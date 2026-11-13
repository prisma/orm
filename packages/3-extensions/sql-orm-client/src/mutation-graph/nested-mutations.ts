import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { ExecutionContext } from '@internal/sql-relational-core/query-lane-context';
import { blindCast, castAs } from '@internal/utils/casts';
import {
  assertInsertConflictSkipCapability,
  assertReturningCapability,
  columnOfContractField,
  type ResolvedRelation,
  resolveInsertConflictColumns,
  resolveModelTableName,
  resolveRelationTargetColumns,
} from '../collection-contract';
import type { DescribeCollectionRowsOptions } from '../collection-dispatch';
import {
  type CollectionTables,
  createStatementTables,
  requireVariantTable,
} from '../collection-tables';
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
  type RelatedCollection,
} from '../relation-mutations';
import { storageTableForContract } from '../storage-resolution';
import type { AliasedTable } from '../table-scope';
import type {
  MutationCreateInput,
  MutationUpdateInput,
  RelationMutation,
  RelationMutationCreate,
} from '../types';
import { emptyState } from '../types';
import { Assert } from './assert';
import { addDeleteAll, addUpdateAll, variantKeyMappings } from './collection-graphs';
import { conflictKeysOf, rowThatCannotConflict } from './conflict-keys';
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
  type Sources,
  selectAstOf,
  updateRows,
} from './model-statements';
import { Requires } from './requires';
import { Rows } from './rows';
import {
  createRowOf,
  type MtiCreateContext,
  modelOf,
  mtiCreateContextOf,
  updateValuesOf,
  variantCreateRowOf,
  withCreateDefaults,
} from './storage-rows';

type Mutation = RelationMutation<Contract<SqlStorage>, string>;
type CreateOrConnect = Extract<Mutation, { kind: 'create' | 'connect' }>;
type FilteredWrite = Extract<Mutation, { kind: 'updateAll' | 'deleteAll' }>;
type CreateMutation = Extract<Mutation, { kind: 'create' }>;

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
  createOf: CreateOf,
): NodeId {
  return insertWithRelations(t, model, parsed, createOf, undefined, undefined);
}

