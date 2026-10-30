import type { Contract } from '@internal/contract/types';
import { coreHash } from '@internal/contract/types';
import { SqlStorage } from '@internal/sql-contract/types';
import { RawQueryAst } from '@internal/sql-relational-core/ast';
import { planFromAst } from '@internal/sql-relational-core/plan';
import { sqliteCreateNamespace } from '@internal/target-sqlite/types';
import { createContract } from '@repo/test-utils';
import { describe, expect, it, vi } from 'vitest';
import sqlite from '../src/runtime/sqlite';

const contract: Contract<SqlStorage> = createContract<SqlStorage>({
  target: 'sqlite',
  storage: new SqlStorage({
    storageHash: coreHash('sqlite-log-test'),
    namespaces: {
      __unbound__: sqliteCreateNamespace({ id: '__unbound__', entries: { table: {} } }),
    },
  }),
});

function selectOne(db: ReturnType<typeof sqlite<Contract<SqlStorage>>>) {
  return planFromAst<{ id: number }>(
    RawQueryAst.rows(['select 1 as id'], {
      id: { codecId: 'sqlite/integer@1', nullable: false },
    }),
    db.contract,
  );
}

describe('sqlite log option', () => {
  it('receives the marker-verification warning when the database has no marker', async () => {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const db = sqlite({ contract, path: ':memory:', log });

    await db.runtime().query(selectOne(db)).toArray();

    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'CONTRACT.MARKER_MISSING', scope: 'marker-verification' }),
    );
    await db.close();
  });

  it('without a log, a query on a database with no marker still succeeds', async () => {
    const db = sqlite({ contract, path: ':memory:' });

    await expect(db.runtime().query(selectOne(db)).toArray()).resolves.toEqual([{ id: 1 }]);
    await db.close();
  });
});
