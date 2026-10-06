import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import {
  Index,
  indexInputFromSerialized,
  type SerializedIndex,
  StorageTable,
} from '@internal/sql-contract/types';
import { describe, expect, it } from 'vitest';
import {
  SqliteDatabase,
  SqliteUnboundDatabase,
  sqliteCreateNamespace,
} from '../src/core/sqlite-unbound-database';

describe('SqliteUnboundDatabase', () => {
  it('materializes kind non-enumerably as sqlite-namespace', () => {
    expect(SqliteUnboundDatabase.instance.kind).toBe('sqlite-namespace');
    expect(Object.keys(SqliteUnboundDatabase.instance)).not.toContain('kind');
  });

  it('exposes the framework-reserved unbound id as its singleton id', () => {
    expect(SqliteUnboundDatabase.instance.id).toBe(UNBOUND_NAMESPACE_ID);
  });

  it('carries an empty frozen tables map', () => {
    expect(SqliteUnboundDatabase.instance.entries['table']).toEqual({});
    expect(Object.isFrozen(SqliteUnboundDatabase.instance.entries['table'])).toBe(true);
  });

  it('elides every qualifier — SQLite has no schema concept and emits unqualified DDL', () => {
    expect(SqliteUnboundDatabase.instance.qualifier()).toBe('');
    expect(SqliteUnboundDatabase.instance.qualifyTable('users')).toBe('"users"');
  });

  it('is a stable singleton — repeated access returns the same instance', () => {
    expect(SqliteUnboundDatabase.instance).toBe(SqliteUnboundDatabase.instance);
  });
});

describe('SqliteDatabase', () => {
  it('qualifies table names without a schema prefix for runtime SQL rendering', () => {
    const database = new SqliteDatabase({
      id: UNBOUND_NAMESPACE_ID,
      entries: {
        table: {
          user: new StorageTable({
            columns: {
              id: { codecId: 'sqlite/integer@1', dataType: 'sqlite/integer', nullable: false },
            },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          }),
        },
      },
    });
    expect(database.qualifyTable('user')).toBe('"user"');
  });
});

describe('sqliteCreateNamespace factory', () => {
  it('returns the unbound singleton for the framework-reserved sentinel', () => {
    expect(sqliteCreateNamespace({ id: UNBOUND_NAMESPACE_ID, entries: { table: {} } })).toBe(
      SqliteUnboundDatabase.instance,
    );
  });

  it('rejects every non-unbound coordinate — SQLite contracts cannot declare named namespaces', () => {
    expect(() => sqliteCreateNamespace({ id: 'auth', entries: { table: {} } })).toThrow(
      /SQLite has no schema concept/,
    );
  });

  it('unknown kind with zero tables carries it through, not returning the unbound singleton', () => {
    const ns = sqliteCreateNamespace({
      id: UNBOUND_NAMESPACE_ID,
      entries: { bogus: { item: {} } } as never,
    });
    expect(ns.entries['bogus']).toBeDefined();
    expect(ns).not.toBe(SqliteUnboundDatabase.instance);
  });
});

describe('SqliteDatabase — entries open dictionary', () => {
  it('exact-shape serialization: JSON.stringify emits only id and entries', () => {
    const db = new SqliteDatabase({
      id: UNBOUND_NAMESPACE_ID,
      entries: { table: { users: { columns: {}, uniques: [], indexes: [], foreignKeys: [] } } },
    });
    const parsed = JSON.parse(JSON.stringify(db)) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(['entries', 'id']);
  });

  it('kind is non-enumerable', () => {
    const db = new SqliteDatabase({ id: UNBOUND_NAMESPACE_ID, entries: { table: {} } });
    expect(Object.keys(db)).not.toContain('kind');
    expect(db.kind).toBe('sqlite-namespace');
  });

  it('entries is frozen after construction', () => {
    const db = new SqliteDatabase({ id: UNBOUND_NAMESPACE_ID, entries: { table: {} } });
    expect(Object.isFrozen(db.entries)).toBe(true);
  });

  it('inner table map is frozen', () => {
    const db = new SqliteDatabase({
      id: UNBOUND_NAMESPACE_ID,
      entries: {
        table: { users: { columns: {}, uniques: [], indexes: [], foreignKeys: [] } },
      },
    });
    expect(Object.isFrozen(db.entries['table'])).toBe(true);
  });

  it('table getter returns the frozen name-keyed map from entries', () => {
    const db = new SqliteDatabase({
      id: UNBOUND_NAMESPACE_ID,
      entries: {
        table: { users: { columns: {}, uniques: [], indexes: [], foreignKeys: [] } },
      },
    });
    expect(db.table).toBe(db.entries['table']);
  });

  it('table getter is non-enumerable', () => {
    const db = new SqliteDatabase({ id: UNBOUND_NAMESPACE_ID, entries: { table: {} } });
    expect(Object.keys(db)).not.toContain('table');
  });

  it('table getter returns StorageTable instances', () => {
    const db = new SqliteDatabase({
      id: UNBOUND_NAMESPACE_ID,
      entries: {
        table: { users: { columns: {}, uniques: [], indexes: [], foreignKeys: [] } },
      },
    });
    expect(db.table['users']).toBeInstanceOf(StorageTable);
  });

  it('entries[kind][name] resolves the same as getter[name]', () => {
    const db = new SqliteDatabase({
      id: UNBOUND_NAMESPACE_ID,
      entries: {
        table: { users: { columns: {}, uniques: [], indexes: [], foreignKeys: [] } },
      },
    });
    expect(db.entries['table']?.['users']).toBe(db.table['users']);
  });

  it('node itself is frozen', () => {
    const db = new SqliteDatabase({ id: UNBOUND_NAMESPACE_ID, entries: { table: {} } });
    expect(Object.isFrozen(db)).toBe(true);
  });
});

