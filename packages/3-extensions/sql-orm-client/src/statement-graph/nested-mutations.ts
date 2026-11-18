import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { AnyExpression } from '@internal/sql-relational-core/ast';
import type { ExecutionContext } from '@internal/sql-relational-core/query-lane-context';
import { blindCast, castAs } from '@internal/utils/casts';
import {
  assertReturningCapability,
  columnOfContractField,
  modelOf as contractModelOf,
  type ResolvedRelation,
  resolveModelTableName,
  resolvePolymorphismInfo,
  resolveRelationTargetColumns,
} from '../collection-contract';
import {
  type CollectionTables,
  createCollectionTables,
  createStatementTables,
  requireVariantTable,
} from '../collection-tables';
import { shorthandToWhereExpr } from '../filters';
import {
  countMutationWhere,
  type InsertConflictSkip,
  projectTableColumn,
} from '../mutation-statements';
import { ormError } from '../orm-errors';
import {
  assertJunctionMetadataShape,
  assertJunctionPayloadWritable,
  hasThrough,
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
import type { MutationCreateInput, MutationUpdateInput, RelationMutation } from '../types';
import { type CollectionState, emptyState } from '../types';
import { Assert } from './assert';
import { addDeleteAll, addUpdateAll, createAllVariantGraph } from './collection-graphs';
import {
  type ConflictCall,
  type ResolvedConflict,
  requireRowsThatCanConflict,
  resolveConflict,
  type VariantInOwnTable,
  variantInOwnTableOf,
} from './conflict-keys';
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
  modelOf,
  mtiCreateContextOf,
  updateValuesOf,
  withCreateDefaults,
} from './storage-rows';

type Mutation = RelationMutation<Contract<SqlStorage>, string>;
type CreateOrConnect = Extract<Mutation, { kind: 'create' | 'connect' }>;
type FilteredWrite = Extract<Mutation, { kind: 'updateAll' | 'deleteAll' }>;

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

function addVariantInOwnTable(
  t: Translation,
  { relation, relatedCollection }: Pick<ParsedRelationMutation, 'relation' | 'relatedCollection'>,
  { data, variant }: Extract<Mutation, { kind: 'create' }>,
  keys: readonly KeySource[],
  added: (base: NodeId) => void,
): boolean {
  if (variant === undefined) {
    return false;
  }
  const collection = {
    context: t.context,
    state: relatedCollection(relation).variant(variant).state,
    modelName: relation.to,
    namespaceId: relation.toNamespace,
  };
  const mti = mtiCreateContextOf(collection);
  if (mti === undefined) {
    return false;
  }
  for (const row of data) {
    parseCreateInput(t, modelOf(collection), row, relatedCollection);
  }
  assertReturningCapability(t.context.contract, 'create()');
  createAllVariantGraph(
    collection,
    requireVariantTable(collection.state.tables, mti.variant.value),
    mti,
    data,
    { graph: t.graph, keys, requires: keys.length === 0 ? parentRowRequired(t) : [], added },
  );
  return true;
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
        rejectVariantDisconnect(relationMutation.name, mutation);
        for (const column of localColumnsOf(t.context.contract, model, relationMutation.relation)) {
          nullColumns[column] = null;
        }
      } else {
        keys.push(...addParentOwned(t, model, relationMutation, mutation));
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
        'ORM.OPERATION_UNSUPPORTED',
        `${kind}() is only supported in update() nested mutations`,
        { meta: { kind, relation: name } },
      );
    }
  }
}

function rejectVariantDisconnect(
  name: string,
  mutation: Extract<Mutation, { kind: 'disconnect' }>,
): void {
  if (mutation.state === undefined) {
    return;
  }
  throw ormError(
    'ORM.OPERATION_UNSUPPORTED',
    `disconnect() nested mutation for relation "${name}" is not available on a variant, because the parent holds the key of the related row`,
    { meta: { kind: 'disconnect', relation: name, reason: 'variant-parent-owned' } },
  );
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
      'ORM.OPERATION_UNSUPPORTED',
      `${filtered.kind}() nested mutation for relation "${name}" is only supported on to-many relations`,
      { meta: { kind: filtered.kind, relation: name, reason: 'to-one-relation' } },
    );
  }
}

