import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { ExecutionContext } from '@internal/sql-relational-core/query-lane-context';
import { castAs } from '@internal/utils/casts';
import {
  columnOfContractField,
  type ResolvedRelation,
  resolveModelTableName,
  resolveRelationTargetColumns,
} from '../collection-contract';
import { createStatementTables } from '../collection-tables';
import { shorthandToWhereExpr } from '../filters';
import {
  type InsertConflictSkip,
  insertAst,
  projectTableColumn,
  projectTableColumns,
} from '../mutation-statements';
import { ormError } from '../orm-errors';
import { collectionSelectAst } from '../query-plan-select';
import {
  assertJunctionMetadataShape,
  assertJunctionPayloadWritable,
  type JunctionRelation,
  type JunctionRelationMutation,
  type ParsedMutationInput,
  type ParsedRelationMutation,
  parseMutationInput,
  partitionByOwnership,
} from '../relation-mutations';
import { storageTableForContract } from '../storage-resolution';
import type { AliasedTable } from '../table-scope';
import type { MutationCreateInput, MutationUpdateInput, RelationMutation } from '../types';
import { emptyState } from '../types';
import { readBackIdentity, writtenKeys } from '../written-keys';
import { Assert } from './assert';
import type { ColumnPair, NodeId } from './edge';
import { Find } from './find';
import { FindByKeys } from './find-by-keys';
import type { Graph } from './graph';
import { InsertReportingKeys } from './insert-reporting-keys';
import {
  addDeleteRows,
  addInsertRows,
  addUpdateRows,
  type KeySource,
  type Model,
  selectAstOf,
} from './model-statements';
import type { Requires } from './requires';
import { createRowOf, withCreateDefaults } from './storage-rows';

type Mutation = RelationMutation<Contract<SqlStorage>, string>;
type CreateOrConnect = Exclude<Mutation, { kind: 'disconnect' }>;

export interface Translation {
  readonly graph: Graph;
  readonly context: ExecutionContext;
  readonly parentRow: NodeId | undefined;
  readonly readsBack: boolean;
}

export interface BeforeWrite {
  readonly keys: readonly KeySource[];
  readonly nullColumns: Readonly<Record<string, null>>;
}

export function addCreateWithRelations(
  t: Translation,
  model: Model,
  parsed: ParsedMutationInput,
  keysFromParent: readonly KeySource[],
  requiresParentRow = false,
): NodeId {
  for (const relationMutation of parsed.relationMutations) {
    rejectDisconnect(relationMutation);
  }
  const before = addBeforeWrite(t, model, parsed.relationMutations);
  const keys = [...keysFromParent, ...before.keys];
  const row = createRowOf(t.context, model, undefined, parsed.scalarData, undefined);
  const parent = t.readsBack
    ? addInsertAndReadBack(t, model, row, keys, requiresParentRow)
    : addParentInsert(t, model, row, keys, requiresParentRow);
  addAfterWrite(t, model, parent, parsed.relationMutations);
  return parent;
}

function addParentInsert(
  t: Translation,
  model: Model,
  row: Record<string, unknown>,
  keys: readonly KeySource[],
  requiresParentRow: boolean,
): NodeId {
  const insert = addInsertRows(t.graph, t.context.contract, model.tables.root, [row], {
    conflict: undefined,
    keys,
    junction: undefined,
  });
  if (requiresParentRow) {
    requireParentRow(t, insert);
  }
  return insert;
}

function addInsertAndReadBack(
  t: Translation,
  model: Model,
  row: Record<string, unknown>,
  keys: readonly KeySource[],
  requiresParentRow: boolean,
): NodeId {
  const { graph, context } = t;
  const { contract } = context;
  const { root } = model.tables;
  const { namespaceId, tableName } = root.storage;
  const owner = { operation: 'create', modelName: model.modelName };
  const written = writtenKeysOf(t, model, row, keys);
  const insert = graph.add(
    new InsertReportingKeys(
      [insertAst(contract, root, [row], undefined)],
      written.keys,
      written.generated,
      owner,
    ),
  );
  for (const { from, columns } of keys) {
    graph.addPayloadDataEdge(from, insert, columns);
  }
  if (requiresParentRow) {
    requireParentRow(t, insert);
  }
  const identity = readBackIdentity(contract, namespaceId, tableName, model.modelName, 'create()');
  const identityPairs = projectTableColumns(contract, root, identity).map(
    (column): ColumnPair => [column, column],
  );
  const read = graph.add(
    new FindByKeys(
      collectionSelectAst(contract, model.modelName, emptyState(model.tables)),
      identityPairs,
      owner,
    ),
  );
  graph.addRowsEdge(insert, read, 'keys', identityPairs);
  return read;
}

function writtenKeysOf(
  t: Translation,
  model: Model,
  row: Readonly<Record<string, unknown>>,
  keys: readonly KeySource[],
) {
  const { namespaceId, tableName } = model.tables.root.storage;
  const fromEdges = keys.flatMap(({ columns }) => columns.map(([, target]) => target.alias));
  return writtenKeys({
    context: t.context,
    namespaceId,
    tableName,
    modelName: model.modelName,
    rows: [{ ...Object.fromEntries(fromEdges.map((column) => [column, true])), ...row }],
    method: 'create()',
  });
}

