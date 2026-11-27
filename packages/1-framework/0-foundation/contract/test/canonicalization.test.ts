import type { JsonObject } from '@internal/utils/json';
import { describe, expect, it } from 'vitest';
import { asNamespaceId } from '../src/namespace-id';

function crossRef(model: string, namespace = 'default') {
  return { namespace: asNamespaceId(namespace), model };
}

import {
  type CanonicalizeContractOptions,
  canonicalizeContract as canonicalizeContractRaw,
  canonicalizeContractToObject as canonicalizeContractToObjectRaw,
  orderTopLevel,
} from '../src/canonicalization';
import { createStorageSort, type NamedArraySortTarget } from '../src/canonicalization-storage-sort';
import type { Contract } from '../src/contract-types';
import type { ContractModelBase } from '../src/domain-types';
import { coreHash, profileHash } from '../src/types';
import { applicationDomainOf } from './support/application-domain-of';

// Tests author JSON-clean contracts directly, so the canonicalisation
// hook trivially passes through.
const identityOptions = {
  serializeContract: (c: Contract): JsonObject => c as unknown as JsonObject,
  normalizeStorage: (storage) => storage,
} satisfies CanonicalizeContractOptions;

function canonicalizeContractToObject(
  contract: Contract,
  options?: Partial<Omit<CanonicalizeContractOptions, 'serializeContract'>>,
): Record<string, unknown> {
  return canonicalizeContractToObjectRaw(contract, { ...identityOptions, ...options });
}

function canonicalizeContract(
  contract: Contract,
  options?: Partial<Omit<CanonicalizeContractOptions, 'serializeContract'>>,
): string {
  return canonicalizeContractRaw(contract, { ...identityOptions, ...options });
}

