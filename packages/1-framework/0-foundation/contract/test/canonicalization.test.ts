import type { JsonObject } from '@internal/utils/json';
import { describe, expect, it } from 'vitest';
import { asNamespaceId } from '../src/namespace-id';

function crossRef(model: string, namespace = 'default') {
  return { namespace: asNamespaceId(namespace), model };
}

import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import {
  type CanonicalizeContractOptions,
  canonicalizeContract as canonicalizeContractRaw,
  canonicalizeContractToObject as canonicalizeContractToObjectRaw,
  orderTopLevel,
} from '../src/canonicalization';
import { createPreserveEmptyPredicate, type PathPattern } from '../src/canonicalization-path-match';
import { createStorageSort, type NamedArraySortTarget } from '../src/canonicalization-storage-sort';
import type { Contract } from '../src/contract-types';
import type { ContractModelBase, ContractValueObject } from '../src/domain-types';
import { coreHash, profileHash } from '../src/types';
import { applicationDomainOf } from './support/application-domain-of';

// Tests author JSON-clean contracts directly, so the canonicalisation
// hook trivially passes through.
const identityOptions = {
  serializeContract: (c: Contract): JsonObject => c as unknown as JsonObject,
} satisfies CanonicalizeContractOptions;

function canonicalizeContractToObject(
  contract: Contract,
  options?: Omit<CanonicalizeContractOptions, 'serializeContract'>,
): Record<string, unknown> {
  return canonicalizeContractToObjectRaw(contract, { ...identityOptions, ...options });
}

function canonicalizeContract(
  contract: Contract,
  options?: Omit<CanonicalizeContractOptions, 'serializeContract'>,
): string {
  return canonicalizeContractRaw(contract, { ...identityOptions, ...options });
}

// `constraint`/`index` below are illustrative boolean fields exercising the
// generic empty-value preservation mechanism — not a claim about the real
// SQL contract's `ForeignKey` shape, which (post FK1) never carries them.
const sqlPreserveEmptyPatterns = [
  ['storage', 'namespaces', '*', 'entries', 'table'],
  ['storage', 'namespaces', '*', 'entries', 'table', '*'],
  ['storage', 'namespaces', '*', 'entries', 'table', '*', ['uniques', 'indexes', 'foreignKeys']],
  ['storage', 'namespaces', '*', 'entries', 'table', '*', 'foreignKeys', ['constraint', 'index']],
  ['storage', 'namespaces', '*', 'entries', 'table', '*', 'columns', '*', 'default', 'value'],
] as const satisfies readonly PathPattern[];

const sqlSortTargets = [
  { path: ['namespaces', '*', 'entries', 'table', '*'], arrayKeys: ['indexes', 'uniques'] },
] as const satisfies readonly NamedArraySortTarget[];

const sqlPreserveEmpty = createPreserveEmptyPredicate(sqlPreserveEmptyPatterns);
const sqlSortStorage = createStorageSort(sqlSortTargets);

function minimal(overrides?: Record<string, unknown>): Contract {
  const models = (overrides?.['models'] as Record<string, unknown> | undefined) ?? {};
  const valueObjects = overrides?.['valueObjects'] as Record<string, unknown> | undefined;
  const domainOverride = overrides?.['domain'];
  const {
    models: _models,
    valueObjects: _valueObjects,
    domain: _domain,
    ...rest
  } = overrides ?? {};
  return {
    targetFamily: 'sql',
    target: 'postgres',
    roots: {},
    domain:
      domainOverride !== undefined
        ? (domainOverride as Contract['domain'])
        : applicationDomainOf({
            models: models as Record<string, ContractModelBase>,
            ...ifDefined(
              'valueObjects',
              valueObjects !== undefined
                ? blindCast<Record<string, ContractValueObject>, 'canonicalization test fixtures'>(
                    valueObjects,
                  )
                : undefined,
            ),
          }),
    storage: { storageHash: coreHash('stub'), namespaces: {} },
    extensions: {},
    capabilities: {},
    meta: {},
    profileHash: profileHash('stub'),
    ...rest,
  };
}