function addParentOwned(
  t: Translation,
  model: Model,
  { name, relation, relatedCollection }: ParsedRelationMutation,
  mutation: CreateOrConnect,
): KeySource[] {
  const { contract } = t.context;
  const related = relatedModel(contract, relation, variantOf(mutation));
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
        'ORM.ARGUMENT_INVALID',
        `create() nested mutation for relation "${name}" requires data`,
        { meta: { kind: 'create', relation: name, problem: 'missing-data' } },
      );
    }
    nestedConflictOf(t, name, relation, mutation);
    const keys: KeySource[] = [];
    const added = (from: NodeId) => keys.push({ from, columns });
    if (
      addVariantInOwnTable(
        t,
        { relation, relatedCollection },
        { ...mutation, data: [row] },
        [],
        added,
      )
    ) {
      return keys;
    }
    return [
      {
        from: nestedCreate(
          t,
          related,
          parseCreateInput(t, related, row, relatedCollection),
          [],
          'rows',
          mutation.variant,
        ),
        columns,
      },
    ];
  }
  const [criterion] = mutation.criteria;
  if (criterion === undefined) {
    throw ormError(
      'ORM.ARGUMENT_INVALID',
      `connect() nested mutation for relation "${name}" requires criterion`,
      { meta: { kind: 'connect', relation: name, problem: 'missing-criterion' } },
    );
  }
  return [
    {
      from: addFindAndAssert(t, { name, relation }, mutation, criterion, columns),
      columns,
    },
  ];
}

