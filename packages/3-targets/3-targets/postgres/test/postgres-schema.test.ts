import { computeStorageHash } from '@internal/contract/hashing';
import { coreHash } from '@internal/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { SqlStorage, StorageTable } from '@internal/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { PostgresNativeEnum } from '../src/core/postgres-native-enum';
import {
  PostgresSchema,
  PostgresUnboundSchema,
  postgresCreateNamespace,
} from '../src/core/postgres-schema';

const emptyTableInput = {
  columns: {},
  uniques: [],
  indexes: [],
  foreignKeys: [],
} as const;

describe('PostgresSchema', () => {
  it('exposes its id and renders a quoted-identifier qualifier', () => {
    const schema = new PostgresSchema({ id: 'auth', entries: { table: {} } });
    expect(schema.id).toBe('auth');
    expect(schema.qualifier()).toBe('"auth"');
  });

  it('qualifies a table name with the schema prefix', () => {
    const schema = new PostgresSchema({ id: 'auth', entries: { table: {} } });
    expect(schema.qualifyTable('users')).toBe('"auth"."users"');
  });

  it('doubles a double quote inside the schema and table names', () => {
    const schema = new PostgresSchema({ id: 'a"uth', entries: { table: {} } });
    expect(schema.qualifier()).toBe('"a""uth"');
    expect(schema.qualifyTable('us"ers; drop table x; --')).toBe(
      '"a""uth"."us""ers; drop table x; --"',
    );
    expect(schema.regclassLiteral(`it's`)).toBe(`'"a""uth"."it''s"'`);
    expect(PostgresSchema.unbound.qualifyTable('us"ers')).toBe('"us""ers"');
  });

  it('quotes the schema name even when it would otherwise collide with a Postgres keyword', () => {
    const schema = new PostgresSchema({ id: 'public', entries: { table: {} } });
    expect(schema.qualifier()).toBe('"public"');
    expect(schema.qualifyTable('users')).toBe('"public"."users"');
  });

  it('normalises plain table inputs into StorageTable instances', () => {
    const schema = new PostgresSchema({
      id: 'app',
      entries: { table: { users: emptyTableInput } },
    });
    expect(schema.table['users']).toBeInstanceOf(StorageTable);
  });
});

describe('PostgresUnboundSchema', () => {
  it('exposes the framework-reserved unbound id as its singleton id', () => {
    expect(PostgresSchema.unbound).toBeInstanceOf(PostgresUnboundSchema);
    expect(PostgresSchema.unbound.id).toBe(UNBOUND_NAMESPACE_ID);
  });

  it('carries empty frozen tables on the unbound singleton', () => {
    expect(PostgresSchema.unbound.entries['table']).toEqual({});
    expect(Object.isFrozen(PostgresSchema.unbound.entries['table'])).toBe(true);
  });

  it('elides the schema qualifier so emission paths render unqualified output', () => {
    expect(PostgresSchema.unbound.qualifier()).toBe('');
    expect(PostgresSchema.unbound.qualifyTable('users')).toBe('"users"');
  });

  it('is a stable singleton — repeated access returns the same instance', () => {
    expect(PostgresSchema.unbound).toBe(PostgresSchema.unbound);
  });
});

describe('ddlSchemaName', () => {
  const storageWithPublic = new SqlStorage({
    storageHash: coreHash('test-with-public'),
    namespaces: {
      public: new PostgresSchema({ id: 'public', entries: { table: {} } }),
      [UNBOUND_NAMESPACE_ID]: PostgresUnboundSchema.instance,
    },
  });

  const storageWithoutPublic = new SqlStorage({
    storageHash: coreHash('test-without-public'),
    namespaces: {
      auth: new PostgresSchema({ id: 'auth', entries: { table: {} } }),
      [UNBOUND_NAMESPACE_ID]: PostgresUnboundSchema.instance,
    },
  });

  it('returns its own id for a named public schema', () => {
    const schema = new PostgresSchema({ id: 'public', entries: { table: {} } });
    expect(schema.ddlSchemaName(storageWithPublic)).toBe('public');
  });

  it('returns its own id for a named non-public schema', () => {
    const schema = new PostgresSchema({ id: 'auth', entries: { table: {} } });
    expect(schema.ddlSchemaName(storageWithoutPublic)).toBe('auth');
  });

  it('returns the sentinel for the unbound singleton regardless of sibling namespaces', () => {
    expect(PostgresUnboundSchema.instance.ddlSchemaName(storageWithPublic)).toBe(
      UNBOUND_NAMESPACE_ID,
    );
    expect(PostgresUnboundSchema.instance.ddlSchemaName(storageWithoutPublic)).toBe(
      UNBOUND_NAMESPACE_ID,
    );
  });
});