const UNBOUND = '__unbound__';

function unboundStorage(tables: Record<string, unknown>): Record<string, unknown> {
  return {
    storageHash: 'stub',
    namespaces: {
      [UNBOUND]: { id: UNBOUND, entries: { table: tables } },
    },
  };
}

function drill(obj: Record<string, unknown>, ...keys: string[]): Record<string, unknown> {
  let current: unknown = obj;
  for (const key of keys) {
    current = (current as Record<string, unknown>)[key];
  }
  return current as Record<string, unknown>;
}

function unboundTables(result: Record<string, unknown>): Record<string, unknown> {
  return drill(result, 'storage', 'namespaces', UNBOUND, 'entries', 'table');
}

function drillDomainModel(
  result: Record<string, unknown>,
  modelName: string,
  ...path: string[]
): Record<string, unknown> {
  return drill(result, 'domain', 'namespaces', UNBOUND, 'models', modelName, ...path);
}

describe('canonicalizeContractToObject', () => {
  it('returns an object with top-level keys in canonical order', () => {
    const result = canonicalizeContractToObject(minimal());
    const keys = Object.keys(result);
    expect(keys).toEqual([
      'targetFamily',
      'target',
      'profileHash',
      'roots',
      'domain',
      'storage',
      'capabilities',
      'extensions',
      'meta',
    ]);
  });

  it('preserves additionalProperties:false when a family preserve-empty hook opts in', () => {
    const result = canonicalizeContractToObject(
      minimal({
        targetFamily: 'mongo',
        target: 'mongo',
        storage: {
          storageHash: 'stub',
          namespaces: {
            [UNBOUND]: {
              id: UNBOUND,
              entries: {
                collection: {
                  users: {
                    validator: {
                      jsonSchema: {
                        bsonType: 'object',
                        properties: { _id: { bsonType: 'objectId' } },
                        additionalProperties: false,
                      },
                      validationLevel: 'strict',
                      validationAction: 'error',
                    },
                  },
                },
              },
            },
          },
        },
      }),
      { shouldPreserveEmpty: (path) => path[path.length - 1] === 'additionalProperties' },
    );
    const jsonSchema = drill(
      result,
      'storage',
      'namespaces',
      UNBOUND,
      'entries',
      'collection',
      'users',
      'validator',
      'jsonSchema',
    );
    expect(jsonSchema['additionalProperties']).toBe(false);
  });

  it('includes schemaVersion when provided', () => {
    const result = canonicalizeContractToObject(minimal(), { schemaVersion: '1.0' });
    expect(result['schemaVersion']).toBe('1.0');
    expect(Object.keys(result)[0]).toBe('schemaVersion');
  });

  it('includes roots when provided', () => {
    const result = canonicalizeContractToObject(minimal({ roots: { users: crossRef('User') } }));
    expect(result['roots']).toEqual({ users: crossRef('User') });
  });

  it('includes execution when provided', () => {
    const input = minimal({
      execution: { executionHash: 'exec', mutations: { defaults: [] } },
    });
    const result = canonicalizeContractToObject(input);
    expect(result['execution']).toEqual({
      executionHash: 'exec',
      mutations: { defaults: [] },
    });
  });

  it('includes storageHash when provided inside storage', () => {
    const result = canonicalizeContractToObject(
      minimal({ storage: { storageHash: 'abc', namespaces: {} } }),
    );
    expect(drill(result, 'storage')['storageHash']).toBe('abc');
  });

  it('includes profileHash', () => {
    const result = canonicalizeContractToObject(minimal({ profileHash: 'def' }));
    expect(result['profileHash']).toBe('def');
  });

  it('keeps storageHash inside storage', () => {
    const result = canonicalizeContractToObject(
      minimal({ storage: { storageHash: 's', namespaces: {} } }),
    );
    expect(result).not.toHaveProperty('storageHash');
    expect(drill(result, 'storage')['storageHash']).toBe('s');
  });

  it('keeps executionHash inside execution', () => {
    const result = canonicalizeContractToObject(
      minimal({
        execution: { executionHash: 'e', mutations: { defaults: [] } },
      }),
    );
    expect(result).not.toHaveProperty('executionHash');
    expect(drill(result, 'execution')['executionHash']).toBe('e');
  });

  it('places profileHash in canonical top-level order', () => {
    const result = canonicalizeContractToObject(minimal({ profileHash: 'p' }));
    const keys = Object.keys(result);
    const ordered = keys.filter((k) => ['profileHash', 'roots'].includes(k));
    expect(ordered).toEqual(['profileHash', 'roots']);
  });

  it('excludes keys not in the Contract schema', () => {
    const input = minimal({ zebra: 'z' });
    const result = canonicalizeContractToObject(input);
    expect(result).not.toHaveProperty('zebra');
  });

  it('includes defaultControlPolicy when set on the contract', () => {
    const result = canonicalizeContractToObject(minimal({ defaultControlPolicy: 'external' }));
    expect(result['defaultControlPolicy']).toBe('external');
  });

  it('omits defaultControlPolicy when not set', () => {
    const result = canonicalizeContractToObject(minimal());
    expect(result).not.toHaveProperty('defaultControlPolicy');
  });

  it('places defaultControlPolicy after extensions and before meta', () => {
    const result = canonicalizeContractToObject(minimal({ defaultControlPolicy: 'tolerated' }));
    const keys = Object.keys(result);
    expect(keys.indexOf('extensions')).toBeLessThan(keys.indexOf('defaultControlPolicy'));
    expect(keys.indexOf('defaultControlPolicy')).toBeLessThan(keys.indexOf('meta'));
  });

  it('sorts object keys recursively', () => {
    const result = canonicalizeContractToObject(
      minimal({
        models: {
          User: {
            fields: {
              name: { type: { kind: 'scalar', codecId: 'text' }, nullable: false },
              age: { type: { kind: 'scalar', codecId: 'int' }, nullable: false },
            },
            storage: { namespaceId: '__unbound__', table: 'users', fields: {} },
            relations: {},
          },
        },
      }),
    );
    const userFields = drillDomainModel(result, 'User', 'fields');
    expect(Object.keys(userFields)).toEqual(['age', 'name']);
  });
});

