import mysqlDriver from '@internal/driver-mysql/runtime';
import { AsyncIterableResult } from '@internal/framework-components/runtime';
import { describe, expect, it, vi } from 'vitest';
import mysql, { type MysqlTransactionOptions } from '../../src/exports/runtime';
import { contractFromJson } from '../../src/exports/static';
import type { Contract } from '../fixtures/generated/contract.d';
import contractJson from '../fixtures/generated/contract.json' with { type: 'json' };

const contract = contractFromJson<Contract>(contractJson);

describe('MySQL callback isolation options', () => {
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
      expect(connection.transaction).toHaveBeenCalledExactlyOnceWith({
        kind: 'explicit',
        isolationLevel,
      });
    } finally {
      await db.close();
    }
  });

  const invalid = [
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
      await expect(async () =>
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