describe('postgresCreateNamespace factory', () => {
  it('returns a PostgresUnboundSchema for the framework-reserved sentinel', () => {
    const namespace = postgresCreateNamespace({ id: UNBOUND_NAMESPACE_ID, entries: { table: {} } });
    expect(namespace).toBeInstanceOf(PostgresUnboundSchema);
    expect(namespace.qualifyTable('users')).toBe('"users"');
  });

  it('materialises a fresh PostgresSchema instance for any named coordinate', () => {
    const auth = postgresCreateNamespace({ id: 'auth', entries: { table: {} } });
    expect(auth).toBeInstanceOf(PostgresSchema);
    expect(auth.id).toBe('auth');
    expect(auth.qualifyTable('users')).toBe('"auth"."users"');
  });

  it('returns distinct PostgresSchema instances for distinct named coordinates', () => {
    const auth = postgresCreateNamespace({ id: 'auth', entries: { table: {} } });
    const billing = postgresCreateNamespace({ id: 'billing', entries: { table: {} } });
    expect(auth).not.toBe(billing);
    expect(auth.id).toBe('auth');
    expect(billing.id).toBe('billing');
  });
});

describe('PostgresSchema — entries open dictionary', () => {
  it('exact-shape serialization: JSON.stringify emits only id and entries', () => {
    const schema = new PostgresSchema({
      id: 'public',
      entries: {
        table: { users: emptyTableInput },
      },
    });
    const parsed = JSON.parse(JSON.stringify(schema)) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(['entries', 'id']);
  });

  it('kind is non-enumerable', () => {
    const schema = new PostgresSchema({ id: 'app', entries: { table: {} } });
    expect(Object.keys(schema)).not.toContain('kind');
    expect(schema.kind).toBe('schema');
  });

  it('entries is frozen after construction', () => {
    const schema = new PostgresSchema({ id: 'app', entries: { table: {} } });
    expect(Object.isFrozen(schema.entries)).toBe(true);
  });

  it('inner table map is frozen', () => {
    const schema = new PostgresSchema({
      id: 'app',
      entries: { table: { users: emptyTableInput } },
    });
    expect(Object.isFrozen(schema.entries['table'])).toBe(true);
  });

  it('table getter returns the frozen name-keyed map from entries', () => {
    const schema = new PostgresSchema({
      id: 'app',
      entries: { table: { users: emptyTableInput } },
    });
    expect(schema.table).toBe(schema.entries['table']);
  });

  it('table getter is non-enumerable', () => {
    const schema = new PostgresSchema({ id: 'app', entries: { table: {} } });
    expect(Object.keys(schema)).not.toContain('table');
  });

  it('valueSet getter returns the frozen name-keyed map when present', () => {
    const schema = new PostgresSchema({
      id: 'app',
      entries: {
        table: {},
        valueSet: { Status: { kind: 'value-set', values: ['active'] } },
      },
    });
    expect(schema.valueSet).toBe(schema.entries['valueSet']);
  });

  it('valueSet getter is non-enumerable', () => {
    const schema = new PostgresSchema({ id: 'app', entries: { table: {} } });
    expect(Object.keys(schema)).not.toContain('valueSet');
  });

  it('valueSet is absent from entries when empty', () => {
    const schema = new PostgresSchema({ id: 'app', entries: { table: {} } });
    expect(schema.entries['valueSet']).toBeUndefined();
  });

  it('valueSet is present in entries when non-empty', () => {
    const schema = new PostgresSchema({
      id: 'app',
      entries: {
        table: {},
        valueSet: { Status: { kind: 'value-set', values: ['active'] } },
      },
    });
    expect(schema.entries['valueSet']).toBeDefined();
  });

  it('table is always present in entries even when empty', () => {
    const schema = new PostgresSchema({ id: 'app', entries: { table: {} } });
    expect(schema.entries['table']).toBeDefined();
  });

  it('entries[kind][name] resolves the same as getter[name] for tables', () => {
    const schema = new PostgresSchema({
      id: 'app',
      entries: { table: { users: emptyTableInput } },
    });
    expect(schema.entries['table']?.['users']).toBe(schema.table['users']);
  });
});

describe('PostgresUnboundSchema — entries open dictionary', () => {
  it('exact-shape serialization: JSON.stringify emits only id and entries', () => {
    const parsed = JSON.parse(JSON.stringify(PostgresUnboundSchema.instance)) as Record<
      string,
      unknown
    >;
    expect(Object.keys(parsed).sort()).toEqual(['entries', 'id']);
  });

  it('table is always present in entries even on unbound singleton', () => {
    expect(PostgresSchema.unbound.entries['table']).toBeDefined();
  });
});

