import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { ExecutionContext } from '@internal/sql-relational-core/query-lane-context';
import { castAs } from '@internal/utils/casts';
import { supportsDefaultInInsert } from '../collection-contract';
import { mapModelDataToStorageRow } from '../collection-runtime';
import { type CollectionTables, createStatementTables } from '../collection-tables';
import { shorthandToWhereExpr } from '../filters';
import { ormError } from '../orm-errors';
import {
  deleteAst,
  groupRowsByColumnSignature,
  type InsertConflictSkip,
  insertAst,
  projectTableColumn,
  updateAst,
} from '../query-plan-mutations';
import { collectionSelectAst } from '../query-plan-select';
import {
  assertJunctionMetadataShape,
  assertJunctionPayloadWritable,
  hasNestedMutationCallbacks,
  type JunctionRelationDefinition,
  type ParsedRelationMutation,
  parseMutationInput,
  partitionByOwnership,
  type RelationDefinition,
} from '../relation-mutations';
import { storageTableForContract } from '../storage-resolution';
import type { AliasedTable } from '../table-scope';
import type { MutationCreateInput, MutationUpdateInput, RelationMutation } from '../types';
import { emptyState } from '../types';
import { Assert } from './assert';
import { Delete } from './delete';
import type { ColumnPair, NodeId } from './edge';
import { Find } from './find';
import type { Graph } from './graph';
import { Insert } from './insert';
import type { Requires } from './requires';
import { Update } from './update';

type Mutation = RelationMutation<Contract<SqlStorage>, string>;
type CreateOrConnect = Exclude<Mutation, { kind: 'disconnect' }>;

export interface Translation {
  readonly graph: Graph;
  readonly context: ExecutionContext;
  readonly gate: NodeId | undefined;
}

export interface KeySource {
  readonly from: NodeId;
  readonly columns: readonly ColumnPair[];
}

export interface Model {
  readonly namespaceId: string;
  readonly modelName: string;
  readonly tables: CollectionTables;
}

export interface BeforeWrite {
  readonly keys: readonly KeySource[];
  readonly nullColumns: Readonly<Record<string, null>>;
}

export function addCreateWithRelations(
  t: Translation,
  model: Model,
  input: Readonly<Record<string, unknown>>,
  keysFromParent: readonly KeySource[],
  gated = false,
): NodeId {
  const parsed = parseMutationInput(
    t.context.contract,
    model.namespaceId,
    model.modelName,
    castAs<MutationCreateInput<Contract<SqlStorage>, string>>(input),
  );
  for (const { relation, mutation } of parsed.relationMutations) {
    rejectDisconnect(relation, mutation);
  }
  const before = addBeforeWrite(t, model, parsed.relationMutations);
  const parent = addInsertOf(
    t,
    model,
    [storageRowOf(t.context, model, parsed.scalarData)],
    [...keysFromParent, ...before.keys],
  );
  if (gated) {
    requireGate(t, parent);
  }
  addAfterWrite(t, model, parent, parsed.relationMutations);
  return parent;
}

export function addBeforeWrite(
  t: Translation,
  model: Model,
  relationMutations: readonly ParsedRelationMutation[],
): BeforeWrite {
  const { parentOwned, junctionOwned } = partitionByOwnership(relationMutations);
  for (const { relation, mutation } of junctionOwned) {
    assertJunctionMetadataShape(relation);
    assertJunctionPayloadWritable(relation, mutation.kind);
  }
  const keys: KeySource[] = [];
  const nullColumns: Record<string, null> = {};
  for (const { relation, mutation } of parentOwned) {
    if (mutation.kind === 'disconnect') {
      for (const column of relation.localColumns) {
        nullColumns[column] = null;
      }
    } else {
      keys.push(addParentOwned(t, model, relation, mutation));
    }
  }
  return { keys, nullColumns };
}