function insertWithRelations(
  t: Translation,
  model: Model,
  parsed: ParsedMutationInput,
  { keysFromParent, returns, shape, variantValue }: CreateOf,
  storageRow: Record<string, unknown> | undefined,
  conflict: InsertConflictSkip | undefined,
): NodeId {
  for (const relationMutation of parsed.relationMutations) {
    rejectUpdateOnly(relationMutation);
  }
  const before = addBeforeWrite(t, model, parsed.relationMutations);
  const row =
    storageRow ?? createRowOf(t.context, model, variantValue, parsed.scalarData, undefined);
  return insertRows(t, model, [row], {
    conflict,
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
  variantValue: string | undefined,
): NodeId {
  return addCreateWithRelations(t, model, parsed, {
    keysFromParent,
    returns,
    shape: allColumns,
    variantValue,
  });
}

interface OwnTableVariant {
  readonly collection: DescribeCollectionRowsOptions;
  readonly mti: MtiCreateContext;
  readonly variantTable: AliasedTable;
  readonly defaultValueCache: Map<string, unknown>;
}

function ownTableVariantOf(
  t: Translation,
  { relation, relatedCollection }: ParsedRelationMutation,
  mutation: CreateMutation,
): OwnTableVariant | undefined {
  if (mutation.variant === undefined) {
    return undefined;
  }
  const collection = {
    context: t.context,
    state: relatedCollection(relation).variant(mutation.variant).state,
    modelName: relation.to,
    namespaceId: relation.toNamespace,
  };
  const mti = mtiCreateContextOf(collection);
  if (mti === undefined) {
    return undefined;
  }
  assertReturningCapability(t.context.contract, 'create()');
  return {
    collection,
    mti,
    variantTable: requireVariantTable(collection.state.tables, mti.variant.value),
    defaultValueCache: new Map(),
  };
}

function addOwnTableVariantRow(
  t: Translation,
  { collection, mti, variantTable, defaultValueCache }: OwnTableVariant,
  relatedCollection: RelatedCollection,
  row: MutationCreateInput<Contract<SqlStorage>, string>,
  keysFromParent: readonly KeySource[],
): NodeId {
  const model = modelOf(collection);
  parseCreateInput(t, model, row, relatedCollection);
  const { root } = model.tables;
  const split = variantCreateRowOf(collection, mti, variantTable, row, defaultValueCache);
  const base = addInsert(t, root, [split.base], {
    conflict: undefined,
    keys: keysFromParent,
    junction: undefined,
    requires: keysFromParent.length === 0 ? parentRowRequired(t) : [],
    owner: { operation: 'create', modelName: model.modelName },
  });
  addInsert(t, variantTable, [split.variant], {
    conflict: undefined,
    keys: [{ from: base, columns: variantKeyMappings(t.context.contract, root, variantTable) }],
    junction: undefined,
    requires: [],
    owner: { operation: 'create', modelName: mti.variant.modelName },
  });
  return base;
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
  for (const relationMutation of relationMutations) {
    rejectFilteredWriteOnToOne(relationMutation);
  }
  for (const relationMutation of parentOwned) {
    for (const mutation of relationMutation.mutations) {
      if (isFilteredWrite(mutation)) {
        continue;
      }
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

function rejectUpdateOnly({ name, mutations }: ParsedRelationMutation): void {
  for (const { kind } of mutations) {
    if (kind === 'disconnect' || kind === 'updateAll' || kind === 'deleteAll') {
      throw ormError(
        'ORM.RELATION_MUTATION_UNSUPPORTED',
        `${kind}() is only supported in update() nested mutations`,
        { meta: { kind, relation: name } },
      );
    }
  }
}

function isFilteredWrite(mutation: Mutation): mutation is FilteredWrite {
  return mutation.kind === 'updateAll' || mutation.kind === 'deleteAll';
}

function rejectFilteredWriteOnToOne({ name, relation, mutations }: ParsedRelationMutation): void {
  const filtered = mutations.find(isFilteredWrite);
  if (
    filtered !== undefined &&
    (relation.cardinality === 'N:1' || relation.cardinality === '1:1')
  ) {
    throw ormError(
      'ORM.RELATION_MUTATION_UNSUPPORTED',
      `${filtered.kind}() nested mutation for relation "${name}" is only supported on to-many relations`,
      { meta: { kind: filtered.kind, relation: name, reason: 'to-one-relation' } },
    );
  }
}

function addParentOwned(
  t: Translation,
  model: Model,
  relationMutation: ParsedRelationMutation,
  mutation: CreateOrConnect,
): KeySource {
  const { name, relation, relatedCollection } = relationMutation;
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
    const variant = ownTableVariantOf(t, relationMutation, mutation);
    if (variant === undefined) {
      return {
        from: nestedCreate(
          t,
          related,
          parseCreateInput(t, related, row, relatedCollection),
          [],
          'rows',
          mutation.variant,
        ),
        columns,
      };
    }
    return { from: addOwnTableVariantRow(t, variant, relatedCollection, row, []), columns };
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
  relationMutation: ParsedRelationMutation,
  mutation: Mutation,
): void {
  const { name, relation, relatedCollection } = relationMutation;
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
  if (isFilteredWrite(mutation)) {
    addFilteredWrite(t, model, parent, name, relation, mutation);
    return;
  }
  if (mutation.kind === 'create') {
    const keys = [{ from: parent, columns: fromParent }];
    const variant = ownTableVariantOf(t, relationMutation, mutation);
    if (variant !== undefined) {
      for (const row of mutation.data) {
        addOwnTableVariantRow(t, variant, relatedCollection, row, keys);
      }
      return;
    }
    const variantValue = mutation.variant;
    const rows = mutation.data.map((row) => parseCreateInput(t, related, row, relatedCollection));
    const values = rows.map((row) =>
      createRowOf(context, related, variantValue, row.scalarData, undefined),
    );
    const conflict = conflictSkipOf(t, related, name, targetColumns, mutation, rows, values);
    if (rows.some((row) => row.relationMutations.length > 0)) {
      rows.forEach((row, index) => {
        insertWithRelations(
          t,
          related,
          row,
          { keysFromParent: keys, returns: 'count', shape: allColumns, variantValue },
          values[index],
          conflict,
        );
      });
      return;
    }
    insertRows(t, related, values, {
      conflict,
      keys,
      requires: [],
      owner: { operation: 'create', modelName: related.modelName },
      returns: 'count',
      shape: allColumns,
      afterWrite: undefined,
    });
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
          links: [],
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
      links: [],
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
  relationMutation: JunctionRelationMutation,
  mutation: Mutation,
): void {
  const { name, relation, relatedCollection } = relationMutation;
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
  if (isFilteredWrite(mutation)) {
    addFilteredWrite(t, model, parent, name, relation, mutation);
    return;
  }
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
    const variant = ownTableVariantOf(t, relationMutation, mutation);
    if (variant !== undefined) {
      for (const row of mutation.data) {
        addLink(addOwnTableVariantRow(t, variant, relatedCollection, row, []), undefined);
      }
      return;
    }
    const variantValue = mutation.variant;
    for (const row of mutation.data) {
      addLink(
        nestedCreate(
          t,
          related,
          parseCreateInput(t, related, row, relatedCollection),
          [],
          'rows',
          variantValue,
        ),
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
    deleteRows(t, junction, {
      where: undefined,
      filters: [
        { from: parent, columns: fromParent },
        { from: target, columns: fromTarget },
      ],
      links: [],
    });
  }
}

function addFilteredWrite(
  t: Translation,
  model: Model,
  parent: NodeId,
  name: string,
  relation: ResolvedRelation,
  mutation: FilteredWrite,
): void {
  const related = {
    context: t.context,
    state: mutation.state,
    modelName: relation.to,
    namespaceId: relation.toNamespace,
  };
  const sources = sourcesOf(t.context.contract, model, relation, related.state.tables, parent);
  if (mutation.kind === 'deleteAll') {
    addDeleteAll(t, related, sources);
    return;
  }
  const set = updateValuesOf(related, mutation.data);
  const linkFields = relation.through === undefined ? relation.on.targetFields : [];
  const linking = linkFields.filter((field) =>
    Object.hasOwn(
      set,
      columnOfContractField(t.context.contract, relation.toNamespace, relation.to, field),
    ),
  );
  if (linking.length > 0) {
    throw ormError(
      'ORM.RELATION_MUTATION_INVALID',
      `updateAll() nested mutation for relation "${name}" cannot set ${linking.map((field) => `"${field}"`).join(', ')}, which links the related rows to their parent`,
      {
        meta: { kind: 'updateAll', relation: name, problem: 'parent-link-column', fields: linking },
      },
    );
  }
  if (Object.keys(set).length > 0) {
    addUpdateAll(t, related, set, sources, 'count');
  }
}

function sourcesOf(
  contract: Contract<SqlStorage>,
  model: Model,
  relation: ResolvedRelation,
  { root, scope }: CollectionTables,
  parent: NodeId,
): Sources {
  const localColumns = localColumnsOf(contract, model, relation);
  const { through } = relation;
  if (through === undefined) {
    const columns = columnMappings(
      contract,
      model.tables.root,
      localColumns,
      root,
      resolveRelationTargetColumns(contract, relation),
    );
    return { filters: [{ from: parent, columns }], links: [] };
  }
  const links = scope.aliasTable({ namespaceId: through.namespaceId, tableName: through.table });
  return {
    filters: [],
    links: [
      {
        from: parent,
        columns: columnMappings(
          contract,
          model.tables.root,
          localColumns,
          links,
          through.parentColumns,
        ),
        junction: links.tableSource(contract),
        targets: columnMappings(contract, links, through.childColumns, root, through.targetColumns),
      },
    ],
  };
}

function columnsFilledBeforeWrite(
  contract: Contract<SqlStorage>,
  model: Model,
  relationMutations: readonly ParsedRelationMutation[],
): string[] {
  return partitionByOwnership(relationMutations).parentOwned.flatMap(({ relation, mutations }) =>
    mutations.some(({ kind }) => kind === 'create' || kind === 'connect')
      ? localColumnsOf(contract, model, relation)
      : [],
  );
}

function conflictSkipOf(
  t: Translation,
  model: Model,
  name: string,
  parentLinkColumns: readonly string[],
  { options }: RelationMutationCreate<Contract<SqlStorage>, string>,
  rows: readonly ParsedMutationInput[],
  values: readonly Readonly<Record<string, unknown>>[],
): InsertConflictSkip | undefined {
  if (options === undefined) {
    return undefined;
  }
  const { contract } = t.context;
  const conflictOn = options.conflictOn ?? [];
  assertInsertConflictSkipCapability(
    contract,
    `create() nested mutation for relation "${name}"`,
    conflictOn.length > 0,
  );
  const columns = resolveInsertConflictColumns(
    contract,
    model.namespaceId,
    model.modelName,
    conflictOn,
  );
  const { namespaceId, tableName } = model.tables.root.storage;
  const conflictKeys = conflictKeysOf(contract, namespaceId, tableName, 'skip', columns);
  const index = values.findIndex(
    (row, at) =>
      rowThatCannotConflict(
        [row],
        conflictKeys,
        new Set([
          ...parentLinkColumns,
          ...columnsFilledBeforeWrite(contract, model, rows[at]?.relationMutations ?? []),
        ]),
      ) !== undefined,
  );
  if (index !== -1) {
    throw ormError(
      'ORM.RELATION_MUTATION_INVALID',
      `create() nested mutation for relation "${name}" row ${index} gives no value for any conflict key: ${conflictKeys.map((key) => `(${key.join(', ')})`).join(', ')}`,
      {
        meta: {
          kind: 'create',
          relation: name,
          problem: 'row-cannot-conflict',
          index,
          conflictKeys,
        },
      },
    );
  }
  return { columns };
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
  relatedCollection: RelatedCollection,
): ParsedMutationInput {
  return parseMutationInput(
    t.context.contract,
    model.namespaceId,
    model.modelName,
    row,
    relatedCollection,
  );
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
