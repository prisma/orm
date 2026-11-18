import { MongoCollection } from '@internal/mongo-contract';
import { collMod, renameField } from '@internal/target-mongo/migration';
import { timeouts } from '@repo/test-utils';
import { ObjectId } from 'mongodb';
import { describe, expect, it } from 'vitest';
import { contract } from './runner-statements-fixtures';
import { useUsersDatabase } from './runner-users-fixtures';

const live = useUsersDatabase('runner_document_check_advice_test');

describe('MongoMigrationRunner, --backfill advice in a collection several root models share', () => {
  it(
    "names --backfill for a variant's field that the other root model's documents cannot hold",
    async () => {
      const items = (bugRequires: readonly string[]) => ({
        bsonType: 'object',
        anyOf: [
          {
            required: ['_id', 'type'],
            properties: { _id: { bsonType: 'objectId' }, type: { bsonType: 'string' } },
            oneOf: [
              {
                required: ['type', ...bugRequires],
                properties: {
                  _id: { bsonType: 'objectId' },
                  type: { enum: ['bug'] },
                  severity: { bsonType: 'string' },
                },
                additionalProperties: false,
              },
            ],
          },
          {
            required: ['_id', 'text'],
            properties: { _id: { bsonType: 'objectId' }, text: { bsonType: 'string' } },
            additionalProperties: false,
          },
        ],
      });
      await live.db().createCollection('items', { validator: { $jsonSchema: items([]) } });
      await live.db().collection('items').insertOne({ type: 'bug' });
      const destination = contract(
        'dest',
        {
          Task: { collection: 'items', fields: ['_id', 'type'], variants: { Bug: 'bug' } },
          Bug: { collection: 'items', fields: ['severity'], base: 'Task' },
          Note: { collection: 'items', fields: ['_id', 'text'] },
        },
        { items: new MongoCollection({}) },
      );

      const result = await live.run(
        [
          collMod(
            'items',
            { validator: { $jsonSchema: items(['severity']) } },
            { id: 'validator.items.update', checkDocuments: true },
          ),
        ],
        destination,
      );

      if (result.ok) throw new Error('Expected the validator change to stop at its document check');
      expect({
        advice: result.failure.why?.includes(
          'To give "severity" values you choose, plan the change with --backfill Bug.severity, as the steps to take describe.',
        ),
        rowsWithoutValue: result.failure.meta.rowsWithoutValue,
      }).toEqual({
        advice: true,
        rowsWithoutValue: [
          {
            field: { kind: 'field', namespaceId: '__unbound__', model: 'Bug', field: 'severity' },
            reason: 'newField',
            rows: 1,
            operationIndex: 0,
          },
        ],
      });
    },
    timeouts.spinUpMongoMemoryServer,
  );
});

describe('MongoMigrationRunner, --backfill advice for a new discriminator beside the old one', () => {
  it(
    'names the new discriminator as required and --backfill for it when the old one is kept as a field',
    async () => {
      const tasks = (discriminator: string, others: readonly string[]) => ({
        bsonType: 'object',
        required: ['_id', discriminator, ...others],
        properties: Object.fromEntries([
          ['_id', { bsonType: 'objectId' }],
          ...[discriminator, ...others].map((field) => [field, { bsonType: 'string' }]),
        ]),
        oneOf: [
          {
            required: [discriminator],
            properties: { [discriminator]: { enum: ['bug'] } },
          },
        ],
      });
      await live.db().createCollection('tasks', { validator: { $jsonSchema: tasks('type', []) } });
      await live.db().collection('tasks').insertOne({ type: 'bug' });
      const destination = contract(
        'dest',
        {
          Task: {
            collection: 'tasks',
            fields: ['_id', 'kind', 'type'],
            variants: { Bug: 'bug' },
            discriminator: 'kind',
          },
          Bug: { collection: 'tasks', fields: [], base: 'Task' },
        },
        { tasks: new MongoCollection({}) },
      );

      const result = await live.run(
        [
          collMod(
            'tasks',
            { validator: { $jsonSchema: tasks('kind', ['type']) } },
            { id: 'validator.tasks.update', checkDocuments: true },
          ),
        ],
        destination,
      );

      if (result.ok) throw new Error('Expected the validator change to stop at its document check');
      expect({
        required: result.failure.why?.includes('This validator change makes "kind" required'),
        advice: result.failure.why?.includes(
          'To give "kind" values you choose, plan the change with --backfill Task.kind, as the steps to take describe.',
        ),
      }).toEqual({ required: true, advice: true });
    },
    timeouts.spinUpMongoMemoryServer,
  );
});