describe('PostgresSchema — unknown entity kind', () => {
  it('carries an unknown kind through frozen as-is (permissive-carry)', () => {
    const bogusMap = Object.freeze({ foo: { x: 1 } });
    const schema = new PostgresSchema({
      id: 'app',
      entries: { table: {}, bogus: bogusMap } as never,
    });
    expect(schema.entries['bogus']).toEqual(bogusMap);
    expect(Object.isFrozen(schema.entries['bogus'])).toBe(true);
  });

  it('unknown kind survives JSON.stringify round-trip', () => {
    const schema = new PostgresSchema({
      id: 'app',
      entries: { table: {}, bogus: { item: { value: 42 } } } as never,
    });
    const parsed = JSON.parse(JSON.stringify(schema)) as Record<string, unknown>;
    expect((parsed['entries'] as Record<string, unknown>)['bogus']).toEqual({
      item: { value: 42 },
    });
  });

  it('forwards an unknown entries kind to the constructor, which carries it (permissive-carry)', () => {
    const schema = postgresCreateNamespace({
      id: 'auth',
      entries: { table: {}, bogus: { item: {} } } as never,
    });
    expect(schema.entries['bogus']).toBeDefined();
  });
});

describe('PostgresSchema — native_enum entries', () => {
  // Keyed by the author handle on input; the constructor re-keys the slot by
  // the entity's physical type name (`aal_level`, ADR 221 coordinate).
  const nativeEnumInput = {
    AalLevel: {
      kind: 'postgres-enum',
      typeName: 'aal_level',
      members: ['aal1', 'aal2', 'aal3'],
      control: 'external',
    },
  };

  it('constructs a PostgresNativeEnum instance from raw entries input', () => {
    const schema = new PostgresSchema({
      id: 'auth',
      entries: { table: {}, native_enum: nativeEnumInput },
    });
    const nativeEnum = schema.entries.native_enum?.['aal_level'];
    expect(nativeEnum).toBeInstanceOf(PostgresNativeEnum);
    expect(nativeEnum?.typeName).toBe('aal_level');
    expect(nativeEnum?.members).toEqual(['aal1', 'aal2', 'aal3']);
    expect(nativeEnum?.control).toBe('external');
  });

  it('native_enum is enumerable on entries', () => {
    const schema = new PostgresSchema({
      id: 'auth',
      entries: { table: {}, native_enum: nativeEnumInput },
    });
    expect(Object.keys(schema.entries)).toContain('native_enum');
  });

  it('native_enum survives a JSON.stringify round-trip', () => {
    const schema = new PostgresSchema({
      id: 'auth',
      entries: { table: {}, native_enum: nativeEnumInput },
    });
    const parsed = JSON.parse(JSON.stringify(schema)) as {
      entries: Record<string, unknown>;
    };
    expect(parsed.entries['native_enum']).toEqual({
      aal_level: {
        kind: 'postgres-enum',
        typeName: 'aal_level',
        members: ['aal1', 'aal2', 'aal3'],
        control: 'external',
      },
    });
  });

  it('is absent from entries when no native_enum input is given', () => {
    const schema = new PostgresSchema({ id: 'auth', entries: { table: {} } });
    expect(schema.entries.native_enum).toBeUndefined();
  });

  it('rejects two native enums that resolve to the same physical type name', () => {
    // Two distinct handles, same `@@map` type name — no upstream validation
    // stops this, and the physical-name re-key would otherwise silently drop one
    // enum's members. Fail loud instead.
    const collidingInput = {
      RoleA: { kind: 'postgres-enum', typeName: 'app_role', members: ['a'] },
      RoleB: { kind: 'postgres-enum', typeName: 'app_role', members: ['b'] },
    };
    expect(
      () => new PostgresSchema({ id: 'auth', entries: { table: {}, native_enum: collidingInput } }),
    ).toThrow(/app_role.*auth|auth.*app_role/);
  });
});

describe('PostgresSchema — native_enum affects storageHash', () => {
  function hashWithNativeEnum(members: readonly string[]): string {
    return computeStorageHash({
      target: 'postgres',
      targetFamily: 'sql',
      storage: {
        namespaces: {
          auth: new PostgresSchema({
            id: 'auth',
            entries: {
              table: {},
              native_enum: {
                AalLevel: { kind: 'postgres-enum', typeName: 'aal_level', members },
              },
            },
          }),
        },
      },
    });
  }

  it('changing native_enum members changes the computed storage hash', () => {
    const twoMembers = hashWithNativeEnum(['aal1', 'aal2']);
    const threeMembers = hashWithNativeEnum(['aal1', 'aal2', 'aal3']);
    expect(twoMembers).not.toBe(threeMembers);
  });

  it('a native_enum-bearing namespace hashes differently than an otherwise-identical enum-free one', () => {
    const withEnum = computeStorageHash({
      target: 'postgres',
      targetFamily: 'sql',
      storage: {
        namespaces: {
          auth: new PostgresSchema({
            id: 'auth',
            entries: {
              table: {},
              native_enum: {
                AalLevel: { kind: 'postgres-enum', typeName: 'aal_level', members: ['aal1'] },
              },
            },
          }),
        },
      },
    });
    const withoutEnum = computeStorageHash({
      target: 'postgres',
      targetFamily: 'sql',
      storage: {
        namespaces: {
          auth: new PostgresSchema({ id: 'auth', entries: { table: {} } }),
        },
      },
    });
    expect(withEnum).not.toBe(withoutEnum);
  });
});
