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

function withBorn(fields: readonly string[]) {
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
}

describe('MongoMigrationRunner, early checks on two collections', () => {
  it(
    'stops at the users check before the accounts index drop and fill, so accounts keep their index and still accept updates',
    async () => {
      await live.createClosed('accounts', ['email'], ['email'], [{ email: 'a@example.com' }]);
      await live.createClosed('users', ['email'], [], [{ email: 'u@example.com' }]);
      const from = contract(
        'from',
        {
          Account: { collection: 'accounts', fields: ['_id', 'email'] },
          User: { collection: 'users', fields: ['_id', 'email'] },
        },
        { accounts: closedCollection(['email'], ['email']), users: closedCollection(['email']) },
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
        accountIndexes: (await accounts.indexes()).map((index) => index.name),
        update: (await accounts.updateMany({}, { $set: { email: 'b@example.com' } })).modifiedCount,
      }).toEqual({
        operations: [
          'collection.accounts.checkDocuments',
          'collection.users.checkDocuments',
          'index.accounts.drop(email_1)',
          'field.accounts.plan.fill',
          'field.users.plan.fill',
          'validator.accounts.update',
          'validator.users.update',
        ],
        failedAt: 'collection.users.checkDocuments',
        accounts: [{ email: 'a@example.com' }],
        accountIndexes: ['_id_', 'email_1'],
        update: 1,
      });
    },
    timeouts.spinUpMongoMemoryServer,
  );
});

describe('MongoMigrationRunner, an early check before an index drop', () => {
  const runDropping = async (
    accounts: { readonly from: MongoCollection; readonly to: MongoCollection } | undefined,
    users: { readonly from: MongoCollection; readonly to: MongoCollection },
  ) => {
    const from = contract(
      'from',
      {
        ...(accounts === undefined
          ? {}
          : { Account: { collection: 'accounts', fields: ['_id', 'email', 'code'] } }),
        User: { collection: 'users', fields: ['_id', 'email'] },
      },
      { ...(accounts === undefined ? {} : { accounts: accounts.from }), users: users.from },
    );
    const to = contract(
      'to',
      {
        ...(accounts === undefined
          ? {}
          : { Account: { collection: 'accounts', fields: ['_id', 'email', 'code'] } }),
        User: {
          collection: 'users',
          fields: ['_id', 'email', 'born'],
          codecs: { _id: 'mongo/objectId@1', born: 'mongo/date@1' },
        },
      },
      { ...(accounts === undefined ? {} : { accounts: accounts.to }), users: users.to },
    );
    const { planned, result } = await live.planAndRun(from, to, [], [mongoTargetDescriptor]);
    return {
      operations:
        planned.kind === 'success'
          ? planned.plan.operations.map((operation) => Reflect.get(operation, 'id'))
          : planned,
      failedAt: result.ok ? result : result.failure.meta['operationId'],
    };
  };

  it(
    'stops before dropping a unique index on another collection, which still refuses a duplicate',
    async () => {
      await live.createClosed(
        'accounts',
        ['email', 'code'],
        ['code'],
        [{ email: 'a@example.com', code: 'A' }],
      );
      await live.createClosed('users', ['email'], [], [{ email: 'u@example.com' }]);

      const run = await runDropping(
        {
          from: closedCollection(['email', 'code'], ['code']),
          to: closedCollection(['email', 'code']),
        },
        { from: closedCollection(['email']), to: withBorn(['email', 'born']) },
      );
      const accounts = live.db().collection('accounts');

      expect({
        ...run,
        accountIndexes: (await accounts.indexes()).map((index) => index.name),
      }).toEqual({
        operations: [
          'collection.users.checkDocuments',
          'index.accounts.drop(code_1)',
          'validator.users.update',
        ],
        failedAt: 'collection.users.checkDocuments',
        accountIndexes: ['_id_', 'code_1'],
      });
      await expect(accounts.insertOne({ email: 'b@example.com', code: 'A' })).rejects.toThrow(
        'duplicate key',
      );
    },
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'stops before dropping a unique index on the same collection, which still refuses a duplicate',
    async () => {
      await live.createClosed('users', ['email'], ['email'], [{ email: 'u@example.com' }]);

      const run = await runDropping(undefined, {
        from: closedCollection(['email'], ['email']),
        to: withBorn(['email', 'born']),
      });
      const users = live.db().collection('users');

      expect({
        ...run,
        userIndexes: (await users.indexes()).map((index) => index.name),
      }).toEqual({
        operations: [
          'collection.users.checkDocuments',
          'index.users.drop(email_1)',
          'validator.users.update',
        ],
        failedAt: 'collection.users.checkDocuments',
        userIndexes: ['_id_', 'email_1'],
      });
      await expect(users.insertOne({ email: 'u@example.com' })).rejects.toThrow('duplicate key');
    },
    timeouts.spinUpMongoMemoryServer,
  );
});

describe('MongoMigrationRunner, early checks for validator changes alone', () => {
  it(
    'stops at the users check before the accounts validator changes',
    async () => {
      await live.createClosed('accounts', ['email'], [], [{ email: 'a@example.com' }]);
      await live.createClosed('users', ['email'], [], [{ email: 'u@example.com' }]);
      const accountsValidator = async () =>
        (await live.db().listCollections({ name: 'accounts' }).toArray())[0]?.['options']?.[
          'validator'
        ];
      const before = await accountsValidator();
      const nonEmptyEmail = () => {
        const schema = closedSchema(['email']);
        return new MongoCollection({
          validator: {
            jsonSchema: {
              ...schema,
              properties: { ...schema.properties, email: { bsonType: 'string', minLength: 1 } },
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
          Account: { collection: 'accounts', fields: ['_id', 'email'] },
          User: {
            collection: 'users',
            fields: ['_id', 'email', 'born'],
            codecs: { _id: 'mongo/objectId@1', born: 'mongo/date@1' },
          },
        },
        { accounts: nonEmptyEmail(), users: withBorn(['email', 'born']) },
      );

      const { planned, result } = await live.planAndRun(from, to, [], [mongoTargetDescriptor]);

      expect({
        operations:
          planned.kind === 'success'
            ? planned.plan.operations.map((operation) => Reflect.get(operation, 'id'))
            : planned,
        failedAt: result.ok ? result : result.failure.meta['operationId'],
        accountsValidatorUnchanged:
          JSON.stringify(await accountsValidator()) === JSON.stringify(before),
      }).toEqual({
        operations: [
          'collection.accounts.checkDocuments',
          'collection.users.checkDocuments',
          'validator.accounts.update',
          'validator.users.update',
        ],
        failedAt: 'collection.users.checkDocuments',
        accountsValidatorUnchanged: true,
      });
    },
    timeouts.spinUpMongoMemoryServer,
  );
});
