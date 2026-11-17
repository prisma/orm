import type { SqlDriver, SqlExecuteRequest } from '@internal/sql-relational-core/ast';
import { RawQueryAst } from '@internal/sql-relational-core/ast';
import type { AffectedCount } from '@internal/sql-relational-core/expression';
import type { SqlQueryPlan } from '@internal/sql-relational-core/plan';
import { planFromAst } from '@internal/sql-relational-core/plan';
import { describe, expect, it, vi } from 'vitest';
import type { TransactionContext } from '../src/sql-runtime';
import { withTransaction } from '../src/sql-runtime';
import {
  createStubAdapter,
  createTestContext,
  createTestContract,
  createTestRuntime,
  createTestStackInstance,
} from './utils';

/**
 * The transaction facade invalidates its context once the callback returns,
 * and every operation on it refuses afterwards. These pin the refusal on the
 * two prepared-statement bridges, which reach the driver by a different route
 * than `tx.query` / `tx.execute` and so need their own guard.
 */

const contract = createTestContract({ storageHash: 'prepared-closed-transaction' });

function createRecordingDriver(): { driver: SqlDriver; driverCalls: SqlExecuteRequest[] } {
  const driverCalls: SqlExecuteRequest[] = [];

  const record = (request: SqlExecuteRequest): void => {
    driverCalls.push(request);
  };

  const transaction = {
    query: vi.fn().mockImplementation(async function* (request: SqlExecuteRequest) {
      record(request);
      yield { id: 1, email: 'a@b.example' };
    }),
    execute: vi.fn().mockImplementation(async (request: SqlExecuteRequest) => {
      record(request);
      return { affectedRows: 1 };
    }),
    commit: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn().mockResolvedValue(undefined),
  };

  const connection = {
    query: vi.fn().mockImplementation(async function* (request: SqlExecuteRequest) {
      record(request);
      yield { id: 1, email: 'a@b.example' };
    }),
    execute: vi.fn().mockImplementation(async (request: SqlExecuteRequest) => {
      record(request);
      return { affectedRows: 1 };
    }),
    release: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn().mockResolvedValue(undefined),
    beginTransaction: vi.fn().mockResolvedValue(transaction),
  };

  const driver: SqlDriver = {
    query: vi.fn().mockImplementation(async function* (request: SqlExecuteRequest) {
      record(request);
      yield { id: 1, email: 'a@b.example' };
    }),
    execute: vi.fn().mockImplementation(async (request: SqlExecuteRequest) => {
      record(request);
      return { affectedRows: 1 };
    }),
    connect: vi.fn().mockResolvedValue(undefined),
    acquireConnection: vi.fn().mockResolvedValue(connection),
    close: vi.fn().mockResolvedValue(undefined),
  };

  return { driver, driverCalls };
}

function setup() {
  const { driver, driverCalls } = createRecordingDriver();
  const runtime = createTestRuntime({
    stackInstance: createTestStackInstance(),
    context: createTestContext(contract, createStubAdapter()),
    driver,
    verifyMarker: false,
  });

  return { runtime, driverCalls };
}

function rowsPlan(): SqlQueryPlan<{ id: unknown; email: unknown }> {
  return planFromAst(
    RawQueryAst.rows(['select id, email from "user"'], {
      id: { codecId: 'pg/int4@1', nullable: false },
      email: { codecId: 'pg/text@1', nullable: false },
    }),
    contract,
  );
}

function affectedCountPlan(): SqlQueryPlan<AffectedCount> {
  return planFromAst(RawQueryAst.affectedCount(['update "user" set seen = now()']), contract);
}

/**
 * Runs a transaction that ends the way `ending` names, and hands back the
 * context it left behind.
 */
async function endedTransaction(
  runtime: Parameters<typeof withTransaction>[0],
  ending: 'commit' | 'rollback',
): Promise<TransactionContext> {
  let escaped: TransactionContext | undefined;

  const run = withTransaction(runtime, async (tx) => {
    escaped = tx;
    if (ending === 'rollback') throw new Error('callback failed');
  });

  if (ending === 'rollback') {
    await expect(run).rejects.toThrow('callback failed');
  } else {
    await run;
  }

  if (!escaped) throw new Error('the callback never ran');
  return escaped;
}

describe.each(['commit', 'rollback'] as const)(
  'prepared statements against a transaction ended by %s',
  (ending) => {
    it('rejects a query and leaves the driver alone', async () => {
      const { runtime, driverCalls } = setup();
      const prepared = await runtime.prepare({}, () => rowsPlan());
      const tx = await endedTransaction(runtime, ending);

      await expect(prepared.query(tx, {}).toArray()).rejects.toMatchObject({
        code: 'RUNTIME.TRANSACTION_CLOSED',
      });
      expect(driverCalls).toEqual([]);
    });

    it('rejects an execute and leaves the driver alone', async () => {
      const { runtime, driverCalls } = setup();
      const prepared = await runtime.prepare({}, () => affectedCountPlan());
      const tx = await endedTransaction(runtime, ending);

      await expect(prepared.execute(tx, {})).rejects.toMatchObject({
        code: 'RUNTIME.TRANSACTION_CLOSED',
      });
      expect(driverCalls).toEqual([]);
    });
  },
);

describe('a prepared statement given a target that is not a runtime, connection or transaction', () => {
  it('throws at the call, because the call itself is a mistake', async () => {
    const { runtime } = setup();
    const prepared = await runtime.prepare({}, () => rowsPlan());
    const update = await runtime.prepare({}, () => affectedCountPlan());
    const notATarget = { query: () => undefined, execute: () => undefined } as never;

    expect(() => prepared.query(notATarget, {})).toThrow(
      'RuntimeQueryable is missing the prepared statement query bridge',
    );
    expect(() => update.execute(notATarget, {})).toThrow(
      'RuntimeQueryable is missing the prepared statement execute bridge',
    );
  });
});
