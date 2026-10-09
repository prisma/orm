import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { isUniqueConstraintViolation } from '@internal/sql-errors';
import {
  type AnyExpression,
  BinaryExpr,
  ColumnRef,
  ExistsExpr,
  LiteralExpr,
  ProjectionItem,
  SelectAst,
} from '@internal/sql-relational-core/ast';
import type { ExecutionContext } from '@internal/sql-relational-core/query-lane-context';
import type { RuntimeScope } from '@internal/sql-relational-core/types';
import { castAs } from '@internal/utils/casts';
import { InternalError } from '@internal/utils/internal-error';
import {
  resolveColumnToField,
  resolveModelRelations,
  resolveModelTableName,
  resolveRowIdentityColumns,
} from './collection-contract';
import { mapModelDataToStorageRow, mapStorageRowToModelFields } from './collection-runtime';
import { and, shorthandToWhereExpr } from './filters';
import { withMutationScope } from './mutation-scope';
import {
  type ResolvedMutationInput,
  type ResolvedOperation,
  resolveMutationInput,
} from './nested-mutation-input';
import { ormError } from './orm-errors';
import {
  compileDeleteCount,
  compileInsertCount,
  compileSelect,
  compileUpdateCount,
  compileUpdateReturning,
} from './query-plan';
import { queryPlanRows } from './query-plan-rows';
import type {
  JunctionRelation,
  JunctionRelationDefinition,
  RelationDefinition,
  RelationDefinitionBase,
  RelationOwnership,
} from './relation-definitions';
import { isRelationMutationCallback } from './relation-mutator';
import { applyCreateDefaults, applyUpdateDefaults, insertRowReturning } from './row-writes';
import { tableSourceForContract } from './storage-resolution';
import type {
  CollectionState,
  MutationCreateInput,
  MutationUpdateInput,
  RuntimeQueryable,
} from './types';
import { emptyState } from './types';
import { combineWhereExprs } from './where-utils';

export function hasNestedMutationCallbacks(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  modelName: string,
  data: Record<string, unknown>,
): boolean {
  // Only the base model's relation names are needed to detect nested-mutation
  // callbacks; resolving relation targets here would eagerly resolve
  // cross-namespace targets (and throw on a non-existent target namespace),
  // so enumerate names directly without target resolution.
  const relationNames = new Set(
    Object.keys(resolveModelRelations(contract, namespaceId, modelName)),
  );
  for (const [fieldName, value] of Object.entries(data)) {
    if (!relationNames.has(fieldName)) {
      continue;
    }
    if (isRelationMutationCallback(value)) {
      return true;
    }
  }

  return false;
}

export async function executeNestedCreateMutation(options: {
  context: ExecutionContext;
  runtime: RuntimeQueryable;
  namespaceId: string;
  modelName: string;
  data: MutationCreateInput<Contract<SqlStorage>, string>;
}): Promise<Record<string, unknown>> {
  const { context, namespaceId, modelName } = options;
  return withMutationScope(options.runtime, async (scope) =>
    createResolvedGraph(
      scope,
      context,
      namespaceId,
      modelName,
      resolveMutationInput(context, namespaceId, modelName, options.data, 'create'),
    ),
  );
}

export async function executeNestedUpdateMutation(options: {
  context: ExecutionContext;
  runtime: RuntimeQueryable;
  namespaceId: string;
  modelName: string;
  filters: readonly AnyExpression[];
  data: MutationUpdateInput<Contract<SqlStorage>, string>;
}): Promise<Record<string, unknown> | null> {
  return withMutationScope(options.runtime, async (scope) =>
    updateFirstGraph(
      scope,
      options.context,
      options.namespaceId,
      options.modelName,
      options.filters,
      options.data,
    ),
  );
}

export function buildRowIdentityFilterFromRow(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  modelName: string,
  row: Record<string, unknown>,
): Record<string, unknown> {
  const tableName = resolveModelTableName(contract, namespaceId, modelName);
  const identityColumns = resolveRowIdentityColumns(contract, namespaceId, tableName);
  if (identityColumns.length === 0) {
    throw ormError(
      'ORM.ROW_IDENTITY_MISSING',
      `Nested mutations on model "${modelName}" require table "${tableName}" to have a primary key or unique constraint`,
      { meta: { model: modelName, table: tableName } },
    );
  }

  const filter: Record<string, unknown> = {};
  for (const column of identityColumns) {
    const fieldName = resolveColumnToField(contract, namespaceId, modelName, column);
    const value = row[fieldName];
    if (value === undefined) {
      throw new InternalError(
        `Missing identity field "${fieldName}" while reloading model "${modelName}"`,
      );
    }
    filter[fieldName] = value;
  }
  return filter;
}

