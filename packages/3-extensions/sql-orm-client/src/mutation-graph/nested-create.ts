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
  parseMutationInput,
  partitionByOwnership,
  type RelationDefinition,
} from '../relation-mutations';
import { storageTableForContract } from '../storage-resolution';
import type { AliasedTable } from '../table-scope';
import type { MutationCreateInput, MutationUpdateInput, RelationMutation } from '../types';
import { emptyState } from '../types';
import { Assert } from './assert';
import type { ColumnPair, NodeId } from './edge';
import { Find } from './find';
import type { Graph } from './graph';
import { Insert } from './insert';
import { Update } from './update';

type Mutation = RelationMutation<Contract<SqlStorage>, string>;
type CreateOrConnect = Exclude<Mutation, { kind: 'disconnect' }>;

interface KeySource {
  readonly from: NodeId;
  readonly columns: readonly ColumnPair[];
}

interface Model {
  readonly namespaceId: string;
  readonly modelName: string;
  readonly tables: CollectionTables;
}

export function addCreateWithRelations(
  graph: Graph,
  context: ExecutionContext,
  model: Model,
  input: Readonly<Record<string, unknown>>,
  keysFromParent: readonly KeySource[],
): NodeId {
  const { contract } = context;
  const parsed = parseMutationInput(
    contract,
    model.namespaceId,
    model.modelName,
    castAs<MutationCreateInput<Contract<SqlStorage>, string>>(input),
  );
  const { parentOwned, childOwned, junctionOwned } = partitionByOwnership(parsed.relationMutations);

  const keys = [...keysFromParent];
  for (const { relation, mutation } of parentOwned) {
    rejectDisconnect(relation, mutation);
    keys.push(addParentOwned(graph, context, model, relation, mutation));
  }
  for (const { relation, mutation } of junctionOwned) {
    rejectDisconnect(relation, mutation);
    assertJunctionMetadataShape(relation);
    assertJunctionPayloadWritable(relation, mutation.kind);
  }

  const parent = addParentInsert(graph, context, model, parsed.scalarData, keys);

  for (const { relation, mutation } of childOwned) {
    rejectDisconnect(relation, mutation);
    addChildOwned(graph, context, model, parent, relation, mutation);
  }
  for (const { relation, mutation } of junctionOwned) {
    addJunctionOwned(graph, context, model, parent, relation, mutation);
  }
  return parent;
}

function rejectDisconnect(
  relation: RelationDefinition,
  mutation: Mutation,
): asserts mutation is CreateOrConnect {
  if (mutation.kind === 'disconnect') {
    throw ormError(
      'ORM.RELATION_MUTATION_UNSUPPORTED',
      'disconnect() is only supported in update() nested mutations',
      { meta: { kind: 'disconnect', relation: relation.relationName } },
    );
  }
}

function addParentOwned(
  graph: Graph,
  context: ExecutionContext,
  model: Model,
  relation: RelationDefinition,
  mutation: CreateOrConnect,
): KeySource {
  const related = relatedModel(relation);
  const columns = pairs(
    context.contract,
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
    return { from: addCreateWithRelations(graph, context, related, row, []), columns };
  }
  const [criterion] = mutation.criteria;
  if (criterion === undefined) {
    throw ormError(
      'ORM.RELATION_MUTATION_INVALID',
      `connect() nested mutation for relation "${relation.relationName}" requires criterion`,
      { meta: { kind: 'connect', relation: relation.relationName, problem: 'missing-criterion' } },
    );
  }
  const found = addFindAndAssert(graph, context, related, relation, criterion, columns);
  return { from: found, columns };
}

function addChildOwned(
  graph: Graph,
  context: ExecutionContext,
  model: Model,
  parent: NodeId,
  relation: RelationDefinition,
  mutation: Mutation,
): void {
  const related = relatedModel(relation);
  const keys = [
    {
      from: parent,
      columns: pairs(
        context.contract,
        model.tables.root,
        relation.localColumns,
        related.tables.root,
        relation.targetColumns,
      ),
    },
  ];
  if (mutation.kind === 'create') {
    const rows = mutation.data.map((row) => castAs<Readonly<Record<string, unknown>>>(row));
    if (rows.some((row) => hasRelationCallbacks(context, related, row))) {
      for (const row of rows) {
        addCreateWithRelations(graph, context, related, row, keys);
      }
      return;
    }
    addChildInserts(graph, context, related, rows, keys);
    return;
  }
  if (mutation.kind === 'connect') {
    for (const criterion of mutation.criteria) {
      const where = criterionWhere(context, related, criterion);
      if (where === undefined) {
        throw ormError(
          'ORM.RELATION_MUTATION_INVALID',
          `connect() nested mutation for relation "${relation.relationName}" requires non-empty criterion`,
          {
            meta: { kind: 'connect', relation: relation.relationName, problem: 'empty-criterion' },
          },
        );
      }
      const update = graph.add(new Update(updateAst(context.contract, related.tables, {}, where)));
      for (const { from, columns } of keys) {
        graph.addPayloadDataEdge(from, update, columns);
      }
    }
  }
}

function addJunctionOwned(
  graph: Graph,
  context: ExecutionContext,
  model: Model,
  parent: NodeId,
  relation: JunctionRelationDefinition,
  mutation: Mutation,
): void {
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
      addLink(addCreateWithRelations(graph, context, related, row, []), undefined);
    }
    return;
  }
  if (mutation.kind === 'connect') {
    const conflict = linkKeyConflict(contract, relation);
    for (const criterion of mutation.criteria) {
      addLink(addFindAndAssert(graph, context, related, relation, criterion, fromTarget), conflict);
    }
  }
}

function addParentInsert(
  graph: Graph,
  context: ExecutionContext,
  model: Model,
  row: Readonly<Record<string, unknown>>,
  keys: readonly KeySource[],
): NodeId {
  return addInsertOf(graph, context, model, [storageRowOf(context, model, row)], keys);
}

function addChildInserts(
  graph: Graph,
  context: ExecutionContext,
  model: Model,
  rows: readonly Readonly<Record<string, unknown>>[],
  keys: readonly KeySource[],
): void {
  const values = rows.map((row) => storageRowOf(context, model, row));
  const groups = supportsDefaultInInsert(context.contract)
    ? [values]
    : groupRowsByColumnSignature(values);
  for (const group of groups) {
    addInsertOf(graph, context, model, group, keys);
  }
}

function addInsertOf(
  graph: Graph,
  context: ExecutionContext,
  model: Model,
  values: readonly Record<string, unknown>[],
  keys: readonly KeySource[],
): NodeId {
  const insert = graph.add(
    new Insert(insertAst(context.contract, model.tables.root, values, undefined)),
  );
  for (const { from, columns } of keys) {
    graph.addPayloadDataEdge(from, insert, columns);
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
  graph: Graph,
  context: ExecutionContext,
  related: Model,
  relation: RelationDefinition,
  criterion: Readonly<Record<string, unknown>>,
  columns: readonly ColumnPair[],
): NodeId {
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
  const assert = graph.add(
    new Assert(
      ormError(
        'ORM.RELATION_ROW_MISSING',
        `connect() nested mutation for relation "${relation.relationName}" did not find a matching row`,
        { meta: { kind: 'connect', relation: relation.relationName } },
      ),
    ),
  );
  graph.addRowsEdge(
    find,
    assert,
    'rows',
    columns.map(([source]) => [source, source]),
  );
  return find;
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
