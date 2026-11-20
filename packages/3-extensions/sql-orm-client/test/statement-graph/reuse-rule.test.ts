import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import {
  BinaryExpr,
  ColumnRef,
  DeleteAst,
  JoinAst,
  LiteralExpr,
  LockingClause,
  OrderByItem,
  ProjectionItem,
  SelectAst,
  TableSource,
} from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { Delete } from '../../src/statement-graph/delete';
import { FilterData } from '../../src/statement-graph/filter-data';
import { Find } from '../../src/statement-graph/find';
import { Graph } from '../../src/statement-graph/graph';
import { Insert } from '../../src/statement-graph/insert';
import { Requires } from '../../src/statement-graph/requires';
import { createCollectionFor } from '../collection-fixtures';
import { cascadeContract } from './cascade-contract';
import { printGraph } from './print-graph';
import {
  addWithState,
  columnMappings,
  columnsOf,
  findUsers,
  findUsersWith,
  insertInto,
  nameIsAda,
  newGraph,
  newGraphWithoutReturning,
  returnedAt,
  updateUsers,
} from './statements';

const sameId = columnMappings('users', 'users', [['id', 'id']]);
const sameName = columnMappings('users', 'users', [['name', 'name']]);
const postIdToUserId = columnMappings('posts', 'users', [['id', 'id']]);
const postOwner = { operation: 'create', modelName: 'Post' };
const byName = OrderByItem.asc(ColumnRef.of('users', 'name'));

const memberId = ProjectionItem.of('id', ColumnRef.of('Member', 'id'));
const memberTeamId = ProjectionItem.of('teamId', ColumnRef.of('Member', 'teamId'));

function findMembers(columns: readonly ProjectionItem[]): Find {
  return new Find(
    SelectAst.from(TableSource.named('Member', undefined, 'public')).withProjection(columns),
  );
}

function deleteFrom(name: string): Delete {
  return new Delete(DeleteAst.from(TableSource.named(name, undefined, 'public')));
}

function usersWithPosts() {
  const { includes, tables } = createCollectionFor('User').collection.include('posts').state;
  return { includes, tables, selectedFields: ['id', 'name'] };
}

function firstUser(): Find {
  return new Find(findUsers([nameIsAda]).ast.withLimit(1));
}

function readBack(): Find {
  return findUsers([], ['id', 'email']);
}

function withSource(graph: Graph, source: Find) {
  const found = addWithState(graph, source);
  addWithState(graph, readBack(), { filter: [new FilterData(found, sameId)] });
  return printGraph(graph);
}

const contracts: readonly (readonly [string, () => Graph, Contract<SqlStorage>])[] = [
  ['with returning', newGraph, { ...cascadeContract, capabilities: { sql: { returning: true } } }],
  ['without returning', newGraphWithoutReturning, cascadeContract],
];

