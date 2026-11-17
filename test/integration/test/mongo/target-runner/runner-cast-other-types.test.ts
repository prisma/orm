import { castField } from '@internal/target-mongo/migration';
import { timeouts } from '@repo/test-utils';
import { Long, ObjectId } from 'mongodb';
import { describe, expect, it } from 'vitest';
import { usersContract, usersValidatorChange, useUsersDatabase } from './runner-users-fixtures';

const live = useUsersDatabase('runner_cast_other_types_test');
const AGE_LONG = { age: { bsonType: 'long' } };

describe('MongoMigrationRunner, a cast that meets a value of a type it was not planned from', () => {
  it(
    'leaves that value as it is, and the validator change stops naming it',
    async () => {
      const drifted = new ObjectId('64b7f0c2a1b2c3d4e5f60718');
      await live.db().createCollection('users');
      await live
        .db()
        .collection('users')
        .insertMany([
          { _id: new ObjectId('64b7f0c2a1b2c3d4e5f60717'), age: 42 },
          { _id: drifted, age: true },
        ]);

      const result = await live.run(
        [
          castField({ collection: 'users', field: 'age', from: ['int'], to: 'long' }),
          usersValidatorChange(AGE_LONG),
        ],
        usersContract(AGE_LONG),
      );

      expect({
        code: result.ok ? undefined : result.failure.code,
        reason: result.ok
          ? undefined
          : result.failure.why?.includes(
              'That document holds a value of type bool in "age", which the new validator does not allow there.',
            ),
        documents: await live
          .db()
          .collection('users')
          .find({}, { sort: { _id: 1 }, promoteLongs: false })
          .toArray(),
      }).toEqual({
        code: 'MIGRATION.PRECHECK_FAILED',
        reason: true,
        documents: [
          { _id: new ObjectId('64b7f0c2a1b2c3d4e5f60717'), age: Long.fromNumber(42) },
          { _id: drifted, age: true },
        ],
      });
    },
    timeouts.spinUpMongoMemoryServer,
  );
});