describe("MongoMigrationRunner, --backfill advice for a model's first discriminator", () => {
  it(
    "names --backfill for the discriminator only, and says how to give a new variant's required field its value",
    async () => {
      const plainTask = {
        bsonType: 'object',
        required: ['_id', 'title'],
        properties: { _id: { bsonType: 'objectId' }, title: { bsonType: 'string' } },
      };
      const tasks = {
        ...plainTask,
        required: ['_id', 'title', 'type'],
        properties: { ...plainTask.properties, type: { bsonType: 'string' } },
        oneOf: [
          {
            required: ['type', 'severity'],
            properties: { type: { enum: ['bug'] }, severity: { bsonType: 'string' } },
          },
          { required: ['type'], properties: { type: { enum: ['epic'] } } },
        ],
      };
      await live.db().createCollection('tasks', { validator: { $jsonSchema: plainTask } });
      await live
        .db()
        .collection('tasks')
        .insertOne({ _id: new ObjectId('65f000000000000000000001'), title: 'a' });
      const destination = contract(
        'dest',
        {
          Task: {
            collection: 'tasks',
            fields: ['_id', 'title', 'type'],
            variants: { Bug: 'bug', Epic: 'epic' },
          },
          Bug: { collection: 'tasks', fields: ['severity'], base: 'Task' },
          Epic: { collection: 'tasks', fields: [], base: 'Task' },
        },
        { tasks: new MongoCollection({}) },
      );

      const result = await live.run(
        [
          collMod(
            'tasks',
            { validator: { $jsonSchema: tasks } },
            { id: 'validator.tasks.update', checkDocuments: true },
          ),
        ],
        destination,
      );

      if (result.ok) throw new Error('Expected the validator change to stop at its document check');
      expect({
        why: result.failure.why,
        rowsWithoutValue: result.failure.meta.rowsWithoutValue,
      }).toEqual({
        why: [
          'This validator change makes "severity" and "type" required. It has _id ObjectId("65f000000000000000000001"). That document has no "type".',
          `Find them all with db.getCollection("tasks").find(${JSON.stringify({ $nor: [{ $jsonSchema: tasks }] })}) in mongosh.`,
          'To give "type" values you choose, plan the change with --backfill Task.type, as the steps to take describe.',
          'The update you write for --backfill Task.type can also set "severity" in the documents it gives value "bug", such as { $set: { type: "bug", severity: <value> } }.',
          'Or keep "severity" optional until a later change, which can make it required with --backfill Bug.severity.',
          'The old validator may reject a document changed to the new shape, so the update that fixes one can skip document validation: change them with a dataTransform in migration.ts, or in mongosh with an update command that sets bypassDocumentValidation: true, such as db.runCommand({ update: "tasks", updates: [{ q: { _id: <id> }, u: { $set: { <field>: <value> } } }], bypassDocumentValidation: true }). Under db migrate you can instead apply the validator over them: set checkDocuments to false on this operation in that migration.ts, run the file with node, and run db migrate again. db update writes no migration.ts, so there fix the documents first. This operation did not change the validator. Once the documents are fixed, run the command again; operations that already ran are skipped. The failed apply changed nothing.',
        ].join(' '),
        rowsWithoutValue: [
          {
            field: { kind: 'field', namespaceId: '__unbound__', model: 'Task', field: 'type' },
            reason: 'newField',
            rows: 1,
            operationIndex: 0,
          },
        ],
      });
    },
    timeouts.spinUpMongoMemoryServer,
  );
});

describe('MongoMigrationRunner, a renamed field that a document never held', () => {
  it(
    'offers no --backfill for the field a rename of the same plan gives its name',
    async () => {
      const users = (name: string) => ({
        bsonType: 'object',
        required: ['_id', name],
        properties: { _id: { bsonType: 'objectId' }, [name]: { bsonType: 'string' } },
      });
      await live.db().createCollection('people', { validator: { $jsonSchema: users('name') } });
      await live.db().collection('people').insertOne({}, { bypassDocumentValidation: true });
      const destination = contract(
        'dest',
        { User: { collection: 'people', fields: ['_id', 'fullName'] } },
        { people: new MongoCollection({}) },
      );

      const result = await live.run(
        [
          renameField('people', 'name', 'fullName'),
          collMod(
            'people',
            { validator: { $jsonSchema: users('fullName') } },
            { id: 'validator.people.update', checkDocuments: true },
          ),
        ],
        destination,
      );

      if (result.ok) throw new Error('Expected the validator change to stop at its document check');
      expect({
        named: result.failure.why?.includes('This validator change makes "fullName" required.'),
        backfill: result.failure.why?.includes('--backfill'),
        rowsWithoutValue: result.failure.meta.rowsWithoutValue,
      }).toEqual({ named: true, backfill: false, rowsWithoutValue: undefined });
    },
    timeouts.spinUpMongoMemoryServer,
  );
});
