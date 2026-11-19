import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import {
  type AnyExpression,
  BinaryExpr,
  ListExpression,
  SelectAst,
  SubqueryExpr,
} from '@internal/sql-relational-core/ast';
import type { ExecutionContext } from '@internal/sql-relational-core/query-lane-context';
import { blindCast, castAs } from '@internal/utils/casts';
import {
  assertReturningCapability,
  columnOfContractField,
  modelOf as contractModelOf,
  getModelFields,
  hasContractCapability,
  isToOneCardinality,
  type ResolvedRelation,
  resolveModelTableName,
  resolvePolymorphismInfo,
  resolveRelationTargetColumns,
  resolveRowIdentityColumns,
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
  type InsertConflict,
  type InsertConflictSkip,
  projectTableColumn,
  projectTableColumns,
  type VariantGuard,
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
import {
  addDeleteAll,
  addDeleteFirst,
  addUpdateAll,
  addUpdateFirst,
  createAllVariantGraph,
  requireOnlyCollidingKey,
  sameRowColumnsOf,
} from './collection-graphs';
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
  type KeyFilter,
  type KeyFilters,
  type Model,
  type Returns,
  type Shape,
  selectAstOf,
  updateRows,
} from './model-statements';
import { Requires } from './requires';
import { Rows } from './rows';
import {
  createRowOf,
  modelOf,
  mtiCreateContextOf,
  updateDefaultsOf,
  updateValuesOf,
  withCreateDefaults,
} from './storage-rows';

type Mutation = RelationMutation<Contract<SqlStorage>, string>;
type CreateOrConnect = Extract<Mutation, { kind: 'create' | 'connect' }>;
type FilteredWrite = Extract<Mutation, { kind: 'updateAll' | 'deleteAll' | 'update' | 'delete' }>;
type SingleRowWrite = Extract<Mutation, { kind: 'update' | 'delete' }>;

export interface ParentRow {
  readonly rowBeforeWrite: NodeId | undefined;
  readonly setValues: Readonly<Record<string, unknown>>;
}

export interface ParentWrite extends ParentRow {
  readonly node: NodeId;
}

export interface CreateOf {
  readonly keysFromParent: readonly KeyFilter[];
  readonly returns: Returns;
  readonly shape: Shape;
  readonly variantValue: string | undefined;
}

interface NestedConflict {
  readonly conflict: InsertConflict;
  readonly relation: string;
}

export interface BeforeWrite {
  readonly keys: readonly KeyFilter[];
  readonly nullColumns: Readonly<Record<string, null>>;
  readonly unlinksAfterWrite: boolean;
}

export function addCreateWithRelations(
  b: Builder,
  model: Model,
  parent: ParentRow,
  parsed: ParsedMutationInput,
  createOf: CreateOf,
): NodeId {
  return insertWithRelations(b, model, parent, parsed, createOf, undefined, undefined);
}

function insertWithRelations(
  b: Builder,
  model: Model,
  parent: ParentRow,
  parsed: ParsedMutationInput,
  { keysFromParent, returns, shape, variantValue }: CreateOf,
  storageRow: Record<string, unknown> | undefined,
  nested: NestedConflict | undefined,
): NodeId {
  for (const relationMutation of parsed.relationMutations) {
    rejectUpdateOnly(relationMutation);
  }
  const before = addBeforeWrite(b, model, parent, parsed.relationMutations);
  const row =
    storageRow ?? createRowOf(b.context, model, variantValue, parsed.scalarData, undefined);
  return insertRows(b, model, [row], {
    conflict: nested?.conflict,
    keys: [...keysFromParent, ...before.keys],
    requires: keysFromParent.length === 0 ? parentRowRequired(parent) : [],
    owner: { operation: 'create', modelName: model.modelName },
    returns,
    shape,
    afterWrite: afterWriteOf(b, model, parent, parsed.relationMutations, nested),
  });
}

