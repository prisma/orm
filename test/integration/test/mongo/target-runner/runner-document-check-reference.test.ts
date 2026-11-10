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

  it(
    'says the rewritten documents may not fit the current validator when the apply stops before the validator change',
    async () => {
      const before = { email: { bsonType: 'string' } };
      await live.db().createCollection('users', {
        validator: { $jsonSchema: usersSchema(before) },
        validationLevel: 'strict',
        validationAction: 'error',
      });
      await live.db().collection('users').insertOne({ email: 'ada@example.com' });
      const after = { email: { bsonType: 'string' }, plan: { bsonType: 'string' } };

      const result = await live.run(
        [
          checkDocuments({
            collection: 'users',
            validator: usersSchema(after),
            rewrittenFields: ['plan'],
          }),
          fillField({ collection: 'users', field: 'plan', value: { $literal: '' } }),
        ],
        usersContract(after),
      );

      if (result.ok) throw new Error('Expected the apply to fail after the fill');
      expect(result.failure.why).toContain(
        "Documents this apply already rewrote in collection users may no longer fit the collection's current validator, so updates to them fail until the migration finishes.",
      );
    },
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'does not say nothing was rewritten when a rewrite of the apply ran before the failing check',
    async () => {
      await live.db().createCollection('users');
      await live.db().collection('users').insertOne({ email: 'ada@example.com' });
      const after = {
        email: { bsonType: 'string' },
        plan: { bsonType: 'string' },
        born: { bsonType: 'date' },
      };

      const result = await live.run(
        [
          fillField({ collection: 'users', field: 'plan', value: { $literal: '' } }),
          checkDocuments({
            collection: 'users',
            validator: usersSchema(after),
            rewrittenFields: ['plan'],
          }),
        ],
        usersContract(after),
      );

      if (result.ok) throw new Error('Expected the check to stop the apply');
      expect({
        nothingRewritten: result.failure.why?.includes('nothing was rewritten'),
        warning: result.failure.why?.includes(
          'Documents this apply already rewrote in collection users',
        ),
      }).toEqual({ nothingRewritten: false, warning: true });
    },
    timeouts.spinUpMongoMemoryServer,
  );
});
