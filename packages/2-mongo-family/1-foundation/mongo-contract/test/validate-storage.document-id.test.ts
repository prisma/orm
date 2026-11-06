import {
  asNamespaceId,
  type ContractModel,
  coreHash,
  profileHash,
  UNBOUND_DOMAIN_NAMESPACE_ID,
} from '@internal/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import type { MongoContract, MongoModelStorage } from '../src/contract-types';
import { documentIdRefusalReason } from '../src/document-id-refusal';
import { buildMongoNamespace } from '../src/ir/build-mongo-namespace';
import { MongoCollection } from '../src/ir/mongo-collection';
import { MongoStorage } from '../src/ir/mongo-storage';
import { validateMongoStorage } from '../src/validate-storage';

const ref = (model: string) => ({ namespace: asNamespaceId(UNBOUND_DOMAIN_NAMESPACE_ID), model });

const objectIdSchema = {
  bsonType: 'object',
  required: ['_id'],
  properties: { _id: { bsonType: 'objectId' } },
  additionalProperties: false,
};

function contractWith(
  models: Record<string, ContractModel<MongoModelStorage>>,
  jsonSchema: Record<string, unknown> | undefined,
): MongoContract {
  return {
    target: 'mongo',
    targetFamily: 'mongo',
    roots: { items: ref('Item') },
    storage: new MongoStorage({
      storageHash: coreHash('test'),
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: buildMongoNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            collection: {
              items: new MongoCollection(
                jsonSchema === undefined
                  ? {}
                  : {
                      validator: {
                        jsonSchema,
                        validationLevel: 'strict',
                        validationAction: 'error',
                      },
                    },
              ),
            },
          },
        }),
      },
    }),
    domain: applicationDomainOf({ models }),
    capabilities: {},
    extensions: {},
    profileHash: profileHash('test'),
    meta: {},
  };
}

const item: ContractModel<MongoModelStorage> = {
  fields: {},
  storage: { fields: {}, collection: 'items' },
  relations: {},
};

describe('validateMongoStorage() and the rules every MongoDB contract source follows', () => {
  it('accepts a collection without a validator, as a Prisma 6 contract has', () => {
    expect(() => validateMongoStorage(contractWith({ Item: item }, undefined))).not.toThrow();
  });

  it('accepts validators that require an _id of a BSON type an _id can have, in every anyOf branch', () => {
    expect(() =>
      validateMongoStorage(
        contractWith(
          { Item: item },
          {
            bsonType: 'object',
            anyOf: [
              objectIdSchema,
              { ...objectIdSchema, properties: { _id: { bsonType: 'string' } } },
            ],
          },
        ),
      ),
    ).not.toThrow();
  });

  it('refuses a validator that does not require _id', () => {
    expect(() =>
      validateMongoStorage(
        contractWith(
          { Item: item },
          { bsonType: 'object', anyOf: [objectIdSchema, { ...objectIdSchema, required: [] }] },
        ),
      ),
    ).toThrow(
      'Collection "items": its validator must require _id, for every model the collection stores, since every document has an _id',
    );
  });

  it('refuses a validator whose _id accepts any value, naming the model, field and codec', () => {
    const withId: ContractModel<MongoModelStorage> = {
      ...item,
      fields: {
        _id: { type: { kind: 'scalar', codecId: 'mongo/bson@1' }, nullable: false, many: false },
      },
      storage: { collection: 'items', fields: { _id: { field: '_id' } } },
    };
    expect(() =>
      validateMongoStorage(
        contractWith({ Item: withId }, { ...objectIdSchema, properties: { _id: {} } }),
      ),
    ).toThrow(`Model "Item" field "_id" ${documentIdRefusalReason('mongo/bson@1', [])}`);
  });

  it('reports a field without a storage entry, not an internal error, when a validator is present', () => {
    const withId: ContractModel<MongoModelStorage> = {
      ...item,
      fields: {
        _id: {
          type: { kind: 'scalar', codecId: 'mongo/objectId@1' },
          nullable: false,
          many: false,
        },
      },
    };
    expect(() => validateMongoStorage(contractWith({ Item: withId }, objectIdSchema))).toThrow(
      expect.objectContaining({
        code: 'CONTRACT.VALIDATION_FAILED',
        message:
          'Contract storage validation failed:\n- Model "__unbound__:Item" field "_id" has no entry in storage.fields',
      }),
    );
  });

  it('names the field stored as _id by its own name', () => {
    const withId: ContractModel<MongoModelStorage> = {
      ...item,
      fields: {
        id: { type: { kind: 'scalar', codecId: 'mongo/bson@1' }, nullable: false, many: false },
      },
      storage: { collection: 'items', fields: { id: { field: '_id' } } },
    };
    expect(() =>
      validateMongoStorage(
        contractWith({ Item: withId }, { ...objectIdSchema, properties: { _id: {} } }),
      ),
    ).toThrow(`Model "Item" field "id" ${documentIdRefusalReason('mongo/bson@1', [])}`);
  });

  it.each([
    ['an array', 'mongo/vector@1', { bsonType: 'array', items: { bsonType: 'double' } }, 'array'],
    ['null', 'mongo/string@1', { bsonType: ['null', 'string'] }, 'null'],
    ['a regular expression', 'test/regex@1', { bsonType: 'regex' }, 'regex'],
  ])(
    'refuses a validator whose _id accepts %s, naming the model, field and codec',
    (_case, codecId, idSchema, forbidden) => {
      const withId: ContractModel<MongoModelStorage> = {
        ...item,
        fields: { _id: { type: { kind: 'scalar', codecId }, nullable: false, many: false } },
        storage: { collection: 'items', fields: { _id: { field: '_id' } } },
      };
      expect(() =>
        validateMongoStorage(
          contractWith({ Item: withId }, { ...objectIdSchema, properties: { _id: idSchema } }),
        ),
      ).toThrow(`Model "Item" field "_id" ${documentIdRefusalReason(codecId, [forbidden])}`);
    },
  );

  it('refuses an embed relation to a model with variants', () => {
    expect(() =>
      validateMongoStorage(
        contractWith(
          {
            Item: { ...item, relations: { task: { to: ref('Task'), cardinality: '1:1' } } },
            Task: {
              fields: {},
              storage: { fields: {} },
              relations: {},
              owner: 'Item',
              discriminator: { field: 'type' },
              variants: { bug: ref('Bug') },
            },
            Bug: { fields: {}, storage: { fields: {} }, relations: {}, base: ref('Task') },
          },
          undefined,
        ),
      ),
    ).toThrow(
      'Relation "Item.task" embeds model "Task", which has variants. The ORM reads and writes only the base fields of an embedded model, so an embedded model cannot have variants.',
    );
  });
});
