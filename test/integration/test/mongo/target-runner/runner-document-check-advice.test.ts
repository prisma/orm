import { MongoCollection } from '@internal/mongo-contract';
import { collMod } from '@internal/target-mongo/migration';
import { timeouts } from '@repo/test-utils';
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
