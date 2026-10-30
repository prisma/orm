import type { SelectAst } from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { FindByKeys } from '../../src/mutation-graph/find-by-keys';
import { printExpression } from './print-expression';
import { columnsOf, findUsers, nameIsAda, recordingRun } from './statements';

const ids = columnsOf('users', ['id']);
const idAndEmail = columnsOf('users', ['id', 'email']);

function whereOf(ast: unknown): string {
  const where = (ast as SelectAst).where;
  return where === undefined ? '' : printExpression(where, 'users');
}

describe('FindByKeys', () => {
  it('reads the rows of a single key column with an IN list, using the values the write changed', async () => {
    const run = recordingRun([{ id: 9 }]);
    const find = new FindByKeys(findUsers([nameIsAda]).ast, ids, { email: 'x' }, undefined);

    expect(await find.execute({ keys: [{ id: 1 }, { id: 2 }] }, run)).toEqual([{ id: 9 }]);
    expect(run.queried.map(whereOf)).toEqual(["(name = 'Ada' and id in (1, 2))"]);
  });

  it('reads the rows of a composite key with one condition per key', async () => {
    const run = recordingRun();
    const find = new FindByKeys(findUsers().ast, idAndEmail, { email: 'new' }, undefined);

    await find.execute(
      {
        keys: [
          { id: 1, email: 'old' },
          { id: 2, email: 'old' },
        ],
      },
      run,
    );

    expect(run.queried.map(whereOf)).toEqual([
      "((id = 1 and email = 'new') or (id = 2 and email = 'new'))",
    ]);
  });

  it('runs nothing when there is no key', async () => {
    const run = recordingRun([{ id: 1 }]);

    expect(
      await new FindByKeys(findUsers().ast, ids, {}, undefined).execute({ keys: [] }, run),
    ).toEqual([]);
    expect(run.queried).toEqual([]);
  });

  it('fails with ORM.MUTATION_ROW_MISSING when it must find every row and does not', async () => {
    const missing = { operation: 'upsert()', modelName: 'User' };
    const find = new FindByKeys(findUsers().ast, ids, {}, missing);

    await expect(find.execute({ keys: [{ id: 1 }] }, recordingRun())).rejects.toMatchObject({
      code: 'ORM.MUTATION_ROW_MISSING',
      message: 'upsert() for model "User" did not find the row it wrote',
      meta: { operation: 'upsert()', model: 'User', phase: 'read-back' },
    });
    expect(await find.execute({ keys: [{ id: 1 }] }, recordingRun([{ id: 1 }]))).toEqual([
      { id: 1 },
    ]);
  });

  it('gives a node that also returns the columns it is asked for', () => {
    const find = new FindByKeys(findUsers().ast, ids, {}, undefined).withReturning(
      columnsOf('users', ['email']),
    );

    expect({
      returns: find.returns.map((column) => column.alias),
      frozen: Object.isFrozen(find),
    }).toEqual({ returns: ['id', 'email'], frozen: true });
  });
});
