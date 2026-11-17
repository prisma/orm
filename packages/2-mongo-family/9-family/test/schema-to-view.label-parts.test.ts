import {
  MongoSchemaCollection,
  MongoSchemaCollectionOptions,
  MongoSchemaIndex,
  MongoSchemaIR,
  MongoSchemaValidator,
} from '@internal/mongo-schema-ir';
import { describe, expect, it } from 'vitest';
import { mongoSchemaToView } from '../src/core/schema-to-view';

describe('mongoSchemaToView label parts', () => {
  const view = mongoSchemaToView(
    new MongoSchemaIR(
      [
        new MongoSchemaCollection({
          name: 'users',
          indexes: [
            new MongoSchemaIndex({
              name: 'email_1_createdAt_-1',
              keys: [
                { field: 'email', direction: 1 },
                { field: 'createdAt', direction: -1 },
              ],
              unique: true,
              sparse: true,
            }),
          ],
          validator: new MongoSchemaValidator({
            jsonSchema: {
              bsonType: 'object',
              required: ['email'],
              properties: { email: { bsonType: 'string' }, name: { bsonType: 'string' } },
            },
            validationLevel: 'strict',
            validationAction: 'error',
          }),
          options: new MongoSchemaCollectionOptions({ capped: { size: 1024 } }),
        }),
      ],
      { fromDatabase: false },
    ),
  );
  const collection = view.root.children?.[0];
  const [index, validator, options] = collection?.children ?? [];

  it('splits a collection into keyword and name', () => {
    expect(collection?.labelParts).toEqual([
      { text: 'collection', role: 'keyword' },
      { text: ' ' },
      { text: 'users', role: 'name' },
    ]);
  });

  it('splits an index into keyword, keys and options', () => {
    expect(index?.labelParts).toEqual([
      { text: 'unique index', role: 'keyword' },
      { text: ' (' },
      { text: 'email, createdAt desc', role: 'name' },
      { text: ')' },
      { text: ' ' },
      { text: '(sparse)', role: 'detail' },
    ]);
    expect(index?.label).toBe('unique index (email, createdAt desc) (sparse)');
  });

  it('splits a validator and its fields', () => {
    expect(validator?.labelParts).toEqual([
      { text: 'validator', role: 'keyword' },
      { text: ' ' },
      { text: '(level: strict, action: error)', role: 'detail' },
    ]);
    expect(validator?.children?.map((field) => field.labelParts)).toEqual([
      [
        { text: 'email', role: 'name' },
        { text: ': ' },
        { text: 'string' },
        { text: ' ' },
        { text: '(required)', role: 'detail' },
      ],
      [{ text: 'name', role: 'name' }, { text: ': ' }, { text: 'string' }],
    ]);
  });

  it('splits collection options into keyword and detail', () => {
    expect(options?.labelParts).toEqual([
      { text: 'options', role: 'keyword' },
      { text: ' ' },
      { text: '(capped)', role: 'detail' },
    ]);
  });
});
