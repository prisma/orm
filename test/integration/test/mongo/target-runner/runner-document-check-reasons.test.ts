import { MongoCollection } from '@internal/mongo-contract';
import type { AnyMongoMigrationOperation } from '@internal/mongo-query-ast/control';
import { collMod } from '@internal/target-mongo/migration';
import { timeouts } from '@repo/test-utils';
import { ObjectId } from 'mongodb';
import { describe, expect, it } from 'vitest';
import { contract } from './runner-statements-fixtures';
import {
  usersContract,
  usersSchema,
  usersValidatorChange,
  useUsersDatabase,
} from './runner-users-fixtures';

const live = useUsersDatabase('runner_document_check_reasons_test');
const PLAN = { name: { bsonType: 'string' }, plan: { bsonType: 'string' } };
const BY_HAND =
  'The old validator may reject a document changed to the new shape, so the update that fixes one can skip document validation: change them with a dataTransform in migration.ts, or in mongosh with an update command that sets bypassDocumentValidation: true, such as db.runCommand({ update: "users", updates: [{ q: { _id: <id> }, u: { $set: { <field>: <value> } } }], bypassDocumentValidation: true }).';

function run(operations: readonly AnyMongoMigrationOperation[], destination = usersContract(PLAN)) {
  return live.run(operations, destination);
}

