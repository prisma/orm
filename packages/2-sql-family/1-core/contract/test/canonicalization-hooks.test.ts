import { canonicalizeContractToObject } from '@internal/contract/hashing';
import type { Contract } from '@internal/contract/types';
import { blindCast } from '@internal/utils/casts';
import type { JsonObject } from '@internal/utils/json';
import { describe, expect, it } from 'vitest';
import {
  sqlContractCanonicalizationHooks,
  sqlContractSerializationPreserveEmpty,
} from '../src/canonicalization-hooks';

describe('sqlContractCanonicalizationHooks.shouldPreserveEmpty', () => {
  it('preserves a column default literal payload (false / empty-array defaults)', () => {
    // `{ kind: 'literal', value: false }` reaches the default-omission walk
    // as a default value; without this veto the emitted contract fails its
    // own validation on the next read (CONTRACT.VALIDATION_FAILED on Boolean @default(false)).
    expect(
      sqlContractCanonicalizationHooks.shouldPreserveEmpty([
        'storage',
        'namespaces',
        'unbound',
        'entries',
        'table',
        'task',
        'columns',
        'done',
        'default',
        'value',
      ]),
    ).toBe(true);
  });

  it('preserves an index unique: false flag', () => {
    // `unique` is a required boolean on every index entry; without this veto
    // the default-omission walk drops `unique: false` and the emitted
    // contract fails IndexSchema validation on the next read.
    expect(
      sqlContractCanonicalizationHooks.shouldPreserveEmpty([
        'storage',
        'namespaces',
        'unbound',
        'entries',
        'table',
        'task',
        'indexes',
        'unique',
      ]),
    ).toBe(true);
  });

  it('does not preserve arbitrary domain-side values', () => {
    expect(
      sqlContractCanonicalizationHooks.shouldPreserveEmpty([
        'domain',
        'namespaces',
        'unbound',
        'models',
        'Task',
        'fields',
        'done',
      ]),
    ).toBe(false);
  });
});

describe('sqlContractCanonicalizationHooks.sortStorage', () => {
  const tableWith = (arrays: Record<string, ReadonlyArray<{ name: string }>>): unknown => ({
    namespaces: { public: { entries: { table: { sample: arrays } } } },
  });

  const namesOf = (sorted: unknown, key: string): readonly string[] => {
    const storage = blindCast<
      {
        namespaces: {
          public: {
            entries: { table: { sample: Record<string, ReadonlyArray<{ name: string }>> } };
          };
        };
      },
      'the sort hook returns the same shape it was handed'
    >(sorted);
    return (storage.namespaces.public.entries.table.sample[key] ?? []).map((entry) => entry.name);
  };

  it('orders checks, indexes, and uniques by physical name', () => {
    const sorted = sqlContractCanonicalizationHooks.sortStorage(
      tableWith({
        checks: [{ name: 'sample_z_check_00000002' }, { name: 'sample_a_check_00000001' }],
        indexes: [{ name: 'z_idx' }, { name: 'a_idx' }],
        uniques: [{ name: 'z_key' }, { name: 'a_key' }],
      }),
    );
    expect({
      checks: namesOf(sorted, 'checks'),
      indexes: namesOf(sorted, 'indexes'),
      uniques: namesOf(sorted, 'uniques'),
    }).toEqual({
      checks: ['sample_a_check_00000001', 'sample_z_check_00000002'],
      indexes: ['a_idx', 'z_idx'],
      uniques: ['a_key', 'z_key'],
    });
  });
});

describe('canonicalization of literal column defaults', () => {
  const { shouldPreserveEmpty } = sqlContractCanonicalizationHooks;

  const contractWithDefaults = (defaults: Record<string, unknown>): Contract =>
    blindCast({
      targetFamily: 'sql',
      target: 'postgres',
      profileHash: 'test-profile',
      roots: {},
      domain: { namespaces: {} },
      storage: {
        namespaces: {
          public: {
            id: 'public',
            kind: 'postgres-schema',
            entries: {
              table: {
                sample: {
                  columns: Object.fromEntries(
                    Object.entries(defaults).map(([name, value]) => [
                      name,
                      {
                        codecId: 'pg/bool@1',
                        dataType: 'pg/bool',
                        nullable: false,
                        default: { kind: 'literal', value },
                      },
                    ]),
                  ),
                  primaryKey: { columns: ['flag'] },
                },
              },
            },
          },
        },
      },
      extensions: {},
      capabilities: {},
      meta: {},
    });

  const canonicalize = (contract: Contract) =>
    canonicalizeContractToObject(contract, {
      serializeContract: (c) =>
        blindCast<JsonObject, 'test contract literal is already plain JSON data'>(c),
      shouldPreserveEmpty,
    });

  const columnDefault = (result: Record<string, unknown>, column: string): unknown => {
    const storage = result['storage'] as {
      namespaces: {
        public: {
          entries: { table: { sample: { columns: Record<string, { default?: unknown }> } } };
        };
      };
    };
    return storage.namespaces.public.entries.table.sample.columns[column]?.default;
  };

  it('keeps value: false in the canonical JSON', () => {
    const result = canonicalize(contractWithDefaults({ flag: false }));
    expect(columnDefault(result, 'flag')).toEqual({ kind: 'literal', value: false });
  });

  it('keeps empty object and array literal default values', () => {
    const result = canonicalize(contractWithDefaults({ obj: {}, arr: [] }));
    expect(columnDefault(result, 'obj')).toEqual({ kind: 'literal', value: {} });
    expect(columnDefault(result, 'arr')).toEqual({ kind: 'literal', value: [] });
  });
});

