import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { ExecutionContext } from '@internal/sql-relational-core/query-lane-context';
import { blindCast, castAs } from '@internal/utils/casts';
import {
  columnOfContractField,
  type ResolvedRelation,
  resolveModelTableName,
  resolveRelationTargetColumns,
} from '../collection-contract';
import { createStatementTables } from '../collection-tables';
import { shorthandToWhereExpr } from '../filters';
import { type InsertConflictSkip, projectTableColumn } from '../mutation-statements';
import { ormError } from '../orm-errors';
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
import { Assert } from './assert';
import type { ColumnMapping, NodeId } from './edge';
import {
  addInsert,
  allColumns,
  type Builder,
  deleteRows,
  findRows,
  insertRows,
  type KeySource,
  type Model,
  type Returns,
  type Shape,
  selectAstOf,
  updateRows,
} from './model-statements';
import { Requires } from './requires';
import { Rows } from './rows';
import { createRowOf, withCreateDefaults } from './storage-rows';

type Mutation = RelationMutation<Contract<SqlStorage>, string>;
type CreateOrConnect = Exclude<Mutation, { kind: 'disconnect' }>;

export interface Translation extends Builder {
  readonly parentRow: NodeId | undefined;
}

export interface CreateOf {
  readonly keysFromParent: readonly KeySource[];
  readonly returns: Returns;
  readonly shape: Shape;
  readonly variantValue: string | undefined;
}

export interface BeforeWrite {
  readonly keys: readonly KeySource[];
  readonly nullColumns: Readonly<Record<string, null>>;
}

export function addCreateWithRelations(
  t: Translation,
  model: Model,
  parsed: ParsedMutationInput,
  { keysFromParent, returns, shape, variantValue }: CreateOf,
): NodeId {
  for (const relationMutation of parsed.relationMutations) {
    rejectDisconnect(relationMutation);
  }
  const before = addBeforeWrite(t, model, parsed.relationMutations);
  const row = createRowOf(t.context, model, variantValue, parsed.scalarData, undefined);
  return insertRows(t, model, [row], {
    conflict: undefined,
    keys: [...keysFromParent, ...before.keys],
    requires: keysFromParent.length === 0 ? parentRowRequired(t) : [],
    owner: { operation: 'create', modelName: model.modelName },
    returns,
    shape,
    afterWrite: (inserted) => addAfterWrite(t, model, inserted, parsed.relationMutations),
  });
}

