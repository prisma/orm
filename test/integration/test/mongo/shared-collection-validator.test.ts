import { defineContract } from '@internal/mongo/contract-builder';
import { timeouts } from '@repo/test-utils';
import { ObjectId } from 'mongodb';
import { expect, it } from 'vitest';
import { withMongod } from './setup';

const contract = defineContract({}, ({ field, model, type }) => ({
  models: {
    User: model('User', {
      collection: 'users',
      fields: { _id: field.scalar(type.ObjectId()), email: field.scalar(type.String()) },
    }),
    Admin: model('Admin', {
      collection: 'users',
      fields: { _id: field.scalar(type.ObjectId()), level: field.scalar(type.Int32()) },
    }),
  },
}));

it(
  'a collection storing two models accepts a document of each and refuses an extra field',
  () =>
    withMongod(async ({ client, dbName }) => {
      const validator =
        contract.storage.namespaces['__unbound__']?.entries.collection?.['users']?.validator;
      if (validator === undefined) expect.unreachable('users has a validator');
      const db = client.db(dbName);
      await db.createCollection('users', {
        validator: { $jsonSchema: validator.jsonSchema },
        validationLevel: validator.validationLevel,
        validationAction: validator.validationAction,
      });
      const users = db.collection('users');

      await users.insertOne({ email: 'ada@example.com' });
      await users.insertOne({ _id: new ObjectId(), level: 3 });
      await expect(users.insertOne({ email: 'bob@example.com', level: 3 })).rejects.toMatchObject({
        code: 121,
      });
      await expect(
        users.insertOne({ email: 'eve@example.com', nickname: 'e' }),
      ).rejects.toMatchObject({ code: 121 });

      expect(await users.find({}, { projection: { _id: 0 } }).toArray()).toEqual([
        { email: 'ada@example.com' },
        { level: 3 },
      ]);
    }),
  timeouts.spinUpMongoMemoryServer,
);