describe('default omission', () => {
  it('strips _generated key from nested objects', () => {
    const result = canonicalizeContractToObject(
      minimal({
        meta: { _generated: 'should be removed', kept: 'yes' } as Record<string, unknown>,
      }),
    );
    const meta = result['meta'] as Record<string, unknown>;
    expect(meta).not.toHaveProperty('_generated');
    expect(meta['kept']).toBe('yes');
  });

  it('preserves nullable: false on fields (ADR 172: always explicit)', () => {
    const result = canonicalizeContractToObject(
      minimal({
        models: {
          User: {
            fields: { id: { type: { kind: 'scalar', codecId: 'int' }, nullable: false } },
            storage: { namespaceId: '__unbound__', table: 'users', fields: {} },
            relations: {},
          },
        },
      }),
    );
    const idField = drillDomainModel(result, 'User', 'fields', 'id');
    expect(idField['nullable']).toBe(false);
  });

  it('strips generated: false', () => {
    const result = canonicalizeContractToObject(
      minimal({
        models: {
          User: {
            fields: {
              id: { type: { kind: 'scalar', codecId: 'int' }, nullable: false, generated: false },
            },
            storage: { namespaceId: '__unbound__', table: 'users', fields: {} },
            relations: {},
          },
        },
      }),
    );
    const idField = drillDomainModel(result, 'User', 'fields', 'id');
    expect(idField).not.toHaveProperty('generated');
  });

  it('preserves elementNullable: true on a many field', () => {
    const result = canonicalizeContractToObject(
      minimal({
        models: {
          User: {
            fields: {
              tags: {
                type: { kind: 'scalar', codecId: 'text' },
                nullable: false,
                many: true,
                elementNullable: true,
              },
            },
            storage: { namespaceId: '__unbound__', table: 'users', fields: {} },
            relations: {},
          },
        },
      }),
    );
    const tagsField = drillDomainModel(result, 'User', 'fields', 'tags');
    expect(tagsField).toEqual({
      type: { kind: 'scalar', codecId: 'text' },
      nullable: false,
      many: true,
      elementNullable: true,
    });
  });

  it('adds no elementNullable to a field that omits it', () => {
    const result = canonicalizeContractToObject(
      minimal({
        models: {
          User: {
            fields: {
              tags: { type: { kind: 'scalar', codecId: 'text' }, nullable: false, many: true },
            },
            storage: { namespaceId: '__unbound__', table: 'users', fields: {} },
            relations: {},
          },
        },
      }),
    );
    const tagsField = drillDomainModel(result, 'User', 'fields', 'tags');
    expect(tagsField).not.toHaveProperty('elementNullable');
  });

  it('preserves a literal false column default value via the family hook', () => {
    const result = canonicalizeContractToObject(
      minimal({
        storage: unboundStorage({
          task: {
            columns: {
              done: {
                codecId: 'pg/bool@1',
                nativeType: 'bool',
                nullable: false,
                default: { kind: 'literal', value: false },
              },
            },
          },
        }),
      }),
      { shouldPreserveEmpty: sqlPreserveEmpty },
    );
    const done = drill(unboundTables(result), 'task', 'columns', 'done');
    expect(done['default']).toEqual({ kind: 'literal', value: false });
  });

  it('preserves a literal empty-array column default value via the family hook', () => {
    const result = canonicalizeContractToObject(
      minimal({
        storage: unboundStorage({
          task: {
            columns: {
              labels: {
                codecId: 'pg/text_array@1',
                nativeType: 'text[]',
                nullable: false,
                default: { kind: 'literal', value: [] },
              },
            },
          },
        }),
      }),
      { shouldPreserveEmpty: sqlPreserveEmpty },
    );
    const labels = drill(unboundTables(result), 'task', 'columns', 'labels');
    expect(labels['default']).toEqual({ kind: 'literal', value: [] });
  });

  it('strips onDelete: noAction and onUpdate: noAction', () => {
    const result = canonicalizeContractToObject(
      minimal({
        storage: unboundStorage({
          posts: {
            foreignKeys: {
              fk_user: { onDelete: 'noAction', onUpdate: 'noAction', columns: ['user_id'] },
            },
          },
        }),
      }),
    );
    const fk = drill(unboundTables(result), 'posts', 'foreignKeys', 'fk_user');
    expect(fk).not.toHaveProperty('onDelete');
    expect(fk).not.toHaveProperty('onUpdate');
  });

  it('preserves required empty objects at top level', () => {
    const result = canonicalizeContractToObject(minimal());
    expect(drill(result, 'domain', 'namespaces', UNBOUND, 'models')).toEqual({});
    expect(result['extensions']).toEqual({});
    expect(result['capabilities']).toEqual({});
    expect(result['meta']).toEqual({});
  });

  it('strips empty storage.namespaces[X].entries.table without a shouldPreserveEmpty hook', () => {
    const result = canonicalizeContractToObject(minimal({ storage: unboundStorage({}) }));
    const ns = drill(result, 'storage', 'namespaces', UNBOUND) as Record<string, unknown>;
    expect(ns).not.toHaveProperty('tables');
  });

  it('preserves empty storage.namespaces[].entries.table when shouldPreserveEmpty hook returns true', () => {
    const result = canonicalizeContractToObject(minimal({ storage: unboundStorage({}) }), {
      shouldPreserveEmpty: sqlPreserveEmpty,
    });
    expect(unboundTables(result)).toEqual({});
  });

  it('preserves empty roots', () => {
    const result = canonicalizeContractToObject(minimal({ roots: {} }));
    expect(result['roots']).toEqual({});
  });

  it('preserves empty model relations', () => {
    const result = canonicalizeContractToObject(
      minimal({
        models: {
          User: {
            fields: { id: { type: { kind: 'scalar', codecId: 'int' }, nullable: false } },
            storage: { namespaceId: '__unbound__', table: 'users', fields: {} },
            relations: {},
          },
        },
      }),
    );
    const user = drillDomainModel(result, 'User');
    expect(user['relations']).toEqual({});
  });

  it('preserves empty table uniques, indexes, and foreignKeys when shouldPreserveEmpty hook provided', () => {
    const result = canonicalizeContractToObject(
      minimal({
        storage: unboundStorage({
          users: { columns: {}, uniques: [], indexes: [], foreignKeys: {} },
        }),
      }),
      { shouldPreserveEmpty: sqlPreserveEmpty },
    );
    const table = drill(unboundTables(result), 'users');
    expect(table['uniques']).toEqual([]);
    expect(table['indexes']).toEqual([]);
    expect(table['foreignKeys']).toEqual({});
  });

  it('strips false-valued FK boolean fields without shouldPreserveEmpty hook', () => {
    const result = canonicalizeContractToObject(
      minimal({
        storage: unboundStorage({
          posts: {
            foreignKeys: {
              fk_user: { columns: ['user_id'], constraint: false, index: false },
            },
          },
        }),
      }),
    );
    const fk = drill(unboundTables(result), 'posts', 'foreignKeys', 'fk_user');
    expect(fk).not.toHaveProperty('constraint');
    expect(fk).not.toHaveProperty('index');
  });

  it('preserves false-valued FK boolean fields in array-form foreignKeys when hook provided', () => {
    const result = canonicalizeContractToObject(
      minimal({
        storage: unboundStorage({
          posts: {
            columns: {},
            foreignKeys: [{ columns: ['user_id'], constraint: false, index: false }],
          },
        }),
      }),
      { shouldPreserveEmpty: sqlPreserveEmpty },
    );
    const table = drill(unboundTables(result), 'posts');
    const fks = table['foreignKeys'] as Array<Record<string, unknown>>;
    expect(fks[0]?.['constraint']).toBe(false);
    expect(fks[0]?.['index']).toBe(false);
  });

  it('preserves empty execution.mutations.defaults', () => {
    const result = canonicalizeContractToObject(
      minimal({
        execution: { executionHash: 'exec', mutations: { defaults: [] } },
      }),
    );
    const mutations = drill(result, 'execution', 'mutations');
    expect(mutations['defaults']).toEqual([]);
  });

  it('preserves empty extension namespace entries', () => {
    const result = canonicalizeContractToObject(minimal({ extensions: { paradedb: {} } }));
    expect(drill(result, 'extensions')['paradedb']).toEqual({});
  });

  it('preserves empty per-namespace table entries when shouldPreserveEmpty hook provided', () => {
    const result = canonicalizeContractToObject(
      minimal({
        storage: unboundStorage({ tasks: {} }),
      }),
      { shouldPreserveEmpty: sqlPreserveEmpty },
    );
    expect(unboundTables(result)['tasks']).toEqual({});
  });

  it('preserves empty model storage (embedded documents)', () => {
    const result = canonicalizeContractToObject(
      minimal({
        models: {
          Address: {
            fields: { street: { type: { kind: 'scalar', codecId: 'string' }, nullable: false } },
            storage: {},
            relations: {},
            owner: 'User',
          },
        },
      }),
    );
    const address = drillDomainModel(result, 'Address');
    expect(address['storage']).toEqual({});
  });

  it('strips non-required empty objects', () => {
    const result = canonicalizeContractToObject(
      minimal({
        models: {
          User: {
            fields: {
              id: { type: { kind: 'scalar', codecId: 'int' }, nullable: false, extra: {} },
            },
            storage: { namespaceId: '__unbound__', table: 'users', fields: {} },
            relations: {},
          },
        },
      }),
    );
    const idField = drillDomainModel(result, 'User', 'fields', 'id');
    expect(idField).not.toHaveProperty('extra');
  });

  it('preserves ISO date strings in meta', () => {
    const isoString = '2024-01-01T00:00:00.000Z';
    const result = canonicalizeContractToObject(
      minimal({
        meta: { createdAt: isoString } as Record<string, unknown>,
      }),
    );
    expect(drill(result, 'meta')['createdAt']).toBe(isoString);
  });

  it('preserves null values (not treated as default)', () => {
    const result = canonicalizeContractToObject(
      minimal({
        models: {
          User: {
            fields: {
              id: { type: { kind: 'scalar', codecId: 'int' }, nullable: false, default: null },
            },
            storage: { namespaceId: '__unbound__', table: 'users', fields: {} },
            relations: {},
          },
        },
      }),
    );
    const idField = drillDomainModel(result, 'User', 'fields', 'id');
    expect(idField['default']).toBeNull();
  });
});