export function addBeforeWrite(
  t: Translation,
  model: Model,
  relationMutations: readonly ParsedRelationMutation[],
): BeforeWrite {
  const { parentOwned, junctionOwned } = partitionByOwnership(relationMutations);
  for (const relationMutation of junctionOwned) {
    assertJunctionMetadataShape(relationMutation);
    assertJunctionPayloadWritable(relationMutation);
  }
  const keys: KeySource[] = [];
  const nullColumns: Record<string, null> = {};
  for (const relationMutation of parentOwned) {
    const { relation, mutation } = relationMutation;
    if (mutation.kind === 'disconnect') {
      for (const column of localColumnsOf(t.context.contract, model, relation)) {
        nullColumns[column] = null;
      }
    } else {
      keys.push(addParentOwned(t, model, relationMutation, mutation));
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
  for (const relationMutation of childOwned) {
    addChildOwned(t, model, parent, relationMutation);
  }
  for (const relationMutation of junctionOwned) {
    addJunctionOwned(t, model, parent, relationMutation);
  }
}

function rejectDisconnect({ name, mutation }: ParsedRelationMutation): void {
  if (mutation.kind === 'disconnect') {
    throw ormError(
      'ORM.RELATION_MUTATION_UNSUPPORTED',
      'disconnect() is only supported in update() nested mutations',
      { meta: { kind: 'disconnect', relation: name } },
    );
  }
}

function addParentOwned(
  t: Translation,
  model: Model,
  { name, relation }: ParsedRelationMutation,
  mutation: CreateOrConnect,
): KeySource {
  const { contract } = t.context;
  const related = relatedModel(contract, relation);
  const columns = pairs(
    contract,
    related.tables.root,
    resolveRelationTargetColumns(contract, relation),
    model.tables.root,
    localColumnsOf(contract, model, relation),
  );
  if (mutation.kind === 'create') {
    const [row] = mutation.data;
    if (row === undefined) {
      throw ormError(
        'ORM.RELATION_MUTATION_INVALID',
        `create() nested mutation for relation "${name}" requires data`,
        { meta: { kind: 'create', relation: name, problem: 'missing-data' } },
      );
    }
    return {
      from: addCreateWithRelations(t, related, parseCreateInput(t, related, row), [], true),
      columns,
    };
  }
  const [criterion] = mutation.criteria;
  if (criterion === undefined) {
    throw ormError(
      'ORM.RELATION_MUTATION_INVALID',
      `connect() nested mutation for relation "${name}" requires criterion`,
      { meta: { kind: 'connect', relation: name, problem: 'missing-criterion' } },
    );
  }
  return { from: addFindAndAssert(t, related, name, 'connect', criterion, columns), columns };
}

function addChildOwned(
  t: Translation,
  model: Model,
  parent: NodeId,
  { name, relation, mutation }: ParsedRelationMutation,
): void {
  const { graph, context } = t;
  const { contract } = context;
  const related = relatedModel(contract, relation);
  const targetColumns = resolveRelationTargetColumns(contract, relation);
  const fromParent = pairs(
    contract,
    model.tables.root,
    localColumnsOf(contract, model, relation),
    related.tables.root,
    targetColumns,
  );
  if (mutation.kind === 'create') {
    const keys = [{ from: parent, columns: fromParent }];
    const rows = mutation.data.map((row) => parseCreateInput(t, related, row));
    if (rows.some((row) => row.relationMutations.length > 0)) {
      for (const row of rows) {
        addCreateWithRelations(t, related, row, keys);
      }
      return;
    }
    addChildInserts(
      t,
      related,
      rows.map((row) => row.scalarData),
      keys,
    );
    return;
  }
  if (mutation.kind === 'connect') {
    for (const criterion of mutation.criteria) {
      addUpdateRows(
        graph,
        context.contract,
        related.tables,
        {},
        {
          where: requiredCriterion(context, related, name, 'connect', criterion),
          filters: [],
          payloads: [{ from: parent, columns: fromParent }],
        },
      );
    }
    return;
  }
  const unlink = Object.fromEntries(targetColumns.map((column) => [column, null]));
  const criteria = mutation.criteria ?? [];
  const wheres =
    criteria.length === 0
      ? [undefined]
      : criteria.map((criterion) =>
          requiredCriterion(context, related, name, 'disconnect', criterion),
        );
  for (const where of wheres) {
    addUpdateRows(graph, context.contract, related.tables, unlink, {
      where,
      filters: [{ from: parent, columns: fromParent }],
      payloads: [],
    });
  }
}

function addJunctionOwned(
  t: Translation,
  model: Model,
  parent: NodeId,
  { name, relation, mutation }: JunctionRelationMutation,
): void {
  const { graph, context } = t;
  const { contract } = context;
  const { through } = relation;
  const related = relatedModel(contract, relation);
  const junction = createStatementTables({
    namespaceId: through.namespaceId,
    tableName: through.table,
  });
  const fromParent = pairs(
    contract,
    model.tables.root,
    localColumnsOf(contract, model, relation),
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
    const values = withCreateDefaults(context, through.namespaceId, through.table, {}, undefined);
    addInsertRows(graph, contract, junction.root, [values], {
      conflict,
      keys: [
        { from: parent, columns: fromParent },
        { from: target, columns: fromTarget },
      ],
      junction: { relation: name, junction: through.table },
    });
  };

  if (mutation.kind === 'create') {
    for (const row of mutation.data) {
      addLink(
        addCreateWithRelations(t, related, parseCreateInput(t, related, row), [], true),
        undefined,
      );
    }
    return;
  }
  if (mutation.kind === 'connect') {
    const conflict = linkKeyConflict(contract, relation);
    for (const criterion of mutation.criteria) {
      addLink(addFindAndAssert(t, related, name, 'connect', criterion, fromTarget), conflict);
    }
    return;
  }
  const criteria = mutation.criteria ?? [];
  if (criteria.length === 0) {
    throw ormError(
      'ORM.RELATION_MUTATION_INVALID',
      `disconnect() nested mutation for relation "${name}" requires criterion`,
      { meta: { kind: 'disconnect', relation: name, problem: 'missing-criterion' } },
    );
  }
  for (const criterion of criteria) {
    const target = addFindAndAssert(t, related, name, 'disconnect', criterion, fromTarget);
    addDeleteRows(graph, contract, junction, {
      where: undefined,
      filters: [
        { from: parent, columns: fromParent },
        { from: target, columns: fromTarget },
      ],
    });
  }
}

function addChildInserts(
  t: Translation,
  model: Model,
  rows: readonly Readonly<Record<string, unknown>>[],
  keys: readonly KeySource[],
): void {
  const values = rows.map((row) => createRowOf(t.context, model, undefined, row, undefined));
  if (t.readsBack) {
    for (const row of values) {
      writtenKeysOf(t, model, row, keys);
    }
  }
  addInsertRows(t.graph, t.context.contract, model.tables.root, values, {
    conflict: undefined,
    keys,
    junction: undefined,
  });
}

function addFindAndAssert(
  t: Translation,
  related: Model,
  name: string,
  kind: 'connect' | 'disconnect',
  criterion: Readonly<Record<string, unknown>>,
  columns: readonly ColumnPair[],
): NodeId {
  const { graph, context } = t;
  const where = requiredCriterion(context, related, name, kind, criterion);
  const find = graph.add(
    new Find(
      selectAstOf(
        context,
        related,
        { ...emptyState(related.tables), filters: [where], limit: 1 },
        'selection',
      ),
    ),
  );
  requireParentRow(t, find);
  const assert = graph.add(
    new Assert(
      ormError(
        'ORM.RELATION_ROW_MISSING',
        `${kind}() nested mutation for relation "${name}" did not find a matching row`,
        { meta: { kind, relation: name } },
      ),
    ),
  );
  graph.addRowsEdge(
    find,
    assert,
    'rows',
    columns.map(([source]) => [source, source]),
  );
  requireParentRow(t, assert);
  return find;
}

function requiredCriterion(
  context: ExecutionContext,
  model: Model,
  name: string,
  kind: 'connect' | 'disconnect',
  criterion: Readonly<Record<string, unknown>>,
) {
  const where = criterionWhere(context, model, criterion);
  if (where === undefined) {
    throw ormError(
      'ORM.RELATION_MUTATION_INVALID',
      `${kind}() nested mutation for relation "${name}" requires non-empty criterion`,
      { meta: { kind, relation: name, problem: 'empty-criterion' } },
    );
  }
  return where;
}

function requireParentRow(t: Translation, node: NodeId<{ requires: Requires[] }>): void {
  if (t.parentRow !== undefined) {
    t.graph.addRequiresEdge(t.parentRow, node);
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

function linkKeyConflict(
  contract: Contract<SqlStorage>,
  relation: JunctionRelation,
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

function relatedModel(contract: Contract<SqlStorage>, relation: ResolvedRelation): Model {
  return {
    namespaceId: relation.toNamespace,
    modelName: relation.to,
    tables: createStatementTables({
      namespaceId: relation.toNamespace,
      tableName: resolveModelTableName(contract, relation.toNamespace, relation.to),
    }),
  };
}

function localColumnsOf(
  contract: Contract<SqlStorage>,
  model: Model,
  relation: ResolvedRelation,
): string[] {
  return relation.on.localFields.map((field) =>
    columnOfContractField(contract, model.namespaceId, model.modelName, field),
  );
}

function parseCreateInput(
  t: Translation,
  model: Model,
  row: MutationCreateInput<Contract<SqlStorage>, string>,
): ParsedMutationInput {
  return parseMutationInput(t.context.contract, model.namespaceId, model.modelName, row);
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