describe('SqliteDatabase — unknown entity kind', () => {
  it('carries an unknown kind through frozen as-is (permissive-carry)', () => {
    const bogusMap = Object.freeze({ foo: { x: 1 } });
    const db = new SqliteDatabase({
      id: UNBOUND_NAMESPACE_ID,
      entries: { table: {}, bogus: bogusMap } as never,
    });
    expect(db.entries['bogus']).toEqual(bogusMap);
    expect(Object.isFrozen(db.entries['bogus'])).toBe(true);
  });

  it('unknown kind survives JSON.stringify round-trip', () => {
    const db = new SqliteDatabase({
      id: UNBOUND_NAMESPACE_ID,
      entries: { table: {}, bogus: { item: { value: 42 } } } as never,
    });
    const parsed = JSON.parse(JSON.stringify(db)) as Record<string, unknown>;
    expect((parsed['entries'] as Record<string, unknown>)['bogus']).toEqual({
      item: { value: 42 },
    });
  });
});

describe('SqliteUnboundDatabase — entries open dictionary', () => {
  it('exact-shape serialization: JSON.stringify emits only id and entries', () => {
    const parsed = JSON.parse(JSON.stringify(SqliteUnboundDatabase.instance)) as Record<
      string,
      unknown
    >;
    expect(Object.keys(parsed).sort()).toEqual(['entries', 'id']);
  });

  it('table getter returns the frozen empty map', () => {
    expect(SqliteUnboundDatabase.instance.table).toBe(
      SqliteUnboundDatabase.instance.entries['table'],
    );
    expect(SqliteUnboundDatabase.instance.table).toEqual({});
  });

  it('table getter is non-enumerable', () => {
    expect(Object.keys(SqliteUnboundDatabase.instance)).not.toContain('table');
  });
});

describe('sqliteCreateNamespace — expression/partial index rejection', () => {
  function tableWithIndex(flat: Record<string, unknown>) {
    const index = new Index(indexInputFromSerialized(flat as SerializedIndex));
    return {
      id: UNBOUND_NAMESPACE_ID,
      entries: {
        table: {
          user: new StorageTable({
            columns: {
              id: { dataType: 'sqlite/integer', codecId: 'sqlite/integer@1', nullable: false },
              email: { dataType: 'sqlite/text', codecId: 'sqlite/text@1', nullable: false },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [index],
            foreignKeys: [],
          }),
        },
      },
    };
  }

  it('rejects an expression index with a clear not-supported error', () => {
    let caught: unknown;
    try {
      sqliteCreateNamespace(
        tableWithIndex({ name: 'users_email_eq', expression: 'lower(email)', unique: false }),
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({
      code: 'CONTRACT.ARGUMENT_INVALID',
      message: expect.stringContaining('SQLite does not support expression or partial indexes'),
    });
    expect(String((caught as Error).message)).toContain('users_email_eq');
  });

  it('rejects a partial (where) index with the same error', () => {
    expect(() =>
      sqliteCreateNamespace(
        tableWithIndex({
          name: 'users_email_active',
          columns: ['email'],
          where: 'deleted_at IS NULL',
          unique: false,
        }),
      ),
    ).toThrow('SQLite does not support expression or partial indexes');
  });

  it('accepts fields-only indexes unchanged', () => {
    const namespace = sqliteCreateNamespace(
      tableWithIndex({ name: 'users_email_idx', columns: ['email'], unique: false }),
    );
    expect(namespace.id).toBe(UNBOUND_NAMESPACE_ID);
  });
});