export function addAfterWrite(
  t: Translation,
  model: Model,
  parent: NodeId,
  relationMutations: readonly ParsedRelationMutation[],
): void {
  const { childOwned, junctionOwned } = partitionByOwnership(relationMutations);
  for (const { relation, mutation } of childOwned) {
    addChildOwned(t, model, parent, relation, mutation);
  }
  for (const { relation, mutation } of junctionOwned) {
    addJunctionOwned(t, model, parent, relation, mutation);
  }
}

function rejectDisconnect(relation: RelationDefinition, mutation: Mutation): void {
  if (mutation.kind === 'disconnect') {
    throw ormError(
      'ORM.RELATION_MUTATION_UNSUPPORTED',
      'disconnect() is only supported in update() nested mutations',
      { meta: { kind: 'disconnect', relation: relation.relationName } },
    );
  }
}

function addParentOwned(
  t: Translation,
  model: Model,
  relation: RelationDefinition,
  mutation: CreateOrConnect,
): KeySource {
  const related = relatedModel(relation);
  const columns = pairs(
    t.context.contract,
    related.tables.root,
    relation.targetColumns,
    model.tables.root,
    relation.localColumns,
  );
  if (mutation.kind === 'create') {
    const [row] = mutation.data;
    if (row === undefined) {
      throw ormError(
        'ORM.RELATION_MUTATION_INVALID',
        `create() nested mutation for relation "${relation.relationName}" requires data`,
        { meta: { kind: 'create', relation: relation.relationName, problem: 'missing-data' } },
      );
    }
    return { from: addCreateWithRelations(t, related, row, [], true), columns };
  }
  const [criterion] = mutation.criteria;
  if (criterion === undefined) {
    throw ormError(
      'ORM.RELATION_MUTATION_INVALID',
      `connect() nested mutation for relation "${relation.relationName}" requires criterion`,
      { meta: { kind: 'connect', relation: relation.relationName, problem: 'missing-criterion' } },
    );
  }
  return { from: addFindAndAssert(t, related, relation, 'connect', criterion, columns), columns };
}

function addChildOwned(
  t: Translation,
  model: Model,
  parent: NodeId,
  relation: RelationDefinition,
  mutation: Mutation,
): void {
  const { graph, context } = t;
  const related = relatedModel(relation);
  const fromParent = pairs(
    context.contract,
    model.tables.root,
    relation.localColumns,
    related.tables.root,
    relation.targetColumns,
  );
  if (mutation.kind === 'create') {
    const keys = [{ from: parent, columns: fromParent }];
    const rows = mutation.data.map((row) => castAs<Readonly<Record<string, unknown>>>(row));
    if (rows.some((row) => hasRelationCallbacks(context, related, row))) {
      for (const row of rows) {
        addCreateWithRelations(t, related, row, keys);
      }
      return;
    }
    addChildInserts(t, related, rows, keys);
    return;
  }
  if (mutation.kind === 'connect') {
    for (const criterion of mutation.criteria) {
      const where = requiredCriterion(context, related, relation, 'connect', criterion);
      const update = graph.add(new Update(updateAst(context.contract, related.tables, {}, where)));
      graph.addPayloadDataEdge(parent, update, fromParent);
    }
    return;
  }
  const unlink = Object.fromEntries(relation.targetColumns.map((column) => [column, null]));
  const criteria = mutation.criteria ?? [];
  const wheres =
    criteria.length === 0
      ? [undefined]
      : criteria.map((criterion) =>
          requiredCriterion(context, related, relation, 'disconnect', criterion),
        );
  for (const where of wheres) {
    const update = graph.add(
      new Update(updateAst(context.contract, related.tables, unlink, where)),
    );
    graph.addFilterDataEdge(parent, update, fromParent);
  }
}