async function applyResolvedGraph(
  scope: RuntimeScope,
  context: ExecutionContext,
  namespaceId: string,
  modelName: string,
  input: ResolvedMutationInput,
  writeParent: (scalarData: Record<string, unknown>) => Promise<Record<string, unknown>>,
): Promise<Record<string, unknown>> {
  const scalarData = { ...input.scalarData };

  for (const { relation, operation } of operationsOwnedBy(input, 'parent')) {
    await applyParentOwnedMutation(
      scope,
      context,
      namespaceId,
      modelName,
      scalarData,
      relation,
      operation,
    );
  }

  const parentRow = await writeParent(scalarData);

  for (const { relation, operation } of operationsOwnedBy(input, 'child')) {
    await applyChildOwnedMutation(
      scope,
      context,
      namespaceId,
      modelName,
      parentRow,
      relation,
      operation,
    );
  }

  for (const { relation, operation } of operationsOwnedBy(input, 'junction')) {
    await applyJunctionOwnedMutation(
      scope,
      context,
      namespaceId,
      modelName,
      parentRow,
      relation,
      operation,
    );
  }

  return parentRow;
}

function isOwnedBy<Ownership extends RelationOwnership>(
  relation: RelationDefinition,
  ownership: Ownership,
): relation is Extract<RelationDefinition, { readonly ownership: Ownership }> {
  return relation.ownership === ownership;
}

function operationsOwnedBy<Ownership extends RelationOwnership>(
  input: ResolvedMutationInput,
  ownership: Ownership,
) {
  return input.relationMutations.flatMap(({ relation, operations }) =>
    isOwnedBy(relation, ownership) ? operations.map((operation) => ({ relation, operation })) : [],
  );
}

function createResolvedGraph(
  scope: RuntimeScope,
  context: ExecutionContext,
  namespaceId: string,
  modelName: string,
  input: ResolvedMutationInput,
): Promise<Record<string, unknown>> {
  return applyResolvedGraph(scope, context, namespaceId, modelName, input, (scalarData) =>
    insertSingleRow(scope, context, namespaceId, modelName, scalarData),
  );
}

async function updateFirstGraph(
  scope: RuntimeScope,
  context: ExecutionContext,
  namespaceId: string,
  modelName: string,
  filters: readonly AnyExpression[],
  input: MutationUpdateInput<Contract<SqlStorage>, string>,
): Promise<Record<string, unknown> | null> {
  const resolved = resolveMutationInput(context, namespaceId, modelName, input, 'update');

  const existingRow = await findFirstByFilters(
    scope,
    context.contract,
    namespaceId,
    modelName,
    filters,
  );
  if (!existingRow) {
    return null;
  }

  return applyResolvedGraph(scope, context, namespaceId, modelName, resolved, (scalarData) =>
    updateSingleRow(scope, context, namespaceId, modelName, existingRow, scalarData),
  );
}

async function updateSingleRow(
  scope: RuntimeScope,
  context: ExecutionContext,
  namespaceId: string,
  modelName: string,
  existingRow: Record<string, unknown>,
  scalarData: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const contract = context.contract;
  const mappedUpdateData = mapModelDataToStorageRow(contract, namespaceId, modelName, scalarData);
  if (Object.keys(mappedUpdateData).length === 0) {
    return existingRow;
  }

  const tableName = resolveModelTableName(contract, namespaceId, modelName);
  applyUpdateDefaults(context, namespaceId, tableName, mappedUpdateData);
  const identityFilter = buildRowIdentityFilterFromRow(
    contract,
    namespaceId,
    modelName,
    existingRow,
  );
  const identityWhere = shorthandToWhereExpr(
    context,
    namespaceId,
    modelName,
    castAs<MutationUpdateInput<Contract<SqlStorage>, string>>(identityFilter),
  );
  if (!identityWhere) {
    throw new InternalError(`Failed to build row identity filter for model "${modelName}"`);
  }

  const compiled = compileUpdateReturning(
    contract,
    namespaceId,
    tableName,
    mappedUpdateData,
    [identityWhere],
    undefined,
  );
  const updatedRowsRaw = await queryPlanRows<Record<string, unknown>>(scope, compiled).toArray();

  const updatedRaw = updatedRowsRaw[0];
  return updatedRaw
    ? mapStorageRowToModelFields(contract, namespaceId, modelName, updatedRaw)
    : existingRow;
}

