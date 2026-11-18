import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import {
  MongoCollection,
  type MongoCollectionOptions,
  type MongoCollectionOptionsInput,
  type MongoContract,
  type MongoIndex,
  type MongoIndexInput,
  type MongoValidator,
  type MongoValidatorInput,
} from '@internal/mongo-contract';
import { describe, expect, it } from 'vitest';
import { contractToMongoSchemaIR } from '../src/core/contract-to-schema';

type MongoCollectionData = {
  readonly indexes?: readonly (MongoIndex | MongoIndexInput)[];
  readonly validator?: MongoValidator | MongoValidatorInput;
  readonly options?: MongoCollectionOptions | MongoCollectionOptionsInput;
};

function makeStorageCollection(data: MongoCollectionData): MongoCollection {
  return new MongoCollection(data);
}

function makeContract(collections: Record<string, MongoCollectionData>): MongoContract {
  const builtCollections: Record<string, MongoCollection> = {};
  for (const [name, data] of Object.entries(collections)) {
    builtCollections[name] = makeStorageCollection(data);
  }
  return {
    target: 'mongo',
    targetFamily: 'mongo',
    profileHash: 'test-profile',
    capabilities: {},
    extensions: {},
    meta: {},
    roots: {},
    models: {},
    storage: {
      storageHash: 'test-storage',
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: {
          id: UNBOUND_NAMESPACE_ID,
          entries: { collection: builtCollections },
        },
      },
    },
  } as unknown as MongoContract;
}

