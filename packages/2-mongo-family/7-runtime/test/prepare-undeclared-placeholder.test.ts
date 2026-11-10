import {
  AggregateCommand,
  MongoFieldFilter,
  MongoMatchStage,
} from '@internal/mongo-query-ast/execution';
import { MongoParamRef, MongoPreparedParamRef } from '@internal/mongo-value';
import { describe, expect, it } from 'vitest';
import { baseMeta } from './mongo-middleware-fixtures';
import { preparedRuntime } from './prepare-fixtures';

function matchEmail(email: MongoPreparedParamRef) {
  return {
    collection: 'users',
    command: new AggregateCommand('users', [
      new MongoMatchStage(MongoFieldFilter.eq('email', email)),
    ]),
    meta: baseMeta,
  };
}

describe('runtime.prepare with a placeholder it did not make', () => {
  it.each([
    [
      'a codec the declaration does not give',
      new MongoPreparedParamRef('email', 'test/int@1', false),
    ],
    [
      'a nullability the declaration does not give',
      new MongoPreparedParamRef('email', 'test/string@1', true),
    ],
  ])('refuses a placeholder with %s', async (_case, foreign) => {
    const { runtime } = preparedRuntime();
    await expect(
      runtime.prepare({ email: 'test/string@1' }, () => matchEmail(foreign)),
    ).rejects.toMatchObject({
      code: 'RUNTIME.PREPARE_UNDECLARED_PARAM',
      details: { name: 'email' },
    });
  });

  it('refuses a placeholder whose name is not declared', async () => {
    const { runtime } = preparedRuntime();
    await expect(
      runtime.prepare({}, () =>
        matchEmail(new MongoPreparedParamRef('email', 'test/string@1', false)),
      ),
    ).rejects.toMatchObject({
      code: 'RUNTIME.PREPARE_UNDECLARED_PARAM',
      details: { name: 'email' },
    });
  });

  it('accepts a placeholder equal to the declared one', async () => {
    const { runtime, resolvedDrafts } = preparedRuntime();
    const statement = await runtime.prepare({ email: 'test/string@1' }, () =>
      matchEmail(new MongoPreparedParamRef('email', 'test/string@1', false)),
    );
    await statement.query(runtime, { email: 'a' }).toArray();
    expect(resolvedDrafts[0]).toMatchObject({
      pipeline: [
        {
          $match: {
            email: {
              $eq: new MongoParamRef('a', {
                name: 'email',
                codecId: 'test/string@1',
                nullable: false,
              }),
            },
          },
        },
      ],
    });
  });
});