const sqlSortTargets = [
  { path: ['namespaces', '*', 'entries', 'table', '*'], arrayKeys: ['indexes', 'uniques'] },
] as const satisfies readonly NamedArraySortTarget[];

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
  const storageNamespaces =
    valueObjects === undefined
      ? {}
      : { [UNBOUND]: { id: UNBOUND, entries: { valueObject: valueObjects } } };
  return {
    targetFamily: 'sql',
    target: 'postgres',
    roots: {},
    domain:
      domainOverride !== undefined
        ? (domainOverride as Contract['domain'])
        : applicationDomainOf({ models: models as Record<string, ContractModelBase> }),
    storage: { storageHash: coreHash('stub'), namespaces: storageNamespaces },
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

  it('puts the format version the serializer prints first', () => {
    const result = canonicalizeContractToObjectRaw(minimal(), {
      serializeContract: (c) => ({ ...(c as unknown as JsonObject), formatVersion: 1 }),
      normalizeStorage: identityOptions.normalizeStorage,
    });
    expect(result['formatVersion']).toBe(1);
    expect(Object.keys(result)[0]).toBe('formatVersion');
  });

  it('carries no format version the serializer does not print', () => {
    expect(canonicalizeContractToObject(minimal())).not.toHaveProperty('formatVersion');
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

describe('values the canonicalizer keeps', () => {
  it('keeps false, empty arrays and empty objects at every depth', () => {
    const result = canonicalizeContractToObject(
      minimal({
        storage: unboundStorage({
          task: {
            columns: {
              done: {
                codecId: 'pg/bool@1',
                nullable: false,
                many: false,
                typeParams: { strict: false, tags: [], extra: {} },
              },
            },
            checks: [],
            indexes: [{ name: 'task_idx', columns: [], unique: false, options: {} }],
            foreignKeys: [{ columns: ['user_id'], index: false, onDelete: 'noAction' }],
          },
        }),
        execution: {
          executionHash: 'exec',
          mutations: {
            defaults: [{ onCreate: { kind: 'generator', id: 'nanoid', params: { upper: false } } }],
          },
        },
        capabilities: { sql: { returning: false }, mongo: {} },
        extensions: { paradedb: { capabilities: {} } },
        meta: { flag: false, list: [], map: {} },
      }),
    );
    expect(drill(unboundTables(result), 'task')).toEqual({
      columns: {
        done: {
          codecId: 'pg/bool@1',
          nullable: false,
          many: false,
          typeParams: { strict: false, tags: [], extra: {} },
        },
      },
      checks: [],
      indexes: [{ name: 'task_idx', columns: [], unique: false, options: {} }],
      foreignKeys: [{ columns: ['user_id'], index: false, onDelete: 'noAction' }],
    });
    expect({
      execution: result['execution'],
      capabilities: result['capabilities'],
      extensions: result['extensions'],
      meta: result['meta'],
    }).toEqual({
      execution: {
        executionHash: 'exec',
        mutations: {
          defaults: [{ onCreate: { kind: 'generator', id: 'nanoid', params: { upper: false } } }],
        },
      },
      capabilities: { sql: { returning: false }, mongo: {} },
      extensions: { paradedb: { capabilities: {} } },
      meta: { flag: false, list: [], map: {} },
    });
  });

  it('keeps many: false on domain fields', () => {
    const result = canonicalizeContractToObject(
      minimal({
        models: {
          User: {
            fields: {
              name: { type: { kind: 'scalar', codecId: 'text' }, nullable: false, many: false },
            },
            storage: { namespaceId: '__unbound__', table: 'users', fields: {} },
            relations: {},
          },
        },
      }),
    );
    expect(drillDomainModel(result, 'User', 'fields', 'name')['many']).toBe(false);
  });

  it('keeps a key named _generated', () => {
    const result = canonicalizeContractToObject(
      minimal({ meta: { _generated: 'kept', kept: 'yes' } as Record<string, unknown> }),
    );
    expect(result['meta']).toEqual({ _generated: 'kept', kept: 'yes' });
  });

  it('keeps null values', () => {
    const result = canonicalizeContractToObject(
      minimal({ meta: { value: null } as Record<string, unknown> }),
    );
    expect(result['meta']).toEqual({ value: null });
  });

  it('applies the family normalizeStorage to storage only', () => {
    const result = canonicalizeContractToObject(
      minimal({ meta: { flag: false } as Record<string, unknown> }),
      { normalizeStorage: () => ({ normalized: true }) },
    );
    expect({ storage: result['storage'], meta: result['meta'] }).toEqual({
      storage: { normalized: true },
      meta: { flag: false },
    });
  });
});

describe('index and unique sorting', () => {
  it('sorts indexes by name when normalizeStorage hook provided', () => {
    const result = canonicalizeContractToObject(
      minimal({
        storage: unboundStorage({
          users: {
            columns: {},
            indexes: [{ name: 'idx_z' }, { name: 'idx_a' }, { name: 'idx_m' }],
          },
        }),
      }),
      { normalizeStorage: sqlSortStorage },
    );
    const table = drill(unboundTables(result), 'users');
    const indexes = table['indexes'] as Array<{ name: string }>;
    expect(indexes.map((i) => i.name)).toEqual(['idx_a', 'idx_m', 'idx_z']);
  });

  it('sorts uniques by name when normalizeStorage hook provided', () => {
    const result = canonicalizeContractToObject(
      minimal({
        storage: unboundStorage({
          users: {
            columns: {},
            uniques: [{ name: 'uq_z' }, { name: 'uq_a' }],
          },
        }),
      }),
      { normalizeStorage: sqlSortStorage },
    );
    const table = drill(unboundTables(result), 'users');
    const uniques = table['uniques'] as Array<{ name: string }>;
    expect(uniques.map((u) => u.name)).toEqual(['uq_a', 'uq_z']);
  });

  it('keeps column order inside primary key and unique column lists', () => {
    const result = canonicalizeContractToObject(
      minimal({
        storage: unboundStorage({
          users: {
            columns: {},
            primaryKey: { columns: ['second', 'first'] },
            uniques: [{ name: 'uq_name', columns: ['last_name', 'first_name'] }],
          },
        }),
      }),
      { normalizeStorage: sqlSortStorage },
    );
    const table = drill(unboundTables(result), 'users');
    expect(table['primaryKey']).toEqual({ columns: ['second', 'first'] });
    expect(table['uniques']).toEqual([{ name: 'uq_name', columns: ['last_name', 'first_name'] }]);
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
      { normalizeStorage: sqlSortStorage },
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
      { normalizeStorage: sqlSortStorage },
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

  it('passes namespaces without a table slot through unchanged', () => {
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
    expect(drill(ns, 'entries', 'collection')).toEqual({ posts: { columns: {} } });
  });
});

describe('canonicalizeContract', () => {
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

describe('canonicalize with value objects', () => {
  it('includes value objects under storage.namespaces.*.entries.valueObject when present', () => {
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
    const vo = drill(result, 'storage', 'namespaces', UNBOUND, 'entries', 'valueObject');
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
      { normalizeStorage: sqlSortStorage },
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
      { normalizeStorage: sqlSortStorage },
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
      'omitDefaults',
      'isDefaultValue',
      'noAction',
      'nullable',
    ];
    for (const token of forbiddenIdentifiers) {
      expect(source, `framework canonicalizer must not reference ${token}`).not.toContain(token);
    }
  });
});