describe('index and unique sorting', () => {
  it('sorts indexes by name when sortStorage hook provided', () => {
    const result = canonicalizeContractToObject(
      minimal({
        storage: unboundStorage({
          users: {
            columns: {},
            indexes: [{ name: 'idx_z' }, { name: 'idx_a' }, { name: 'idx_m' }],
          },
        }),
      }),
      { sortStorage: sqlSortStorage },
    );
    const table = drill(unboundTables(result), 'users');
    const indexes = table['indexes'] as Array<{ name: string }>;
    expect(indexes.map((i) => i.name)).toEqual(['idx_a', 'idx_m', 'idx_z']);
  });

  it('sorts uniques by name when sortStorage hook provided', () => {
    const result = canonicalizeContractToObject(
      minimal({
        storage: unboundStorage({
          users: {
            columns: {},
            uniques: [{ name: 'uq_z' }, { name: 'uq_a' }],
          },
        }),
      }),
      { sortStorage: sqlSortStorage },
    );
    const table = drill(unboundTables(result), 'users');
    const uniques = table['uniques'] as Array<{ name: string }>;
    expect(uniques.map((u) => u.name)).toEqual(['uq_a', 'uq_z']);
  });

  it('handles storage without namespaces (no-op)', () => {
    const result = canonicalizeContractToObject(
      minimal({ storage: { storageHash: 'stub', namespaces: {} } }),
    );
    expect(result['storage']).toBeDefined();
  });

  it('preserves ISO date string defaults through sort', () => {
    const isoString = '2024-06-15T00:00:00.000Z';
    const result = canonicalizeContractToObject(
      minimal({
        models: {
          User: {
            fields: {
              createdAt: {
                type: { kind: 'scalar', codecId: 'timestamp' },
                nullable: false,
                default: isoString,
              },
            },
            storage: { namespaceId: '__unbound__', table: 'users', fields: {} },
            relations: {},
          },
        },
      }),
    );
    const field = drillDomainModel(result, 'User', 'fields', 'createdAt');
    expect(field['default']).toBe(isoString);
  });

  it('sorts indexes without name using empty-string fallback', () => {
    const result = canonicalizeContractToObject(
      minimal({
        storage: unboundStorage({
          users: {
            columns: {},
            indexes: [{ columns: ['b'] }, { name: 'idx_a', columns: ['a'] }],
          },
        }),
      }),
      { sortStorage: sqlSortStorage },
    );
    const table = drill(unboundTables(result), 'users');
    const indexes = table['indexes'] as Array<{ name?: string }>;
    expect(indexes[0]?.['name']).toBeUndefined();
    expect(indexes[1]?.['name']).toBe('idx_a');
  });

  it('sorts uniques without name using empty-string fallback', () => {
    const result = canonicalizeContractToObject(
      minimal({
        storage: unboundStorage({
          users: {
            columns: {},
            uniques: [{ columns: ['b'] }, { name: 'uq_a', columns: ['a'] }],
          },
        }),
      }),
      { sortStorage: sqlSortStorage },
    );
    const table = drill(unboundTables(result), 'users');
    const uniques = table['uniques'] as Array<{ name?: string }>;
    expect(uniques[0]?.['name']).toBeUndefined();
    expect(uniques[1]?.['name']).toBe('uq_a');
  });

  it('handles non-object table entries gracefully', () => {
    const result = canonicalizeContractToObject(
      minimal({
        storage: unboundStorage({ bad: null as unknown as Record<string, unknown> }),
      }),
    );
    expect(unboundTables(result)['bad']).toBeNull();
  });

  it('passes non-object namespace values through unchanged', () => {
    const result = canonicalizeContractToObject(
      minimal({
        storage: {
          storageHash: 'stub',
          namespaces: {
            broken: null as unknown as Record<string, unknown>,
          },
        },
      }),
    );
    const storage = drill(result, 'storage');
    expect((storage['namespaces'] as Record<string, unknown>)['broken']).toBeNull();
  });

  it('passes namespaces without a table slot through unchanged (e.g. Mongo)', () => {
    const result = canonicalizeContractToObject(
      minimal({
        storage: {
          storageHash: 'stub',
          namespaces: {
            [UNBOUND]: {
              id: UNBOUND,
              entries: { collection: { posts: { columns: {} } } },
            },
          },
        },
      }),
    );
    const ns = drill(result, 'storage', 'namespaces', UNBOUND);
    expect(ns).not.toHaveProperty('tables');
    expect(ns).not.toHaveProperty('collections');
    expect(drill(ns, 'entries', 'collection')).toEqual({ posts: {} });
  });
});

