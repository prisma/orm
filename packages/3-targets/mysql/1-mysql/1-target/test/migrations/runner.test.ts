import type { SqlControlFamilyInstance } from '@internal/family-sql/control';
import { createMigrationPlan } from '@internal/family-sql/control';
import type { SqlControlDriverInstance } from '@internal/sql-contract/types';
import { InternalError } from '@internal/utils/internal-error';
import { structuredError } from '@internal/utils/structured-error';
import { describe, expect, it } from 'vitest';
import type { MysqlPlanTargetDetails } from '../../src/core/migrations/planner-target-details';
import { createMysqlMigrationRunner } from '../../src/core/migrations/runner';

const HASH = 'sha256:destination';

interface RecorderOptions {
  readonly failExecute?: string;
  readonly throwOn?: (event: string) => Error | undefined;
}

function recorder(options: RecorderOptions = {}) {
  const events: string[] = [];
  const postchecksSeen = new Map<string, number>();
  const driver = {
    familyId: 'sql',
    targetId: 'mysql',
    async query(sql: string) {
      const name = sql.startsWith('SELECT GET_LOCK')
        ? 'GET_LOCK'
        : sql.startsWith('SELECT RELEASE_LOCK')
          ? 'RELEASE_LOCK'
          : sql;
      events.push(name);
      const thrown = options.throwOn?.(name);
      if (thrown !== undefined) throw thrown;
      if (name === 'GET_LOCK') return { rows: [{ acquired: '1' }] };
      if (sql.startsWith('POST')) {
        const seen = (postchecksSeen.get(sql) ?? 0) + 1;
        postchecksSeen.set(sql, seen);
        return { rows: [{ result: seen === 1 ? '0' : '1' }] };
      }
      if (sql === `EXEC ${options.failExecute}`) throw new Error('DDL failed');
      return { rows: [{ result: '1' }] };
    },
    async close() {},
  } as unknown as SqlControlDriverInstance<'mysql'>;
  const family = {
    bootstrapControlTableQueries: () => [],
    async readMarker() {
      events.push('readMarker');
      const thrown = options.throwOn?.('readMarker');
      if (thrown !== undefined) throw thrown;
      return null;
    },
    async introspect() {
      events.push('introspect');
      const thrown = options.throwOn?.('introspect');
      if (thrown !== undefined) throw thrown;
      return {};
    },
    verifySchema() {
      events.push('verifySchema');
      return { ok: true };
    },
    async initMarker({ space }: { space: string }) {
      events.push(`initMarker ${space}`);
    },
    async writeLedgerEntry({ space }: { space: string }) {
      events.push(`writeLedgerEntry ${space}`);
      const thrown = options.throwOn?.(`writeLedgerEntry ${space}`);
      if (thrown !== undefined) throw thrown;
    },
  } as unknown as SqlControlFamilyInstance;
  return { events, driver, family };
}

function planFor(space: string) {
  return createMigrationPlan<MysqlPlanTargetDetails>({
    targetId: 'mysql',
    spaceId: space,
    origin: null,
    destination: { storageHash: HASH },
    operations: [
      {
        id: `table.${space}`,
        label: `Create table ${space}`,
        operationClass: 'additive',
        target: { id: 'mysql', details: { objectType: 'table' as const, name: space } },
        precheck: [{ description: 'absent', sql: `PRE ${space}` }],
        execute: [{ description: 'create', sql: `EXEC ${space}` }],
        postcheck: [{ description: 'present', sql: `POST ${space}` }],
      },
    ],
    providedInvariants: [],
  });
}

function run(recorded: ReturnType<typeof recorder>, spaces: readonly string[]) {
  return createMysqlMigrationRunner(recorded.family).execute({
    driver: recorded.driver,
    perSpaceOptions: spaces.map((space) => ({
      space,
      plan: planFor(space),
      driver: recorded.driver,
      destinationContract: { storage: { storageHash: HASH } } as never,
      policy: { allowedOperationClasses: ['additive'] },
      frameworkComponents: [],
      migrationEdges: [
        {
          from: 'sha256:empty',
          to: HASH,
          dirName: `m-${space}`,
          migrationHash: 'sha256:m',
          operationCount: 1,
        } as never,
      ],
    })),
  });
}

