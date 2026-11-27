import { canonicalizeContractToObject, computeStorageHash } from '@internal/contract/hashing';
import type { Contract } from '@internal/contract/types';
import { blindCast } from '@internal/utils/casts';
import type { JsonObject } from '@internal/utils/json';
import { describe, expect, it } from 'vitest';
import {
  mongoContractCanonicalizationHooks,
  normalMongoDomain,
} from '../src/canonicalization-hooks';

const storageWith = (
  collection: Record<string, unknown>,
  entries: Record<string, unknown> = {},
): Record<string, unknown> => ({
  namespaces: { app: { id: 'app', entries: { collection: { users: collection }, ...entries } } },
});

const index = (extra: Record<string, unknown> = {}) => ({
  name: 'users_email_idx',
  keys: [{ field: 'email', direction: 1 }],
  ...extra,
});

const hashOf = (storage: Record<string, unknown>): string =>
  computeStorageHash({
    target: 'mongo',
    targetFamily: 'mongo',
    storage,
    ...mongoContractCanonicalizationHooks,
  });

const contractWith = (storage: Record<string, unknown>, domain: unknown = { namespaces: {} }) =>
  blindCast<Contract, 'test contract literal'>({
    targetFamily: 'mongo',
    target: 'mongo',
    profileHash: 'test-profile',
    roots: {},
    domain,
    storage,
    extensions: {},
    capabilities: {},
    meta: {},
  });

const canonicalize = (contract: Contract) =>
  canonicalizeContractToObject(contract, {
    serializeContract: (c) =>
      blindCast<JsonObject, 'test contract literal is already plain JSON data'>(c),
    ...mongoContractCanonicalizationHooks,
  });

const written = (storage: Record<string, unknown>): unknown =>
  canonicalize(contractWith(storage))['storage'];

describe('MongoDB storage values the family does not own', () => {
  const pairs: ReadonlyArray<readonly [string, Record<string, unknown>, Record<string, unknown>]> =
    [
      [
        'a partial filter expression holding false',
        storageWith({ indexes: [index({ partialFilterExpression: { deleted: false, a: 1 } })] }),
        storageWith({ indexes: [index({ partialFilterExpression: { a: 1 } })] }),
      ],
      [
        'a partial filter expression that is only false',
        storageWith({ indexes: [index({ partialFilterExpression: { isAdmin: false } })] }),
        storageWith({ indexes: [index({ partialFilterExpression: {} })] }),
      ],
      [
        'a clustered index with no name',
        storageWith({ options: { clusteredIndex: {} } }),
        storageWith({}),
      ],
      [
        'change stream images that are off',
        storageWith({ options: { changeStreamPreAndPostImages: { enabled: false } } }),
        storageWith({ options: { changeStreamPreAndPostImages: { enabled: true } } }),
      ],
      [
        'storage engine options holding an empty object',
        storageWith({
          options: { storageEngine: { wiredTiger: { configString: 'x' }, inMemory: {} } },
        }),
        storageWith({ options: { storageEngine: { wiredTiger: { configString: 'x' } } } }),
      ],
      [
        'index option defaults holding false',
        storageWith({
          options: {
            indexOptionDefaults: { storageEngine: { wiredTiger: { prefixCompression: false } } },
          },
        }),
        storageWith({ options: { indexOptionDefaults: { storageEngine: { wiredTiger: {} } } } }),
      ],
      [
        'a validator enum member that is an object holding false',
        storageWith({
          validator: {
            jsonSchema: { bsonType: 'object', properties: { kind: { enum: [{ a: false }] } } },
          },
        }),
        storageWith({
          validator: { jsonSchema: { bsonType: 'object', properties: { kind: { enum: [{}] } } } },
        }),
      ],
      [
        'a closed validator schema',
        storageWith({
          validator: {
            jsonSchema: { bsonType: 'object', properties: { a: {} }, additionalProperties: false },
          },
        }),
        storageWith({ validator: { jsonSchema: { bsonType: 'object', properties: { a: {} } } } }),
      ],
      [
        'a value set member that is an object holding false',
        storageWith({}, { valueSet: { V: { kind: 'valueSet', values: [{ a: false }] } } }),
        storageWith({}, { valueSet: { V: { kind: 'valueSet', values: [{}] } } }),
      ],
    ];

  it.each(pairs)('gives contracts that differ in %s different hashes', (_, left, right) => {
    expect(hashOf(left)).not.toBe(hashOf(right));
  });

  it.each(pairs)('writes %s as given', (_, left) => {
    expect(written(left)).toEqual(left);
  });

  it('keeps an empty collection and the empty schema of an unconstrained field', () => {
    const storage = storageWith({
      validator: {
        jsonSchema: {
          bsonType: 'object',
          properties: { raw: {}, list: { bsonType: 'array', items: {} } },
        },
      },
    });
    expect(written(storage)).toEqual(storage);
    expect(written(storageWith({}))).toEqual(storageWith({}));
  });
});