describe('canonicalizeContract', () => {
  it('returns a JSON string', () => {
    const result = canonicalizeContract(minimal());
    expect(() => JSON.parse(result)).not.toThrow();
  });

  it('serializes number values in meta', () => {
    const result = canonicalizeContract(
      minimal({
        meta: { limit: 42 } as Record<string, unknown>,
      }),
    );
    const parsed = JSON.parse(result) as Record<string, unknown>;
    expect(drill(parsed, 'meta')['limit']).toBe(42);
  });

  it('produces identical output as JSON.stringify of canonicalizeContractToObject', () => {
    const input = minimal({
      storage: { storageHash: 'test', namespaces: {} },
      profileHash: 'profile',
    });
    const objResult = canonicalizeContractToObject(input);
    const strResult = canonicalizeContract(input);
    expect(JSON.parse(strResult)).toEqual(objResult);
  });
});

describe('orderTopLevel', () => {
  it('places known keys in canonical order followed by unknown keys sorted alphabetically', () => {
    const result = orderTopLevel({
      zebra: 'z',
      target: 'postgres',
      apple: 'a',
      targetFamily: 'sql',
    });
    expect(Object.keys(result)).toEqual(['targetFamily', 'target', 'apple', 'zebra']);
  });

  it('places domain before storage', () => {
    const result = orderTopLevel({
      storage: {},
      domain: { namespaces: { [UNBOUND]: { models: {} } } },
      target: 'postgres',
    });
    const keys = Object.keys(result);
    expect(keys.indexOf('domain')).toBeLessThan(keys.indexOf('storage'));
  });
});

