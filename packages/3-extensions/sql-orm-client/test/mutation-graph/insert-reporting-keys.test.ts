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
    const insert = new InsertReportingKeys(
      asts,
      [{ id: 1 }, { id: 2 }, { id: 3 }],
      undefined,
      'User',
    );

    expect(await insert.execute({}, run)).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    expect({
      executed: run.executed,
      queried: run.queried,
      frozen: Object.isFrozen(insert),
    }).toEqual({ executed: asts, queried: [], frozen: true });
  });

  it('gives the key the database generated for a one-row insert, decoded from its insert id', async () => {
    const run = recordingRun([], 1, '7');
    const insert = new InsertReportingKeys([ada], [{ tenant: 'a' }], generatedId, 'User');

    expect(await insert.execute({}, run)).toEqual([{ tenant: 'a', id: 7 }]);
  });

  it.each([
    ['reports no insert id', recordingRun([], 1)],
    ['changed another number of rows', recordingRun([], 2, '7')],
  ])('fails with ORM.INSERT_ID_MISSING when the insert %s', async (_case, run) => {
    const insert = new InsertReportingKeys([ada], [{}], generatedId, 'User');

    await expect(insert.execute({}, run)).rejects.toMatchObject({
      code: 'ORM.INSERT_ID_MISSING',
      message:
        'The insert for model "User" reported no generated value for key column "id", so the ORM cannot read the row back. A middleware that answers the statement in place of the database must report the row\'s insertId.',
      meta: { model: 'User', column: 'id' },
    });
  });
});