describe('canonicalization of model storage', () => {
  it('keeps the empty fields and storage fields of a variant with no fields of its own', () => {
    const contract: Contract = blindCast({
      targetFamily: 'sql',
      target: 'sqlite',
      profileHash: 'test-profile',
      roots: {},
      domain: {
        namespaces: {
          app: {
            models: {
              Epic: {
                fields: {},
                relations: {},
                base: { namespace: 'app', model: 'Task' },
                storage: { table: 'task', namespaceId: 'app', fields: {} },
              },
            },
          },
        },
      },
      storage: { namespaces: {} },
      extensions: {},
      capabilities: {},
      meta: {},
    });

    const result = canonicalizeContractToObject(contract, {
      serializeContract: (c) =>
        blindCast<JsonObject, 'test contract literal is already plain JSON data'>(c),
      shouldPreserveEmpty: sqlContractCanonicalizationHooks.shouldPreserveEmpty,
    });

    expect(result['domain']).toEqual({
      namespaces: {
        app: {
          models: {
            Epic: {
              fields: {},
              relations: {},
              base: { namespace: 'app', model: 'Task' },
              storage: { table: 'task', namespaceId: 'app', fields: {} },
            },
          },
        },
      },
    });
  });
});

describe('canonicalization of codec type parameters', () => {
  const typeParams = { jsonIr: [{ unit: false }, { unit: true }], options: {}, list: [] };
  const scalar = { kind: 'scalar', codecId: 'arktype/json@1', typeParams };

  const contract: Contract = blindCast({
    targetFamily: 'sql',
    target: 'postgres',
    profileHash: 'test-profile',
    roots: {},
    domain: {
      namespaces: {
        public: {
          models: {
            Setting: {
              fields: {
                flag: { nullable: false, type: scalar },
                either: {
                  nullable: false,
                  type: { kind: 'union', members: [scalar] },
                },
              },
              relations: {},
              storage: { table: 'setting', namespaceId: 'public', fields: {} },
            },
          },
        },
      },
    },
    storage: {
      types: { Flag: { codecId: 'arktype/json@1', nativeType: 'jsonb', typeParams } },
      namespaces: {
        public: {
          id: 'public',
          entries: {
            table: {
              setting: {
                columns: {
                  flag: {
                    codecId: 'arktype/json@1',
                    dataType: 'pg/jsonb',
                    nullable: false,
                    typeParams,
                  },
                  plain: {
                    codecId: 'pg/int4@1',
                    dataType: 'pg/int4',
                    nullable: false,
                    typeParams: {},
                  },
                },
              },
            },
          },
        },
      },
    },
    extensions: {},
    capabilities: {},
    meta: {},
  });

  const canonicalize = (shouldPreserveEmpty: (path: readonly string[]) => boolean) =>
    blindCast<
      {
        domain: {
          namespaces: {
            public: {
              models: {
                Setting: {
                  fields: Record<string, { type: { typeParams?: unknown; members?: unknown } }>;
                };
              };
            };
          };
        };
        storage: {
          types: Record<string, { typeParams?: unknown }>;
          namespaces: {
            public: {
              entries: {
                table: { setting: { columns: Record<string, { typeParams?: unknown }> } };
              };
            };
          };
        };
      },
      'canonicalization keeps the shape of the test contract'
    >(
      canonicalizeContractToObject(contract, {
        serializeContract: (c) =>
          blindCast<JsonObject, 'test contract literal is already plain JSON data'>(c),
        shouldPreserveEmpty,
      }),
    );

  it('keeps false, [] and {} inside typeParams when a contract is written', () => {
    const { domain, storage } = canonicalize(sqlContractSerializationPreserveEmpty);
    const fields = domain.namespaces.public.models.Setting.fields;
    const columns = storage.namespaces.public.entries.table.setting.columns;
    expect({
      column: columns['flag']?.typeParams,
      storageType: storage.types['Flag']?.typeParams,
      field: fields['flag']?.type.typeParams,
      unionMembers: fields['either']?.type.members,
    }).toEqual({
      column: typeParams,
      storageType: typeParams,
      field: typeParams,
      unionMembers: [scalar],
    });
  });

  it('still omits an empty typeParams', () => {
    const { storage } = canonicalize(sqlContractSerializationPreserveEmpty);
    expect(storage.namespaces.public.entries.table.setting.columns['plain']).not.toHaveProperty(
      'typeParams',
    );
  });

  it('leaves the hashing predicate unchanged, so no storage hash changes', () => {
    const { storage } = canonicalize(sqlContractCanonicalizationHooks.shouldPreserveEmpty);
    expect(storage.namespaces.public.entries.table.setting.columns['flag']?.typeParams).toEqual({
      jsonIr: [{}, { unit: true }],
    });
  });
});