describe('canonicalize with valueObjects', () => {
  it('includes valueObjects under domain.namespaces when present', () => {
    const contract = minimal({
      valueObjects: {
        Address: {
          fields: {
            street: { type: { kind: 'scalar', codecId: 'pg/text@1' }, nullable: false },
            city: { type: { kind: 'scalar', codecId: 'pg/text@1' }, nullable: false },
          },
        },
      },
    });
    const result = canonicalizeContractToObject(contract);
    const vo = drill(result, 'domain', 'namespaces', UNBOUND, 'valueObjects');
    expect(vo).toHaveProperty('Address');
  });

  it('omits valueObjects from namespace output when absent', () => {
    const contract = minimal();
    const result = canonicalizeContractToObject(contract);
    const ns = drill(result, 'domain', 'namespaces', UNBOUND);
    expect(ns).not.toHaveProperty('valueObjects');
  });
});

describe('domain plane', () => {
  it('emits domain.namespaces in canonical output', () => {
    const result = canonicalizeContractToObject(minimal());
    expect(drill(result, 'domain', 'namespaces', UNBOUND, 'models')).toEqual({});
  });
});

describe('typeParams canonicalization', () => {
  it('strips empty storage.types[].typeParams even when SQL shouldPreserveEmpty hook is provided', () => {
    const result = canonicalizeContractToObject(
      minimal({
        storage: { storageHash: 'stub', types: { MyType: { typeParams: {} } } },
      }),
      { shouldPreserveEmpty: sqlPreserveEmpty },
    );
    const myType = drill(result, 'storage', 'types', 'MyType');
    expect(myType).not.toHaveProperty('typeParams');
  });

  it('strips empty storage.types[].typeParams without shouldPreserveEmpty hook', () => {
    const result = canonicalizeContractToObject(
      minimal({
        storage: {
          storageHash: 'stub',
          namespaces: {},
          types: { MyType: { typeParams: {} } },
        },
      }),
    );
    const myType = drill(result, 'storage', 'types', 'MyType');
    expect(myType).not.toHaveProperty('typeParams');
  });

  it('preserves non-empty storage.types[].typeParams', () => {
    const result = canonicalizeContractToObject(
      minimal({
        storage: {
          storageHash: 'stub',
          namespaces: {},
          types: { MyType: { typeParams: { length: 10 } } },
        },
      }),
      { shouldPreserveEmpty: sqlPreserveEmpty },
    );
    const myType = drill(result, 'storage', 'types', 'MyType');
    expect(myType['typeParams']).toEqual({ length: 10 });
  });
});

