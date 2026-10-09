import { type AnyExpression, checkLimitOffset } from '@internal/sql-relational-core/ast';
import { ormError } from '../orm-errors';
import type { IncludeExpr } from '../types';
import { After, IntoWhere } from './edges';
import { Graph } from './graph';
import { Delete, Find, type FindRead, type Node, type TableIdentity, Update } from './nodes';

export interface WriteTarget {
  readonly table: TableIdentity;
  readonly where: readonly AnyExpression[];
  readonly read: FindRead;
  readonly selectedFields: readonly string[] | undefined;
  readonly includes: readonly IncludeExpr[];
}

export function updateAllGraph(
  target: WriteTarget,
  set: Readonly<Record<string, unknown>>,
  form: 'rows' | 'count',
): Graph {
  const graph = new Graph();
  const update = graph.add(new Update(target.table, set, target.where));
  return withResult(graph, target, update, form);
}

export function deleteAllGraph(target: WriteTarget, form: 'rows' | 'count'): Graph {
  const graph = new Graph();
  const del = new Delete(target.table, target.where);

  if (form === 'rows' && target.includes.length > 0) {
    const find = new Find(target.table, target.where, target.read);
    graph.add(find);
    graph.add(del, new After(find, del));
    return withResult(graph, target, find, form);
  }

  graph.add(del);
  return withResult(graph, target, del, form);
}

export function updateFirstGraph(
  target: WriteTarget,
  identityColumns: readonly string[],
  set: Readonly<Record<string, unknown>>,
): Graph {
  const graph = new Graph();
  const find = addFindOfFirstRow(graph, target, identityColumns);
  if (find === undefined) {
    return withResult(graph, target, undefined, 'first row');
  }

  const update = new Update(target.table, set, []);
  const added = graph.add(update, sameRow(find, update, identityColumns));
  return withResult(graph, target, added, 'first row');
}

export function deleteFirstGraph(target: WriteTarget, identityColumns: readonly string[]): Graph {
  const graph = new Graph();
  const find = addFindOfFirstRow(graph, target, identityColumns);
  if (find === undefined) {
    return withResult(graph, target, undefined, 'first row');
  }

  const del = new Delete(target.table, []);
  if (target.includes.length === 0) {
    graph.add(del, sameRow(find, del, identityColumns));
    return withResult(graph, target, del, 'first row');
  }

  const rowWithIncludes = new Find(target.table, [], {
    ...target.read,
    limit: undefined,
    offset: undefined,
  });
  graph.add(rowWithIncludes, sameRow(find, rowWithIncludes, identityColumns));
  graph.add(del, sameRow(find, del, identityColumns), new After(rowWithIncludes, del));
  return withResult(graph, target, rowWithIncludes, 'first row');
}

function addFindOfFirstRow(
  graph: Graph,
  target: WriteTarget,
  identityColumns: readonly string[],
): Find | undefined {
  const { modelName, tableName } = target.table;
  if (identityColumns.length === 0) {
    throw ormError(
      'ORM.ROW_IDENTITY_MISSING',
      `update()/delete() on model "${modelName}" requires the table to have a primary key or unique constraint`,
      { meta: { model: modelName, table: tableName } },
    );
  }
  checkLimitOffset('limit', target.read.limit);
  if (target.read.limit === 0) {
    return undefined;
  }
  const find = new Find(target.table, target.where, { ...target.read, limit: 1 });
  graph.add(find);
  return find;
}

function sameRow(find: Find, node: Node, identityColumns: readonly string[]): IntoWhere {
  return new IntoWhere(
    find,
    node,
    identityColumns.map((column) => [column, column]),
  );
}

function withResult(
  graph: Graph,
  target: WriteTarget,
  node: Node | undefined,
  form: 'rows' | 'first row' | 'count',
): Graph {
  graph.setResult({
    node,
    form,
    selectedFields: target.selectedFields,
    includes: target.includes,
  });
  return graph;
}