describe('contractToMongoSchemaIR', () => {
  it('returns empty IR for null contract', () => {
    const ir = contractToMongoSchemaIR(null);
    expect(ir.collections).toEqual([]);
  });

  it('converts empty collection (no indexes)', () => {
    const ir = contractToMongoSchemaIR(makeContract({ users: {} }));
    expect(ir.collection('users')).toBeDefined();
    expect(ir.collection('users')!.name).toBe('users');
    expect(ir.collection('users')!.indexes).toEqual([]);
  });

  it('converts collection with one ascending index', () => {
    const ir = contractToMongoSchemaIR(
      makeContract({
        users: {
          indexes: [{ name: 'email_1', keys: [{ field: 'email', direction: 1 }] }],
        },
      }),
    );
    const coll = ir.collection('users')!;
    expect(coll.indexes).toHaveLength(1);
    expect(coll.indexes[0]!.keys).toEqual([{ field: 'email', direction: 1 }]);
    expect(coll.indexes[0]!.unique).toBe(false);
  });

  it('converts collection with unique index', () => {
    const ir = contractToMongoSchemaIR(
      makeContract({
        users: {
          indexes: [{ name: 'email_1', keys: [{ field: 'email', direction: 1 }], unique: true }],
        },
      }),
    );
    const idx = ir.collection('users')!.indexes[0]!;
    expect(idx.unique).toBe(true);
  });

  it('converts multiple collections', () => {
    const ir = contractToMongoSchemaIR(
      makeContract({
        users: { indexes: [{ name: 'email_1', keys: [{ field: 'email', direction: 1 }] }] },
        posts: { indexes: [{ name: 'title_1', keys: [{ field: 'title', direction: 1 }] }] },
      }),
    );
    expect(ir.collections).toHaveLength(2);
    expect(ir.collection('users')).toBeDefined();
    expect(ir.collection('posts')).toBeDefined();
  });

  it('preserves sparse option', () => {
    const ir = contractToMongoSchemaIR(
      makeContract({
        users: {
          indexes: [
            { name: 'nickname_1', keys: [{ field: 'nickname', direction: 1 }], sparse: true },
          ],
        },
      }),
    );
    expect(ir.collection('users')!.indexes[0]!.sparse).toBe(true);
  });

  it('preserves TTL option', () => {
    const ir = contractToMongoSchemaIR(
      makeContract({
        users: {
          indexes: [
            {
              name: 'createdAt_1',
              keys: [{ field: 'createdAt', direction: 1 }],
              expireAfterSeconds: 3600,
            },
          ],
        },
      }),
    );
    expect(ir.collection('users')!.indexes[0]!.expireAfterSeconds).toBe(3600);
  });

  it('preserves partialFilterExpression', () => {
    const pfe = { active: { $eq: true } };
    const ir = contractToMongoSchemaIR(
      makeContract({
        users: {
          indexes: [
            {
              name: 'status_1',
              keys: [{ field: 'status', direction: 1 }],
              partialFilterExpression: pfe,
            },
          ],
        },
      }),
    );
    expect(ir.collection('users')!.indexes[0]!.partialFilterExpression).toEqual(pfe);
  });

  it('converts compound index', () => {
    const ir = contractToMongoSchemaIR(
      makeContract({
        users: {
          indexes: [
            {
              name: 'email_1_tenantId_1',
              keys: [
                { field: 'email', direction: 1 },
                { field: 'tenantId', direction: 1 },
              ],
              unique: true,
            },
          ],
        },
      }),
    );
    const idx = ir.collection('users')!.indexes[0]!;
    expect(idx.keys).toHaveLength(2);
    expect(idx.keys[0]!.field).toBe('email');
    expect(idx.keys[1]!.field).toBe('tenantId');
    expect(idx.unique).toBe(true);
  });

  it('preserves M2 index options (weights, default_language, language_override, collation, wildcardProjection)', () => {
    const ir = contractToMongoSchemaIR(
      makeContract({
        users: {
          indexes: [
            {
              name: 'bio_text',
              keys: [{ field: 'bio', direction: 'text' as const }],
              weights: { bio: 10 },
              default_language: 'english',
              language_override: 'lang',
              collation: { locale: 'en', strength: 2 },
            },
            {
              name: '$**_1',
              keys: [{ field: '$**', direction: 1 as const }],
              wildcardProjection: { name: 1 as const, email: 1 as const },
            },
          ],
        },
      }),
    );
    const textIdx = ir.collection('users')!.indexes[0]!;
    expect(textIdx.weights).toEqual({ bio: 10 });
    expect(textIdx.default_language).toBe('english');
    expect(textIdx.language_override).toBe('lang');
    expect(textIdx.collation).toEqual({ locale: 'en', strength: 2 });

    const wildcardIdx = ir.collection('users')!.indexes[1]!;
    expect(wildcardIdx.wildcardProjection).toEqual({ name: 1, email: 1 });
  });

  it('converts collection with validator', () => {
    const ir = contractToMongoSchemaIR(
      makeContract({
        users: {
          validator: {
            jsonSchema: { bsonType: 'object', properties: { name: { bsonType: 'string' } } },
            validationLevel: 'strict',
            validationAction: 'error',
          },
        },
      }),
    );
    const coll = ir.collection('users')!;
    expect(coll.validator).toBeDefined();
    expect(coll.validator!.jsonSchema).toEqual({
      bsonType: 'object',
      properties: { name: { bsonType: 'string' } },
    });
    expect(coll.validator!.validationLevel).toBe('strict');
    expect(coll.validator!.validationAction).toBe('error');
  });

  it('converts collection with options', () => {
    const ir = contractToMongoSchemaIR(
      makeContract({
        events: {
          options: {
            capped: { size: 1048576, max: 1000 },
            collation: { locale: 'en' },
            changeStreamPreAndPostImages: { enabled: true },
            clusteredIndex: { name: 'myCluster' },
          },
        },
      }),
    );
    const coll = ir.collection('events')!;
    expect(coll.options).toBeDefined();
    expect(coll.options!.capped).toEqual({ size: 1048576, max: 1000 });
    expect(coll.options!.collation).toEqual({ locale: 'en' });
    expect(coll.options!.changeStreamPreAndPostImages).toEqual({ enabled: true });
    expect(coll.options!.clusteredIndex).toEqual({ name: 'myCluster' });
  });

  it('converts collection with timeseries options', () => {
    const ir = contractToMongoSchemaIR(
      makeContract({
        metrics: {
          options: {
            timeseries: { timeField: 'ts', metaField: 'meta', granularity: 'hours' },
          },
        },
      }),
    );
    const coll = ir.collection('metrics')!;
    expect(coll.options!.timeseries).toEqual({
      timeField: 'ts',
      metaField: 'meta',
      granularity: 'hours',
    });
  });

  it('collection without validator or options has undefined for both', () => {
    const ir = contractToMongoSchemaIR(makeContract({ users: {} }));
    expect(ir.collection('users')!.validator).toBeUndefined();
    expect(ir.collection('users')!.options).toBeUndefined();
  });
});
