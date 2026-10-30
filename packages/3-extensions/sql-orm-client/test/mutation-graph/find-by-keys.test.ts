import type { SelectAst } from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { FindByKeys } from '../../src/mutation-graph/find-by-keys';
import { printExpression } from './print-expression';
import { columnPairs, columnsOf, findUsers, nameIsAda, recordingRun } from './statements';

const ids = columnPairs('users', 'users', [['id', 'id']]);
const idsAndEmails = columnPairs('users', 'users', [
  ['id', 'id'],
  ['email', 'email'],
]);
const create = { operation: 'create', modelName: 'User' };

function whereOf(ast: unknown): string {
  const where = (ast as SelectAst).where;
  return where === undefined ? '' : printExpression(where, 'users');
}

function orderOf(ast: unknown): string[] {
  return ((ast as SelectAst).orderBy ?? []).map((item) => {
    const expr = item.expr;
    if (expr.kind !== 'case') return printExpression(expr, 'users');
    const branches = expr.branches.map(
      ({ condition, value }) =>
        `when ${printExpression(condition, 'users')} then ${printExpression(value, 'users')}`,
    );
    return `case ${branches.join(' ')} end ${item.dir}`;
  });
}

describe('FindByKeys', () => {
  it('reads the row of one key with its condition alone, and takes the row the database matched', async () => {
    const run = recordingRun([{ id: 1, email: 'Bob@x.com' }]);
    const find = new FindByKeys(findUsers([nameIsAda]).ast, idsAndEmails, create);

    expect(await find.execute({ keys: [{ id: 1, email: 'bob@x.com' }] }, run)).toEqual([
      { id: 1, email: 'Bob@x.com' },
    ]);
    expect({ where: run.queried.map(whereOf), order: run.queried.map(orderOf) }).toEqual({
      where: ["(name = 'Ada' and (id = 1 and email = 'bob@x.com'))"],
      order: [[]],
    });
  });

  it('reads the rows of several keys with an IN list, ordered by the database in the order of the keys', async () => {
    const run = recordingRun([{ id: 11 }, { id: 10 }]);
    const find = new FindByKeys(findUsers().ast, ids, create);

    expect(await find.execute({ keys: [{ id: 11 }, { id: 10 }] }, run)).toEqual([
      { id: 11 },
      { id: 10 },
    ]);
    expect({ where: run.queried.map(whereOf), order: run.queried.map(orderOf) }).toEqual({
      where: ['id in (11, 10)'],
      order: [['case when id = 11 then 0 when id = 10 then 1 end asc']],
    });
  });

  it('reads more keys than one statement takes in chunks of 500, each ordered by its own keys, joined in key order', async () => {
    const keys = Array.from({ length: 1200 }, (_, index) => ({ id: 1200 - index }));
    const queried: SelectAst[] = [];
    const run = {
      ...recordingRun(),
      query(ast: SelectAst) {
        queried.push(ast);
        const offset = (queried.length - 1) * 500;
        return recordingRun(keys.slice(offset, offset + 500)).query(ast);
      },
    };
    const find = new FindByKeys(findUsers().ast, ids, create);

    expect(await find.execute({ keys }, run)).toEqual(keys);
    expect(
      queried.map((ast) => {
        const [order] = ast.orderBy ?? [];
        return order?.expr.kind === 'case' ? order.expr.branches.length : 0;
      }),
    ).toEqual([500, 500, 200]);
  });

  it('runs nothing when there is no key', async () => {
    const run = recordingRun([{ id: 1 }]);

    expect(await new FindByKeys(findUsers().ast, ids, create).execute({ keys: [] }, run)).toEqual(
      [],
    );
    expect(run.queried).toEqual([]);
  });

  it('fails with ORM.MUTATION_ROW_MISSING when it finds fewer rows than keys', async () => {
    const find = new FindByKeys(findUsers().ast, ids, { operation: 'upsert', modelName: 'User' });

    await expect(find.execute({ keys: [{ id: 1 }] }, recordingRun())).rejects.toMatchObject({
      code: 'ORM.MUTATION_ROW_MISSING',
      message: 'upsert() for model "User" did not find the row it wrote',
      meta: { operation: 'upsert', model: 'User', phase: 'read-back' },
    });
    await expect(
      find.execute({ keys: [{ id: 1 }, { id: 2 }] }, recordingRun([{ id: 1 }])),
    ).rejects.toMatchObject({ code: 'ORM.MUTATION_ROW_MISSING' });
  });

  it('gives a node that also returns the columns it is asked for', () => {
    const find = new FindByKeys(findUsers().ast, ids, create).withReturning(
      columnsOf('users', ['email']),
    );

    expect({
      returns: find.returns.map((column) => column.alias),
      frozen: Object.isFrozen(find),
    }).toEqual({ returns: ['id', 'email'], frozen: true });
  });
});