describe('array sort with nullish entries', () => {
  it('sorts indexes containing nullish entries without throwing', () => {
    const result = canonicalizeContractToObject(
      minimal({
        storage: unboundStorage({
          users: {
            columns: {},
            indexes: [null, null] as unknown as Record<string, unknown>[],
          },
        }),
      }),
      { sortStorage: sqlSortStorage },
    );
    const table = drill(unboundTables(result), 'users');
    const indexes = table['indexes'] as Array<unknown>;
    expect(indexes).toHaveLength(2);
  });

  it('sorts uniques containing nullish entries without throwing', () => {
    const result = canonicalizeContractToObject(
      minimal({
        storage: unboundStorage({
          users: {
            columns: {},
            uniques: [null, null] as unknown as Record<string, unknown>[],
          },
        }),
      }),
      { sortStorage: sqlSortStorage },
    );
    const table = drill(unboundTables(result), 'users');
    const uniques = table['uniques'] as Array<unknown>;
    expect(uniques).toHaveLength(2);
  });
});

describe('framework canonicalizer has no SQL/Mongo storage path knowledge', () => {
  it('canonicalization.ts does not hardcode tables, indexes, uniques, or foreignKeys path guards', async () => {
    const { readFile } = await import('node:fs/promises');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const sourcePath = join(dirname(fileURLToPath(import.meta.url)), '../src/canonicalization.ts');
    const source = await readFile(sourcePath, 'utf8');
    // Strip comments so doc-comment prose (e.g. markdown `indexes` references)
    // doesn't trip the path-literal guard; only real code literals must fail.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    // Path literals are forbidden regardless of quoting style (single, double,
    // or backtick) so a hardcoded token can't slip past in a different quote.
    const forbiddenPathLiterals = ['tables', 'indexes', 'uniques', 'foreignKeys'];
    for (const token of forbiddenPathLiterals) {
      const quotedLiteral = new RegExp(`['"\`]${token}['"\`]`);
      expect(
        code,
        `framework canonicalizer must not reference the ${token} path literal`,
      ).not.toMatch(quotedLiteral);
    }
    // Helper identifiers are bare references, so a plain substring check suffices.
    const forbiddenIdentifiers = [
      'sortIndexesAndUniques',
      'sortTableArrays',
      'isNamespaceTable',
      'isRequiredNamespaceTables',
      'isStorageTypeTypeParams',
      'isFkBooleanField',
    ];
    for (const token of forbiddenIdentifiers) {
      expect(source, `framework canonicalizer must not reference ${token}`).not.toContain(token);
    }
  });
});
