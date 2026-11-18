import { defineContract } from '@internal/mongo/contract-builder';
import mongo from '@internal/mongo/runtime';
import { timeouts } from '@repo/test-utils';
import { expect, it } from 'vitest';
import { withMongod } from './setup';

const contract = defineContract({}, ({ field, model, type }) => ({
  models: {
    Item: model('Item', {
      collection: 'items',
      fields: { _id: field.scalar(type.ObjectId()), embedding: field.scalar(type.Vector()) },
    }),
  },
}));

it(
  'installs the validator of a vector field, which accepts the vector the ORM writes',
  () =>
    withMongod(async ({ client, dbName }) => {
      const validator =
        contract.storage.namespaces['__unbound__']?.entries.collection?.['items']?.validator;
      if (validator === undefined) expect.unreachable('items has a validator');
      const db = client.db(dbName);
      await db.createCollection('items', {
        validator: { $jsonSchema: validator.jsonSchema },
        validationLevel: validator.validationLevel,
        validationAction: validator.validationAction,
      });

      const created = await mongo({ contract, mongoClient: client, dbName }).orm.items.create({
        embedding: [0.5, 1, 2.25],
      });

      expect(created.embedding).toEqual([0.5, 1, 2.25]);
      expect(
        await db
          .collection('items')
          .find({}, { projection: { _id: 0 } })
          .toArray(),
      ).toEqual([{ embedding: [0.5, 1, 2.25] }]);
    }),
  timeouts.spinUpMongoMemoryServer,
);