function afterWriteOf(
  b: Builder,
  model: Model,
  parent: ParentRow,
  relationMutations: readonly ParsedRelationMutation[],
  nested: NestedConflict | undefined,
): ((written: NodeId) => void) | undefined {
  const { childOwned, junctionOwned } = partitionByOwnership(relationMutations);
  const readsRow = childOwned.length > 0 || junctionOwned.length > 0;
  const guard =
    nested !== undefined && 'link' in nested.conflict ? nested.conflict.guard : undefined;
  if (!readsRow && guard === undefined) {
    return undefined;
  }
  return (written) => {
    if (guard !== undefined && nested !== undefined) {
      addVariantCheck(b, model, written, nested.relation, guard);
    }
    if (readsRow) {
      addAfterWrite(b, model, { ...parent, node: written }, relationMutations);
    }
  };
}

function addVariantCheck(
  { graph, context }: Builder,
  model: Model,
  written: NodeId,
  relation: string,
  { column, value }: VariantGuard,
): void {
  const discriminator = projectTableColumn(context.contract, model.tables.root, column);
  graph.add(
    new Assert(
      ormError(
        'ORM.RELATION_ROW_MISSING',
        `create() nested mutation for relation "${relation}" found a row of another variant than "${value}" on its conflict key`,
        { meta: { kind: 'create', relation, variant: value } },
      ),
      { [column]: value },
    ),
    { rows: new Rows(written, [[discriminator, discriminator]]), requires: [] },
  );
}

function addLinkedCreates(
  b: Builder,
  related: Model,
  parent: ParentRow,
  name: string,
  relatedCollection: RelatedCollection,
  mutation: Extract<Mutation, { kind: 'create' }>,
  resolved: ResolvedConflict | undefined,
  data: readonly MutationCreateInput<Contract<SqlStorage>, string>[],
  link: (created: NodeId) => void,
): void {
  const rows = data.map((row) => parseCreateInput(b, related, row, relatedCollection));
  const values = rows.map((row) =>
    createRowOf(b.context, related, mutation.variant, row.scalarData, undefined),
  );
  const nested = conflictOf(b, related, name, [], resolved, rows, values, mutation.variant);
  rows.forEach((row, index) => {
    link(
      insertWithRelations(
        b,
        related,
        parent,
        row,
        { keysFromParent: [], returns: 'rows', shape: allColumns, variantValue: mutation.variant },
        values[index],
        nested,
      ),
    );
  });
}

function addVariantInOwnTable(
  b: Builder,
  parent: ParentRow,
  { relation, relatedCollection }: Pick<ParsedRelationMutation, 'relation' | 'relatedCollection'>,
  { data, variant }: Extract<Mutation, { kind: 'create' }>,
  keys: readonly KeyFilter[],
  added: (base: NodeId) => void,
): boolean {
  if (variant === undefined) {
    return false;
  }
  const collection = {
    context: b.context,
    state: relatedCollection(relation).variant(variant).state,
    modelName: relation.to,
    namespaceId: relation.toNamespace,
  };
  const mti = mtiCreateContextOf(collection);
  if (mti === undefined) {
    return false;
  }
  for (const row of data) {
    parseCreateInput(b, modelOf(collection), row, relatedCollection);
  }
  assertReturningCapability(b.context.contract, 'create()');
  createAllVariantGraph(
    collection,
    requireVariantTable(collection.state.tables, mti.variant.value),
    mti,
    data,
    { graph: b.graph, keys, requires: keys.length === 0 ? parentRowRequired(parent) : [], added },
  );
  return true;
}

export function addBeforeWrite(
  b: Builder,
  model: Model,
  parent: ParentRow,
  relationMutations: readonly ParsedRelationMutation[],
): BeforeWrite {
  const { parentOwned, junctionOwned } = partitionByOwnership(relationMutations);
  for (const relationMutation of junctionOwned) {
    assertJunctionMetadataShape(relationMutation);
    assertJunctionPayloadWritable(relationMutation);
  }
  const keys: KeyFilter[] = [];
  const nullColumns: Record<string, null> = {};
  let unlinksAfterWrite = false;
  for (const relationMutation of relationMutations) {
    rejectFilteredWriteOnToOne(relationMutation);
    rejectSingleRowWrite(relationMutation);
  }
  for (const relationMutation of parentOwned) {
    for (const mutation of relationMutation.mutations) {
      if (mutation.kind === 'delete') {
        rejectNullOnRequiredKey(
          b.context.contract,
          mutation.kind,
          relationMutation.name,
          model,
          relationMutation.relation.on.localFields,
        );
        unlinksAfterWrite = true;
        continue;
      }
      if (isFilteredWrite(mutation)) {
        continue;
      }
      if (mutation.kind === 'disconnect') {
        rejectNullOnRequiredKey(
          b.context.contract,
          mutation.kind,
          relationMutation.name,
          model,
          relationMutation.relation.on.localFields,
        );
        if (disconnectsNothing(mutation)) {
          continue;
        }
        if (isConditionalUnlink(mutation)) {
          unlinksAfterWrite = true;
          continue;
        }
        for (const column of localColumnsOf(b.context.contract, model, relationMutation.relation)) {
          nullColumns[column] = null;
        }
      } else {
        keys.push(...addParentOwned(b, model, parent, relationMutation, mutation));
      }
    }
  }
  return { keys, nullColumns, unlinksAfterWrite };
}

