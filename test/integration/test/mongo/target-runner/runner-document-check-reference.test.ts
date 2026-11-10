import { checkDocuments, fillField } from '@internal/target-mongo/migration';
import { timeouts } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import {
  usersContract,
  usersSchema,
  usersValidatorChange,
  useUsersDatabase,
} from './runner-users-fixtures';

const live = useUsersDatabase('runner_document_check_reference_test');

describe('MongoMigrationRunner, the check before a collection rewrites', () => {
  it(
    'checks against the validator it is given, the one the validator change of the migration sets',
    async () => {
      await live.db().createCollection('users');
      await live.db().collection('users').insertOne({ email: 'ada@example.com' });
      const edited = { email: { bsonType: 'string' }, plan: { bsonType: 'string' } };

      const result = await live.run(
        [
          checkDocuments({
            collection: 'users',
            validator: usersSchema(edited),
            rewrittenFields: ['plan'],
          }),
          fillField({ collection: 'users', field: 'plan', value: { $literal: '' } }),
          usersValidatorChange(edited),
        ],
        usersContract(edited),
      );

      expect({
        applied: result.ok ? result.value.operationsExecuted : result.failure.message,
        users: await live
          .db()
          .collection('users')
          .find({}, { projection: { _id: 0 } })
          .toArray(),
      }).toEqual({ applied: 3, users: [{ email: 'ada@example.com', plan: '' }] });
    },
    timeouts.spinUpMongoMemoryServer,
  );
});
