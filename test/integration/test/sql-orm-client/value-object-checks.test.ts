import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import postgresAdapterControl from '@internal/adapter-postgres/control';
import postgresAdapter from '@internal/adapter-postgres/runtime';
import type { Contract } from '@internal/contract/types';
import postgresDriverControl from '@internal/driver-postgres/control';
import postgresDriver from '@internal/driver-postgres/runtime';
import sqlFamilyControl, { INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
import { APP_SPACE_ID, createControlStack } from '@internal/framework-components/control';
import { instantiateExecutionStack } from '@internal/framework-components/execution';
import { buildFabricatedMigrationEdge } from '@internal/migration-tools/aggregate';
import { PostgresRuntimeImpl } from '@internal/postgres/runtime';
import type { SqlStorage } from '@internal/sql-contract/types';
import { Collection } from '@internal/sql-orm-client';
import { createExecutionContext, createSqlExecutionStack } from '@internal/sql-runtime';
import postgresTargetControl from '@internal/target-postgres/control';
import postgresTarget from '@internal/target-postgres/runtime';
import { timeouts, withDevDatabase } from '@repo/test-utils';
import { dirname, join } from 'pathe';
import { Client } from 'pg';
import { describe, expect, it } from 'vitest';
import { authorSqlContractFromPsl } from '../scalar-lists/psl-list-authoring';

const schema = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'fixtures/value-object-checks/contract.prisma'),
  'utf-8',
);

const controlStack = createControlStack({
  family: sqlFamilyControl,
  target: postgresTargetControl,
  adapter: postgresAdapterControl,
  driver: postgresDriverControl,
  extensions: [],
});

async function authored(): Promise<Contract<SqlStorage>> {
  const result = await authorSqlContractFromPsl(schema);
  expect(result.diagnostics).toEqual([]);
  const { contract } = result;
  if (contract === undefined) throw new Error('the fixture did not author a contract');
  return contract;
}

const frameworkComponents = [
  postgresTargetControl,
  postgresAdapterControl,
  postgresDriverControl,
] as const;

/** Plans the contract against the empty database and applies it, as `db update` does, then verifies the database against it. */
async function pushAndVerify(contract: Contract<SqlStorage>, connectionString: string) {
  const family = sqlFamilyControl.create(controlStack);
  const driver = await postgresDriverControl.create(connectionString);
  try {
    const planResult = postgresTargetControl
      .createPlanner(postgresAdapterControl.create(controlStack))
      .plan({
        contract,
        schema: await family.introspect({ driver, contract }),
        policy: INIT_ADDITIVE_POLICY,
        fromContract: null,
        origin: null,
        statements: [],
        frameworkComponents,
        spaceId: APP_SPACE_ID,
        snapshotsImportPath: '../../snapshots',
      });
    if (planResult.kind !== 'success') throw new Error(JSON.stringify(planResult));
    const { plan } = planResult;
    const applied = await postgresTargetControl.createRunner(family).execute({
      driver,
      perSpaceOptions: [
        {
          space: plan.spaceId ?? APP_SPACE_ID,
          plan,
          migrationEdges: [
            buildFabricatedMigrationEdge({
              currentMarkerStorageHash: plan.origin?.storageHash,
              destinationStorageHash: plan.destination.storageHash,
              operationCount: plan.operations.length,
            }),
          ],
          driver,
          destinationContract: contract,
          policy: INIT_ADDITIVE_POLICY,
          frameworkComponents,
        },
      ],
    });
    if (!applied.ok) throw new Error(JSON.stringify(applied.failure));
    return family.verifySchema({
      contract,
      schema: await family.introspect({ driver, contract }),
      strict: true,
      frameworkComponents,
    });
  } finally {
    await driver.close();
  }
}

/** One connection for the ORM and for raw SQL: the PGlite-backed dev server takes one at a time. */
async function withRuntime(
  contract: Contract<SqlStorage>,
  connectionString: string,
  fn: (runtime: PostgresRuntimeImpl, client: Client) => Promise<void>,
): Promise<void> {
  const client = new Client({ connectionString });
  await client.connect();
  const stack = createSqlExecutionStack({
    target: postgresTarget,
    adapter: postgresAdapter,
    driver: {
      ...postgresDriver,
      create() {
        return postgresDriver.create({ cursor: { disabled: true } });
      },
    },
  });
  const instance = instantiateExecutionStack(stack);
  if (instance.adapter === undefined || instance.driver === undefined) {
    throw new Error('the Postgres execution stack has no adapter or driver');
  }
  await instance.driver.connect({ kind: 'pgClient', client, ownedByDriver: false });
  const runtime = new PostgresRuntimeImpl({
    closeRefusal: undefined,
    context: createExecutionContext({ contract, stack }),
    adapter: instance.adapter,
    driver: instance.driver,
    middleware: [],
  });
  try {
    await fn(runtime, client);
  } finally {
    await runtime.close();
    await client.end();
  }
}

const geo = { lat: 59.9, lng: 10.7 };
const place = {
  label: 'Home',
  kind: 'home',
  tags: ['a'],
  ratings: [1, null],
  geo,
  stops: [geo],
};

function without(key: string, value: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(value).filter(([name]) => name !== key));
}