export function addAfterWrite(
  b: Builder,
  model: Model,
  parent: ParentWrite,
  relationMutations: readonly ParsedRelationMutation[],
): void {
  const { parentOwned, childOwned, junctionOwned } = partitionByOwnership(relationMutations);
  for (const relationMutation of parentOwned) {
    for (const mutation of relationMutation.mutations) {
      if (
        mutation.kind === 'disconnect' &&
        !disconnectsNothing(mutation) &&
        isConditionalUnlink(mutation)
      ) {
        addConditionalUnlink(b, model, parent, relationMutation, mutation);
      } else if (mutation.kind === 'update' || mutation.kind === 'delete') {
        addLinkedRowWrite(b, model, parent, relationMutation, mutation);
      }
    }
  }
  for (const relationMutation of childOwned) {
    for (const mutation of relationMutation.mutations) {
      addChildOwned(b, model, parent, relationMutation, mutation);
    }
  }
  for (const relationMutation of junctionOwned) {
    for (const mutation of relationMutation.mutations) {
      addJunctionOwned(b, model, parent, relationMutation, mutation);
    }
  }
}

function rejectUpdateOnly({ name, mutations }: ParsedRelationMutation): void {
  for (const { kind } of mutations) {
    if (kind !== 'create' && kind !== 'connect') {
      throw ormError(
        'ORM.OPERATION_UNSUPPORTED',
        `${kind}() is only supported in update() nested mutations`,
        { meta: { kind, relation: name } },
      );
    }
  }
}

function isConditionalUnlink(mutation: Extract<Mutation, { kind: 'disconnect' }>): boolean {
  return mutation.state !== undefined || mutation.criteria !== undefined;
}

function disconnectsNothing(mutation: Extract<Mutation, { kind: 'disconnect' }>): boolean {
  return mutation.criteria !== undefined && mutation.criteria.length === 0;
}

function addConditionalUnlink(
  b: Builder,
  model: Model,
  parent: ParentWrite,
  { name, relation }: ParsedRelationMutation,
  mutation: Extract<Mutation, { kind: 'disconnect' }>,
): void {
  const { context } = b;
  const { contract } = context;
  const related = relatedModel(contract, relation, mutation.state);
  const localColumns = localColumnsOf(contract, model, relation);
  const keys = projectTableColumns(contract, model.tables.root, localColumns).map(
    ({ expr }) => expr,
  );
  const [only, ...others] = keys;
  const linked = only !== undefined && others.length === 0 ? only : ListExpression.of(keys);
  const targets = projectTableColumns(
    contract,
    related.tables.root,
    resolveRelationTargetColumns(contract, relation),
  );
  const { criteria } = mutation;
  const wheres =
    criteria === undefined
      ? [variantWhere(contract, mutation.state, undefined)]
      : criteria.map((criterion) => requiredCriterion(context, related, name, mutation, criterion));
  const nulls = Object.fromEntries(localColumns.map((column) => [column, null]));
  const unlink = {
    ...nulls,
    ...updateDefaultsOf(context, model, { ...parent.setValues, ...nulls }),
  };
  for (const where of wheres) {
    const target = SelectAst.from(related.tables.root.tableSource(contract)).withProjection(
      targets,
    );
    updateRows(b, model, unlink, {
      where: BinaryExpr.in(
        linked,
        SubqueryExpr.of(where === undefined ? target : target.withWhere(where)),
      ),
      filters: [{ from: parent.node, columns: sameRowColumnsOf(contract, model.tables.root) }],
      links: [],
      payloads: [],
      owner: { operation: 'update', modelName: model.modelName },
      returns: 'count',
      shape: allColumns,
      afterWrite: undefined,
    });
  }
}

