import { resolveDocumentChecks } from '@internal/family-mongo/control';
import { checkDocuments, fillField } from '@internal/target-mongo/migration';
import { timeouts } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { usersContract, usersValidatorChange, useUsersDatabase } from './runner-users-fixtures';

const live = useUsersDatabase('runner_document_check_reference_test');

describe('MongoMigrationRunner, the check before a collection rewrites', () => {
  it(
    'checks against the validator change of the same migration as emitted, so an edit to it applies to both',
    async () => {
      await live.db().createCollection('users');
      await live.db().collection('users').insertOne({ email: 'ada@example.com' });
      const edited = { email: { bsonType: 'string' }, plan: { bsonType: 'string' } };

      const result = await live.run(
        resolveDocumentChecks([
          checkDocuments({ collection: 'users', rewrittenFields: ['plan'] }),
          fillField({ collection: 'users', field: 'plan', value: { $literal: '' } }),
          usersValidatorChange(edited),
        ]),
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
