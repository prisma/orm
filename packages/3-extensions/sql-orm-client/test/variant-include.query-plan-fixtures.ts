import {
  BinaryExpr,
  CodecJsonValueProjection,
  type CodecRef,
  ColumnRef,
  DerivedTableSource,
  EqColJoinOn,
  JoinAst,
  JsonArrayAggExpr,
  JsonDocumentProjection,
  JsonObjectExpr,
  ProjectionItem,
  SelectAst,
  SubqueryExpr,
  TableSource,
} from '@internal/sql-relational-core/ast';
import { ifDefined } from '@internal/utils/defined';
import { InternalError } from '@internal/utils/internal-error';
import { expect } from 'vitest';
import {
  type CollectionState,
  emptyState,
  type IncludeExpr,
  type IncludeScalar,
  type IncludeThroughDescriptor,
  type RelationCardinalityTag,
} from '../src/types';
import { isSelectAst } from './helpers';

export function includeExpr(options: {
  relationName: string;
  relatedModelName: string;
  relatedTableName: string;
  localTableName: string;
  targetColumn: string;
  localColumn: string;
  cardinality: RelationCardinalityTag;
  nested?: CollectionState;
  scalar?: IncludeScalar<unknown>;
  through?: IncludeThroughDescriptor;
}): IncludeExpr {
  return {
    relationName: options.relationName,
    relatedModelName: options.relatedModelName,
    relatedNamespaceId: 'public',
    relatedTableName: options.relatedTableName,
    localTableName: options.localTableName,
    targetColumns: [options.targetColumn],
    localColumns: [options.localColumn],
    cardinality: options.cardinality,
    ...ifDefined('through', options.through),
    nested: options.nested ?? emptyState(),
    scalar: options.scalar,
    combine: undefined,
  };
}

export function selectedState(...fields: string[]): CollectionState {
  return { ...emptyState(), selectedFields: fields };
}

export function rootState(
  include: IncludeExpr,
  variantName: string,
  ...fields: string[]
): CollectionState {
  return {
    ...emptyState(),
    includes: [include],
    selectedFields: fields,
    variantName,
  };
}

export function assigneeInclude(localTableName: string): IncludeExpr {
  return includeExpr({
    relationName: 'assignee',
    relatedModelName: 'Assignee',
    relatedTableName: 'assignees',
    localTableName,
    targetColumn: 'id',
    localColumn: 'assignee_id',
    cardinality: 'N:1',
    nested: selectedState('id', 'name'),
  });
}

export function tasksInclude(nested: CollectionState): IncludeExpr {
  return includeExpr({
    relationName: 'tasks',
    relatedModelName: 'Task',
    relatedTableName: 'tasks',
    localTableName: 'projects_tbl',
    targetColumn: 'project_id',
    localColumn: 'id',
    cardinality: '1:N',
    nested,
  });
}

export function projection(
  alias: string,
  table: string,
  column: string,
  codecId: 'pg/int4@1' | 'pg/text@1',
): ProjectionItem {
  return ProjectionItem.of(alias, ColumnRef.of(table, column), { codecId });
}

/**
 * The codec the child SELECT resolved for a projected alias — the same one the
 * enclosing `json_agg` entry carries, since the entry reads that column.
 */
function codecOfProjected(childRows: SelectAst, alias: string): CodecRef {
  const codec = childRows.projection.find((item) => item.alias === alias)?.codec;
  if (codec === undefined) {
    throw new InternalError(`child rows project no codec for '${alias}'`);
  }
  return codec;
}

export function rowAggregate(
  relationName: string,
  childRows: SelectAst,
  projectedAliases: readonly string[],
): SelectAst {
  const rowsAlias = `${relationName}__rows`;
  return SelectAst.from(DerivedTableSource.as(rowsAlias, childRows)).withProjection([
    ProjectionItem.of(
      relationName,
      JsonArrayAggExpr.of(
        new JsonDocumentProjection(
          JsonObjectExpr.fromEntries(
            projectedAliases.map((alias) =>
              JsonObjectExpr.entry(
                alias,
                new CodecJsonValueProjection(
                  ColumnRef.of(rowsAlias, alias),
                  codecOfProjected(childRows, alias),
                ),
              ),
            ),
          ),
        ),
        'emptyArray',
      ),
    ),
  ]);
}

export function assigneeRows(parentTable: string, parentColumn: string): SelectAst {
  return SelectAst.from(TableSource.named('assignees', undefined, 'public'))
    .withProjection([
      projection('id', 'assignees', 'id', 'pg/int4@1'),
      projection('name', 'assignees', 'name', 'pg/text@1'),
    ])
    .withWhere(
      BinaryExpr.eq(ColumnRef.of('assignees', 'id'), ColumnRef.of(parentTable, parentColumn)),
    );
}

function expectSelectAst(value: unknown): asserts value is SelectAst {
  expect(isSelectAst(value)).toBe(true);
}

export function childRowsFor(planAst: unknown, relationName: string): SelectAst {
  expectSelectAst(planAst);
  const relationProjection = planAst.projection.find((item) => item.alias === relationName);
  expect(relationProjection?.expr).toBeInstanceOf(SubqueryExpr);
  const aggregateFrom = (relationProjection!.expr as SubqueryExpr).query.from;
  expect(aggregateFrom).toBeInstanceOf(DerivedTableSource);
  return (aggregateFrom as DerivedTableSource).query;
}

export function taskVariantProjection(tableRef: string, forwarded = false): ProjectionItem[] {
  return [
    projection(
      'features__priority',
      tableRef,
      forwarded ? 'features__priority' : 'priority',
      'pg/int4@1',
    ),
    projection(
      'features__assignee_id',
      tableRef,
      forwarded ? 'features__assignee_id' : 'assignee_id',
      'pg/int4@1',
    ),
  ];
}

export const featureJoin = JoinAst.inner(
  TableSource.named('features', undefined, 'public'),
  EqColJoinOn.of(ColumnRef.of('tasks', 'id'), ColumnRef.of('features', 'id')),
);