export function rejectNullOnRequiredKey(
  contract: Contract<SqlStorage>,
  kind: Mutation['kind'],
  name: string,
  holder: Pick<Model, 'namespaceId' | 'modelName'>,
  keyFields: readonly string[],
): void {
  const fields = getModelFields(contract, holder.namespaceId, holder.modelName);
  const required = keyFields.filter((field) => {
    const column = Object.hasOwn(fields, field) ? fields[field] : undefined;
    return (
      column !== undefined &&
      storageTableForContract(contract, column.namespaceId, column.table).columns[column.column]
        ?.nullable === false
    );
  });
  if (required.length === 0) {
    return;
  }
  throw ormError(
    'ORM.OPERATION_UNSUPPORTED',
    `${kind}() nested mutation for relation "${name}" cannot set ${required.map((field) => `"${field}"`).join(', ')} of model "${holder.modelName}" to null, because the foreign key is required`,
    {
      meta: {
        kind,
        relation: name,
        reason: 'required-foreign-key',
        model: holder.modelName,
        fields: required,
      },
    },
  );
}

function isFilteredWrite(mutation: Mutation): mutation is FilteredWrite {
  return (
    mutation.kind === 'updateAll' ||
    mutation.kind === 'deleteAll' ||
    mutation.kind === 'update' ||
    mutation.kind === 'delete'
  );
}

function isSingleRowWrite(mutation: Mutation): mutation is SingleRowWrite {
  return mutation.kind === 'update' || mutation.kind === 'delete';
}

function rejectSingleRowWrite({
  name,
  relation,
  relatedCollection,
  mutations,
}: ParsedRelationMutation): void {
  for (const mutation of mutations.filter(isSingleRowWrite)) {
    const { kind } = mutation;
    const { filters, variantValue } = mutation.state;
    const related = relatedCollection(relation);
    const unfiltered = variantValue === undefined ? related : related.variant(variantValue);
    if (
      !isToOneCardinality(relation.cardinality) &&
      filters.length <= unfiltered.state.filters.length
    ) {
      throw ormError(
        'ORM.ARGUMENT_INVALID',
        `${kind}() nested mutation for relation "${name}" requires where() on a to-many relation`,
        { meta: { kind, relation: name, problem: 'missing-where' } },
      );
    }
  }
}

function addLinkedRowWrite(
  b: Builder,
  model: Model,
  parent: ParentWrite,
  { relation }: ParsedRelationMutation,
  mutation: SingleRowWrite,
): void {
  const { context } = b;
  const { contract } = context;
  const related = {
    context,
    state: mutation.state,
    modelName: relation.to,
    namespaceId: relation.toNamespace,
  };
  const localColumns = localColumnsOf(contract, model, relation);
  const targetColumns = resolveRelationTargetColumns(contract, relation);
  const target = mutation.state.tables.root;
  if (mutation.kind === 'delete') {
    addDeleteFirst(
      b,
      related,
      throughUpdatedParent(contract, model, parent, relation, mutation.state.tables),
      (found) => {
        const nulls = Object.fromEntries(localColumns.map((column) => [column, null]));
        updateRows(
          b,
          model,
          { ...nulls, ...updateDefaultsOf(context, model, { ...parent.setValues, ...nulls }) },
          {
            where: undefined,
            filters: [
              { from: parent.node, columns: sameRowColumnsOf(contract, model.tables.root) },
              {
                from: found,
                columns: columnMappings(
                  contract,
                  target,
                  targetColumns,
                  model.tables.root,
                  localColumns,
                ),
              },
            ],
            links: [],
            payloads: [],
            owner: { operation: 'update', modelName: model.modelName },
            returns: 'count',
            shape: allColumns,
            afterWrite: undefined,
          },
        );
      },
    );
    return;
  }
  const set = updateValuesOf(related, mutation.data);
  if (Object.keys(set).length > 0) {
    addUpdateFirst(
      b,
      related,
      set,
      throughUpdatedParent(contract, model, parent, relation, mutation.state.tables),
    );
  }
}