describe.each(contracts)('the reuse rule, on a contract %s', (_, graphOf, cascade) => {
  it('reads the columns of a read-back with the Find it reads its key from', () => {
    const graph = graphOf();
    const found = addWithState(graph, firstUser());

    const read = addWithState(graph, readBack(), { filter: [new FilterData(found, sameId)] });

    expect(read).toBe(found);
    expect(printGraph(graph)).toBe(
      ["n1 Find users where name = 'Ada' limit 1", 'result: none'].join('\n'),
    );
    expect(returnedAt(graph, 0)).toEqual(['id', 'email']);
  });

  it('reads the columns of a read-back with the Find after a write to another table', () => {
    const graph = graphOf();
    const found = addWithState(graph, firstUser());
    addWithState(graph, new Insert([insertInto('posts', [{ title: 'Hello' }])], postOwner));

    const read = addWithState(graph, readBack(), { filter: [new FilterData(found, sameId)] });

    expect(read).toBe(found);
    expect(printGraph(graph)).toBe(
      ["n1 Find users where name = 'Ada' limit 1", 'n2 Insert posts', 'result: none'].join('\n'),
    );
    expect(returnedAt(graph, 0)).toEqual(['id', 'email']);
  });

  it('reads the columns of a read-back with a Find that has an order, a limit, an offset and locking', () => {
    const graph = graphOf();
    const source = new Find(
      findUsers([nameIsAda])
        .ast.withOrderBy([byName])
        .withLimit(1)
        .withOffset(2)
        .withLocking([LockingClause.of('forUpdate')]),
    );
    const found = addWithState(graph, source);

    const read = addWithState(graph, readBack(), { filter: [new FilterData(found, sameId)] });

    expect(read).toBe(found);
    expect(printGraph(graph)).toBe(
      ["n1 Find users where name = 'Ada' order by name asc limit 1 offset 2", 'result: none'].join(
        '\n',
      ),
    );
    expect(returnedAt(graph, 0)).toEqual(['id', 'email']);
  });

  it('adds a read-back as it is after a write to the table', () => {
    const graph = graphOf();
    const found = addWithState(graph, firstUser());
    addWithState(graph, updateUsers({ name: 'Bob' }));

    const read = addWithState(graph, readBack(), { filter: [new FilterData(found, sameId)] });

    expect(read).not.toBe(found);
    expect(printGraph(graph)).toBe(
      [
        "n1 Find users where name = 'Ada' limit 1",
        "n2 Update users set name = 'Bob'",
        'n3 Find users <- FilterData n1 (id->id)',
        'result: none',
      ].join('\n'),
    );
    expect(returnedAt(graph, 0)).toEqual(['id']);
  });

  it('adds a read-back as it is after a write whose declared foreign-key action changes the table', () => {
    const graph = new Graph(cascade);
    const found = addWithState(graph, findMembers([memberId]));
    addWithState(graph, deleteFrom('Org'));

    addWithState(graph, findMembers([memberId, memberTeamId]), {
      filter: [new FilterData(found, [[memberId, memberId]])],
    });

    expect(printGraph(graph)).toBe(
      [
        'n1 Find Member',
        'n2 Delete Org',
        'n3 Find Member <- FilterData n1 (id->id)',
        'result: none',
      ].join('\n'),
    );
  });

  it('reads the columns of a read-back with the Find after a write to a table no declared action reaches from it', () => {
    const graph = new Graph(cascade);
    const found = addWithState(graph, findMembers([memberId]));
    addWithState(graph, deleteFrom('Order'));

    const read = addWithState(graph, findMembers([memberId, memberTeamId]), {
      filter: [new FilterData(found, [[memberId, memberId]])],
    });

    expect(read).toBe(found);
    expect(printGraph(graph)).toBe(
      ['n1 Find Member', 'n2 Delete Order', 'result: none'].join('\n'),
    );
    expect(returnedAt(graph, 0)).toEqual(['id', 'teamId']);
  });

  it.each([
    [
      'a join',
      (ast: SelectAst) =>
        ast.withJoins([
          JoinAst.inner(
            TableSource.named('posts', undefined, 'public'),
            BinaryExpr.eq(ColumnRef.of('posts', 'user_id'), ColumnRef.of('users', 'id')),
          ),
        ]),
    ],
    ['DISTINCT', (ast: SelectAst) => ast.withDistinct()],
    ['DISTINCT ON', (ast: SelectAst) => ast.withDistinctOn([ColumnRef.of('users', 'name')])],
    ['GROUP BY', (ast: SelectAst) => ast.withGroupBy([ColumnRef.of('users', 'id')])],
    ['HAVING', (ast: SelectAst) => ast.withHaving(nameIsAda)],
  ])('adds a read-back as it is when the Find it reads has %s', (_name, change) => {
    const printed = withSource(graphOf(), new Find(change(findUsers([nameIsAda]).ast)));

    expect(printed.split('\n')).toHaveLength(3);
    expect(printed).toContain('n2 Find users <- FilterData n1 (id->id)');
  });

  it.each([
    ['a condition', () => findUsers([nameIsAda], ['id', 'email'])],
    ['an order', () => new Find(readBack().ast.withOrderBy([byName]))],
    ['includes', () => findUsersWith(usersWithPosts())],
  ])('adds a read-back with %s as it is', (_name, read) => {
    const graph = graphOf();
    const found = addWithState(graph, firstUser());

    const id = addWithState(graph, read(), { filter: [new FilterData(found, sameId)] });

    expect(id).not.toBe(found);
    expect(printGraph(graph).split('\n')).toHaveLength(3);
  });

  it('adds a Find that reads by columns that are not a key as it is', () => {
    const graph = graphOf();
    const found = addWithState(graph, firstUser());

    addWithState(graph, readBack(), { filter: [new FilterData(found, sameName)] });

    expect(printGraph(graph)).toBe(
      [
        "n1 Find users where name = 'Ada' limit 1",
        'n2 Find users <- FilterData n1 (name->name)',
        'result: none',
      ].join('\n'),
    );
  });

  it('adds a read-back with a Requires edge beside its FilterData edge as it is', () => {
    const graph = graphOf();
    const found = addWithState(graph, firstUser());
    const other = addWithState(graph, findUsers([nameIsAda]));

    const read = addWithState(graph, readBack(), {
      filter: [new FilterData(found, sameId)],
      requires: [new Requires(other)],
    });

    expect(read).not.toBe(found);
    expect(printGraph(graph)).toBe(
      [
        "n1 Find users where name = 'Ada' limit 1",
        "n2 Find users where name = 'Ada'",
        'n3 Find users <- FilterData n1 (id->id), Requires n2',
        'result: none',
      ].join('\n'),
    );
  });

  it('adds a read-back as it is when the Find it reads its key from reads another table', () => {
    const graph = graphOf();
    const found = addWithState(
      graph,
      new Find(
        SelectAst.from(TableSource.named('posts', undefined, 'public')).withProjection(
          columnsOf('posts', ['id']),
        ),
      ),
    );

    const read = addWithState(graph, readBack(), {
      filter: [new FilterData(found, postIdToUserId)],
    });

    expect(read).not.toBe(found);
    expect(printGraph(graph)).toBe(
      ['n1 Find posts', 'n2 Find users <- FilterData n1 (id->id)', 'result: none'].join('\n'),
    );
  });

  it('adds a read-back as it is when the Find it reads its key from selects an expression', () => {
    const source = findUsers([nameIsAda]).ast;
    const printed = withSource(
      graphOf(),
      new Find(
        source.withProjection([...source.projection, ProjectionItem.of('one', LiteralExpr.of(1))]),
      ),
    );

    expect(printed).toBe(
      [
        "n1 Find users where name = 'Ada'",
        'n2 Find users <- FilterData n1 (id->id)',
        'result: none',
      ].join('\n'),
    );
  });
});
