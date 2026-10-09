import type { AnyExpression } from '@internal/sql-relational-core/ast';
import type { IncludeExpr } from '../types';
import { After } from './edges';
import { Graph } from './graph';
import { Delete, Find, type FindRead, type TableIdentity, Update } from './nodes';

export interface BulkTarget {
  readonly table: TableIdentity;
  readonly where: readonly AnyExpression[];
  readonly read: FindRead;
  readonly selectedFields: readonly string[] | undefined;
  readonly includes: readonly IncludeExpr[];
}

export function updateAllGraph(
  target: BulkTarget,
  set: Readonly<Record<string, unknown>>,
  form: 'rows' | 'count',
): Graph {
  const graph = new Graph();
  const update = graph.add(new Update(target.table, set, target.where));
  graph.setResult({
    node: update,
    form,
    selectedFields: target.selectedFields,
    includes: target.includes,
  });
  return graph;
}

export function deleteAllGraph(target: BulkTarget, form: 'rows' | 'count'): Graph {
  const graph = new Graph();
  const del = new Delete(target.table, target.where);
  const result = { form, selectedFields: target.selectedFields, includes: target.includes };

  if (form === 'rows' && target.includes.length > 0) {
    const find = new Find(target.table, target.where, target.read);
    graph.add(find);
    graph.add(del, new After(find, del));
    graph.setResult({ ...result, node: find });
    return graph;
  }

  graph.add(del);
  graph.setResult({ ...result, node: del });
  return graph;
}