function throughUpdatedParent(
  contract: Contract<SqlStorage>,
  model: Model,
  parent: ParentWrite,
  relation: ResolvedRelation,
  { root, scope }: CollectionTables,
): KeyFilters {
  const parentTable = model.tables.root;
  const { namespaceId, tableName } = parentTable.storage;
  const keyColumns = resolveRowIdentityColumns(contract, namespaceId, tableName);
  const updated = scope.aliasTable({ namespaceId, tableName });
  return {
    filters: [],
    links: [
      {
        from: parent.node,
        columns: columnMappings(contract, parentTable, keyColumns, updated, keyColumns),
        junction: updated.tableSource(contract),
        targets: columnMappings(
          contract,
          updated,
          localColumnsOf(contract, model, relation),
          root,
          resolveRelationTargetColumns(contract, relation),
        ),
      },
    ],
  };
}

function rejectFilteredWriteOnToOne({ name, relation, mutations }: ParsedRelationMutation): void {
  const filtered = mutations.find(
    (mutation) => mutation.kind === 'updateAll' || mutation.kind === 'deleteAll',
  );
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
  b: Builder,
  model: Model,
  parent: ParentRow,
  { name, relation, relatedCollection }: ParsedRelationMutation,
  mutation: CreateOrConnect,
): KeyFilter[] {
  const { contract } = b.context;
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
    const resolved = nestedConflictOf(b, name, relation, mutation);
    const keys: KeyFilter[] = [];
    const added = (from: NodeId) => keys.push({ from, columns });
    if (
      addVariantInOwnTable(
        b,
        parent,
        { relation, relatedCollection },
        { ...mutation, data: [row] },
        [],
        added,
      )
    ) {
      return keys;
    }
    addLinkedCreates(b, related, parent, name, relatedCollection, mutation, resolved, [row], added);
    return keys;
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
      from: addFindAndAssert(b, parent, { name, relation }, mutation, criterion, columns),
      columns,
    },
  ];
}

