import mysqlDriver from '@internal/driver-mysql/runtime';
import { AsyncIterableResult } from '@internal/framework-components/runtime';
import type { RuntimeConnection } from '@internal/sql-runtime';
import { afterEach, describe, expect, it, vi } from 'vitest';
import mysql, { type MysqlTransactionOptions } from '../../src/exports/runtime';
import { contractFromJson } from '../../src/exports/static';
import type { Contract } from '../fixtures/generated/contract.d';
import contractJson from '../fixtures/generated/contract.json' with { type: 'json' };

const contract = contractFromJson<Contract>(contractJson);

afterEach(() => vi.useRealTimers());

function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('MySQL callback isolation options', () => {
  it.each([
    [10, undefined, true],
    [10, null, false],
    [null, 1, true],
    [undefined, undefined, false],
    [2147483647, null, false],
  ] as const)(
    'resolves global timeout %s and local %s independently of isolation',
    async (global, local, expires) => {
      const db = mysql({
        contract,
        transactionOptions: { isolationLevel: 'RepeatableRead', timeout: global },
      });
      const tx = {
        query: () => new AsyncIterableResult((async function* () {})()),
        execute: async () => ({ affectedRows: 0 }),
        commit: vi.fn(async () => {}),
        rollback: vi.fn(async () => {}),
      };
      const connection = {
        ...tx,
        transaction: vi.fn(async (...args: Parameters<RuntimeConnection['transaction']>) => {
          args[1]?.started({ invalidate: () => true });
          return tx;
        }),
        release: vi.fn(async () => {}),
        destroy: vi.fn(async () => {}),
      };
      vi.spyOn(db.runtime(), 'connection').mockResolvedValue(connection);
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
      const entered = deferred();
      const resume = deferred();
      const run = db.transaction(
        async () => {
          entered.resolve();
          await resume.promise;
          return 42;
        },
        { isolationLevel: 'Serializable', timeout: local },
      );
      const outcome = expires
        ? expect(run).rejects.toMatchObject({ code: 'RUNTIME.TRANSACTION_TIMEOUT' })
        : expect(run).resolves.toBe(42);
      await entered.promise;
      await vi.advanceTimersByTimeAsync(20);
      resume.resolve();
      await outcome;
      expect(connection.transaction.mock.calls[0]?.[0]).toEqual({ isolationLevel: 'Serializable' });
      expect(tx.rollback).toHaveBeenCalledTimes(expires ? 1 : 0);
      expect(tx.commit).toHaveBeenCalledTimes(expires ? 0 : 1);
      expect(connection.release).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
      await db.close();
    },
  );
  it.each([
    [undefined, undefined, undefined],
    [{}, {}, undefined],
    [{ isolationLevel: undefined }, { isolationLevel: undefined }, undefined],
    [{ isolationLevel: 'RepeatableRead' }, undefined, 'RepeatableRead'],
    [{ isolationLevel: 'RepeatableRead' }, {}, 'RepeatableRead'],
    [{ isolationLevel: 'RepeatableRead' }, { isolationLevel: undefined }, 'RepeatableRead'],
    [{ isolationLevel: 'RepeatableRead' }, { isolationLevel: 'Serializable' }, 'Serializable'],
    [undefined, { isolationLevel: 'ReadUncommitted' }, 'ReadUncommitted'],
    [undefined, { isolationLevel: 'ReadCommitted' }, 'ReadCommitted'],
  ] as const)('resolves global %j and local %j', async (global, local, isolationLevel) => {
    const db = mysql({ contract, transactionOptions: global });
    const transaction = {
      query: () => new AsyncIterableResult((async function* () {})()),
      execute: async () => ({ affectedRows: 0 }),
      commit: vi.fn(async () => undefined),
      rollback: vi.fn(async () => undefined),
    };
    const connection = {
      ...transaction,
      transaction: vi.fn(async () => transaction),
      release: vi.fn(async () => undefined),
      destroy: vi.fn(async () => undefined),
    };
    vi.spyOn(db.runtime(), 'connection').mockResolvedValue(connection);
    try {
      expect(await db.transaction(async () => 42, local)).toBe(42);
      expect(connection.transaction).toHaveBeenCalledExactlyOnceWith({ isolationLevel }, undefined);
    } finally {
      await db.close();
    }
  });

  const invalid = [
    ...[0, -1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 2147483648].map(
      (timeout) => ({ timeout }),
    ),
    null,
    1,
    'Serializable',
    { isolationLevel: null },
    { isolationLevel: false },
    { isolationLevel: 'unknown' },
    { isolationLevel: 'Serializable; SELECT 1' },
    { unknown: true },
  ];

  it.each(invalid)('rejects global %j before driver creation', (value) => {
    const create = vi.spyOn(mysqlDriver, 'create');
    try {
      expect(() =>
        mysql({ contract, transactionOptions: value as MysqlTransactionOptions }),
      ).toThrow(expect.objectContaining({ code: 'RUNTIME.ARGUMENT_INVALID' }));
      expect(create).not.toHaveBeenCalled();
    } finally {
      create.mockRestore();
    }
  });

  it.each(invalid)('rejects local %j before acquisition and callback', async (value) => {
    const db = mysql({ contract });
    const acquire = vi.spyOn(db.runtime(), 'connection');
    const callback = vi.fn(async () => 42);
    try {
      await expect(
        db.transaction(callback, value as MysqlTransactionOptions),
      ).rejects.toMatchObject({
        code: 'RUNTIME.ARGUMENT_INVALID',
        why: expect.any(String),
        fix: expect.any(String),
      });
      expect(acquire).not.toHaveBeenCalled();
      expect(callback).not.toHaveBeenCalled();
    } finally {
      await db.close();
    }
  });
});