describe('the MySQL migration runner', () => {
  it('applies, verifies and marks each space in turn, holding the marker lock throughout', async () => {
    const recorded = recorder();
    const result = await run(recorded, ['ext', 'app']);
    expect({ ok: result.ok, events: recorded.events }).toEqual({
      ok: true,
      events: [
        'GET_LOCK',
        'readMarker',
        'POST ext',
        'PRE ext',
        'EXEC ext',
        'POST ext',
        'introspect',
        'verifySchema',
        'START TRANSACTION',
        'initMarker ext',
        'writeLedgerEntry ext',
        'COMMIT',
        'readMarker',
        'POST app',
        'PRE app',
        'EXEC app',
        'POST app',
        'introspect',
        'verifySchema',
        'START TRANSACTION',
        'initMarker app',
        'writeLedgerEntry app',
        'COMMIT',
        'RELEASE_LOCK',
      ],
    });
  });

  it('stops at a failed space, names it, says the space before it changed the database, and releases the lock', async () => {
    const recorded = recorder({ failExecute: 'app' });
    const result = await run(recorded, ['ext', 'app']);
    expect({
      failure: failureFacts(result),
      last: recorded.events.slice(-2),
      marked: recorded.events.filter((event) => event.startsWith('initMarker')),
    }).toEqual({
      failure: {
        code: 'MIGRATION.EXECUTION_FAILED',
        failingSpace: 'app',
        databaseUnchanged: false,
      },
      last: ['EXEC app', 'RELEASE_LOCK'],
      marked: ['initMarker ext'],
    });
  });

  it('says a failure in the first space before it ran anything changed nothing', async () => {
    const recorded = recorder({ failExecute: 'ext' });
    expect(failureFacts(await run(recorded, ['ext']))).toEqual({
      code: 'MIGRATION.EXECUTION_FAILED',
      failingSpace: 'ext',
      databaseUnchanged: true,
    });
  });
});

function failureFacts(result: Awaited<ReturnType<typeof run>>) {
  return result.ok
    ? undefined
    : {
        code: result.failure.code,
        failingSpace: result.failure.meta.failingSpace,
        databaseUnchanged: result.failure.meta.databaseUnchanged,
      };
}

const connectionLost = () =>
  Object.assign(new Error('Connection lost'), { code: 'DRIVER.NOT_CONNECTED' });

const connectionReset = () => Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });

describe('the MySQL migration runner, when something throws', () => {
  it('keeps the failure of the apply when releasing the lock fails too', async () => {
    const recorded = recorder({
      failExecute: 'ext',
      throwOn: (event) => (event === 'RELEASE_LOCK' ? connectionLost() : undefined),
    });
    expect(failureFacts(await run(recorded, ['ext']))).toEqual({
      code: 'MIGRATION.EXECUTION_FAILED',
      failingSpace: 'ext',
      databaseUnchanged: true,
    });
  });

  it('reports a failed release when the apply succeeded', async () => {
    const recorded = recorder({
      throwOn: (event) => (event === 'RELEASE_LOCK' ? connectionLost() : undefined),
    });
    await expect(run(recorded, ['ext'])).rejects.toThrow('Connection lost');
  });

  it.each([
    ['a check query of the second space', 'POST app', ['ext', 'app'], 1],
    ['introspection after the second space ran', 'introspect', ['ext', 'app'], 2],
    ['the ledger insert of the second space', 'writeLedgerEntry app', ['ext', 'app'], 1],
    ['the commit of a space that ran', 'COMMIT', ['app'], 1],
  ] as const)(
    'turns an error thrown by %s into a failure of that space, and releases the lock',
    async (_name, thrower, spaces, throwAt) => {
      let seen = 0;
      const recorded = recorder({
        throwOn: (event) => {
          if (event !== thrower) return undefined;
          seen += 1;
          return seen === throwAt ? connectionReset() : undefined;
        },
      });
      const result = await run(recorded, spaces);
      expect({
        failure: failureFacts(result),
        errorCode: result.ok ? undefined : result.failure.meta['errorCode'],
        released: recorded.events.at(-1),
      }).toEqual({
        failure: {
          code: 'MIGRATION.EXECUTION_FAILED',
          failingSpace: 'app',
          databaseUnchanged: false,
        },
        errorCode: 'ECONNRESET',
        released: 'RELEASE_LOCK',
      });
    },
  );

  it('rethrows a structured error with its own code, fix and docs link, naming the space and whether the database changed', async () => {
    const corrupt = structuredError('CONTRACT.MARKER_ROW_CORRUPT', 'Marker row is corrupt', {
      fix: 'Delete the row, then run db sign.',
      docsUrl: 'https://pris.ly/marker',
      meta: { space: 'app' },
    });
    let reads = 0;
    const recorded = recorder({
      throwOn: (event) => (event === 'readMarker' && ++reads === 2 ? corrupt : undefined),
    });
    const thrown = await run(recorded, ['ext', 'app']).catch((error: unknown) => error);
    expect({
      same: thrown === corrupt,
      code: corrupt.code,
      fix: corrupt.fix,
      docsUrl: corrupt.docsUrl,
      meta: corrupt.meta,
      released: recorded.events.at(-1),
    }).toEqual({
      same: true,
      code: 'CONTRACT.MARKER_ROW_CORRUPT',
      fix: 'Delete the row, then run db sign.',
      docsUrl: 'https://pris.ly/marker',
      meta: { space: 'app', failingSpace: 'app', databaseUnchanged: false },
      released: 'RELEASE_LOCK',
    });
  });

  it('rethrows an internal error as it is', async () => {
    const bug = new InternalError('broken invariant');
    const recorded = recorder({ throwOn: (event) => (event === 'introspect' ? bug : undefined) });
    await expect(run(recorded, ['app'])).rejects.toBe(bug);
  });
});
