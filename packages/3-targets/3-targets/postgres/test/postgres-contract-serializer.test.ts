import { canonicalizeContractToObject } from '@internal/contract/hashing';
import type { Contract } from '@internal/contract/types';
import { effectiveControlPolicy } from '@internal/contract/types';
import { SqlContractSerializerBase, type SqlEntityHydrationFactory } from '@internal/family-sql/ir';
import {
  type AnyEntityKindDescriptor,
  type Namespace,
  UNBOUND_NAMESPACE_ID,
} from '@internal/framework-components/ir';
import {
  ForeignKey,
  PrimaryKey,
  type SqlNamespaceInput,
  SqlStorage,
  StorageColumn,
  StorageTable,
  type StorageTypeInstance,
  toStorageTypeInstance,
} from '@internal/sql-contract/types';
import { blindCast } from '@internal/utils/casts';
import { createSqlContract } from '@repo/test-utils';
import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import { PostgresContractSerializer } from '../src/core/postgres-contract-serializer';
import { PostgresNativeEnum } from '../src/core/postgres-native-enum';
import { PostgresRlsPolicy } from '../src/core/postgres-rls-policy';
import { PostgresRole } from '../src/core/postgres-role';
import { PostgresSchema, postgresCreateNamespace } from '../src/core/postgres-schema';
import postgresTargetDescriptor from '../src/exports/control';

function makeValidContractJson() {
  return createSqlContract({
    storage: {
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: { id: UNBOUND_NAMESPACE_ID, entries: { table: {} } },
      },
    },
  });
}

function makeContractWithTablesJson() {
  return createSqlContract({
    storage: {
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: {
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: {
              user: {
                columns: {
                  id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
                  email: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
                },
                primaryKey: { columns: ['id'] },
                uniques: [],
                indexes: [],
                foreignKeys: [],
              },
              post: {
                columns: {
                  id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
                  userId: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
                },
                primaryKey: { columns: ['id'] },
                uniques: [],
                indexes: [],
                foreignKeys: [
                  {
                    source: {
                      namespaceId: UNBOUND_NAMESPACE_ID,
                      tableName: 'post',
                      columns: ['userId'],
                    },
                    target: {
                      namespaceId: UNBOUND_NAMESPACE_ID,
                      tableName: 'user',
                      columns: ['id'],
                    },
                  },
                ],
              },
            },
          },
        },
      },
    },
  });
}