function nestedCreate(
  t: Translation,
  model: Model,
  parsed: ParsedMutationInput,
  keysFromParent: readonly KeySource[],
  returns: Returns,
): NodeId {
  return addCreateWithRelations(t, model, parsed, {
    keysFromParent,
    returns,
    shape: allColumns,
    variantValue: undefined,
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
    for (const mutation of relationMutation.mutations) {
      if (mutation.kind === 'disconnect') {
        for (const column of localColumnsOf(t.context.contract, model, relationMutation.relation)) {
          nullColumns[column] = null;
        }
      } else {
        keys.push(addParentOwned(t, model, relationMutation, mutation));
      }
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
    for (const mutation of relationMutation.mutations) {
      addChildOwned(t, model, parent, relationMutation, mutation);
    }
  }
  for (const relationMutation of junctionOwned) {
    for (const mutation of relationMutation.mutations) {
      addJunctionOwned(t, model, parent, relationMutation, mutation);
    }
  }
}

function rejectDisconnect({ name, mutations }: ParsedRelationMutation): void {
  if (mutations.some(({ kind }) => kind === 'disconnect')) {
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
  const columns = columnMappings(
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
      from: nestedCreate(t, related, parseCreateInput(t, related, row), [], 'rows'),
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
  { name, relation }: ParsedRelationMutation,
  mutation: Mutation,
): void {
  const { context } = t;
  const { contract } = context;
  const related = relatedModel(contract, relation);
  const targetColumns = resolveRelationTargetColumns(contract, relation);
  const fromParent = columnMappings(
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
        nestedCreate(t, related, row, keys, 'count');
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
      updateRows(
        t,
        related,
        {},
        {
          where: requiredCriterion(context, related, name, 'connect', criterion),
          filters: [],
          payloads: [{ from: parent, columns: fromParent }],
          owner: { operation: 'update', modelName: related.modelName },
          returns: 'count',
          shape: allColumns,
          afterWrite: undefined,
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
    updateRows(t, related, unlink, {
      where,
      filters: [{ from: parent, columns: fromParent }],
      payloads: [],
      owner: { operation: 'update', modelName: related.modelName },
      returns: 'count',
      shape: allColumns,
      afterWrite: undefined,
    });
  }
}

function addJunctionOwned(
  t: Translation,
  model: Model,
  parent: NodeId,
  { name, relation }: JunctionRelationMutation,
  mutation: Mutation,
): void {
  const { context } = t;
  const { contract } = context;
  const { through } = relation;
  const related = relatedModel(contract, relation);
  const junction = createStatementTables({
    namespaceId: through.namespaceId,
    tableName: through.table,
  });
  const fromParent = columnMappings(
    contract,
    model.tables.root,
    localColumnsOf(contract, model, relation),
    junction.root,
    through.parentColumns,
  );
  const fromTarget = columnMappings(
    contract,
    related.tables.root,
    through.targetColumns,
    junction.root,
    through.childColumns,
  );
  const addLink = (target: NodeId, conflict: InsertConflictSkip | undefined) => {
    const values = withCreateDefaults(context, through.namespaceId, through.table, {}, undefined);
    addInsert(t, junction.root, [values], {
      conflict,
      keys: [
        { from: parent, columns: fromParent },
        { from: target, columns: fromTarget },
      ],
      junction: { relation: name, junction: through.table },
      requires: [],
      owner: { operation: 'create', modelName: model.modelName },
    });
  };

  if (mutation.kind === 'create') {
    for (const row of mutation.data) {
      addLink(nestedCreate(t, related, parseCreateInput(t, related, row), [], 'rows'), undefined);
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
    deleteRows(t, junction, {
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
  insertRows(t, model, values, {
    conflict: undefined,
    keys,
    requires: [],
    owner: { operation: 'create', modelName: model.modelName },
    returns: 'count',
    shape: allColumns,
    afterWrite: undefined,
  });
}

function addFindAndAssert(
  t: Translation,
  related: Model,
  name: string,
  kind: 'connect' | 'disconnect',
  criterion: Readonly<Record<string, unknown>>,
  columns: readonly ColumnMapping[],
): NodeId {
  const { graph, context } = t;
  const where = requiredCriterion(context, related, name, kind, criterion);
  const find = findRows(
    t,
    selectAstOf(
      context,
      related,
      { ...emptyState(related.tables), filters: [where], limit: 1 },
      'selection',
    ),
    { filter: [], requires: parentRowRequired(t) },
  );
  graph.add(
    new Assert(
      ormError(
        'ORM.RELATION_ROW_MISSING',
        `${kind}() nested mutation for relation "${name}" did not find a matching row`,
        { meta: { kind, relation: name } },
      ),
    ),
    {
      rows: new Rows(
        find,
        columns.map(([source]) => [source, source]),
      ),
      requires: parentRowRequired(t),
    },
  );
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

function parentRowRequired(t: Translation): Requires[] {
  return t.parentRow === undefined ? [] : [new Requires(t.parentRow)];
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

function columnMappings(
  contract: Contract<SqlStorage>,
  from: AliasedTable,
  fromColumns: readonly string[],
  to: AliasedTable,
  toColumns: readonly string[],
): ColumnMapping[] {
  return fromColumns.map((column, index) => [
    projectTableColumn(contract, from, column),
    projectTableColumn(
      contract,
      to,
      blindCast<
        string,
        'the contract validator and assertJunctionMetadataShape give both column lists of a relation one length'
      >(toColumns[index]),
    ),
  ]);
}
