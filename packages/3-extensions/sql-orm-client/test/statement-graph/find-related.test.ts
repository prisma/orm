import type { SelectAst } from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { FindRelated, RELATED_KEY_LIMITS } from '../../src/statement-graph/find-related';
import { printExpression } from './print-expression';
import { columnMappings, columnsOf, findUsers, nameIsAda, recordingRun } from './statements';

const ids = columnMappings('posts', 'users', [['user_id', 'id']]);
const idsAndEmails = columnMappings('posts', 'users', [
  ['user_id', 'id'],
  ['title', 'email'],
]);

function whereOf(ast: SelectAst): string {
  return ast.where === undefined ? '' : printExpression(ast.where, 'users');
}

function keysPerStatement(queried: readonly SelectAst[]): number[] {
  return queried.map((ast) => {
    const where = ast.where;
    if (where?.kind !== 'binary') return 0;
    return where.right.kind === 'list' ? where.right.values.length : 1;
  });
}

function selects(queried: readonly unknown[]): SelectAst[] {
  return queried.filter((ast): ast is SelectAst => (ast as SelectAst).kind === 'select');
}

describe('FindRelated', () => {
  it('reads the rows of all parent keys in one statement, beside its own filter', async () => {
    const run = recordingRun([{ id: 7 }]);
    const find = new FindRelated(findUsers([nameIsAda]).ast, ids, RELATED_KEY_LIMITS);

    expect(
      await find.execute(
        { keys: [{ user_id: 1 }, { user_id: 2 }], state: null, requires: null },
        run,
      ),
    ).toEqual([{ id: 7 }]);
    expect(selects(run.queried).map(whereOf)).toEqual(["(name = 'Ada' and id in (1, 2))"]);
  });

  it('sends each parent key once', async () => {
    const run = recordingRun();
    const find = new FindRelated(findUsers().ast, ids, RELATED_KEY_LIMITS);

    await find.execute(
      { keys: [{ user_id: 1 }, { user_id: 2 }, { user_id: 1 }], state: null, requires: null },
      run,
    );

    expect(selects(run.queried).map(whereOf)).toEqual(['id in (1, 2)']);
  });

  it('matches a composite key with an OR of ANDs', async () => {
    const run = recordingRun();
    const find = new FindRelated(findUsers().ast, idsAndEmails, RELATED_KEY_LIMITS);

    await find.execute(
      {
        keys: [
          { user_id: 1, title: 'a' },
          { user_id: 2, title: 'b' },
        ],
        state: null,
        requires: null,
      },
      run,
    );

    expect(selects(run.queried).map(whereOf)).toEqual([
      "((id = 1 and email = 'a') or (id = 2 and email = 'b'))",
    ]);
  });

  it('splits more keys than one statement binds into statements of 10 000 parameters', async () => {
    const keys = Array.from({ length: 10_001 }, (_, index) => ({ user_id: index }));
    const run = recordingRun();

    await new FindRelated(findUsers().ast, ids, RELATED_KEY_LIMITS).execute(
      { keys, state: null, requires: null },
      run,
    );

    expect(keysPerStatement(selects(run.queried))).toEqual([10_000, 1]);
  });

  it('splits keys whose values exceed an estimated 1 MiB', async () => {
    const keys = ['a', 'b', 'c'].map((letter) => ({ user_id: letter.repeat(300_000) }));
    const run = recordingRun();

    await new FindRelated(findUsers().ast, ids, RELATED_KEY_LIMITS).execute(
      { keys, state: null, requires: null },
      run,
    );

    expect(keysPerStatement(selects(run.queried))).toEqual([1, 1, 1]);
  });

  it('runs nothing when there is no parent key', async () => {
    const run = recordingRun([{ id: 1 }]);

    expect(
      await new FindRelated(findUsers().ast, ids, RELATED_KEY_LIMITS).execute(
        { keys: [], state: null, requires: null },
        run,
      ),
    ).toEqual([]);
    expect(run.queried).toEqual([]);
  });

  it('reports its statement without parent keys', () => {
    const find = new FindRelated(findUsers([nameIsAda]).ast, ids, RELATED_KEY_LIMITS);

    expect(find.statements.map((ast) => whereOf(ast as SelectAst))).toEqual(["name = 'Ada'"]);
  });

  it('gives a node that also returns the columns it is asked for', () => {
    const find = new FindRelated(findUsers().ast, ids, RELATED_KEY_LIMITS).withReturning(
      columnsOf('users', ['email']),
    );

    expect({
      returns: find.returns.map((column) => column.alias),
      frozen: Object.isFrozen(find),
    }).toEqual({ returns: ['id', 'email'], frozen: true });
  });

  it('sends a key shared by many parents once, whatever chunk it falls in', async () => {
    const keys = [1, 1, 2, 1, 2, 3].map((user_id) => ({ user_id }));
    const run = recordingRun();

    await new FindRelated(findUsers().ast, ids, { ...RELATED_KEY_LIMITS, parameters: 2 }).execute(
      { keys, state: null, requires: null },
      run,
    );

    expect(selects(run.queried).map(whereOf)).toEqual(['id in (1, 2)', 'id = 3']);
  });

  it('keeps every part of a composite key in the chunk of its key', async () => {
    const keys = [1, 2, 3].map((user_id) => ({ user_id, title: `t${user_id}` }));
    const run = recordingRun();

    await new FindRelated(findUsers().ast, idsAndEmails, {
      ...RELATED_KEY_LIMITS,
      parameters: 5,
    }).execute({ keys, state: null, requires: null }, run);

    expect(selects(run.queried).map(whereOf)).toEqual([
      "((id = 1 and email = 't1') or (id = 2 and email = 't2'))",
      "(id = 3 and email = 't3')",
    ]);
  });
});
