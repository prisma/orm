import { MongoCollection } from '@internal/mongo-contract';
import { mongoTargetDescriptor } from '@internal/target-mongo/control';
import { timeouts } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { closedSchema, contract, useStatementsDatabase } from './runner-statements-fixtures';

const live = useStatementsDatabase('runner_unique_index_build_test');

describe('MongoMigrationRunner, a new unique field on a collection with documents', () => {
  const users = (
    storageHash: string,
    fields: readonly string[],
    required: readonly string[],
    sharedWith: Record<string, { collection: string; fields: string[] }> = {},
  ) => {
    const schema = closedSchema(fields);
    return contract(
      storageHash,
      { User: { collection: 'users', fields: ['_id', ...fields] }, ...sharedWith },
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
        why: 'The documents that collide lack "code" or hold null in it, and a document without the field counts as holding null. Give each document its own value of the indexed fields, or remove the duplicates, then run the command again; operations that already ran are skipped. Under migration plan, --backfill User.code writes a slot to give each document its own value. The failed apply changed nothing.',
      });
    },
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'names no --backfill when the planner would refuse it, as for a field of a model that shares the collection',
    async () => {
      await twoUsers();
      const admin = { Admin: { collection: 'users', fields: ['_id', 'level'] } };

      const { result } = await live.planAndRun(
        users('from', ['email'], ['email'], admin),
        users('to', ['email', 'code'], ['email'], admin),
        [],
        [mongoTargetDescriptor],
      );

      if (result.ok) throw new Error('Expected the index build to fail');
      expect(result.failure.why).toBe(
        'The documents that collide lack "code" or hold null in it, and a document without the field counts as holding null. Give each document its own value of the indexed fields, or remove the duplicates, then run the command again; operations that already ran are skipped. The failed apply changed nothing.',
      );
    },
    timeouts.spinUpMongoMemoryServer,
  );
});
