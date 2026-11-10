import { checkDocuments, fillField } from '@internal/target-mongo/migration';
import { timeouts } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { usersContract, usersValidatorChange, useUsersDatabase } from './runner-users-fixtures';

const live = useUsersDatabase('runner_document_check_reference_test');

describe('MongoMigrationRunner, the check before a collection rewrites', () => {
  it(
    'reads the validator from the validator change of the same migration, so an edit to it applies to both',
    async () => {
      await live.db().createCollection('users');
      await live.db().collection('users').insertOne({ email: 'ada@example.com' });
      const edited = { email: { bsonType: 'string' }, plan: { bsonType: 'string' } };

      const result = await live.run(
        [
          checkDocuments({ collection: 'users', rewrittenFields: ['plan'] }),
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

  it(
    'refuses a check whose collection has no validator change in the migration',
    async () => {
      await live.db().createCollection('users');
      const properties = { email: { bsonType: 'string' } };

      await expect(
        live.run(
          [checkDocuments({ collection: 'users', rewrittenFields: ['plan'] })],
          usersContract(properties),
        ),
      ).rejects.toThrow(
        'checkDocuments on collection users has no validator change of that collection after it to read the validator from.',
      );
    },
    timeouts.spinUpMongoMemoryServer,
  );
});