function addChildOwned(
  b: Builder,
  model: Model,
  parent: ParentWrite,
  { name, relation, relatedCollection }: ParsedRelationMutation,
  mutation: Mutation,
): void {
  const { context } = b;
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
    addFilteredWrite(b, model, parent, name, relation, mutation);
    return;
  }
  if (mutation.kind === 'create') {
    const keys = [{ from: parent.node, columns: fromParent }];
    const resolved = nestedConflictOf(b, name, relation, mutation);
    if (
      addVariantInOwnTable(
        b,
        parent,
        { relation, relatedCollection },
        mutation,
        keys,
        () => undefined,
      )
    ) {
      return;
    }
    const variantValue = mutation.variant;
    const rows = mutation.data.map((row) => parseCreateInput(b, related, row, relatedCollection));
    const values = rows.map((row) =>
      createRowOf(context, related, variantValue, row.scalarData, undefined),
    );
    const nested = conflictOf(
      b,
      related,
      name,
      targetColumns,
      resolved,
      rows,
      values,
      variantValue,
    );
    if (
      (nested !== undefined && 'link' in nested.conflict) ||
      rows.some((row) => row.relationMutations.length > 0)
    ) {
      rows.forEach((row, index) => {
        insertWithRelations(
          b,
          related,
          parent,
          row,
          { keysFromParent: keys, returns: 'count', shape: allColumns, variantValue },
          values[index],
          nested,
        );
      });
      return;
    }
    insertRows(b, related, values, {
      conflict: nested?.conflict,
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
        b,
        related,
        {},
        {
          where: requiredCriterion(context, related, name, mutation, criterion),
          filters: [],
          links: [],
          payloads: [{ from: parent.node, columns: fromParent }],
          owner: { operation: 'update', modelName: related.modelName },
          returns: 'count',
          shape: allColumns,
          afterWrite: undefined,
        },
      );
    }
    return;
  }
  rejectNullOnRequiredKey(
    contract,
    mutation.kind,
    name,
    { namespaceId: relation.toNamespace, modelName: relation.to },
    relation.on.targetFields,
  );
  const unlink = Object.fromEntries(targetColumns.map((column) => [column, null]));
  const { criteria } = mutation;
  const wheres =
    criteria === undefined
      ? [variantWhere(contract, mutation.state, undefined)]
      : criteria.map((criterion) => requiredCriterion(context, related, name, mutation, criterion));
  for (const where of wheres) {
    updateRows(b, related, unlink, {
      where,
      filters: [{ from: parent.node, columns: fromParent }],
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
  b: Builder,
  model: Model,
  parent: ParentWrite,
  { name, relation, relatedCollection }: JunctionRelationMutation,
  mutation: Mutation,
): void {
  const { context } = b;
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
    addFilteredWrite(b, model, parent, name, relation, mutation);
    return;
  }
  const addLink = (target: NodeId, conflict: InsertConflictSkip | undefined) => {
    const values = withCreateDefaults(context, through.namespaceId, through.table, {}, undefined);
    addInsert(b, junction.root, [values], {
      conflict,
      keys: [
        { from: parent.node, columns: fromParent },
        { from: target, columns: fromTarget },
      ],
      junction: { relation: name, junction: through.table },
      requires: [],
      owner: { operation: 'create', modelName: model.modelName },
    });
  };

  if (mutation.kind === 'create') {
    const resolved = nestedConflictOf(b, name, relation, mutation);
    if (
      addVariantInOwnTable(b, parent, { relation, relatedCollection }, mutation, [], (base) =>
        addLink(base, undefined),
      )
    ) {
      return;
    }
    const conflict = resolved === undefined ? undefined : linkKeyConflict(contract, relation);
    addLinkedCreates(
      b,
      related,
      parent,
      name,
      relatedCollection,
      mutation,
      resolved,
      mutation.data,
      (created) => addLink(created, conflict),
    );
    return;
  }
  if (mutation.kind === 'connect') {
    const conflict = linkKeyConflict(contract, relation);
    for (const criterion of mutation.criteria) {
      addLink(
        addFindAndAssert(b, parent, { name, relation }, mutation, criterion, fromTarget),
        conflict,
      );
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
    const target = addFindAndAssert(b, parent, { name, relation }, mutation, criterion, fromTarget);
    deleteRows(b, junction, {
      where: undefined,
      filters: [
        { from: parent.node, columns: fromParent },
        { from: target, columns: fromTarget },
      ],
      links: [],
    });
  }
}

function addFilteredWrite(
  b: Builder,
  model: Model,
  parent: ParentWrite,
  name: string,
  relation: ResolvedRelation,
  mutation: FilteredWrite,
): void {
  const related = {
    context: b.context,
    state: mutation.state,
    modelName: relation.to,
    namespaceId: relation.toNamespace,
  };
  const keyFilters = keyFiltersOf(
    b.context.contract,
    model,
    relation,
    related.state.tables,
    parent.node,
  );
  if (mutation.kind === 'deleteAll') {
    addDeleteAll(b, related, keyFilters);
    return;
  }
  if (mutation.kind === 'delete') {
    addDeleteFirst(b, related, keyFilters);
    return;
  }
  const set = updateValuesOf(related, mutation.data);
  const linkFields = relation.through === undefined ? relation.on.targetFields : [];
  const linking = linkFields.filter((field) =>
    Object.hasOwn(
      set,
      columnOfContractField(b.context.contract, relation.toNamespace, relation.to, field),
    ),
  );
  if (linking.length > 0) {
    throw ormError(
      'ORM.ARGUMENT_INVALID',
      `${mutation.kind}() nested mutation for relation "${name}" cannot set ${linking.map((field) => `"${field}"`).join(', ')}, which links the related rows to their parent`,
      {
        meta: {
          kind: mutation.kind,
          relation: name,
          problem: 'parent-link-column',
          fields: linking,
        },
      },
    );
  }
  if (Object.keys(set).length === 0) {
    return;
  }
  if (mutation.kind === 'update') {
    addUpdateFirst(b, related, set, keyFilters);
    return;
  }
  addUpdateAll(b, related, set, keyFilters, 'count');
}

function keyFiltersOf(
  contract: Contract<SqlStorage>,
  model: Model,
  relation: ResolvedRelation,
  { root, scope }: CollectionTables,
  parent: NodeId,
): KeyFilters {
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

function rejectParentHeldInConflictRow(
  name: string,
  onConflict: ResolvedConflict['onConflict'],
  { relationMutations }: ParsedMutationInput,
): void {
  for (const { name: nested, mutations } of partitionByOwnership(relationMutations).parentOwned) {
    const mutation = mutations.find(({ kind }) => kind === 'create' || kind === 'connect');
    if (mutation === undefined) {
      continue;
    }
    throw ormError(
      'ORM.OPERATION_UNSUPPORTED',
      `create() nested mutation for relation "${name}" cannot take a callback on relation "${nested}" in a row with onConflict "${onConflict}", because the foreign key of "${nested}" is on the row and the callback would write before the database decides whether the row conflicts`,
      {
        meta: {
          kind: 'create',
          relation: name,
          reason: 'parent-held-relation-in-conflict-row',
          nestedRelation: nested,
          nestedKind: mutation.kind,
        },
      },
    );
  }
}

function nestedCall(name: string, modelName: string): ConflictCall {
  return {
    action: `create() nested mutation for relation "${name}"`,
    modelName,
    meta: { kind: 'create', relation: name },
  };
}

function nestedConflictOf(
  b: Builder,
  name: string,
  relation: ResolvedRelation,
  { options, variant }: Extract<Mutation, { kind: 'create' }>,
): ResolvedConflict | undefined {
  if (options === undefined) {
    return undefined;
  }
  const { contract } = b.context;
  const resolved = resolveConflict(
    contract,
    nestedCall(name, relation.to),
    relation.toNamespace,
    options,
    ['skip', 'connect'],
    variantTargetOf(contract, relation, variant),
  );
  if (resolved.onConflict === 'skip') {
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

function conflictOf(
  b: Builder,
  model: Model,
  name: string,
  parentLinkColumns: readonly string[],
  resolved: ResolvedConflict | undefined,
  rows: readonly ParsedMutationInput[],
  values: readonly Readonly<Record<string, unknown>>[],
  variantValue: string | undefined,
): NestedConflict | undefined {
  if (resolved === undefined) {
    return undefined;
  }
  const { context } = b;
  const { contract } = context;
  const call = nestedCall(name, model.modelName);
  for (const row of rows) {
    rejectParentHeldInConflictRow(name, resolved.onConflict, row);
  }
  const [connectColumns = []] = requireRowsThatCanConflict(
    contract,
    call,
    model.tables.root.storage,
    resolved,
    values,
    () => parentLinkColumns,
  );
  if (resolved.onConflict === 'skip') {
    return { conflict: { columns: resolved.columns }, relation: name };
  }
  const targeted = hasContractCapability(contract, 'insertOnConflictTarget');
  if (!targeted) {
    for (const value of values) {
      requireOnlyCollidingKey(context, model, value, connectColumns, call.action);
    }
  }
  return {
    conflict: {
      columns: connectColumns,
      targeted,
      link: parentLinkColumns,
      guard: variantGuardOf(contract, model, variantValue),
    },
    relation: name,
  };
}

function variantGuardOf(
  contract: Contract<SqlStorage>,
  { namespaceId, modelName }: Model,
  variantValue: string | undefined,
): VariantGuard | undefined {
  const discriminator =
    variantValue === undefined
      ? undefined
      : resolvePolymorphismInfo(contract, namespaceId, modelName)?.discriminatorColumn;
  return discriminator === undefined || variantValue === undefined
    ? undefined
    : { column: discriminator, value: variantValue };
}

function addFindAndAssert(
  b: Builder,
  parent: ParentRow,
  { name, relation }: Pick<ParsedRelationMutation, 'name' | 'relation'>,
  mutation: Extract<Mutation, { kind: 'connect' | 'disconnect' }>,
  criterion: Readonly<Record<string, unknown>>,
  columns: readonly ColumnMapping[],
): NodeId {
  const { graph, context } = b;
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
    b,
    selectAstOf(
      context,
      withVariants,
      { ...emptyState(withVariants.tables), filters: [where], limit: 1 },
      'selection',
    ),
    { filter: [], requires: parentRowRequired(parent) },
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
      requires: parentRowRequired(parent),
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

function parentRowRequired({ rowBeforeWrite }: ParentRow): Requires[] {
  return rowBeforeWrite === undefined ? [] : [new Requires(rowBeforeWrite)];
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
  b: Builder,
  model: Model,
  row: MutationCreateInput<Contract<SqlStorage>, string>,
  relatedCollection: RelatedCollection,
): ParsedMutationInput {
  return parseMutationInput(
    b.context.contract,
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