async function insertTrip(
  client: Client,
  columns: Partial<Record<'origin' | 'detour' | 'legs' | 'menu', unknown>>,
) {
  const values = { origin: place, legs: [], ...columns };
  const names = Object.keys(values);
  await client.query(
    `insert into trip (id, ${names.map((name) => `"${name}"`).join(', ')}) values ((select coalesce(max(id), 0) + 1 from trip), ${names.map((_, index) => `$${index + 1}::jsonb`).join(', ')})`,
    Object.values(values).map((value) => (value === undefined ? null : JSON.stringify(value))),
  );
}

const refused = { code: '23514' };

describe('derived checks of value object and discriminator columns on Postgres', () => {
  it(
    'are created by db update, verify cleanly, accept the rows the ORM writes and refuse rows that do not fit',
    async () => {
      const contract = await authored();
      await withDevDatabase(async ({ connectionString }) => {
        expect(await pushAndVerify(contract, connectionString)).toMatchObject({ ok: true });

        await withRuntime(contract, connectionString, async (runtime, client) => {
          const tables = contract.storage.namespaces['public']?.entries.table ?? {};
          const declared = ['trip', 'shape'].flatMap((table) => tables[table]?.checks ?? []);
          const live = await client.query<{ conname: string }>(
            "select conname from pg_constraint where contype = 'c' and conrelid in ('trip'::regclass, 'shape'::regclass) order by conname",
          );
          expect({
            prefixes: declared.map((check) => check.prefix),
            live: live.rows.map((row) => row.conname),
          }).toEqual({
            prefixes: [
              'trip_detour_shape',
              'trip_legs_shape',
              'trip_menu_shape',
              'trip_origin_shape',
              'shape_kind_check',
            ],
            live: declared.map((check) => check.name).sort(),
          });

          const context = createExecutionContext({
            contract,
            stack: createSqlExecutionStack({ target: postgresTarget, adapter: postgresAdapter }),
          });
          const trips = new Collection({ runtime, context }, 'Trip', { namespaceId: 'public' });
          await trips.create({
            id: 1,
            origin: { ...place, note: 'gate code 4' },
            detour: { ...place, note: null, ratings: [] },
            legs: [place, place],
            menu: { title: 'root', children: [{ title: 'child', children: [] }] },
          } as never);
          await trips.create({ id: 2, origin: place, legs: [] } as never);
          const written = await client.query(
            'select id, detour is null as detour_sql_null, menu is null as menu_sql_null from trip order by id',
          );
          expect(written.rows).toEqual([
            { id: 1, detour_sql_null: false, menu_sql_null: false },
            { id: 2, detour_sql_null: true, menu_sql_null: true },
          ]);

          const acceptedRows: Record<string, Partial<Record<string, unknown>>> = {
            'SQL NULL in a nullable column': { detour: undefined },
            'JSON null in a nullable column': { detour: null },
            'a nullable member that is absent': { origin: place },
            'a nullable member that is JSON null': { origin: { ...place, note: null } },
            'null elements in a list whose elements are nullable': {
              origin: { ...place, ratings: [null, 2] },
            },
            'any object below where a value object refers back into itself': {
              menu: { title: 'a', children: [{ anything: 1 }] },
            },
          };
          const refusedRows: Record<string, Partial<Record<string, unknown>>> = {
            'a missing key': { origin: without('label', place) },
            'an extra key': { origin: { ...place, extra: 1 } },
            'a wrong JSON type': { origin: { ...place, label: 1 } },
            'a value outside the enum': { origin: { ...place, kind: 'school' } },
            'a null element in a list whose elements are not nullable': {
              origin: { ...place, tags: [null] },
            },
            'a list member that is not an array': { origin: { ...place, ratings: 'x' } },
            'a nested object with a wrong JSON type': {
              origin: { ...place, geo: { lat: 'x', lng: 1 } },
            },
            'a nested object with a missing key': { origin: { ...place, geo: { lat: 1 } } },
            'a list of nested objects with an extra key': {
              origin: { ...place, stops: [{ ...geo, alt: 1 }] },
            },
            'JSON null in a required column': { origin: null },
            'a null element in a list column': { legs: [null] },
            'an object in a list column': { legs: place },
            'a member below where a value object refers back into itself that is not an object': {
              menu: { title: 'a', children: [1] },
            },
            'a missing key above where a value object refers back into itself': {
              menu: { children: [] },
            },
          };
          const outcomes = async (rows: Record<string, Partial<Record<string, unknown>>>) => {
            const results: Record<string, unknown> = {};
            for (const [name, columns] of Object.entries(rows)) {
              results[name] = await insertTrip(client, columns).then(
                () => 'accepted',
                (error: { code?: string }) => ({ code: error.code }),
              );
            }
            return results;
          };
          expect({
            accepted: await outcomes(acceptedRows),
            refused: await outcomes(refusedRows),
          }).toEqual({
            accepted: Object.fromEntries(
              Object.keys(acceptedRows).map((name) => [name, 'accepted']),
            ),
            refused: Object.fromEntries(Object.keys(refusedRows).map((name) => [name, refused])),
          });

          const shapes = new Collection({ runtime, context }, 'Shape', { namespaceId: 'public' });
          await shapes
            .variant('circle' as never)
            .create({ id: 1, name: 'wheel', radius: 2 } as never);
          await expect(
            client.query(`insert into shape (id, kind, name) values (2, 'triangle', 'x')`),
          ).rejects.toMatchObject(refused);
        });
      });
    },
    timeouts.spinUpPpgDev,
  );
});