async function applyParentOwnedMutation(
  scope: RuntimeScope,
  context: ExecutionContext,
  parentNamespaceId: string,
  parentModelName: string,
  scalarData: Record<string, unknown>,
  relation: RelationDefinition,
  operation: ResolvedOperation,
): Promise<void> {
  const contract = context.contract;
  if (operation.kind === 'disconnect') {
    for (const localColumn of relation.localColumns) {
      const parentFieldName = resolveColumnToField(
        contract,
        parentNamespaceId,
        parentModelName,
        localColumn,
      );
      scalarData[parentFieldName] = null;
    }
    return;
  }

  const relatedRows: Record<string, unknown>[] = [];
  if (operation.kind === 'create') {
    for (const row of operation.rows) {
      relatedRows.push(
        await createResolvedGraph(
          scope,
          context,
          relation.relatedNamespaceId,
          relation.relatedModelName,
          row,
        ),
      );
    }
  }
  if (operation.kind === 'connect') {
    for (const criterion of operation.criteria) {
      relatedRows.push(await findRelatedRow(scope, context, relation, 'connect', criterion));
    }
  }

  for (const relatedRow of relatedRows) {
    const linkValues = readLinkValues(
      contract,
      relation.relatedNamespaceId,
      relation.relatedModelName,
      relatedRow,
      'target',
      relation.targetColumns,
      relation.localColumns,
    );
    for (const [localColumn, value] of linkValues) {
      scalarData[resolveColumnToField(contract, parentNamespaceId, parentModelName, localColumn)] =
        value;
    }
  }
}

async function applyChildOwnedMutation(
  scope: RuntimeScope,
  context: ExecutionContext,
  parentNamespaceId: string,
  parentModelName: string,
  parentRow: Record<string, unknown>,
  relation: RelationDefinition,
  operation: ResolvedOperation,
): Promise<void> {
  const contract = context.contract;
  const parentValues = readLinkValues(
    contract,
    parentNamespaceId,
    parentModelName,
    parentRow,
    'parent',
    relation.localColumns,
    relation.targetColumns,
  );

  if (operation.kind === 'updateAll' || operation.kind === 'deleteAll') {
    await applyFilteredWrite(
      scope,
      context,
      relation,
      buildChildJoinWhere(relation, parentValues),
      operation,
    );
    return;
  }

  if (operation.kind === 'create') {
    for (const row of operation.rows) {
      const scalarData: Record<string, unknown> = { ...row.scalarData };

      for (const [childColumn, parentValue] of parentValues.entries()) {
        const childFieldName = resolveColumnToField(
          contract,
          relation.relatedNamespaceId,
          relation.relatedModelName,
          childColumn,
        );
        scalarData[childFieldName] = parentValue;
      }

      await createResolvedGraph(
        scope,
        context,
        relation.relatedNamespaceId,
        relation.relatedModelName,
        { scalarData, relationMutations: row.relationMutations },
      );
    }
    return;
  }

  if (operation.kind === 'connect') {
    for (const criterionWhere of operation.criteria) {
      await updateRelatedRows(scope, contract, relation, Object.fromEntries(parentValues), [
        criterionWhere,
      ]);
    }
    return;
  }

  const setValues: Record<string, unknown> = {};
  for (const childColumn of parentValues.keys()) {
    setValues[childColumn] = null;
  }

  const parentJoinWhere = buildChildJoinWhere(relation, parentValues);
  const disconnectFilters =
    operation.criteria.length === 0
      ? [parentJoinWhere]
      : operation.criteria.map((criterionWhere) => and(parentJoinWhere, criterionWhere));
  for (const filter of disconnectFilters) {
    await updateRelatedRows(scope, contract, relation, setValues, [filter]);
  }
}