describe('PostgresContractSerializer', () => {
  it('extends SqlContractSerializerBase', () => {
    const serializer = new PostgresContractSerializer();
    expect(serializer).toBeInstanceOf(SqlContractSerializerBase);
  });

  it('deserializes a valid SQL contract envelope', () => {
    const serializer = new PostgresContractSerializer();
    const contract = serializer.deserializeContract(makeValidContractJson());
    expect(contract.targetFamily).toBe('sql');
    expect(contract.storage.namespaces[UNBOUND_NAMESPACE_ID]!.entries.table ?? {}).toEqual({});
  });

  it('hydrates JSON storage into the SQL Contract IR class hierarchy', () => {
    const serializer = new PostgresContractSerializer();
    const contract = serializer.deserializeContract(makeContractWithTablesJson());

    expect(contract.storage).toBeInstanceOf(SqlStorage);
    const tables = contract.storage.namespaces[UNBOUND_NAMESPACE_ID]!.entries.table ?? {};
    const userTable = tables['user'] as StorageTable | undefined;
    expect(userTable).toBeInstanceOf(StorageTable);
    expect(userTable?.columns['id']).toBeInstanceOf(StorageColumn);
    expect(userTable?.primaryKey).toBeInstanceOf(PrimaryKey);
    const postTable = tables['post'] as StorageTable | undefined;
    expect(postTable).toBeInstanceOf(StorageTable);
    expect(postTable?.foreignKeys[0]).toBeInstanceOf(ForeignKey);
  });

  it('rejects an invalid contract (family-shared structural validation runs)', () => {
    const serializer = new PostgresContractSerializer();
    const bad = { ...makeValidContractJson(), targetFamily: 'mongo' };
    expect(() => serializer.deserializeContract(bad)).toThrow();
  });

  it('serializeContract round-trips a JSON-clean contract', () => {
    const serializer = new PostgresContractSerializer();
    const contract = serializer.deserializeContract(makeContractWithTablesJson());
    const json = serializer.serializeContract(contract);
    const reparsed = JSON.parse(JSON.stringify(json));
    expect(reparsed).toMatchObject({
      targetFamily: 'sql',
      storage: {
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: {
            id: UNBOUND_NAMESPACE_ID,
            kind: 'postgres-unbound-schema',
            entries: {
              table: {
                user: {
                  columns: { id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false } },
                },
              },
            },
          },
        },
      },
    });
    expect(reparsed.storage).not.toHaveProperty('kind');
    expect(reparsed.storage.namespaces[UNBOUND_NAMESPACE_ID].entries.table.user).not.toHaveProperty(
      'kind',
    );
    expect(
      reparsed.storage.namespaces[UNBOUND_NAMESPACE_ID].entries.table.user.columns.id,
    ).not.toHaveProperty('kind');
  });

  it('hydrates storage.types entries via the family registry dispatch path', () => {
    const sentinel: StorageTypeInstance = toStorageTypeInstance({
      codecId: 'test/fake-test-entity@1',
      nativeType: 'fake-test-entity',
      typeParams: { proof: true },
    });

    const registry = new Map<string, SqlEntityHydrationFactory>([
      ['fake-test-entity', () => sentinel],
    ]);

    class RegistryDispatchProbeSerializer extends SqlContractSerializerBase<Contract<SqlStorage>> {
      constructor() {
        super(registry);
      }

      protected override hydrateSqlNamespaceEntry(
        nsId: string,
        raw: Record<string, unknown>,
      ): Namespace | SqlNamespaceInput {
        return postgresCreateNamespace(
          blindCast<
            SqlNamespaceInput,
            'super.hydrateSqlNamespaceEntry returns SqlNamespaceInput when raw is not materialized'
          >(super.hydrateSqlNamespaceEntry(nsId, raw)),
        );
      }

      protected override parseSqlContractStructure(_json: unknown): Contract<SqlStorage> {
        const base = createSqlContract({
          storage: {
            namespaces: {
              [UNBOUND_NAMESPACE_ID]: { id: UNBOUND_NAMESPACE_ID, entries: { table: {} } },
            },
          },
        }) as unknown as Contract<SqlStorage>;
        return {
          ...base,
          storage: {
            ...base.storage,
            types: {
              fake_thing: { kind: 'fake-test-entity' as const },
            },
          },
        } as unknown as Contract<SqlStorage>;
      }
    }

    const contract = new RegistryDispatchProbeSerializer().deserializeContract({});
    expect(contract.storage.types?.['fake_thing']).toBe(sentinel);
  });
});

describe('control-policy round-trip fidelity', () => {
  function makeMixedControlContractJson() {
    const base = createSqlContract({
      storage: {
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: {
            id: UNBOUND_NAMESPACE_ID,
            entries: {
              table: {
                user: {
                  columns: {
                    id: {
                      nativeType: 'int4',
                      codecId: 'pg/int4@1',
                      nullable: false,
                      control: 'observed',
                    },
                    email: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
                  },
                  primaryKey: { columns: ['id'] },
                  uniques: [],
                  indexes: [],
                  foreignKeys: [],
                  control: 'external',
                },
              },
            },
          },
        },
      },
    });
    return {
      ...base,
      defaultControlPolicy: 'tolerated',
      storage: {
        ...base.storage,
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: {
            ...base.storage.namespaces[UNBOUND_NAMESPACE_ID]!,
            entries: {
              ...base.storage.namespaces[UNBOUND_NAMESPACE_ID]!.entries,
            },
          },
        },
      },
    };
  }

  it('preserves effective control per node across serialize → deserialize', () => {
    const serializer = new PostgresContractSerializer();
    const input = makeMixedControlContractJson();

    const contract = serializer.deserializeContract(input);
    const reparsed = JSON.parse(JSON.stringify(serializer.serializeContract(contract)));

    expect(reparsed.defaultControlPolicy).toBe('tolerated');

    const ns = reparsed.storage.namespaces[UNBOUND_NAMESPACE_ID];
    const table = ns.entries.table.user;
    const idColumn = table.columns.id;
    const emailColumn = table.columns.email;

    const def = reparsed.defaultControlPolicy;
    expect(effectiveControlPolicy(table.control, def)).toBe('external');
    expect(effectiveControlPolicy(idColumn.control, def)).toBe('observed');
    expect(effectiveControlPolicy(emailColumn.control, def)).toBe('tolerated');

    // Omit-when-default holds: the unset column never grows a control property.
    expect(emailColumn).not.toHaveProperty('control');
  });
});

