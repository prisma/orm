import { MongoCollection } from '@internal/mongo-contract';
import { mongoTargetDescriptor } from '@internal/target-mongo/control';
import { timeouts } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import {
  closedCollection,
  closedSchema,
  contract,
  useStatementsDatabase,
} from './runner-statements-fixtures';

const live = useStatementsDatabase('runner_early_document_check_test');

describe('MongoMigrationRunner, documents no rewrite of the plan makes fit', () => {
  it(
    'stops before the first rewrite, and leaves the documents as they were',
    async () => {
      await live.createClosed('users', ['email'], [], [{ email: 'ada@example.com' }]);
      const from = contract(
        'from',
        { User: { collection: 'users', fields: ['_id', 'email'] } },
        { users: closedCollection(['email']) },
      );
      const schema = closedSchema(['email', 'plan', 'born']);
      const to = contract(
        'to',
        {
          User: {
            collection: 'users',
            fields: ['_id', 'email', 'plan', 'born'],
            codecs: { _id: 'mongo/objectId@1', born: 'mongo/date@1' },
          },
        },
        {
          users: new MongoCollection({
            validator: {
              jsonSchema: {
                ...schema,
                properties: { ...schema.properties, born: { bsonType: 'date' } },
              },
              validationLevel: 'strict',
              validationAction: 'error',
            },
          }),
        },
      );

      const { planned, result } = await live.planAndRun(from, to, [], [mongoTargetDescriptor]);

      expect({
        operations:
          planned.kind === 'success'
            ? planned.plan.operations.map((operation) => Reflect.get(operation, 'id'))
            : planned,
        failure: result.ok
          ? result
          : {
              code: result.failure.code,
              operationId: result.failure.meta['operationId'],
              message: result.failure.message,
              why: result.failure.why,
            },
        users: await live.documents('users'),
      }).toEqual({
        operations: [
          'collection.users.checkDocuments',
          'field.users.plan.fill',
          'validator.users.update',
        ],
        failure: {
          code: 'MIGRATION.PRECHECK_FAILED',
          operationId: 'collection.users.checkDocuments',
          message:
            'Operation collection.users.checkDocuments stopped: 1 document in collection users does not fit the new validator, and no rewrite of this plan makes it fit',
          why: expect.stringMatching(
            /^This validator change makes "born" required\. .* No rewrite of this plan changes what makes it fail, so nothing was rewritten\. .*The failed apply changed nothing\.$/,
          ),
        },
        users: [{ email: 'ada@example.com' }],
      });
    },
    timeouts.spinUpMongoMemoryServer,
  );
});
