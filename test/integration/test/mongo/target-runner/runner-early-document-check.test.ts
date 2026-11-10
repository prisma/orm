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

describe('MongoMigrationRunner, a new unique field on a collection with documents', () => {
  const users = (storageHash: string, fields: readonly string[], required: readonly string[]) => {
    const schema = closedSchema(fields);
    return contract(
      storageHash,
      { User: { collection: 'users', fields: ['_id', ...fields] } },
      {
        users: new MongoCollection({
          indexes: fields.includes('code')
            ? [{ name: 'code_1', keys: [{ field: 'code', direction: 1 as const }], unique: true }]
            : [],
          validator: {
            jsonSchema: { ...schema, required: ['_id', ...required] },
            validationLevel: 'strict',
            validationAction: 'error',
          },
        }),
      },
    );
  };
  const twoUsers = async () => {
    await live.createClosed(
      'users',
      ['email'],
      [],
      [{ email: 'ada@example.com' }, { email: 'bo@example.com' }],
    );
  };
  const indexNames = async () =>
    (await live.db().collection('users').indexes()).map(({ name }) => name);

  it(
    'stops at the document check before the index create when the field is required, naming it',
    async () => {
      await twoUsers();

      const { planned, result } = await live.planAndRun(
        users('from', ['email'], ['email']),
        users('to', ['email', 'code'], ['email', 'code']),
        [],
        [mongoTargetDescriptor],
      );

      expect({
        operations:
          planned.kind === 'success'
            ? planned.plan.operations.map((operation) => Reflect.get(operation, 'id'))
            : planned,
        failure: result.ok
          ? result
          : { code: result.failure.code, operationId: result.failure.meta['operationId'] },
        startOfWhy: result.ok ? undefined : result.failure.why?.split('. ')[0],
        indexes: await indexNames(),
      }).toEqual({
        operations: [
          'collection.users.checkDocuments',
          'index.users.create(code_1)',
          'validator.users.update',
        ],
        failure: {
          code: 'MIGRATION.PRECHECK_FAILED',
          operationId: 'collection.users.checkDocuments',
        },
        startOfWhy: 'This validator change makes "code" required',
        indexes: ['_id_'],
      });
    },
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'fails a unique index build that meets a duplicate value with its own failure, naming the index and the value',
    async () => {
      await twoUsers();

      const { result } = await live.planAndRun(
        users('from', ['email'], ['email']),
        users('to', ['email', 'code'], ['email']),
        [],
        [mongoTargetDescriptor],
      );

      if (result.ok) throw new Error('Expected the index build to fail');
      expect({
        code: result.failure.code,
        message: result.failure.message,
        why: result.failure.why,
      }).toEqual({
        code: 'MIGRATION.EXECUTION_FAILED',
        message:
          'Operation index.users.create(code_1) failed: the unique index code_1 cannot be built, because two documents in collection users hold the same value { code: null }',
        why: 'A document without the field counts as holding null. Give each document its own value of the indexed fields, or remove the duplicates, then run the command again; operations that already ran are skipped. The failed apply changed nothing.',
      });
    },
    timeouts.spinUpMongoMemoryServer,
  );
});

describe('MongoMigrationRunner, early checks on two collections', () => {
  it(
    'stops at the users check before the accounts fill, so accounts documents still accept updates',
    async () => {
      await live.createClosed('accounts', ['email'], [], [{ email: 'a@example.com' }]);
      await live.createClosed('users', ['email'], [], [{ email: 'u@example.com' }]);
      const withBorn = (fields: readonly string[]) => {
        const schema = closedSchema(fields);
        return new MongoCollection({
          validator: {
            jsonSchema: {
              ...schema,
              properties: { ...schema.properties, born: { bsonType: 'date' } },
            },
            validationLevel: 'strict',
            validationAction: 'error',
          },
        });
      };
      const from = contract(
        'from',
        {
          Account: { collection: 'accounts', fields: ['_id', 'email'] },
          User: { collection: 'users', fields: ['_id', 'email'] },
        },
        { accounts: closedCollection(['email']), users: closedCollection(['email']) },
      );
      const to = contract(
        'to',
        {
          Account: {
            collection: 'accounts',
            fields: ['_id', 'email', 'plan'],
            codecs: { _id: 'mongo/objectId@1' },
          },
          User: {
            collection: 'users',
            fields: ['_id', 'email', 'plan', 'born'],
            codecs: { _id: 'mongo/objectId@1', born: 'mongo/date@1' },
          },
        },
        {
          accounts: closedCollection(['email', 'plan']),
          users: withBorn(['email', 'plan', 'born']),
        },
      );

      const { planned, result } = await live.planAndRun(from, to, [], [mongoTargetDescriptor]);

      const accounts = live.db().collection('accounts');
      expect({
        operations:
          planned.kind === 'success'
            ? planned.plan.operations.map((operation) => Reflect.get(operation, 'id'))
            : planned,
        failedAt: result.ok ? result : result.failure.meta['operationId'],
        accounts: await live.documents('accounts'),
        update: (await accounts.updateMany({}, { $set: { email: 'b@example.com' } })).modifiedCount,
      }).toEqual({
        operations: [
          'collection.accounts.checkDocuments',
          'collection.users.checkDocuments',
          'field.accounts.plan.fill',
          'field.users.plan.fill',
          'validator.accounts.update',
          'validator.users.update',
        ],
        failedAt: 'collection.users.checkDocuments',
        accounts: [{ email: 'a@example.com' }],
        update: 1,
      });
    },
    timeouts.spinUpMongoMemoryServer,
  );
});