function addJunctionOwned(
  t: Translation,
  model: Model,
  parent: NodeId,
  relation: JunctionRelationDefinition,
  mutation: Mutation,
): void {
  const { graph, context } = t;
  const { contract } = context;
  const { through } = relation;
  const related = relatedModel(relation);
  const junction = createStatementTables({
    namespaceId: through.namespaceId,
    tableName: through.table,
  });
  const fromParent = pairs(
    contract,
    model.tables.root,
    relation.localColumns,
    junction.root,
    through.parentColumns,
  );
  const fromTarget = pairs(
    contract,
    related.tables.root,
    through.targetColumns,
    junction.root,
    through.childColumns,
  );
  const addLink = (target: NodeId, conflict: InsertConflictSkip | undefined) => {
    const values = withCreateDefaults(context, through.namespaceId, through.table, {});
    const link = graph.add(
      new Insert(insertAst(contract, junction.root, [values], conflict), {
        relation: relation.relationName,
        junction: through.table,
      }),
    );
    graph.addPayloadDataEdge(parent, link, fromParent);
    graph.addPayloadDataEdge(target, link, fromTarget);
  };

  if (mutation.kind === 'create') {
    for (const row of mutation.data) {
      addLink(addCreateWithRelations(t, related, row, [], true), undefined);
    }
    return;
  }
  if (mutation.kind === 'connect') {
    const conflict = linkKeyConflict(contract, relation);
    for (const criterion of mutation.criteria) {
      addLink(addFindAndAssert(t, related, relation, 'connect', criterion, fromTarget), conflict);
    }
    return;
  }
  const criteria = mutation.criteria ?? [];
  if (criteria.length === 0) {
    throw ormError(
      'ORM.RELATION_MUTATION_INVALID',
      `disconnect() nested mutation for relation "${relation.relationName}" requires criterion`,
      {
        meta: { kind: 'disconnect', relation: relation.relationName, problem: 'missing-criterion' },
      },
    );
  }
  for (const criterion of criteria) {
    const target = addFindAndAssert(t, related, relation, 'disconnect', criterion, fromTarget);
    const unlink = graph.add(new Delete(deleteAst(contract, junction, undefined)));
    graph.addFilterDataEdge(parent, unlink, fromParent);
    graph.addFilterDataEdge(target, unlink, fromTarget);
  }
}

function addChildInserts(
  t: Translation,
  model: Model,
  rows: readonly Readonly<Record<string, unknown>>[],
  keys: readonly KeySource[],
): void {
  const values = rows.map((row) => storageRowOf(t.context, model, row));
  const groups = supportsDefaultInInsert(t.context.contract)
    ? [values]
    : groupRowsByColumnSignature(values);
  for (const group of groups) {
    addInsertOf(t, model, group, keys);
  }
}

function addInsertOf(
  t: Translation,
  model: Model,
  values: readonly Record<string, unknown>[],
  keys: readonly KeySource[],
) {
  const insert = t.graph.add(
    new Insert(insertAst(t.context.contract, model.tables.root, values, undefined)),
  );
  for (const { from, columns } of keys) {
    t.graph.addPayloadDataEdge(from, insert, columns);
  }
  return insert;
}

function storageRowOf(
  context: ExecutionContext,
  model: Model,
  row: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const { namespaceId, tableName } = model.tables.root.storage;
  return withCreateDefaults(
    context,
    namespaceId,
    tableName,
    mapModelDataToStorageRow(context.contract, namespaceId, model.modelName, row),
  );
}

function addFindAndAssert(
  t: Translation,
  related: Model,
  relation: RelationDefinition,
  kind: 'connect' | 'disconnect',
  criterion: Readonly<Record<string, unknown>>,
  columns: readonly ColumnPair[],
): NodeId {
  const { graph, context } = t;
  const where = criterionWhere(context, related, criterion);
  if (where === undefined) {
    throw ormError(
      'ORM.RELATION_MUTATION_INVALID',
      `Nested connect for model "${related.modelName}" requires non-empty criterion`,
      { meta: { kind: 'connect', model: related.modelName, problem: 'empty-criterion' } },
    );
  }
  const find = graph.add(
    new Find(
      collectionSelectAst(context.contract, related.modelName, {
        ...emptyState(related.tables),
        filters: [where],
        limit: 1,
      }),
    ),
  );
  requireGate(t, find);
  const assert = graph.add(
    new Assert(
      ormError(
        'ORM.RELATION_ROW_MISSING',
        `${kind}() nested mutation for relation "${relation.relationName}" did not find a matching row`,
        { meta: { kind, relation: relation.relationName } },
      ),
    ),
  );
  graph.addRowsEdge(
    find,
    assert,
    'rows',
    columns.map(([source]) => [source, source]),
  );
  requireGate(t, assert);
  return find;
}

