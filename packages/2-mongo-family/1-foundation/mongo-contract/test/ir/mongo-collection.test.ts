import { IRNodeBase } from '@internal/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { MongoCollection } from '../../src/ir/mongo-collection';
import { MongoCollectionOptions } from '../../src/ir/mongo-collection-options';
import { MongoIndex } from '../../src/ir/mongo-index';
import { MongoValidator } from '../../src/ir/mongo-validator';

describe('MongoCollection', () => {
  it('constructs from empty input', () => {
    const collection = new MongoCollection();
    expect(collection.kind).toBe('mongo-collection');
    expect(collection.indexes).toBeUndefined();
    expect(collection.validator).toBeUndefined();
    expect(collection.options).toBeUndefined();
  });

  it('normalises plain index data into MongoIndex instances', () => {
    const collection = new MongoCollection({
      indexes: [{ name: 'email_1', keys: [{ field: 'email', direction: 1 }], unique: true }],
    });
    const indexes = collection.indexes;
    expect(indexes).toHaveLength(1);
    expect(indexes?.[0]).toBeInstanceOf(MongoIndex);
    expect(indexes?.[0]?.unique).toBe(true);
  });

  it('preserves already-constructed nested IR-class instances by reference', () => {
    const idx = new MongoIndex({ name: 'email_1', keys: [{ field: 'email', direction: 1 }] });
    const validator = new MongoValidator({
      jsonSchema: { type: 'object' },
      validationLevel: 'strict',
      validationAction: 'error',
    });
    const options = new MongoCollectionOptions({});
    const collection = new MongoCollection({ indexes: [idx], validator, options });
    expect(collection.indexes?.[0]).toBe(idx);
    expect(collection.validator).toBe(validator);
    expect(collection.options).toBe(options);
  });

  it('normalises plain validator and options data into IR-class instances', () => {
    const collection = new MongoCollection({
      validator: {
        jsonSchema: { type: 'object' },
        validationLevel: 'strict',
        validationAction: 'error',
      },
      options: { changeStreamPreAndPostImages: { enabled: true } },
    });
    expect(collection.validator).toBeInstanceOf(MongoValidator);
    expect(collection.options).toBeInstanceOf(MongoCollectionOptions);
    expect(collection.options?.changeStreamPreAndPostImages?.enabled).toBe(true);
  });

  it('extends IRNodeBase and freezes', () => {
    const collection = new MongoCollection();
    expect(collection).toBeInstanceOf(IRNodeBase);
    expect(collection).toBeInstanceOf(MongoCollection);
    expect(Object.isFrozen(collection)).toBe(true);
  });

  it('omits undeclared optional fields from canonical JSON', () => {
    const collection = new MongoCollection({
      indexes: [{ name: 'email_1', keys: [{ field: 'email', direction: 1 }], unique: true }],
    });
    expect(JSON.parse(JSON.stringify(collection))).toEqual({
      kind: 'mongo-collection',
      indexes: [
        {
          kind: 'mongo-index',
          name: 'email_1',
          keys: [{ field: 'email', direction: 1 }],
          unique: true,
        },
      ],
    });
  });
});