function addChildOwned(
  t: Translation,
  model: Model,
  parent: NodeId,
  { name, relation, relatedCollection }: ParsedRelationMutation,
  mutation: Mutation,
): void {
  const { context } = t;
  const { contract } = context;
  const related = relatedModel(contract, relation, variantOf(mutation));
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
    const resolved = nestedConflictOf(t, name, relation, mutation);
    if (addVariantInOwnTable(t, { relation, relatedCollection }, mutation, keys, () => undefined)) {
      return;
    }
    const variantValue = mutation.variant;
    const rows = mutation.data.map((row) => parseCreateInput(t, related, row, relatedCollection));
    const values = rows.map((row) =>
      createRowOf(context, related, variantValue, row.scalarData, undefined),
    );
    const conflict = conflictSkipOf(t, related, name, targetColumns, resolved, rows, values);
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
          where: requiredCriterion(context, related, name, mutation, criterion),
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
      ? [variantWhere(contract, mutation.state, undefined)]
      : criteria.map((criterion) => requiredCriterion(context, related, name, mutation, criterion));
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
  { name, relation, relatedCollection }: JunctionRelationMutation,
  mutation: Mutation,
): void {
  const { context } = t;
  const { contract } = context;
  const { through } = relation;
  const related = relatedModel(contract, relation, variantOf(mutation));
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
    nestedConflictOf(t, name, relation, mutation);
    if (
      addVariantInOwnTable(t, { relation, relatedCollection }, mutation, [], (base) =>
        addLink(base, undefined),
      )
    ) {
      return;
    }
    for (const row of mutation.data) {
      addLink(
        nestedCreate(
          t,
          related,
          parseCreateInput(t, related, row, relatedCollection),
          [],
          'rows',
          mutation.variant,
        ),
        undefined,
      );
    }
    return;
  }
  if (mutation.kind === 'connect') {
    const conflict = linkKeyConflict(contract, relation);
    for (const criterion of mutation.criteria) {
      addLink(addFindAndAssert(t, { name, relation }, mutation, criterion, fromTarget), conflict);
    }
    return;
  }
  const criteria = mutation.criteria ?? [];
  if (criteria.length === 0) {
    throw ormError(
      'ORM.ARGUMENT_INVALID',
      `disconnect() nested mutation for relation "${name}" requires criterion`,
      { meta: { kind: 'disconnect', relation: name, problem: 'missing-criterion' } },
    );
  }
  for (const criterion of criteria) {
    const target = addFindAndAssert(t, { name, relation }, mutation, criterion, fromTarget);
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
      'ORM.ARGUMENT_INVALID',
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

function nestedCall(name: string, modelName: string): ConflictCall {
  return {
    action: `create() nested mutation for relation "${name}"`,
    modelName,
    meta: { kind: 'create', relation: name },
  };
}

function nestedConflictOf(
  t: Translation,
  name: string,
  relation: ResolvedRelation,
  { options, variant }: Extract<Mutation, { kind: 'create' }>,
): ResolvedConflict | undefined {
  if (options === undefined) {
    return undefined;
  }
  const { contract } = t.context;
  const resolved = resolveConflict(
    contract,
    nestedCall(name, relation.to),
    relation.toNamespace,
    options,
    variantTargetOf(contract, relation, variant),
  );
  const reason = hasThrough(relation)
    ? 'many-to-many-relation'
    : relation.cardinality === 'N:1' || relation.cardinality === '1:1'
      ? 'to-one-relation'
      : undefined;
  if (reason !== undefined) {
    throw ormError(
      'ORM.OPERATION_UNSUPPORTED',
      `create() nested mutation for relation "${name}" supports onConflict "skip" only on one-to-many relations`,
      { meta: { kind: 'create', relation: name, reason } },
    );
  }
  return resolved;
}

function variantTargetOf(
  contract: Contract<SqlStorage>,
  relation: ResolvedRelation,
  variantValue: string | undefined,
): VariantInOwnTable | undefined {
  if (variantValue !== undefined) {
    return variantInOwnTableOf(contract, relation.toNamespace, relation.to, variantValue);
  }
  const base = contractModelOf(contract, relation.toNamespace, relation.to)?.base;
  if (base === undefined) {
    return undefined;
  }
  const value = [
    ...(resolvePolymorphismInfo(contract, base.namespace, base.model)?.variants.values() ?? []),
  ].find(
    (variant) => variant.modelName === relation.to && variant.namespaceId === relation.toNamespace,
  )?.value;
  return variantInOwnTableOf(contract, base.namespace, base.model, value);
}

function conflictSkipOf(
  t: Translation,
  model: Model,
  name: string,
  parentLinkColumns: readonly string[],
  resolved: ResolvedConflict | undefined,
  rows: readonly ParsedMutationInput[],
  values: readonly Readonly<Record<string, unknown>>[],
): InsertConflictSkip | undefined {
  if (resolved === undefined) {
    return undefined;
  }
  const { contract } = t.context;
  requireRowsThatCanConflict(
    contract,
    nestedCall(name, model.modelName),
    model.tables.root.storage,
    resolved,
    values,
    (at) => [
      ...parentLinkColumns,
      ...columnsFilledBeforeWrite(contract, model, rows[at]?.relationMutations ?? []),
    ],
  );
  return { columns: resolved.columns };
}

function addFindAndAssert(
  t: Translation,
  { name, relation }: Pick<ParsedRelationMutation, 'name' | 'relation'>,
  mutation: Extract<Mutation, { kind: 'connect' | 'disconnect' }>,
  criterion: Readonly<Record<string, unknown>>,
  columns: readonly ColumnMapping[],
): NodeId {
  const { graph, context } = t;
  const { kind } = mutation;
  const related = relatedModel(context.contract, relation, mutation.state);
  const where = requiredCriterion(context, related, name, mutation, criterion);
  const withVariants =
    mutation.state === undefined
      ? {
          ...related,
          tables: createCollectionTables(context.contract, related.namespaceId, related.modelName),
        }
      : related;
  const find = findRows(
    t,
    selectAstOf(
      context,
      withVariants,
      { ...emptyState(withVariants.tables), filters: [where], limit: 1 },
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
  { kind, state: variant }: Extract<Mutation, { kind: 'connect' | 'disconnect' }>,
  criterion: Readonly<Record<string, unknown>>,
): AnyExpression {
  const where = criterionWhere(context, model, criterion);
  if (where === undefined) {
    throw ormError(
      'ORM.ARGUMENT_INVALID',
      `${kind}() nested mutation for relation "${name}" requires non-empty criterion`,
      { meta: { kind, relation: name, problem: 'empty-criterion' } },
    );
  }
  return variantWhere(context.contract, variant, where) ?? where;
}

function variantOf(mutation: Mutation): CollectionState | undefined {
  return mutation.kind === 'connect' || mutation.kind === 'disconnect' ? mutation.state : undefined;
}

function variantWhere(
  contract: Contract<SqlStorage>,
  variant: CollectionState | undefined,
  where: AnyExpression | undefined,
): AnyExpression | undefined {
  if (variant === undefined) {
    return where;
  }
  const { tables, filters, variantValue } = variant;
  return countMutationWhere(
    contract,
    tables,
    where === undefined ? filters : [...filters, where],
    variantValue,
  );
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

function relatedModel(
  contract: Contract<SqlStorage>,
  relation: ResolvedRelation,
  variant: CollectionState | undefined,
): Model {
  if (variant !== undefined) {
    return { namespaceId: relation.toNamespace, modelName: relation.to, tables: variant.tables };
  }
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