describe('postgresTargetDescriptor', () => {
  it('exposes a contractSerializer property', () => {
    expect(postgresTargetDescriptor.contractSerializer).toBeInstanceOf(PostgresContractSerializer);
  });

  it('exposes a schemaVerifier property next to migrations', () => {
    expect(postgresTargetDescriptor.schemaVerifier).toBeDefined();
    expect(postgresTargetDescriptor.migrations).toBeDefined();
  });
});

describe('role + policy round-trip', () => {
  function makeContractWithRolesAndPolicies() {
    const base = createSqlContract({
      storage: {
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: {
            id: UNBOUND_NAMESPACE_ID,
            entries: {
              table: {
                posts: {
                  columns: {
                    id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
                    user_id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
                  },
                  primaryKey: { columns: ['id'] },
                  uniques: [],
                  indexes: [],
                  foreignKeys: [],
                },
                logs: {
                  columns: {
                    id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
                  },
                  primaryKey: { columns: ['id'] },
                  uniques: [],
                  indexes: [],
                  foreignKeys: [],
                },
              },
            },
          },
        },
      },
    });
    return {
      ...base,
      storage: {
        ...base.storage,
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: {
            ...base.storage.namespaces[UNBOUND_NAMESPACE_ID]!,
            entries: {
              ...base.storage.namespaces[UNBOUND_NAMESPACE_ID]!.entries,
              role: {
                app_user: {
                  kind: 'role',
                  name: 'app_user',
                  namespaceId: UNBOUND_NAMESPACE_ID,
                },
              },
              policy: {
                posts_select_own_a1b2c3d4: {
                  kind: 'policy',
                  name: 'posts_select_own_a1b2c3d4',
                  prefix: 'posts_select_own',
                  tableName: 'posts',
                  namespaceId: UNBOUND_NAMESPACE_ID,
                  operation: 'select',
                  roles: ['app_user'],
                  using: 'user_id = current_user_id()',
                  permissive: true,
                },
                posts_insert_restrictive_b5c6d7e8: {
                  kind: 'policy',
                  name: 'posts_insert_restrictive_b5c6d7e8',
                  prefix: 'posts_insert_restrictive',
                  tableName: 'posts',
                  namespaceId: UNBOUND_NAMESPACE_ID,
                  operation: 'insert',
                  roles: ['app_user', 'admin'],
                  using: 'user_id = current_user_id()',
                  withCheck: 'user_id = current_user_id()',
                  permissive: false,
                },
              },
            },
          },
        },
      },
    };
  }

  it('permissive: false survives canonicalization (default-omission must not drop it)', () => {
    const serializer = new PostgresContractSerializer();
    const contract = blindCast<Contract, 'test contract shape is structurally a Contract'>(
      makeContractWithRolesAndPolicies(),
    );
    const canonical = canonicalizeContractToObject(contract, {
      serializeContract: (c) => serializer.serializeContract(blindCast<never, 'test'>(c)),
      shouldPreserveEmpty: serializer.shouldPreserveEmpty,
      sortStorage: serializer.sortStorage,
    });
    const storage = blindCast<
      {
        namespaces: Record<
          string,
          { entries: { policy: Record<string, { permissive?: boolean }> } }
        >;
      },
      'canonical storage shape'
    >(canonical['storage']);
    const policies = storage.namespaces[UNBOUND_NAMESPACE_ID]?.entries.policy;
    expect(policies?.['posts_select_own_a1b2c3d4']?.permissive).toBe(true);
    expect(policies?.['posts_insert_restrictive_b5c6d7e8']?.permissive).toBe(false);
  });

  it('preserves role + policy entries through serialize → deserialize', () => {
    const serializer = new PostgresContractSerializer();
    const input = makeContractWithRolesAndPolicies();

    const contract = serializer.deserializeContract(input);
    const json = serializer.serializeContract(contract);
    const reparsed = JSON.parse(JSON.stringify(json));
    const roundTripped = serializer.deserializeContract(reparsed);

    const ns = roundTripped.storage.namespaces[UNBOUND_NAMESPACE_ID] as PostgresSchema;
    expect(ns).toBeInstanceOf(PostgresSchema);

    // Role slot preserved
    expect(Object.keys(ns.role)).toHaveLength(1);
    const role = ns.role['app_user'];
    expect(role).toBeInstanceOf(PostgresRole);
    expect(role?.name).toBe('app_user');
    expect(role?.namespaceId).toBe(UNBOUND_NAMESPACE_ID);
    expect(role?.control).toBe('external');

    // RLS policies preserved with prefix + full name both distinct
    expect(Object.keys(ns.policy)).toHaveLength(2);

    const selectPolicy = ns.policy['posts_select_own_a1b2c3d4'];
    expect(selectPolicy).toBeInstanceOf(PostgresRlsPolicy);
    expect(selectPolicy?.name).toBe('posts_select_own_a1b2c3d4');
    expect(selectPolicy?.prefix).toBe('posts_select_own');
    expect(selectPolicy?.tableName).toBe('posts');
    expect(selectPolicy?.operation).toBe('select');
    expect(selectPolicy?.roles).toEqual(['app_user']);
    expect(selectPolicy?.using).toBe('user_id = current_user_id()');
    expect(selectPolicy?.withCheck).toBeUndefined();
    expect(selectPolicy?.permissive).toBe(true);

    const insertPolicy = ns.policy['posts_insert_restrictive_b5c6d7e8'];
    expect(insertPolicy).toBeInstanceOf(PostgresRlsPolicy);
    expect(insertPolicy?.name).toBe('posts_insert_restrictive_b5c6d7e8');
    expect(insertPolicy?.prefix).toBe('posts_insert_restrictive');
    expect(insertPolicy?.roles).toEqual(['app_user', 'admin']);
    expect(insertPolicy?.withCheck).toBe('user_id = current_user_id()');
    expect(insertPolicy?.permissive).toBe(false);
  });

  it('produces frozen PostgresRlsPolicy and PostgresRole instances after round-trip', () => {
    const serializer = new PostgresContractSerializer();
    const input = makeContractWithRolesAndPolicies();

    const contract = serializer.deserializeContract(input);
    const json = serializer.serializeContract(contract);
    const roundTripped = serializer.deserializeContract(JSON.parse(JSON.stringify(json)));

    const ns = roundTripped.storage.namespaces[UNBOUND_NAMESPACE_ID] as PostgresSchema;
    const role = ns.role['app_user']!;
    const policy = ns.policy['posts_select_own_a1b2c3d4']!;

    expect(Object.isFrozen(role)).toBe(true);
    expect(Object.isFrozen(policy)).toBe(true);
  });

  it('returns PostgresSchema.unbound when all slots are empty', () => {
    const serializer = new PostgresContractSerializer();
    const input = createSqlContract({
      storage: {
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: { id: UNBOUND_NAMESPACE_ID, entries: { table: {} } },
        },
      },
    });

    const contract = serializer.deserializeContract(input);
    const ns = contract.storage.namespaces[UNBOUND_NAMESPACE_ID];
    expect(ns).toBe(PostgresSchema.unbound);
  });

  it('does NOT collapse to PostgresSchema.unbound when a pack-contributed kind has entries', () => {
    const customKind: AnyEntityKindDescriptor = {
      kind: 'customKind',
      schema: type({ name: 'string' }),
      construct: (input) => input,
    };
    const serializer = new PostgresContractSerializer([customKind]);

    const input = createSqlContract({
      storage: {
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: {
            id: UNBOUND_NAMESPACE_ID,
            entries: {
              table: {},
              customKind: { someEntry: { name: 'someEntry' } },
            },
          },
        },
      },
    });

    const contract = serializer.deserializeContract(input);
    const ns = contract.storage.namespaces[UNBOUND_NAMESPACE_ID];
    expect(ns).not.toBe(PostgresSchema.unbound);
    expect(ns).toBeInstanceOf(PostgresSchema);
  });

  it('round-trips a roles-only unbound slot (does not collapse to PostgresSchema.unbound)', () => {
    const serializer = new PostgresContractSerializer();
    const input = createSqlContract({
      storage: {
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: {
            id: UNBOUND_NAMESPACE_ID,
            entries: {
              table: {},
              role: {
                anon: { kind: 'role', name: 'anon', namespaceId: UNBOUND_NAMESPACE_ID },
              },
            },
          },
        },
      },
    });

    const contract = serializer.deserializeContract(input);
    const ns = contract.storage.namespaces[UNBOUND_NAMESPACE_ID];
    expect(ns).not.toBe(PostgresSchema.unbound);
    expect(ns?.entries['role']).toMatchObject({
      anon: { kind: 'role', name: 'anon', namespaceId: UNBOUND_NAMESPACE_ID, control: 'external' },
    });

    const reserialized = serializer.serializeContract(contract);
    const reserializedUnbound = (
      reserialized as { storage: { namespaces: Record<string, unknown> } }
    ).storage.namespaces[UNBOUND_NAMESPACE_ID];
    expect(reserializedUnbound).toMatchObject({
      id: UNBOUND_NAMESPACE_ID,
      kind: 'postgres-unbound-schema',
      entries: {
        role: { anon: { kind: 'role', name: 'anon', namespaceId: UNBOUND_NAMESPACE_ID } },
      },
    });
  });

  it('rejects a malformed policy entry (bad operation literal)', () => {
    const serializer = new PostgresContractSerializer();
    const input = createSqlContract({
      storage: {
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: {
            id: UNBOUND_NAMESPACE_ID,
            entries: {
              table: {},
              policy: {
                bad_policy: {
                  kind: 'policy',
                  name: 'bad_policy_a1b2c3d4',
                  prefix: 'bad_policy',
                  tableName: 'posts',
                  namespaceId: UNBOUND_NAMESPACE_ID,
                  operation: 'truncate', // invalid — not in the closed set
                  roles: ['app_user'],
                  permissive: true,
                },
              },
            },
          },
        },
      },
    });

    expect(() => serializer.deserializeContract(input)).toThrow();
  });

  it('rejects a malformed role entry (non-external control)', () => {
    const serializer = new PostgresContractSerializer();
    const input = createSqlContract({
      storage: {
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: {
            id: UNBOUND_NAMESPACE_ID,
            entries: {
              table: {},
              role: {
                app_user: {
                  kind: 'role',
                  name: 'app_user',
                  namespaceId: UNBOUND_NAMESPACE_ID,
                  control: 'managed', // invalid — roles are external-only
                },
              },
            },
          },
        },
      },
    });

    expect(() => serializer.deserializeContract(input)).toThrow();
  });

  it('serialized role carries its control policy, defaulted to external', () => {
    const serializer = new PostgresContractSerializer();
    const input = makeContractWithRolesAndPolicies();

    const contract = serializer.deserializeContract(input);
    const json = serializer.serializeContract(contract);
    const reparsed = JSON.parse(JSON.stringify(json));

    const role = reparsed.storage.namespaces[UNBOUND_NAMESPACE_ID].entries.role['app_user'];
    expect(role).toEqual({
      kind: 'role',
      name: 'app_user',
      namespaceId: UNBOUND_NAMESPACE_ID,
      control: 'external',
    });
  });

  it('serialized policy matches expected shape', () => {
    const serializer = new PostgresContractSerializer();
    const input = makeContractWithRolesAndPolicies();

    const contract = serializer.deserializeContract(input);
    const json = serializer.serializeContract(contract);
    const reparsed = JSON.parse(JSON.stringify(json));

    const ns = reparsed.storage.namespaces[UNBOUND_NAMESPACE_ID];
    const selectPolicy = ns.entries.policy['posts_select_own_a1b2c3d4'];
    const insertPolicy = ns.entries.policy['posts_insert_restrictive_b5c6d7e8'];

    expect(selectPolicy).toEqual({
      kind: 'policy',
      name: 'posts_select_own_a1b2c3d4',
      prefix: 'posts_select_own',
      tableName: 'posts',
      namespaceId: UNBOUND_NAMESPACE_ID,
      operation: 'select',
      roles: ['app_user'],
      using: 'user_id = current_user_id()',
      permissive: true,
    });
    expect(insertPolicy).toEqual({
      kind: 'policy',
      name: 'posts_insert_restrictive_b5c6d7e8',
      prefix: 'posts_insert_restrictive',
      tableName: 'posts',
      namespaceId: UNBOUND_NAMESPACE_ID,
      operation: 'insert',
      roles: ['app_user', 'admin'],
      using: 'user_id = current_user_id()',
      withCheck: 'user_id = current_user_id()',
      permissive: false,
    });
  });

  it('rejects a malformed policy entry (missing permissive)', () => {
    const serializer = new PostgresContractSerializer();
    const input = createSqlContract({
      storage: {
        namespaces: {
          [UNBOUND_NAMESPACE_ID]: {
            id: UNBOUND_NAMESPACE_ID,
            entries: {
              table: {},
              policy: {
                bad_policy: {
                  kind: 'policy',
                  name: 'bad_policy_a1b2c3d4',
                  prefix: 'bad_policy',
                  tableName: 'posts',
                  namespaceId: UNBOUND_NAMESPACE_ID,
                  operation: 'select',
                  roles: ['app_user'],
                  // permissive missing
                },
              },
            },
          },
        },
      },
    });

    expect(() => serializer.deserializeContract(input)).toThrow();
  });
});