async function applyFilteredWrite(
  scope: RuntimeScope,
  context: ExecutionContext,
  relation: RelationDefinitionBase,
  relatedToParent: AnyExpression,
  operation: Extract<ResolvedOperation, { kind: 'updateAll' | 'deleteAll' }>,
): Promise<void> {
  const contract = context.contract;
  const namespaceId = relation.relatedNamespaceId;
  const tableName = relation.relatedTableName;
  const filters = [relatedToParent, ...operation.filters];

  if (operation.kind === 'deleteAll') {
    await scope.execute(compileDeleteCount(contract, namespaceId, tableName, filters));
    return;
  }

  const setValues = operation.setValues;
  if (Object.keys(setValues).length === 0) {
    return;
  }

  applyUpdateDefaults(context, namespaceId, tableName, setValues);
  await updateRelatedRows(scope, contract, relation, setValues, filters);
}

async function applyJunctionOwnedMutation(
  scope: RuntimeScope,
  context: ExecutionContext,
  parentNamespaceId: string,
  parentModelName: string,
  parentRow: Record<string, unknown>,
  relation: JunctionRelation,
  operation: ResolvedOperation,
): Promise<void> {
  const contract = context.contract;
  const parentPkValues = completeJunctionValues(
    relation,
    'parent',
    relation.through.parentColumns,
    readLinkValues(
      contract,
      parentNamespaceId,
      parentModelName,
      parentRow,
      'parent',
      relation.localColumns,
      relation.through.parentColumns,
    ),
  );

  if (operation.kind === 'updateAll' || operation.kind === 'deleteAll') {
    await applyFilteredWrite(
      scope,
      context,
      relation,
      buildJunctionMembershipWhere(contract, relation, parentPkValues),
      operation,
    );
    return;
  }

  if (operation.kind === 'create') {
    for (const row of operation.rows) {
      const relatedRow = await createResolvedGraph(
        scope,
        context,
        relation.relatedNamespaceId,
        relation.relatedModelName,
        row,
      );
      const targetPkValues = readJunctionTargetValues(contract, relation, relatedRow);
      await insertJunctionLink(scope, context, relation, parentPkValues, targetPkValues, 'create');
    }
    return;
  }

  const linkedTargetKeys = new Set<string>();
  for (const criterion of operation.criteria) {
    const targetPkValues = readJunctionTargetValues(
      contract,
      relation,
      await findRelatedRow(scope, context, relation, operation.kind, criterion),
    );
    if (operation.kind === 'disconnect') {
      await deleteJunctionLink(scope, context, relation, parentPkValues, targetPkValues);
      continue;
    }
    const targetKey = JSON.stringify([...targetPkValues.entries()]);
    if (linkedTargetKeys.has(targetKey)) {
      continue;
    }
    linkedTargetKeys.add(targetKey);
    await insertJunctionLink(scope, context, relation, parentPkValues, targetPkValues, 'connect');
  }
}

async function findRelatedRow(
  scope: RuntimeScope,
  context: ExecutionContext,
  relation: RelationDefinitionBase,
  kind: 'connect' | 'disconnect',
  criterion: AnyExpression,
): Promise<Record<string, unknown>> {
  const relatedRow = await findFirstByFilters(
    scope,
    context.contract,
    relation.relatedNamespaceId,
    relation.relatedModelName,
    [criterion],
  );
  if (!relatedRow) {
    throw ormError(
      'ORM.RELATION_ROW_MISSING',
      `${kind}() nested mutation for relation "${relation.relationName}" did not find a matching row`,
      { meta: { kind, relation: relation.relationName } },
    );
  }
  return relatedRow;
}

function readJunctionTargetValues(
  contract: Contract<SqlStorage>,
  relation: JunctionRelationDefinition,
  relatedRow: Record<string, unknown>,
): Map<string, unknown> {
  return completeJunctionValues(
    relation,
    'target',
    relation.through.childColumns,
    readLinkValues(
      contract,
      relation.relatedNamespaceId,
      relation.relatedModelName,
      relatedRow,
      'target',
      relation.through.targetColumns,
      relation.through.childColumns,
    ),
  );
}