function requiredCriterion(
  context: ExecutionContext,
  model: Model,
  relation: RelationDefinition,
  kind: 'connect' | 'disconnect',
  criterion: Readonly<Record<string, unknown>>,
) {
  const where = criterionWhere(context, model, criterion);
  if (where === undefined) {
    throw ormError(
      'ORM.RELATION_MUTATION_INVALID',
      `${kind}() nested mutation for relation "${relation.relationName}" requires non-empty criterion`,
      { meta: { kind, relation: relation.relationName, problem: 'empty-criterion' } },
    );
  }
  return where;
}

function requireGate(t: Translation, node: NodeId<{ requires: Requires[] }>): void {
  if (t.gate !== undefined) {
    t.graph.addRequiresEdge(t.gate, node);
  }
}

function criterionWhere(
  context: ExecutionContext,
  model: Model,
  criterion: Readonly<Record<string, unknown>>,
) {
  return shorthandToWhereExpr(
    context,
    model.namespaceId,
    model.modelName,
    castAs<MutationUpdateInput<Contract<SqlStorage>, string>>(criterion),
    model.tables.root,
  );
}

function withCreateDefaults(
  context: ExecutionContext,
  namespaceId: string,
  tableName: string,
  values: Record<string, unknown>,
): Record<string, unknown> {
  const withDefaults = { ...values };
  for (const applied of context.applyMutationDefaults({
    op: 'create',
    entry: tableName,
    namespace: namespaceId,
    values,
  })) {
    withDefaults[applied.field] = applied.value;
  }
  return withDefaults;
}

function hasRelationCallbacks(
  context: ExecutionContext,
  model: Model,
  row: Readonly<Record<string, unknown>>,
): boolean {
  return hasNestedMutationCallbacks(context.contract, model.namespaceId, model.modelName, {
    ...row,
  });
}

function linkKeyConflict(
  contract: Contract<SqlStorage>,
  relation: JunctionRelationDefinition,
): InsertConflictSkip | undefined {
  const { through } = relation;
  const linkColumns = new Set([...through.parentColumns, ...through.childColumns]);
  const table = storageTableForContract(contract, through.namespaceId, through.table);
  const keys = [
    ...(table.primaryKey === undefined ? [] : [table.primaryKey.columns]),
    ...table.uniques.map((unique) => unique.columns),
  ];
  const key = keys.find(
    (columns) =>
      columns.length === linkColumns.size && columns.every((column) => linkColumns.has(column)),
  );
  return key === undefined ? undefined : { columns: key };
}

function relatedModel(relation: RelationDefinition): Model {
  return {
    namespaceId: relation.relatedNamespaceId,
    modelName: relation.relatedModelName,
    tables: createStatementTables({
      namespaceId: relation.relatedNamespaceId,
      tableName: relation.relatedTableName,
    }),
  };
}

function pairs(
  contract: Contract<SqlStorage>,
  source: AliasedTable,
  sourceColumns: readonly string[],
  target: AliasedTable,
  targetColumns: readonly string[],
): ColumnPair[] {
  return sourceColumns.flatMap((column, index) => {
    const targetColumn = targetColumns[index];
    return targetColumn === undefined
      ? []
      : [
          [
            projectTableColumn(contract, source, column),
            projectTableColumn(contract, target, targetColumn),
          ] as const,
        ];
  });
}
