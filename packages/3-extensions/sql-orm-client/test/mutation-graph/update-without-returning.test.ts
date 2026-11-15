import { ColumnRef, ParamRef } from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { FilterData } from '../../src/mutation-graph/filter-data';
import { Update } from '../../src/mutation-graph/update';
import { getTestContext } from '../helpers';
import {
  addWithState,
  aliasedTable,
  columnMappings,
  contextWithoutReturning,
  findUsers,
  newGraph,
  newGraphWithoutReturning,
  positions,
  recordingRun,
  updateOwner,
  updatePosts,
  updateUsers,
} from './statements';

const sameId = columnMappings('users', 'users', [['id', 'id']]);
const [from] = positions();
const idMatch = (id: number) => new FilterData(from, sameId).output({ id });

function runWithoutReturning(affectedRows: number) {
  return recordingRun([], affectedRows, undefined, contextWithoutReturning);
}

function setByExpression(column: string): Update {
  const update = updateUsers({ name: 'Ada' }, undefined, ['id']);
  return new Update(
    update.ast.withSet({
      ...update.ast.set,
      [column]: ColumnRef.of(aliasedTable('users').alias, 'invited_by_id'),
    }),
    updateOwner,
  );
}

describe('Update on a contract without returning', () => {
  it('runs without RETURNING and gives the keys of the rows its FilterData edges gave it', async () => {
    const update = updateUsers({ name: 'Ada' }, undefined, ['id']);
    const run = runWithoutReturning(2);

    expect(
      await update.execute(
        {
          filter: [[idMatch(7), idMatch(8)]],
          payload: null,
          link: null,
          state: null,
          requires: null,
        },
        run,
      ),
    ).toEqual([{ id: 7 }, { id: 8 }]);
    expect(run.executed.map((ast) => (ast.kind === 'update' ? ast.returning : 'other'))).toEqual([
      undefined,
    ]);
  });

  it('gives the new value of a key column it sets, and the values it sets', async () => {
    const update = updateUsers({ id: 5, name: 'Ada' }, undefined, ['id', 'name']);

    expect(
      await update.execute(
        { filter: [[idMatch(7)]], payload: null, link: null, state: null, requires: null },
        runWithoutReturning(1),
      ),
    ).toEqual([{ id: 5, name: 'Ada' }]);
  });

  it('gives the values its PayloadData edges set', async () => {
    const update = updatePosts({ title: 'New' }, undefined, ['id', 'user_id']);
    const postId = columnMappings('posts', 'posts', [['id', 'id']]);

    expect(
      await update.execute(
        {
          filter: [[new FilterData(from, postId).output({ id: 10 })]],
          payload: [[{ user_id: ParamRef.of(7, { name: 'user_id' }) }]],
          link: null,
          state: null,
          requires: null,
        },
        runWithoutReturning(1),
      ),
    ).toEqual([{ id: 10, user_id: 7 }]);
  });

  it('gives the affected row count when nothing reads from it', async () => {
    const update = updateUsers({ name: 'Ada' });

    expect(
      await update.execute(
        {
          filter: [[idMatch(7), idMatch(8)]],
          payload: null,
          link: null,
          state: null,
          requires: null,
        },
        runWithoutReturning(2),
      ),
    ).toEqual({ affectedRows: 2 });
  });
});

describe('the check of an Update', () => {
  it('refuses an Update read from that sets a column read from it by an expression', () => {
    const graph = newGraphWithoutReturning();
    const update = setByExpression('id');
    const id = addWithState(graph, update);
    addWithState(graph, findUsers(), { filter: [new FilterData(id, sameId)] });

    expect(() => update.checkIfCanRun(graph, id, contextWithoutReturning)).toThrow(
      expect.objectContaining({
        code: 'ORM.CAPABILITY_MISSING',
        message:
          'updateAll() on model "User" cannot read back the rows it updates: it sets key column "id" by an expression, and without capability "returning" the database does not report the value it wrote.',
        meta: { capability: 'returning', action: 'updateAll()' },
      }),
    );
  });

  it('accepts an Update that sets by an expression a column nothing reads from it', () => {
    const graph = newGraphWithoutReturning();
    const update = setByExpression('email');
    const id = addWithState(graph, update);
    addWithState(graph, findUsers(), { filter: [new FilterData(id, sameId)] });

    expect(() => update.checkIfCanRun(graph, id, contextWithoutReturning)).not.toThrow();
  });

  it('accepts an Update that sets a key by an expression when nothing reads from it', () => {
    const graph = newGraphWithoutReturning();
    const update = setByExpression('id');
    const id = addWithState(graph, update);

    expect(() => update.checkIfCanRun(graph, id, contextWithoutReturning)).not.toThrow();
  });

  it('accepts any Update on a contract with returning', () => {
    const graph = newGraph();
    const update = setByExpression('id');
    const id = addWithState(graph, update);
    addWithState(graph, findUsers(), { filter: [new FilterData(id, sameId)] });

    expect(() => update.checkIfCanRun(graph, id, getTestContext())).not.toThrow();
  });
});
