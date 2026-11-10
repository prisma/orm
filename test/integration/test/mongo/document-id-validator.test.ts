import { defineContract } from '@internal/mongo/contract-builder';
import mongo from '@internal/mongo/runtime';
import { timeouts } from '@repo/test-utils';
import { type Db, ObjectId } from 'mongodb';
import { expect, it } from 'vitest';
import { withMongod } from './setup';

const contract = defineContract({}, ({ field, model, type }) => ({
  models: {
    Note: model('Note', {
      collection: 'notes',
      fields: { text: field.scalar(type.String()) },
    }),
    Tag: model('Tag', {
      collection: 'tags',
      fields: { _id: field.scalar(type.String()), label: field.scalar(type.String()) },
    }),
  },
}));

async function createWithValidator(db: Db, collection: 'notes' | 'tags'): Promise<void> {
  const validator =
    contract.storage.namespaces['__unbound__']?.entries.collection?.[collection]?.validator;
  if (validator === undefined) expect.unreachable(`${collection} has a validator`);
  await db.createCollection(collection, {
    validator: { $jsonSchema: validator.jsonSchema },
    validationLevel: validator.validationLevel,
    validationAction: validator.validationAction,
  });
}

it(
  'stores a document of a model without an _id field, with the objectId _id MongoDB adds, under its validator',
  () =>
    withMongod(async ({ client, dbName }) => {
      const db = client.db(dbName);
      await createWithValidator(db, 'notes');
      const orm = mongo({ contract, mongoClient: client, dbName }).orm;

      await orm.notes.create({ text: 'hello' });

      const stored = await db.collection('notes').find().toArray();
      expect(
        stored.map(({ _id, ...rest }) => ({ objectId: _id instanceof ObjectId, ...rest })),
      ).toEqual([{ objectId: true, text: 'hello' }]);
      expect(await orm.notes.select('text').all()).toEqual([{ text: 'hello' }]);
    }),
  timeouts.spinUpMongoMemoryServer,
);

it(
  'stores and reads back a document whose _id is a string, under its validator',
  () =>
    withMongod(async ({ client, dbName }) => {
      const db = client.db(dbName);
      await createWithValidator(db, 'tags');
      const orm = mongo({ contract, mongoClient: client, dbName }).orm;

      expect(await orm.tags.create({ _id: 'red', label: 'Red' })).toEqual({
        _id: 'red',
        label: 'Red',
      });

      expect(await db.collection('tags').find().toArray()).toEqual([{ _id: 'red', label: 'Red' }]);
      expect(await orm.tags.all()).toEqual([{ _id: 'red', label: 'Red' }]);
      await expect(
        db.collection('tags').insertOne({ _id: new ObjectId(), label: 'x' }),
      ).rejects.toThrow('Document failed validation');
    }),
  timeouts.spinUpMongoMemoryServer,
);
