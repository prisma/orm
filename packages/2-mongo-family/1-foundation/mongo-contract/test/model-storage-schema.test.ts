import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import { MongoContractSchema } from '../src/contract-schema';

function contractWithUserStorage(storage: unknown) {
  return {
    target: 'mongo',
    targetFamily: 'mongo',
    roots: {},
    domain: {
      namespaces: {
        __unbound__: {
          models: {
            User: {
              fields: {
                id: {
                  type: { kind: 'scalar', codecId: 'mongo/objectId@1' },
                  nullable: false,
                  many: false,
                },
              },
              relations: {},
              storage,
            },
          },
        },
      },
    },
    storage: { namespaces: {} },
  };
}

describe('model storage schema', () => {
  it('accepts the stored name of each field', () => {
    const contract = contractWithUserStorage({
      collection: 'users',
      fields: { id: { field: '_id' } },
    });
    expect(MongoContractSchema(contract)).toEqual(contract);
  });

  it.each([
    { collection: 'users' },
    { collection: 'users', fields: { id: {} } },
    { collection: 'users', fields: { id: { field: 1 } } },
    { collection: 'users', fields: { id: { field: '_id', column: '_id' } } },
  ])('rejects model storage %j', (storage) => {
    expect(MongoContractSchema(contractWithUserStorage(storage))).toBeInstanceOf(type.errors);
  });
});