function completeJunctionValues(
  relation: JunctionRelationDefinition,
  rowRole: 'parent' | 'target',
  junctionColumns: readonly string[],
  values: Map<string, unknown>,
): Map<string, unknown> {
  if (junctionColumns.length === 0 || !junctionColumns.every((column) => values.has(column))) {
    throw new InternalError(
      `Relation "${relation.relationName}" has incomplete junction metadata for ${rowRole} columns`,
    );
  }
  return values;
}

function buildJunctionRow(
  relation: JunctionRelationDefinition,
  parentPkValues: Map<string, unknown>,
  targetPkValues: Map<string, unknown>,
): Record<string, unknown> {
  const through = relation.through;
  const junctionRow: Record<string, unknown> = {};
  for (const [column, value] of [...parentPkValues, ...targetPkValues]) {
    if (Object.hasOwn(junctionRow, column) && !Object.is(junctionRow[column], value)) {
      throw ormError(
        'ORM.RELATION_MUTATION_INVALID',
        `Cannot write junction "${through.table}": conflicting values for junction column "${column}"`,
        { meta: { relation: relation.relationName, junction: through.table, column } },
      );
    }
    junctionRow[column] = value;
  }
  return junctionRow;
}

async function insertJunctionLink(
  scope: RuntimeScope,
  context: ExecutionContext,
  relation: JunctionRelation,
  parentPkValues: Map<string, unknown>,
  targetPkValues: Map<string, unknown>,
  mutationKind: 'create' | 'connect',
): Promise<void> {
  const through = relation.through;
  const junctionRow = buildJunctionRow(relation, parentPkValues, targetPkValues);

  // Mirror insertSingleRow: payload columns whose only source is an
  // execution-time onCreate default pass both the type gate and the runtime
  // guard, so the INSERT must populate them here or hit NOT NULL on the
  // database.
  applyCreateDefaults(context, through.namespaceId, through.table, [junctionRow]);

  const conflictColumns = mutationKind === 'connect' ? relation.connectConflictColumns : undefined;
  const compiled = compileInsertCount(
    context.contract,
    through.namespaceId,
    through.table,
    [junctionRow],
    conflictColumns && { columns: conflictColumns },
  );
  try {
    await scope.execute(compiled);
  } catch (error) {
    // The junction PK is the common unique constraint here, but the table may
    // carry others — say a unique constraint was violated rather than
    // asserting the link itself already exists.
    if (mutationKind === 'connect' && !conflictColumns && isUniqueConstraintViolation(error)) {
      throw ormError(
        'ORM.RELATION_LINK_DUPLICATE',
        `connect() nested mutation for relation "${relation.relationName}" violated a unique constraint on junction "${through.table}"; the junction link may already be present`,
        { meta: { relation: relation.relationName, junction: through.table }, cause: error },
      );
    }
    throw error;
  }
}

async function deleteJunctionLink(
  scope: RuntimeScope,
  context: ExecutionContext,
  relation: JunctionRelationDefinition,
  parentPkValues: Map<string, unknown>,
  targetPkValues: Map<string, unknown>,
): Promise<void> {
  const through = relation.through;
  const junctionRow = buildJunctionRow(relation, parentPkValues, targetPkValues);

  const where = combineWhereExprs(
    Object.entries(junctionRow).map(([column, value]) =>
      BinaryExpr.eq(ColumnRef.of(through.table, column), LiteralExpr.of(value)),
    ),
  );
  if (!where) {
    throw new InternalError(
      `Relation "${relation.relationName}" has no junction columns to identify the link to delete`,
    );
  }
  const compiled = compileDeleteCount(context.contract, through.namespaceId, through.table, [
    where,
  ]);
  await scope.execute(compiled);
}

function readLinkValues(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  modelName: string,
  row: Record<string, unknown>,
  rowRole: 'parent' | 'target',
  sourceColumns: readonly string[],
  linkColumns: readonly string[],
): Map<string, unknown> {
  const values = new Map<string, unknown>();
  sourceColumns.forEach((sourceColumn, index) => {
    const linkColumn = linkColumns[index];
    if (!sourceColumn || !linkColumn) {
      return;
    }
    const fieldName = resolveColumnToField(contract, namespaceId, modelName, sourceColumn);
    const value = row[fieldName];
    if (value === undefined) {
      throw new InternalError(
        `Nested mutation requires ${rowRole} field "${fieldName}" to be present in returned row`,
      );
    }
    values.set(linkColumn, value);
  });
  return values;
}

