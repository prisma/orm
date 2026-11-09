import { ParamRef } from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { InsertReportingKeys } from '../../src/mutation-graph/insert-reporting-keys';
import type { GeneratedKey } from '../../src/written-keys';
import { insertInto, recordingRun } from './statements';

const generatedId: GeneratedKey = { column: 'id', decode: async (insertId) => Number(insertId) };
const ada = insertInto('users', [{ name: 'Ada' }]);

describe('InsertReportingKeys', () => {
  it('runs its statements without RETURNING and gives the keys the client wrote', async () => {
    const asts = [insertInto('users', [{ id: 1 }, { id: 2 }]), insertInto('users', [{ id: 3 }])];
    const run = recordingRun([], 2);
    const insert = new InsertReportingKeys(asts, [{ id: 1 }, { id: 2 }, { id: 3 }], undefined, {
      operation: 'createAll',
      modelName: 'User',
    });

    expect(await insert.execute({ payload: null, state: null, requires: null }, run)).toEqual([
      { id: 1 },
      { id: 2 },
      { id: 3 },
    ]);
    expect({
      executed: run.executed,
      queried: run.queried,
      frozen: Object.isFrozen(insert),
    }).toEqual({ executed: asts, queried: [], frozen: true });
  });

  it('gives the key the database generated for a one-row insert, decoded from its insert id', async () => {
    const run = recordingRun([], 1, '7');
    const insert = new InsertReportingKeys([ada], [{ tenant: 'a' }], generatedId, {
      operation: 'create',
      modelName: 'User',
    });

    expect(await insert.execute({ payload: null, state: null, requires: null }, run)).toEqual([
      { tenant: 'a', id: 7 },
    ]);
  });

  it.each([
    ['reports no insert id', recordingRun([], 1)],
    ['changed another number of rows', recordingRun([], 2, '7')],
  ])('fails with ORM.MUTATION_ROW_MISSING when the insert %s', async (_case, run) => {
    const insert = new InsertReportingKeys([ada], [{}], generatedId, {
      operation: 'create',
      modelName: 'User',
    });

    await expect(
      insert.execute({ payload: null, state: null, requires: null }, run),
    ).rejects.toMatchObject({
      code: 'ORM.MUTATION_ROW_MISSING',
      message:
        'create() for model "User" cannot find the row it inserted: the insert\'s result carried no insert id for key column "id". A middleware may have answered the statement in place of the database without one.',
      meta: { operation: 'create', model: 'User', phase: 'insert-id', column: 'id' },
    });
  });

  it('adds the record of each payload edge to its row and to the key it gives', async () => {
    const run = recordingRun([], 1);
    const insert = new InsertReportingKeys(
      [insertInto('posts', [{ title: 'Hello' }])],
      [{ id: 5, user_id: true }],
      undefined,
      { operation: 'create', modelName: 'Post' },
    );

    expect(
      await insert.execute(
        {
          payload: [[{ user_id: ParamRef.of(7, { name: 'user_id' }) }]],
          state: null,
          requires: null,
        },
        run,
      ),
    ).toEqual([{ id: 5, user_id: 7 }]);
    expect(run.executed[0]).toMatchObject({
      rows: [{ title: { value: 'Hello' }, user_id: { value: 7 } }],
    });
  });

  it('returns no rows and runs nothing when a payload edge has no source row', async () => {
    const run = recordingRun([], 1);
    const insert = new InsertReportingKeys([ada], [{}], generatedId, {
      operation: 'create',
      modelName: 'User',
    });

    expect(await insert.execute({ payload: [[]], state: null, requires: null }, run)).toEqual([]);
    expect(run).toMatchObject({ queried: [], executed: [] });
  });
});