describe('MongoDB storage defaults the family leaves out', () => {
  const pairs: ReadonlyArray<readonly [string, Record<string, unknown>, Record<string, unknown>]> =
    [
      ['empty indexes', storageWith({ indexes: [] }), storageWith({})],
      [
        "an index's unique and sparse of false",
        storageWith({ indexes: [index({ unique: false, sparse: false })] }),
        storageWith({ indexes: [index()] }),
      ],
      [
        "an index's collation flags of false",
        storageWith({
          indexes: [
            index({
              collation: {
                locale: 'en',
                caseLevel: false,
                numericOrdering: false,
                backwards: false,
                normalization: false,
              },
            }),
          ],
        }),
        storageWith({ indexes: [index({ collation: { locale: 'en' } })] }),
      ],
      [
        "a collection's collation flags of false",
        storageWith({ options: { collation: { locale: 'en', backwards: false } } }),
        storageWith({ options: { collation: { locale: 'en' } } }),
      ],
      [
        "a validator schema's empty required and properties at any level",
        storageWith({
          validator: {
            jsonSchema: {
              bsonType: 'object',
              required: [],
              properties: { address: { bsonType: 'object', required: [], properties: {} } },
              oneOf: [{ properties: {}, required: [] }],
            },
          },
        }),
        storageWith({
          validator: {
            jsonSchema: {
              bsonType: 'object',
              properties: { address: { bsonType: 'object' } },
              oneOf: [{}],
            },
          },
        }),
      ],
      [
        'a value-object field many: false',
        storageWith(
          {},
          {
            valueObject: {
              Address: {
                fields: {
                  city: {
                    nullable: false,
                    type: { kind: 'scalar', codecId: 'mongo/string@1' },
                    many: false,
                  },
                },
              },
            },
          },
        ),
        storageWith(
          {},
          {
            valueObject: {
              Address: {
                fields: {
                  city: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
                },
              },
            },
          },
        ),
      ],
      ['an empty entity-kind slot', storageWith({}, { valueSet: {} }), storageWith({})],
    ];

  it.each(pairs)('gives a contract with %s written and left out one hash', (_, left, right) => {
    expect(hashOf(left)).toBe(hashOf(right));
  });

  it.each(pairs)('writes the same file whether %s is written or left out', (_, left, right) => {
    expect(written(left)).toEqual(written(right));
  });
});

describe('normalMongoDomain', () => {
  it("leaves out a model field's many: false and keeps the empty fields of a variant", () => {
    const domain = {
      namespaces: {
        app: {
          models: {
            Task: {
              fields: {
                title: {
                  nullable: false,
                  type: { kind: 'scalar', codecId: 'mongo/string@1' },
                  many: false,
                },
              },
              relations: {},
              storage: { collection: 'tasks', fields: {} },
            },
            Epic: {
              fields: {},
              relations: {},
              base: { namespace: 'app', model: 'Task' },
              storage: { collection: 'tasks', fields: {} },
            },
          },
        },
      },
    };
    expect(normalMongoDomain(domain)).toEqual({
      namespaces: {
        app: {
          models: {
            Task: {
              fields: {
                title: { nullable: false, type: { kind: 'scalar', codecId: 'mongo/string@1' } },
              },
              relations: {},
              storage: { collection: 'tasks', fields: {} },
            },
            Epic: {
              fields: {},
              relations: {},
              base: { namespace: 'app', model: 'Task' },
              storage: { collection: 'tasks', fields: {} },
            },
          },
        },
      },
    });
  });
});