function buildJunctionMembershipWhere(
  contract: Contract<SqlStorage>,
  relation: JunctionRelationDefinition,
  parentPkValues: Map<string, unknown>,
): AnyExpression {
  const through = relation.through;
  const conditions: AnyExpression[] = [];
  for (const [junctionColumn, parentValue] of parentPkValues.entries()) {
    conditions.push(
      BinaryExpr.eq(ColumnRef.of(through.table, junctionColumn), LiteralExpr.of(parentValue)),
    );
  }
  through.childColumns.forEach((junctionColumn, index) => {
    const targetColumn = through.targetColumns[index];
    if (targetColumn === undefined) {
      throw new InternalError(
        `Relation "${relation.relationName}" has incomplete junction metadata for target columns`,
      );
    }
    conditions.push(
      BinaryExpr.eq(
        ColumnRef.of(through.table, junctionColumn),
        ColumnRef.of(relation.relatedTableName, targetColumn),
      ),
    );
  });
  if (parentPkValues.size === 0 || through.childColumns.length === 0) {
    throw new InternalError(
      `Relation "${relation.relationName}" has incomplete junction metadata for the membership condition`,
    );
  }

  return ExistsExpr.exists(
    SelectAst.from(tableSourceForContract(contract, through.namespaceId, through.table))
      .withProjection([ProjectionItem.of('_exists', LiteralExpr.of(1))])
      .withWhere(and(...conditions)),
  );
}

function buildChildJoinWhere(
  relation: RelationDefinition,
  childValues: Map<string, unknown>,
): AnyExpression {
  const where = combineWhereExprs(
    [...childValues].map(([childColumn, parentValue]) =>
      BinaryExpr.eq(
        ColumnRef.of(relation.relatedTableName, childColumn),
        LiteralExpr.of(parentValue),
      ),
    ),
  );
  if (!where) {
    throw new InternalError(
      `Relation "${relation.relationName}" has no column pairing to scope its related rows to the parent`,
    );
  }
  return where;
}

async function insertSingleRow(
  scope: RuntimeScope,
  context: ExecutionContext,
  namespaceId: string,
  modelName: string,
  data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const contract = context.contract;
  const tableName = resolveModelTableName(contract, namespaceId, modelName);

  const firstRow = await insertRowReturning(
    scope,
    context,
    namespaceId,
    tableName,
    mapModelDataToStorageRow(contract, namespaceId, modelName, data),
  );
  if (!firstRow) {
    throw ormError(
      'ORM.MUTATION_ROW_MISSING',
      `Nested create for model "${modelName}" did not return a row`,
      { meta: { operation: 'create', model: modelName, phase: 'nested' } },
    );
  }

  return mapStorageRowToModelFields(contract, namespaceId, modelName, firstRow);
}

async function findFirstByFilters(
  scope: RuntimeScope,
  contract: Contract<SqlStorage>,
  namespaceId: string,
  modelName: string,
  filters: readonly AnyExpression[],
): Promise<Record<string, unknown> | null> {
  const tableName = resolveModelTableName(contract, namespaceId, modelName);
  const state: CollectionState = {
    ...emptyState(),
    filters,
    limit: 1,
  };
  const compiled = compileSelect(contract, namespaceId, tableName, state);
  const rows = await queryPlanRows<Record<string, unknown>>(scope, compiled).toArray();

  const firstRow = rows[0];
  if (!firstRow) {
    return null;
  }

  return mapStorageRowToModelFields(contract, namespaceId, modelName, firstRow);
}

async function updateRelatedRows(
  scope: RuntimeScope,
  contract: Contract<SqlStorage>,
  relation: RelationDefinitionBase,
  setValues: Record<string, unknown>,
  filters: readonly AnyExpression[],
): Promise<void> {
  await scope.execute(
    compileUpdateCount(
      contract,
      relation.relatedNamespaceId,
      relation.relatedTableName,
      setValues,
      filters,
    ),
  );
}