describe('native_enum + valueSet round-trip', () => {
  function makeContractWithNativeEnum() {
    const base = createSqlContract({
      storage: {
        namespaces: {
          auth: {
            id: 'auth',
            entries: { table: {} },
          },
        },
      },
    });
    return {
      ...base,
      storage: {
        ...base.storage,
        namespaces: {
          auth: {
            ...base.storage.namespaces['auth']!,
            entries: {
              ...base.storage.namespaces['auth']!.entries,
              native_enum: {
                AalLevel: {
                  kind: 'postgres-enum',
                  typeName: 'aal_level',
                  members: ['aal1', 'aal2', 'aal3'],
                  control: 'external',
                },
              },
              valueSet: {
                AalLevel: { kind: 'valueSet', values: ['aal1', 'aal2', 'aal3'] },
              },
            },
          },
        },
      },
    };
  }

  it('deserializes the native_enum entity and preserves the derived valueSet', () => {
    const serializer = new PostgresContractSerializer();
    const input = makeContractWithNativeEnum();

    const contract = serializer.deserializeContract(input);
    const ns = contract.storage.namespaces['auth'] as PostgresSchema;
    expect(ns).toBeInstanceOf(PostgresSchema);

    const nativeEnum = ns.entries.native_enum?.['aal_level'];
    expect(nativeEnum).toBeInstanceOf(PostgresNativeEnum);
    expect(nativeEnum?.typeName).toBe('aal_level');
    expect(nativeEnum?.members).toEqual(['aal1', 'aal2', 'aal3']);
    expect(nativeEnum?.control).toBe('external');

    const valueSet = ns.valueSet?.['AalLevel'];
    expect(valueSet?.values).toEqual(['aal1', 'aal2', 'aal3']);
  });

  it('round-trips the native_enum entity through JSON — entity and derived valueSet both survive', () => {
    const serializer = new PostgresContractSerializer();
    const input = makeContractWithNativeEnum();

    const contract = serializer.deserializeContract(input);
    const json = serializer.serializeContract(contract);
    const reparsed = JSON.parse(JSON.stringify(json));
    const roundTripped = serializer.deserializeContract(reparsed);

    const ns = roundTripped.storage.namespaces['auth'] as PostgresSchema;
    expect(ns).toBeInstanceOf(PostgresSchema);

    const nativeEnum = ns.entries.native_enum?.['aal_level'];
    expect(nativeEnum).toBeInstanceOf(PostgresNativeEnum);
    expect(nativeEnum?.typeName).toBe('aal_level');
    expect(nativeEnum?.members).toEqual(['aal1', 'aal2', 'aal3']);
    expect(nativeEnum?.control).toBe('external');

    const valueSet = ns.valueSet?.['AalLevel'];
    expect(valueSet?.values).toEqual(['aal1', 'aal2', 'aal3']);
  });

  it('serialized namespace entries include native_enum alongside valueSet', () => {
    const serializer = new PostgresContractSerializer();
    const input = makeContractWithNativeEnum();

    const contract = serializer.deserializeContract(input);
    const json = serializer.serializeContract(contract);
    const reparsed = JSON.parse(JSON.stringify(json));

    const ns = reparsed.storage.namespaces['auth'];
    expect(ns.entries.native_enum.aal_level).toEqual({
      kind: 'postgres-enum',
      typeName: 'aal_level',
      members: ['aal1', 'aal2', 'aal3'],
      control: 'external',
    });
    expect(ns.entries.valueSet.AalLevel).toEqual({
      kind: 'valueSet',
      values: ['aal1', 'aal2', 'aal3'],
    });
  });

  it('a contract.json with no native_enum key hydrates unchanged (absent-key tolerance)', () => {
    const serializer = new PostgresContractSerializer();
    const input = createSqlContract({
      storage: {
        namespaces: {
          auth: {
            id: 'auth',
            entries: {
              table: {},
              valueSet: {
                AalLevel: { kind: 'valueSet', values: ['aal1', 'aal2', 'aal3'] },
              },
            },
          },
        },
      },
    });

    const contract = serializer.deserializeContract(input);
    const ns = contract.storage.namespaces['auth'] as PostgresSchema;
    expect(ns).toBeInstanceOf(PostgresSchema);
    expect(ns.entries.native_enum).toBeUndefined();
    expect(ns.valueSet?.['AalLevel']?.values).toEqual(['aal1', 'aal2', 'aal3']);

    const json = serializer.serializeContract(contract);
    const reparsed = JSON.parse(JSON.stringify(json));
    expect(reparsed.storage.namespaces.auth.entries.native_enum).toBeUndefined();
  });

  it('an enum-free contract serializes byte-identically (regression pin)', () => {
    const serializer = new PostgresContractSerializer();
    const input = createSqlContract({
      storage: {
        namespaces: {
          auth: {
            id: 'auth',
            entries: {
              table: {
                sessions: {
                  columns: {
                    id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
                  },
                  primaryKey: { columns: ['id'] },
                  uniques: [],
                  indexes: [],
                  foreignKeys: [],
                },
              },
            },
          },
        },
      },
    });

    const contract = serializer.deserializeContract(input);
    const json = serializer.serializeContract(contract);
    const reparsed = JSON.parse(JSON.stringify(json));

    expect(reparsed.storage.namespaces.auth).toEqual({
      id: 'auth',
      kind: 'postgres-schema',
      entries: {
        table: {
          sessions: {
            columns: {
              id: {
                nativeType: 'int4',
                codecId: 'pg/int4@1',
                nullable: false,
                many: false,
              },
            },
            primaryKey: { columns: ['id'] },
            uniques: [],
            indexes: [],
            foreignKeys: [],
          },
        },
      },
    });
  });

  it('rejects a malformed native_enum entry (a non-string member)', () => {
    const serializer = new PostgresContractSerializer();
    const input = createSqlContract({
      storage: {
        namespaces: {
          auth: {
            id: 'auth',
            entries: {
              table: {},
              native_enum: {
                AalLevel: {
                  kind: 'postgres-enum',
                  typeName: 'aal_level',
                  members: [{ name: 'aal1' }],
                },
              },
            },
          },
        },
      },
    });

    expect(() => serializer.deserializeContract(input)).toThrow();
  });

  it('rejects a native_enum entry with the wrong kind literal', () => {
    const serializer = new PostgresContractSerializer();
    const input = createSqlContract({
      storage: {
        namespaces: {
          auth: {
            id: 'auth',
            entries: {
              table: {},
              native_enum: {
                AalLevel: {
                  kind: 'enum',
                  typeName: 'aal_level',
                  members: ['aal1'],
                },
              },
            },
          },
        },
      },
    });

    expect(() => serializer.deserializeContract(input)).toThrow();
  });
});
