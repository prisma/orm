import { type } from 'arktype';
import { describe, expect, it } from 'vitest';
import { createMongoContractSchema } from '../../src/contract-schema';
import { MongoCollection } from '../../src/ir/mongo-collection';

function minimalContract(opts: { collectionControl?: unknown; defaultControlPolicy?: unknown }) {
  return {
    target: 'mongo',
    targetFamily: 'mongo',
    roots: {},
    domain: { namespaces: { main: { models: {} } } },
    storage: {
      namespaces: {
        main: {
          id: 'main',
          entries: {
            collection: {
              users:
                opts.collectionControl !== undefined ? { control: opts.collectionControl } : {},
            },
          },
        },
      },
    },
    ...(opts.defaultControlPolicy !== undefined
      ? { defaultControlPolicy: opts.defaultControlPolicy }
      : {}),
  };
}

describe('MongoCollection control field', () => {
  it('retains control when set', () => {
    const collection = new MongoCollection({ control: 'external' });
    expect(collection.control).toBe('external');
  });

  it('omits control when unset', () => {
    const collection = new MongoCollection();
    expect(Object.hasOwn(collection, 'control')).toBe(false);
    expect('control' in JSON.parse(JSON.stringify(collection))).toBe(false);
  });
});

describe('Mongo contract schema control fields', () => {
  const schema = createMongoContractSchema();

  it('accepts a collection carrying control', () => {
    expect(schema(minimalContract({ collectionControl: 'observed' })) instanceof type.errors).toBe(
      false,
    );
  });

  it('rejects a collection carrying a non-ControlPolicy string', () => {
    expect(schema(minimalContract({ collectionControl: 'bogus' })) instanceof type.errors).toBe(
      true,
    );
  });

  it('accepts a contract carrying defaultControlPolicy', () => {
    expect(
      schema(minimalContract({ defaultControlPolicy: 'managed' })) instanceof type.errors,
    ).toBe(false);
  });

  it('rejects a contract carrying a non-ControlPolicy defaultControlPolicy', () => {
    expect(schema(minimalContract({ defaultControlPolicy: 'bogus' })) instanceof type.errors).toBe(
      true,
    );
  });
});
