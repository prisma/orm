import { once } from 'node:events';
import { createConnection, createServer, type Socket } from 'node:net';
import { INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
import { APP_SPACE_ID } from '@internal/framework-components/control';
import { SqlConnectionError } from '@internal/sql-errors';
import type { PostgresPlanTargetDetails } from '@internal/target-postgres/planner-target-details';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  contract,
  createDriver,
  createMigrationPlan,
  createTestDatabase,
  familyInstance,
  frameworkComponents,
  type PostgresControlDriver,
  postgresTargetDescriptor,
  resetDatabase,
  synthEdges,
  testTimeout,
  toPlanContractInfo,
} from './fixtures/runner-fixtures';

const LOST_STEP_SQL = 'create table "user" (id int primary key)';

/** A TCP proxy in front of the database whose connections can be cut. */
async function startCuttingProxy(target: { readonly host: string; readonly port: number }) {
  const sockets = new Set<Socket>();
  const server = createServer((downstream) => {
    const upstream = createConnection(target);
    for (const socket of [downstream, upstream]) {
      sockets.add(socket);
      socket.on('error', () => undefined);
      socket.on('close', () => {
        sockets.delete(socket);
        downstream.destroy();
        upstream.destroy();
      });
    }
    downstream.pipe(upstream);
    upstream.pipe(downstream);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('proxy has no port');
  const cut = () => {
    for (const socket of sockets) socket.destroy();
  };
  return {
    port: address.port,
    cut,
    close: async () => {
      cut();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function lostStepPlan() {
  return createMigrationPlan<PostgresPlanTargetDetails>({
    targetId: 'postgres',
    spaceId: APP_SPACE_ID,
    origin: null,
    destination: toPlanContractInfo(contract),
    operations: [
      {
        id: 'table.user',
        label: 'Create user table',
        summary: 'Creates the user table',
        operationClass: 'additive',
        target: {
          id: 'postgres',
          details: { schema: 'public', objectType: 'table', name: 'user' },
        },
        precheck: [],
        execute: [{ description: 'create user table', sql: LOST_STEP_SQL }],
        postcheck: [],
      },
    ],
    providedInvariants: [],
  });
}

function runPlan(control: PostgresControlDriver) {
  const plan = lostStepPlan();
  return postgresTargetDescriptor.createRunner(familyInstance).execute({
    driver: control,
    perSpaceOptions: [
      {
        space: APP_SPACE_ID,
        plan,
        migrationEdges: synthEdges(plan),
        driver: control,
        destinationContract: contract,
        policy: INIT_ADDITIVE_POLICY,
        frameworkComponents,
      },
    ],
  });
}

describe('PostgresMigrationRunner - a session the server ends during a step', {
  concurrent: false,
}, () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let driver: PostgresControlDriver | undefined;

  beforeAll(async () => {
    database = await createTestDatabase();
  }, testTimeout);

  afterAll(async () => {
    await database?.close();
  }, testTimeout);

  beforeEach(async () => {
    driver = await createDriver(database.connectionString);
    await resetDatabase(driver);
  }, testTimeout);

  afterEach(async () => {
    await driver?.close();
    driver = undefined;
  }, testTimeout);

  it('fails with EXECUTION_FAILED naming the operation and the SQLSTATE', {
    timeout: testTimeout,
  }, async () => {
    const control = driver!;
    const query = control.query.bind(control);
    vi.spyOn(control, 'query').mockImplementation((sql, params) =>
      sql === LOST_STEP_SQL
        ? Promise.reject(
            new SqlConnectionError('terminating connection due to administrator command', {
              sqlState: '57P01',
              transient: true,
            }),
          )
        : query(sql, params),
    );

    const failure = (await runPlan(control)).assertNotOk();

    expect(failure.code).toBe('MIGRATION.EXECUTION_FAILED');
    expect(failure.meta).toMatchObject({
      operationId: 'table.user',
      stepDescription: 'create user table',
      sql: LOST_STEP_SQL,
      sqlState: '57P01',
      connectionLost: true,
      transient: true,
    });
  });

  it('keeps EXECUTION_FAILED when the connection is cut mid-step and the ROLLBACK fails too', {
    timeout: testTimeout,
  }, async () => {
    const url = new URL(database.connectionString);
    const proxy = await startCuttingProxy({ host: url.hostname, port: Number(url.port) });
    url.host = `127.0.0.1:${proxy.port}`;
    const control = await createDriver(url.toString());
    try {
      const query = control.query.bind(control);
      vi.spyOn(control, 'query').mockImplementation((sql, params) => {
        if (sql === LOST_STEP_SQL) proxy.cut();
        return query(sql, params);
      });

      const failure = (await runPlan(control)).assertNotOk();

      expect(failure.code).toBe('MIGRATION.EXECUTION_FAILED');
      expect(failure.meta).toMatchObject({
        operationId: 'table.user',
        sql: LOST_STEP_SQL,
        connectionLost: true,
      });
    } finally {
      await control.close();
      await proxy.close();
    }
  });
});