describe('MongoMigrationRunner, what a failed document check names', () => {
  it(
    'names why the document it shows does not fit: a missing field, a type, and a field the validator does not name',
    async () => {
      await live.db().createCollection('users');
      await live
        .db()
        .collection('users')
        .insertOne({ _id: new ObjectId('64b7f0c2a1b2c3d4e5f60718'), name: 5, legacyScore: 3 });

      const result = await run([usersValidatorChange(PLAN)]);

      if (result.ok) throw new Error('Expected the validator change to stop at its document check');
      expect(result.failure.why).toContain(
        'It has _id ObjectId("64b7f0c2a1b2c3d4e5f60718"). That document has no "plan", holds a value of type int in "name", which the new validator does not allow there, and has "legacyScore", a field the new validator does not name.',
      );
    },
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'names --backfill for a field the collection validator did not require, and says the old validator may reject a fix by hand',
    async () => {
      const nameOnly = { ...usersSchema(PLAN), required: ['_id', 'name'] };
      await live.db().createCollection('users', { validator: { $jsonSchema: nameOnly } });
      await live.db().collection('users').insertOne({ name: 'Ada' });

      const result = await run([usersValidatorChange(PLAN)]);

      if (result.ok) throw new Error('Expected the validator change to stop at its document check');
      expect(result.failure.why).toContain(
        `To give "plan" values you choose, plan the change with migration plan --backfill User.plan. ${BY_HAND}`,
      );
    },
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'names no --backfill for a field of a root model that shares the collection, which the planner would refuse',
    async () => {
      const root = (required: readonly string[]) => ({
        required: ['_id', ...required],
        properties: {
          _id: { bsonType: 'objectId' },
          name: { bsonType: 'string' },
          plan: { bsonType: 'string' },
        },
        additionalProperties: false,
      });
      const admin = {
        required: ['_id', 'level'],
        properties: { _id: { bsonType: 'objectId' }, level: { bsonType: 'string' } },
        additionalProperties: false,
      };
      const shared = (required: readonly string[]) => ({
        bsonType: 'object',
        anyOf: [root(required), admin],
      });
      await live.db().createCollection('users', { validator: { $jsonSchema: shared(['name']) } });
      await live.db().collection('users').insertOne({ name: 'Ada' });

      const result = await run(
        [
          collMod(
            'users',
            { validator: { $jsonSchema: shared(['name', 'plan']) } },
            { id: 'validator.users.update', checkDocuments: true },
          ),
        ],
        contract(
          'dest',
          {
            User: { collection: 'users', fields: ['_id', 'name', 'plan'] },
            Admin: { collection: 'users', fields: ['_id', 'level'] },
          },
          { users: new MongoCollection({}) },
        ),
      );

      if (result.ok) throw new Error('Expected the validator change to stop at its document check');
      expect({
        backfill: result.failure.why?.includes('--backfill'),
        byHand: result.failure.why?.includes('bypassDocumentValidation: true'),
      }).toEqual({ backfill: false, byHand: true });
    },
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'names the reasons against the variant whose discriminator value the document holds',
    async () => {
      const variants = {
        bsonType: 'object',
        required: ['_id', 'kind'],
        properties: { _id: { bsonType: 'objectId' }, kind: { bsonType: 'string' } },
        oneOf: [
          {
            properties: {
              _id: { bsonType: 'objectId' },
              kind: { enum: ['a'] },
              x: { bsonType: 'string' },
            },
            required: ['kind', 'x'],
            additionalProperties: false,
          },
          {
            properties: {
              _id: { bsonType: 'objectId' },
              kind: { enum: ['b'] },
              y: { bsonType: 'string' },
              z: { bsonType: 'string' },
            },
            required: ['kind', 'y', 'z'],
            additionalProperties: false,
          },
        ],
      };
      await live.db().createCollection('users');
      await live.db().collection('users').insertOne({ kind: 'b' });

      const result = await run([
        collMod(
          'users',
          { validator: { $jsonSchema: variants } },
          { id: 'validator.users.update', checkDocuments: true },
        ),
      ]);

      if (result.ok) throw new Error('Expected the validator change to stop at its document check');
      expect(result.failure.why).toContain('That document has no "y" and has no "z".');
    },
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'names the reasons against the right variant next to a base field with a one-value enum',
    async () => {
      const region = { bsonType: 'string', enum: ['EU'] };
      const variants = {
        bsonType: 'object',
        required: ['_id', 'kind', 'region'],
        properties: { _id: { bsonType: 'objectId' }, kind: { bsonType: 'string' }, region },
        oneOf: [
          {
            properties: {
              _id: { bsonType: 'objectId' },
              region,
              kind: { enum: ['a'] },
              x: { bsonType: 'string' },
            },
            required: ['kind', 'x'],
            additionalProperties: false,
          },
          {
            properties: {
              _id: { bsonType: 'objectId' },
              region,
              kind: { enum: ['b'] },
              y: { bsonType: 'string' },
              z: { bsonType: 'string' },
            },
            required: ['kind', 'y', 'z'],
            additionalProperties: false,
          },
        ],
      };
      await live.db().createCollection('users');
      await live.db().collection('users').insertOne({ kind: 'b', region: 'EU' });

      const result = await run([
        collMod(
          'users',
          { validator: { $jsonSchema: variants } },
          { id: 'validator.users.update', checkDocuments: true },
        ),
      ]);

      if (result.ok) throw new Error('Expected the validator change to stop at its document check');
      expect(result.failure.why).toContain('That document has no "y" and has no "z".');
    },
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'names the fields whose accepted values the change alters, as what it touches',
    async () => {
      const ageSchema = (bsonType: string) => ({
        bsonType: 'object',
        required: ['_id', 'name'],
        properties: {
          _id: { bsonType: 'objectId' },
          name: { bsonType: 'string' },
          age: { bsonType },
        },
      });
      await live
        .db()
        .createCollection('users', { validator: { $jsonSchema: ageSchema('string') } });
      await live.db().collection('users').insertOne({ name: 'Ada', age: 'forty' });

      const result = await run([
        collMod(
          'users',
          { validator: { $jsonSchema: ageSchema('int') } },
          { id: 'validator.users.update', checkDocuments: true },
        ),
      ]);

      if (result.ok) throw new Error('Expected the validator change to stop at its document check');
      expect({
        start: result.failure.why?.split('. It has')[0],
        touched: result.failure.meta['documentsFailingValidator'],
      }).toMatchObject({
        start: 'This validator change changes what "age" accepts',
        touched: { requires: [], retypes: ['age'] },
      });
    },
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'names a field one variant newly requires though another variant already required it',
    async () => {
      const variants = (bRequires: readonly string[]) => ({
        bsonType: 'object',
        required: ['_id', 'kind'],
        properties: { _id: { bsonType: 'objectId' }, kind: { bsonType: 'string' } },
        oneOf: [
          {
            properties: {
              _id: { bsonType: 'objectId' },
              kind: { enum: ['a'] },
              x: { bsonType: 'string' },
            },
            required: ['kind', 'x'],
            additionalProperties: false,
          },
          {
            properties: {
              _id: { bsonType: 'objectId' },
              kind: { enum: ['b'] },
              x: { bsonType: 'string' },
            },
            required: ['kind', ...bRequires],
            additionalProperties: false,
          },
        ],
      });
      await live.db().createCollection('users', { validator: { $jsonSchema: variants([]) } });
      await live.db().collection('users').insertOne({ kind: 'b' });

      const result = await run([
        collMod(
          'users',
          { validator: { $jsonSchema: variants(['x']) } },
          { id: 'validator.users.update', checkDocuments: true },
        ),
      ]);

      if (result.ok) throw new Error('Expected the validator change to stop at its document check');
      expect(result.failure.meta['documentsFailingValidator']).toMatchObject({
        requires: ['x'],
        retypes: [],
      });
    },
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'names why the document fails inside a value object',
    async () => {
      const withAddress = (zip: string) => ({
        bsonType: 'object',
        required: ['_id', 'address'],
        properties: {
          _id: { bsonType: 'objectId' },
          address: {
            bsonType: 'object',
            required: ['zip'],
            properties: { zip: { bsonType: zip } },
            additionalProperties: false,
          },
        },
        additionalProperties: false,
      });
      await live
        .db()
        .createCollection('users', { validator: { $jsonSchema: withAddress('string') } });
      await live
        .db()
        .collection('users')
        .insertOne({ address: { zip: '10115' } });

      const result = await run([
        collMod(
          'users',
          { validator: { $jsonSchema: withAddress('int') } },
          { id: 'validator.users.update', checkDocuments: true },
        ),
      ]);

      if (result.ok) throw new Error('Expected the validator change to stop at its document check');
      expect(result.failure.why).toContain(
        'That document holds a value of type string in "address.zip", which the new validator does not allow there.',
      );
    },
    timeouts.spinUpMongoMemoryServer,
  );
});
