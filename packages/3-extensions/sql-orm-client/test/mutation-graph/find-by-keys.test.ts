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

describe('FindByKeys', () => {
  it('reads the rows of a single key column with an IN list', async () => {
    const run = recordingRun([
      { __written_key_id: 1, id: 1 },
      { __written_key_id: 2, id: 2 },
    ]);
    const find = new FindByKeys(findUsers([nameIsAda]).ast, ids, create);

    expect(await find.execute({ keys: [{ id: 1 }, { id: 2 }] }, run)).toEqual([
      { id: 1 },
      { id: 2 },
    ]);
    expect(run.queried.map(whereOf)).toEqual(["(name = 'Ada' and id in (1, 2))"]);
  });

  it('gives the rows in the order of the keys, not the order the database returns them', async () => {
    const run = recordingRun([
      { __written_key_id: 10, name: 'b' },
      { __written_key_id: 11, name: 'a' },
    ]);
    const find = new FindByKeys(findUsers().ast, ids, create);

    expect(await find.execute({ keys: [{ id: 11 }, { id: 10 }] }, run)).toEqual([
      { name: 'a' },
      { name: 'b' },
    ]);
  });

  it('reads the rows of a composite key with one condition per key', async () => {
    const run = recordingRun([{ __written_key_id: 1, __written_key_email: 'a' }]);
    const find = new FindByKeys(findUsers().ast, idsAndEmails, create);

    await find.execute({ keys: [{ id: 1, email: 'a' }] }, run);
    const two = [
      { id: 1, email: 'a' },
      { id: 2, email: 'b' },
    ];
    await expect(find.execute({ keys: two }, run)).rejects.toMatchObject({
      code: 'ORM.MUTATION_ROW_MISSING',
    });

    expect(run.queried.map(whereOf)).toEqual([
      "(id = 1 and email = 'a')",
      "((id = 1 and email = 'a') or (id = 2 and email = 'b'))",
    ]);
  });

  it('runs nothing when there is no key', async () => {
    const run = recordingRun([{ id: 1 }]);

    expect(await new FindByKeys(findUsers().ast, ids, create).execute({ keys: [] }, run)).toEqual(
      [],
    );
    expect(run.queried).toEqual([]);
  });

  it('fails with ORM.MUTATION_ROW_MISSING when a key finds no row', async () => {
    const find = new FindByKeys(findUsers().ast, ids, { operation: 'upsert', modelName: 'User' });

    await expect(find.execute({ keys: [{ id: 1 }] }, recordingRun())).rejects.toMatchObject({
      code: 'ORM.MUTATION_ROW_MISSING',
      message: 'upsert() for model "User" did not find the row it wrote',
      meta: { operation: 'upsert', model: 'User', phase: 'read-back' },
    });
  });

  it('selects each key column under its own alias and gives a node that also returns the columns it is asked for', () => {
    const find = new FindByKeys(findUsers().ast, ids, create).withReturning(
      columnsOf('users', ['email']),
    );

    expect({
      returns: find.returns.map((column) => column.alias),
      frozen: Object.isFrozen(find),
    }).toEqual({ returns: ['id', '__written_key_id', 'email'], frozen: true });
  });
});
