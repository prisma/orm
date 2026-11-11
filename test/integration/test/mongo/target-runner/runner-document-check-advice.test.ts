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
      expect(result.failure.why).toContain(
        'To give "severity" values you choose, plan the change with migration plan --backfill Bug.severity.',
      );
    },
    timeouts.spinUpMongoMemoryServer,
  );
});
