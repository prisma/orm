import { BinaryExpr, ColumnRef, ParamRef } from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import type { Node } from '../../src/mutation-graph/nodes';
import { printExpression } from '../../src/mutation-graph/print-expression';
import {
  columnPairs,
  deleteUsers,
  findUsers,
  graphOfUsers,
  nameIsAda,
  recordingRun,
  updateUsers,
} from './statements';

const idIs = (value: number) => BinaryExpr.eq(ColumnRef.of('users', 'id'), ParamRef.of(value));
const emailColumn = columnPairs('users', 'users', [['email', 'email']]).map(([source]) => source);

function whereOf(ast: { readonly where?: Parameters<typeof printExpression>[0] | undefined }) {
  return ast.where === undefined ? undefined : printExpression(ast.where, 'users');
}

describe.each([
  ['Find', () => findUsers([nameIsAda]), 'select'],
  ['Update', () => updateUsers({ email: 'a@b.c' }, nameIsAda, ['id']), 'update'],
  ['Delete', () => deleteUsers(nameIsAda, ['id']), 'delete'],
] as const)('%s', (_name, make, kind) => {
  it('holds its statement as SQL AST and is frozen', () => {
    const node = make();

    expect(node.ast.kind).toBe(kind);
    expect(Object.isFrozen(node)).toBe(true);
  });

  it('is its own peephole result', () => {
    const node: Node = make();

    expect(node.peephole(graphOfUsers(), 0)).toBe(node);
  });

  it('runs its statement as it is when the filter slot has no edge', async () => {
    const node = make();
    const run = recordingRun([{ id: 1 }]);

    const rows = await node.execute({ filter: null }, run);

    expect(rows).toEqual([{ id: 1 }]);
    expect(run.queried).toEqual([node.ast]);
  });

  it('adds the conditions of one edge to its where, or between the rows of the edge', async () => {
    const run = recordingRun();

    await make().execute({ filter: [[idIs(7), idIs(8)]] }, run);

    expect(run.queried.map(whereOf)).toEqual(["(name = 'Ada' and (id = 7 or id = 8))"]);
  });

  it('puts and between the edges', async () => {
    const run = recordingRun();

    await make().execute({ filter: [[idIs(7)], [idIs(8), idIs(9)]] }, run);

    expect(run.queried.map(whereOf)).toEqual(["(name = 'Ada' and id = 7 and (id = 8 or id = 9))"]);
  });

  it('returns no rows and runs nothing when an edge has no source row', async () => {
    const run = recordingRun([{ id: 1 }]);

    const rows = await make().execute({ filter: [[idIs(7)], []] }, run);

    expect(rows).toEqual([]);
    expect(run.queried).toEqual([]);
    expect(run.executed).toEqual([]);
  });

  it('gives a node that also returns the columns it is asked for, once each', () => {
    const node = make();

    const widened = node.alsoReturning([...emailColumn, ...node.returns]);

    expect(widened).toBeInstanceOf(node.constructor);
    expect(widened.returns.map((column) => column.alias)).toEqual(['id', 'email']);
    expect(node.returns.map((column) => column.alias)).toEqual(['id']);
  });
});

describe.each([
  ['Update', () => updateUsers({ email: 'a@b.c' }, nameIsAda)],
  ['Delete', () => deleteUsers(nameIsAda)],
] as const)('%s that returns no column', (_name, make) => {
  it('gives the affected row count', async () => {
    const node = make();
    const run = recordingRun([], 3);

    expect(await node.execute({ filter: null }, run)).toBe(3);
    expect(run.executed).toEqual([node.ast]);
    expect(run.queried).toEqual([]);
  });

  it('returns columns once it is asked to', async () => {
    const run = recordingRun([{ email: 'a@b.c' }]);

    const rows = await make().alsoReturning(emailColumn).execute({ filter: null }, run);

    expect(rows).toEqual([{ email: 'a@b.c' }]);
    expect(run.executed).toEqual([]);
  });
});

describe('Update', () => {
  it('has no peephole result when it sets nothing', () => {
    expect(updateUsers({}, nameIsAda).peephole(graphOfUsers(), 0)).toBeUndefined();
  });
});
