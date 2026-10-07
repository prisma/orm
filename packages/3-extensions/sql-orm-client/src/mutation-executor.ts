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
  getColumnToFieldMap,
  resolveFieldToColumn,
  resolveModelRelations,
  resolveModelTableName,
  resolveRowIdentityColumns,
} from './collection-contract';
import { mapModelDataToStorageRow, mapStorageRowToModelFields } from './collection-runtime';
import { and, shorthandToWhereExpr } from './filters';
import { createModelAccessor } from './model-accessor';
import { ormError } from './orm-errors';
import {
  compileDeleteCount,
  compileInsertCount,
  compileInsertReturning,
  compileSelect,
  compileUpdateCount,
  compileUpdateReturning,
} from './query-plan';
import { queryPlanRows } from './query-plan-rows';
import {
  createRelationMutator,
  isRelationMutationCallback,
  isRelationMutationDescriptor,
} from './relation-mutator';
import { tableSourceForContract } from './storage-resolution';
import type {
  CollectionState,
  MutationCreateInput,
  MutationUpdateInput,
  RelationCardinalityTag,
  RelationMutation,
  RelationMutationCreate,
  RelationMutationDeleteAll,
  RelationMutationFilter,
  RelationMutationUpdateAll,
  RuntimeQueryable,
  RuntimeTransaction,
} from './types';
import { emptyState } from './types';
import { isWhereDirectInput, normalizeWhereArg } from './where-interop';

interface JunctionThrough {
  readonly table: string;
  readonly namespaceId: string;
  readonly parentColumns: readonly string[];
  readonly childColumns: readonly string[];
  readonly targetColumns: readonly string[];
  readonly requiredPayloadColumns: readonly string[];
}

interface RelationDefinition {
  readonly relationName: string;
  readonly relatedModelName: string;
  readonly relatedNamespaceId: string;
  readonly relatedTableName: string;
  readonly cardinality: RelationCardinalityTag | undefined;
  readonly localColumns: readonly string[];
  readonly targetColumns: readonly string[];
  readonly through: JunctionThrough | undefined;
}

export interface JunctionRelationDefinition extends RelationDefinition {
  readonly through: JunctionThrough;
}

function hasThrough(relation: RelationDefinition): relation is JunctionRelationDefinition {
  return relation.through !== undefined;
}

interface ParsedRelationMutation {
  readonly relation: RelationDefinition;
  readonly mutations: readonly RelationMutation<Contract<SqlStorage>, string>[];
}

interface ResolvedNestedInput {
  readonly createRows: Map<object, (ParsedMutationInput | undefined)[]>;
  readonly filters: Map<object, readonly AnyExpression[]>;
}

interface ParsedMutationInput {
  readonly scalarData: Record<string, unknown>;
  readonly relationMutations: readonly ParsedRelationMutation[];
}

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
  return withMutationScope(options.runtime, async (scope) => {
    const resolved = newResolvedNestedInput();
    const parsed = parseMutationInput(context.contract, namespaceId, modelName, options.data);
    validateRelationMutations(context, resolved, parsed.relationMutations, 'create');
    return createParsedGraph(scope, context, resolved, namespaceId, modelName, parsed);
  });
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
    const fieldName = toFieldName(contract, namespaceId, modelName, column);
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

export async function withMutationScope<T>(
  runtime: RuntimeQueryable,
  run: (scope: RuntimeScope) => Promise<T>,
): Promise<T> {
  // A top-level transaction wins when the runtime exposes one directly.
  if (typeof runtime.transaction === 'function') {
    return runInTransaction(await runtime.transaction(), run);
  }

  // Otherwise open a connection and run the whole mutation graph inside its
  // transaction. The top-level `Runtime` exposes `transaction()` only on a
  // connection (`connection().transaction()`), so without this a multi-statement
  // graph that fails after the first write would leave a partial write behind.
  if (typeof runtime.connection === 'function') {
    const connection = await runtime.connection();
    try {
      if (typeof connection.transaction === 'function') {
        return await runInTransaction(await connection.transaction(), run);
      }
      return await run(connection);
    } finally {
      await connection.release?.();
    }
  }

  // Bare runtimes (e.g. unit-test stubs) expose neither: run directly.
  return run(runtime);
}

async function runInTransaction<T>(
  transaction: RuntimeTransaction,
  run: (scope: RuntimeScope) => Promise<T>,
): Promise<T> {
  try {
    const result = await run(transaction);
    if (typeof transaction.commit === 'function') {
      await transaction.commit();
    }
    return result;
  } catch (error) {
    if (typeof transaction.rollback === 'function') {
      await transaction.rollback();
    }
    throw error;
  }
}

async function createParsedGraph(
  scope: RuntimeScope,
  context: ExecutionContext,
  resolved: ResolvedNestedInput,
  namespaceId: string,
  modelName: string,
  parsed: ParsedMutationInput,
): Promise<Record<string, unknown>> {
  const { parentOwned, childOwned, junctionOwned } = partitionByOwnership(parsed.relationMutations);

  const scalarData = { ...parsed.scalarData };

  for (const { relation, mutations } of parentOwned) {
    for (const mutation of mutations) {
      await applyParentOwnedMutation(
        scope,
        context,
        resolved,
        namespaceId,
        modelName,
        scalarData,
        relation,
        mutation,
      );
    }
  }

  for (const { relation, mutations } of junctionOwned) {
    for (const mutation of mutations) {
      await preflightJunctionOwnedCreateMutation(scope, context, relation, mutation);
    }
  }

  const parentRow = await insertSingleRow(scope, context, namespaceId, modelName, scalarData);

  for (const { relation, mutations } of childOwned) {
    for (const mutation of mutations) {
      await applyChildOwnedMutation(
        scope,
        context,
        resolved,
        namespaceId,
        modelName,
        parentRow,
        relation,
        mutation,
      );
    }
  }

  for (const { relation, mutations } of junctionOwned) {
    for (const mutation of mutations) {
      await applyJunctionOwnedMutation(
        scope,
        context,
        resolved,
        namespaceId,
        modelName,
        parentRow,
        relation,
        mutation,
      );
    }
  }

  return parentRow;
}

async function updateFirstGraph(
  scope: RuntimeScope,
  context: ExecutionContext,
  namespaceId: string,
  modelName: string,
  filters: readonly AnyExpression[],
  input: MutationUpdateInput<Contract<SqlStorage>, string>,
): Promise<Record<string, unknown> | null> {
  const contract = context.contract;
  const resolved = newResolvedNestedInput();
  const parsed = parseMutationInput(contract, namespaceId, modelName, input);
  validateRelationMutations(context, resolved, parsed.relationMutations, 'update');

  const existingRow = await findFirstByFilters(scope, contract, namespaceId, modelName, filters);
  if (!existingRow) {
    return null;
  }

  const { parentOwned, childOwned, junctionOwned } = partitionByOwnership(parsed.relationMutations);

  const scalarData = { ...parsed.scalarData };

  for (const { relation, mutations } of parentOwned) {
    for (const mutation of mutations) {
      await applyParentOwnedMutation(
        scope,
        context,
        resolved,
        namespaceId,
        modelName,
        scalarData,
        relation,
        mutation,
      );
    }
  }

  for (const { relation, mutations } of junctionOwned) {
    for (const mutation of mutations) {
      await preflightJunctionOwnedCreateMutation(scope, context, relation, mutation);
    }
  }

  let parentRow = existingRow;

  const mappedUpdateData = mapModelDataToStorageRow(contract, namespaceId, modelName, scalarData);
  if (Object.keys(mappedUpdateData).length > 0) {
    const tableName = resolveModelTableName(contract, namespaceId, modelName);
    const appliedUpdateDefaults = context.applyMutationDefaults({
      op: 'update',
      entry: tableName,
      namespace: namespaceId,
      values: mappedUpdateData,
    });
    for (const def of appliedUpdateDefaults) {
      mappedUpdateData[def.field] = def.value;
    }
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
    if (updatedRaw) {
      parentRow = mapStorageRowToModelFields(contract, namespaceId, modelName, updatedRaw);
    }
  }

  for (const { relation, mutations } of childOwned) {
    for (const mutation of mutations) {
      await applyChildOwnedMutation(
        scope,
        context,
        resolved,
        namespaceId,
        modelName,
        parentRow,
        relation,
        mutation,
      );
    }
  }

  for (const { relation, mutations } of junctionOwned) {
    for (const mutation of mutations) {
      await applyJunctionOwnedMutation(
        scope,
        context,
        resolved,
        namespaceId,
        modelName,
        parentRow,
        relation,
        mutation,
      );
    }
  }

  return parentRow;
}

function parseMutationInput(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  modelName: string,
  input:
    | MutationCreateInput<Contract<SqlStorage>, string>
    | MutationUpdateInput<Contract<SqlStorage>, string>,
): ParsedMutationInput {
  const scalarData: Record<string, unknown> = {};
  const relationDefinitions = new Map(
    getRelationDefinitions(contract, namespaceId, modelName).map((relation) => [
      relation.relationName,
      relation,
    ]),
  );

  const relationMutations: ParsedRelationMutation[] = [];

  for (const [fieldName, value] of Object.entries(input)) {
    const relation = relationDefinitions.get(fieldName);
    if (!relation) {
      scalarData[fieldName] = value;
      continue;
    }

    if (!isRelationMutationCallback(value)) {
      throw ormError(
        'ORM.RELATION_MUTATION_INVALID',
        `Relation field "${fieldName}" on model "${modelName}" expects a mutator callback`,
        { meta: { relation: fieldName, model: modelName, problem: 'missing-callback' } },
      );
    }

    const mutator = createRelationMutator<Contract<SqlStorage>, string>();
    relationMutations.push({
      relation,
      mutations: toRelationMutationList(fieldName, modelName, value(mutator)),
    });
  }

  return {
    scalarData,
    relationMutations,
  };
}

function toRelationMutationList(
  fieldName: string,
  modelName: string,
  result: unknown,
): readonly RelationMutation<Contract<SqlStorage>, string>[] {
  if (!Array.isArray(result)) {
    if (!isRelationMutationDescriptor(result)) {
      throw ormError(
        'ORM.RELATION_MUTATION_INVALID',
        `Relation field "${fieldName}" on model "${modelName}" returned an invalid mutation descriptor`,
        { meta: { relation: fieldName, model: modelName, problem: 'invalid-descriptor' } },
      );
    }
    return [result];
  }

  const elements: readonly unknown[] = result;
  const mutations: RelationMutation<Contract<SqlStorage>, string>[] = [];
  for (const [index, element] of elements.entries()) {
    if (Array.isArray(element)) {
      throw ormError(
        'ORM.RELATION_MUTATION_INVALID',
        `Relation field "${fieldName}" on model "${modelName}" returned a nested array at index ${index}; return one flat array of mutations`,
        { meta: { relation: fieldName, model: modelName, problem: 'nested-array', index } },
      );
    }
    if (!isRelationMutationDescriptor(element)) {
      throw ormError(
        'ORM.RELATION_MUTATION_INVALID',
        `Relation field "${fieldName}" on model "${modelName}" returned an invalid mutation descriptor at index ${index}`,
        { meta: { relation: fieldName, model: modelName, problem: 'invalid-descriptor', index } },
      );
    }
    mutations.push(element);
  }
  return mutations;
}

type FilteredWriteMutation =
  | RelationMutationUpdateAll<Contract<SqlStorage>, string>
  | RelationMutationDeleteAll<Contract<SqlStorage>, string>;

function isFilteredWrite(
  mutation: RelationMutation<Contract<SqlStorage>, string>,
): mutation is FilteredWriteMutation {
  return mutation.kind === 'updateAll' || mutation.kind === 'deleteAll';
}

function assertAllowedInCreate(
  relation: RelationDefinition,
  mutation: RelationMutation<Contract<SqlStorage>, string>,
): void {
  if (mutation.kind === 'disconnect' || isFilteredWrite(mutation)) {
    throw ormError(
      'ORM.RELATION_MUTATION_UNSUPPORTED',
      `${mutation.kind}() is only supported in update() nested mutations`,
      { meta: { kind: mutation.kind, relation: relation.relationName } },
    );
  }
}

function toOneFilteredWriteError(
  relation: RelationDefinition,
  kind: FilteredWriteMutation['kind'],
) {
  return ormError(
    'ORM.RELATION_MUTATION_UNSUPPORTED',
    `${kind}() nested mutation for relation "${relation.relationName}" is only supported on to-many relations`,
    { meta: { kind, relation: relation.relationName, reason: 'to-one-relation' } },
  );
}

function createMissingDataError(relation: RelationDefinition) {
  return ormError(
    'ORM.RELATION_MUTATION_INVALID',
    `create() nested mutation for relation "${relation.relationName}" requires data`,
    { meta: { kind: 'create', relation: relation.relationName, problem: 'missing-data' } },
  );
}

function connectMissingCriterionError(relation: RelationDefinition) {
  return ormError(
    'ORM.RELATION_MUTATION_INVALID',
    `connect() nested mutation for relation "${relation.relationName}" requires criterion`,
    { meta: { kind: 'connect', relation: relation.relationName, problem: 'missing-criterion' } },
  );
}

function junctionDisconnectMissingCriteriaError(relation: RelationDefinition) {
  return ormError(
    'ORM.RELATION_MUTATION_INVALID',
    `disconnect() nested mutation for relation "${relation.relationName}" requires criterion`,
    {
      meta: { kind: 'disconnect', relation: relation.relationName, problem: 'missing-criterion' },
    },
  );
}

function relationCriterionWhere(
  context: ExecutionContext,
  relation: RelationDefinition,
  kind: 'connect' | 'disconnect',
  criterion: Record<string, unknown>,
): AnyExpression {
  const criterionWhere = shorthandToWhereExpr(
    context,
    relation.relatedNamespaceId,
    relation.relatedModelName,
    castAs<MutationUpdateInput<Contract<SqlStorage>, string>>(criterion),
  );
  if (!criterionWhere) {
    throw ormError(
      'ORM.RELATION_MUTATION_INVALID',
      `${kind}() nested mutation for relation "${relation.relationName}" requires non-empty criterion`,
      { meta: { kind, relation: relation.relationName, problem: 'empty-criterion' } },
    );
  }
  return criterionWhere;
}

function modelCriterionWhere(
  context: ExecutionContext,
  namespaceId: string,
  modelName: string,
  criterion: Record<string, unknown>,
): AnyExpression {
  const whereExpr = shorthandToWhereExpr(
    context,
    namespaceId,
    modelName,
    castAs<MutationUpdateInput<Contract<SqlStorage>, string>>(criterion),
  );
  if (!whereExpr) {
    throw ormError(
      'ORM.RELATION_MUTATION_INVALID',
      `Nested connect for model "${modelName}" requires non-empty criterion`,
      { meta: { kind: 'connect', model: modelName, problem: 'empty-criterion' } },
    );
  }
  return whereExpr;
}

function assertNoParentLinkColumn(
  contract: Contract<SqlStorage>,
  relation: RelationDefinition,
  setValues: Record<string, unknown>,
  parentLinkColumns: ReadonlySet<string>,
): void {
  const parentLinkFields = Object.keys(setValues)
    .filter((column) => parentLinkColumns.has(column))
    .map((column) =>
      toFieldName(contract, relation.relatedNamespaceId, relation.relatedModelName, column),
    );
  if (parentLinkFields.length > 0) {
    throw ormError(
      'ORM.RELATION_MUTATION_INVALID',
      `updateAll() nested mutation for relation "${relation.relationName}" cannot set ${parentLinkFields.map((field) => `"${field}"`).join(', ')}, which links the related rows to their parent`,
      {
        meta: {
          kind: 'updateAll',
          relation: relation.relationName,
          problem: 'parent-link-column',
          fields: parentLinkFields,
        },
      },
    );
  }
}

function childLinkColumns(relation: RelationDefinition): ReadonlySet<string> {
  const columns = new Set<string>();
  relation.targetColumns.forEach((targetColumn, index) => {
    if (targetColumn && relation.localColumns[index]) {
      columns.add(targetColumn);
    }
  });
  return columns;
}

function validateRelationMutations(
  context: ExecutionContext,
  resolved: ResolvedNestedInput,
  relationMutations: readonly ParsedRelationMutation[],
  operation: 'create' | 'update',
): void {
  const { parentOwned, childOwned, junctionOwned } = partitionByOwnership(relationMutations);

  for (const { relation, mutations } of parentOwned) {
    for (const mutation of mutations) {
      if (operation === 'create') {
        assertAllowedInCreate(relation, mutation);
      }
      validateParentOwnedMutation(context, resolved, relation, mutation);
    }
  }

  for (const { relation, mutations } of junctionOwned) {
    for (const mutation of mutations) {
      if (operation === 'create') {
        assertAllowedInCreate(relation, mutation);
      }
      validateJunctionOwnedMutation(context, resolved, relation, mutation);
    }
  }

  for (const { relation, mutations } of childOwned) {
    for (const mutation of mutations) {
      if (operation === 'create') {
        assertAllowedInCreate(relation, mutation);
      }
      validateChildOwnedMutation(context, resolved, relation, mutation);
    }
  }
}

function newResolvedNestedInput(): ResolvedNestedInput {
  return { createRows: new Map(), filters: new Map() };
}

function assertCreateRowsAreObjects(
  relation: RelationDefinition,
  mutation: RelationMutationCreate<Contract<SqlStorage>, string>,
): void {
  const rows: readonly unknown[] = mutation.data;
  rows.forEach((row, index) => {
    if (row === null || row === undefined) {
      throw createMissingDataError(relation);
    }
    if (typeof row !== 'object' || Array.isArray(row)) {
      throw ormError(
        'ORM.RELATION_MUTATION_INVALID',
        `create() nested mutation for relation "${relation.relationName}" requires an object for each row; the value at index ${index} is not an object`,
        {
          meta: {
            kind: 'create',
            relation: relation.relationName,
            problem: 'invalid-data',
            index,
          },
        },
      );
    }
  });
}

function parsedCreateRow(
  context: ExecutionContext,
  resolved: ResolvedNestedInput,
  relation: RelationDefinition,
  mutation: RelationMutationCreate<Contract<SqlStorage>, string>,
  index: number,
): ParsedMutationInput | undefined {
  let rows = resolved.createRows.get(mutation);
  if (!rows) {
    assertCreateRowsAreObjects(relation, mutation);
    rows = [];
    resolved.createRows.set(mutation, rows);
  }
  const cached = rows[index];
  if (cached) {
    return cached;
  }
  const input = mutation.data[index];
  if (!input) {
    return undefined;
  }
  const parsed = parseMutationInput(
    context.contract,
    relation.relatedNamespaceId,
    relation.relatedModelName,
    input,
  );
  rows[index] = parsed;
  return parsed;
}

function parsedCreateRows(
  context: ExecutionContext,
  resolved: ResolvedNestedInput,
  relation: RelationDefinition,
  mutation: RelationMutationCreate<Contract<SqlStorage>, string>,
): ParsedMutationInput[] {
  const rows: ParsedMutationInput[] = [];
  mutation.data.forEach((_input, index) => {
    const parsed = parsedCreateRow(context, resolved, relation, mutation, index);
    if (parsed) {
      rows.push(parsed);
    }
  });
  return rows;
}

function resolvedFilters(
  context: ExecutionContext,
  resolved: ResolvedNestedInput,
  relation: RelationDefinition,
  mutation: FilteredWriteMutation,
): readonly AnyExpression[] {
  const cached = resolved.filters.get(mutation);
  if (cached) {
    return cached;
  }
  const filters: AnyExpression[] = [];
  for (const input of mutation.filters) {
    const filter = resolveRelationFilter(context, relation, input);
    if (filter) {
      filters.push(filter);
    }
  }
  resolved.filters.set(mutation, filters);
  return filters;
}

function validateFilteredWrite(
  context: ExecutionContext,
  resolved: ResolvedNestedInput,
  relation: RelationDefinition,
  mutation: FilteredWriteMutation,
  parentLinkColumns: ReadonlySet<string>,
): void {
  resolvedFilters(context, resolved, relation, mutation);
  if (mutation.kind === 'updateAll') {
    assertNoParentLinkColumn(
      context.contract,
      relation,
      mapModelDataToStorageRow(
        context.contract,
        relation.relatedNamespaceId,
        relation.relatedModelName,
        mutation.data,
      ),
      parentLinkColumns,
    );
  }
}

function validateParentOwnedMutation(
  context: ExecutionContext,
  resolved: ResolvedNestedInput,
  relation: RelationDefinition,
  mutation: RelationMutation<Contract<SqlStorage>, string>,
): void {
  if (isFilteredWrite(mutation)) {
    throw toOneFilteredWriteError(relation, mutation.kind);
  }

  if (mutation.kind === 'create') {
    const row = parsedCreateRow(context, resolved, relation, mutation, 0);
    if (!row) {
      throw createMissingDataError(relation);
    }
    validateRelationMutations(context, resolved, row.relationMutations, 'create');
    return;
  }

  if (mutation.kind === 'connect') {
    const criterion = mutation.criteria[0];
    if (!criterion) {
      throw connectMissingCriterionError(relation);
    }
    modelCriterionWhere(
      context,
      relation.relatedNamespaceId,
      relation.relatedModelName,
      castAs<Record<string, unknown>>(criterion),
    );
  }
}

function validateChildOwnedMutation(
  context: ExecutionContext,
  resolved: ResolvedNestedInput,
  relation: RelationDefinition,
  mutation: RelationMutation<Contract<SqlStorage>, string>,
): void {
  if (isFilteredWrite(mutation)) {
    if (relation.cardinality === '1:1') {
      throw toOneFilteredWriteError(relation, mutation.kind);
    }
    validateFilteredWrite(context, resolved, relation, mutation, childLinkColumns(relation));
    return;
  }

  if (mutation.kind === 'create') {
    for (const row of parsedCreateRows(context, resolved, relation, mutation)) {
      validateRelationMutations(context, resolved, row.relationMutations, 'create');
    }
    return;
  }

  for (const criterion of mutation.criteria ?? []) {
    relationCriterionWhere(context, relation, mutation.kind, criterion);
  }
}

function validateJunctionOwnedMutation(
  context: ExecutionContext,
  resolved: ResolvedNestedInput,
  relation: JunctionRelationDefinition,
  mutation: RelationMutation<Contract<SqlStorage>, string>,
): void {
  assertJunctionMetadataShape(relation);
  assertJunctionPayloadWritable(relation, mutation.kind);

  if (isFilteredWrite(mutation)) {
    validateFilteredWrite(context, resolved, relation, mutation, new Set());
    return;
  }

  if (mutation.kind === 'create') {
    for (const row of parsedCreateRows(context, resolved, relation, mutation)) {
      validateRelationMutations(context, resolved, row.relationMutations, 'create');
    }
    return;
  }

  if (mutation.kind === 'disconnect' && (!mutation.criteria || mutation.criteria.length === 0)) {
    throw junctionDisconnectMissingCriteriaError(relation);
  }

  for (const criterion of mutation.criteria ?? []) {
    modelCriterionWhere(context, relation.relatedNamespaceId, relation.relatedModelName, criterion);
  }
}

interface JunctionParsedRelationMutation extends ParsedRelationMutation {
  readonly relation: JunctionRelationDefinition;
}

function partitionByOwnership(relationMutations: readonly ParsedRelationMutation[]): {
  parentOwned: ParsedRelationMutation[];
  childOwned: ParsedRelationMutation[];
  junctionOwned: JunctionParsedRelationMutation[];
} {
  const parentOwned: ParsedRelationMutation[] = [];
  const childOwned: ParsedRelationMutation[] = [];
  const junctionOwned: JunctionParsedRelationMutation[] = [];

  for (const relationMutation of relationMutations) {
    if (hasThrough(relationMutation.relation)) {
      junctionOwned.push({
        relation: relationMutation.relation,
        mutations: relationMutation.mutations,
      });
      continue;
    }

    if (relationMutation.relation.cardinality === 'N:1') {
      parentOwned.push(relationMutation);
      continue;
    }

    childOwned.push(relationMutation);
  }

  return {
    parentOwned,
    childOwned,
    junctionOwned,
  };
}

async function applyParentOwnedMutation(
  scope: RuntimeScope,
  context: ExecutionContext,
  resolved: ResolvedNestedInput,
  parentNamespaceId: string,
  parentModelName: string,
  scalarData: Record<string, unknown>,
  relation: RelationDefinition,
  mutation: RelationMutation<Contract<SqlStorage>, string>,
): Promise<void> {
  const contract = context.contract;
  if (isFilteredWrite(mutation)) {
    throw toOneFilteredWriteError(relation, mutation.kind);
  }

  if (mutation.kind === 'disconnect') {
    for (const localColumn of relation.localColumns) {
      const parentFieldName = toFieldName(
        contract,
        parentNamespaceId,
        parentModelName,
        localColumn,
      );
      scalarData[parentFieldName] = null;
    }
    return;
  }

  if (mutation.kind === 'create') {
    const row = parsedCreateRow(context, resolved, relation, mutation, 0);
    if (!row) {
      throw createMissingDataError(relation);
    }

    const relatedRow = await createParsedGraph(
      scope,
      context,
      resolved,
      relation.relatedNamespaceId,
      relation.relatedModelName,
      row,
    );
    copyRelatedValuesToParent(
      contract,
      parentNamespaceId,
      parentModelName,
      relation,
      scalarData,
      relatedRow,
    );
    return;
  }

  const criterion = mutation.criteria[0];
  if (!criterion) {
    throw connectMissingCriterionError(relation);
  }

  const relatedRow = await findRowByCriterion(
    scope,
    context,
    relation.relatedNamespaceId,
    relation.relatedModelName,
    castAs<Record<string, unknown>>(criterion),
  );
  if (!relatedRow) {
    throw ormError(
      'ORM.RELATION_ROW_MISSING',
      `connect() nested mutation for relation "${relation.relationName}" did not find a matching row`,
      { meta: { kind: 'connect', relation: relation.relationName } },
    );
  }

  copyRelatedValuesToParent(
    contract,
    parentNamespaceId,
    parentModelName,
    relation,
    scalarData,
    relatedRow,
  );
}

function copyRelatedValuesToParent(
  contract: Contract<SqlStorage>,
  parentNamespaceId: string,
  parentModelName: string,
  relation: RelationDefinition,
  scalarData: Record<string, unknown>,
  relatedRow: Record<string, unknown>,
): void {
  for (let i = 0; i < relation.localColumns.length; i++) {
    const localColumn = relation.localColumns[i];
    const targetColumn = relation.targetColumns[i];
    if (!localColumn || !targetColumn) {
      continue;
    }

    const parentFieldName = toFieldName(contract, parentNamespaceId, parentModelName, localColumn);
    const childFieldName = toFieldName(
      contract,
      relation.relatedNamespaceId,
      relation.relatedModelName,
      targetColumn,
    );
    scalarData[parentFieldName] = relatedRow[childFieldName];
  }
}

async function applyChildOwnedMutation(
  scope: RuntimeScope,
  context: ExecutionContext,
  resolved: ResolvedNestedInput,
  parentNamespaceId: string,
  parentModelName: string,
  parentRow: Record<string, unknown>,
  relation: RelationDefinition,
  mutation: RelationMutation<Contract<SqlStorage>, string>,
): Promise<void> {
  const contract = context.contract;
  const parentValues = readParentColumnValues(
    contract,
    parentNamespaceId,
    parentModelName,
    relation,
    parentRow,
  );

  if (isFilteredWrite(mutation)) {
    await applyFilteredWrite(
      scope,
      context,
      resolved,
      relation,
      buildChildJoinWhere(relation, parentValues),
      mutation,
    );
    return;
  }

  if (mutation.kind === 'create') {
    for (const row of parsedCreateRows(context, resolved, relation, mutation)) {
      const scalarData: Record<string, unknown> = { ...row.scalarData };

      for (const [childColumn, parentValue] of parentValues.entries()) {
        const childFieldName = toFieldName(
          contract,
          relation.relatedNamespaceId,
          relation.relatedModelName,
          childColumn,
        );
        scalarData[childFieldName] = parentValue;
      }

      await createParsedGraph(
        scope,
        context,
        resolved,
        relation.relatedNamespaceId,
        relation.relatedModelName,
        { scalarData, relationMutations: row.relationMutations },
      );
    }
    return;
  }

  if (mutation.kind === 'connect') {
    for (const criterion of mutation.criteria) {
      const criterionWhere = relationCriterionWhere(context, relation, 'connect', criterion);

      const setValues: Record<string, unknown> = {};
      for (const [childColumn, parentValue] of parentValues.entries()) {
        setValues[childColumn] = parentValue;
      }

      await executeUpdateCount(
        scope,
        contract,
        relation.relatedNamespaceId,
        relation.relatedTableName,
        setValues,
        [criterionWhere],
      );
    }
    return;
  }

  const setValues: Record<string, unknown> = {};
  for (const childColumn of parentValues.keys()) {
    setValues[childColumn] = null;
  }

  if (!mutation.criteria || mutation.criteria.length === 0) {
    const parentJoinWhere = buildChildJoinWhere(relation, parentValues);
    await executeUpdateCount(
      scope,
      contract,
      relation.relatedNamespaceId,
      relation.relatedTableName,
      setValues,
      [parentJoinWhere],
    );
    return;
  }

  for (const criterion of mutation.criteria) {
    const criterionWhere = relationCriterionWhere(context, relation, 'disconnect', criterion);

    const parentJoinWhere = buildChildJoinWhere(relation, parentValues);
    await executeUpdateCount(
      scope,
      contract,
      relation.relatedNamespaceId,
      relation.relatedTableName,
      setValues,
      [and(parentJoinWhere, criterionWhere)],
    );
  }
}

async function applyFilteredWrite(
  scope: RuntimeScope,
  context: ExecutionContext,
  resolved: ResolvedNestedInput,
  relation: RelationDefinition,
  relatedToParent: AnyExpression,
  mutation: FilteredWriteMutation,
): Promise<void> {
  const contract = context.contract;
  const namespaceId = relation.relatedNamespaceId;
  const tableName = relation.relatedTableName;
  const filters = [relatedToParent, ...resolvedFilters(context, resolved, relation, mutation)];

  if (mutation.kind === 'deleteAll') {
    await scope.execute(compileDeleteCount(contract, namespaceId, tableName, filters));
    return;
  }

  const setValues = mapModelDataToStorageRow(
    contract,
    namespaceId,
    relation.relatedModelName,
    mutation.data,
  );
  if (Object.keys(setValues).length === 0) {
    return;
  }

  const appliedDefaults = context.applyMutationDefaults({
    op: 'update',
    entry: tableName,
    namespace: namespaceId,
    values: setValues,
  });
  for (const def of appliedDefaults) {
    setValues[def.field] = def.value;
  }

  await executeUpdateCount(scope, contract, namespaceId, tableName, setValues, filters);
}

function resolveRelationFilter(
  context: ExecutionContext,
  relation: RelationDefinition,
  input: RelationMutationFilter<Contract<SqlStorage>, string>,
): AnyExpression | undefined {
  const namespaceId = relation.relatedNamespaceId;
  const modelName = relation.relatedModelName;
  const whereArg =
    typeof input === 'function'
      ? input(createModelAccessor(context, namespaceId, modelName))
      : isWhereDirectInput(input)
        ? input
        : shorthandToWhereExpr(context, namespaceId, modelName, input);
  return normalizeWhereArg(whereArg, { contract: context.contract, namespaceId });
}

async function applyJunctionOwnedMutation(
  scope: RuntimeScope,
  context: ExecutionContext,
  resolved: ResolvedNestedInput,
  parentNamespaceId: string,
  parentModelName: string,
  parentRow: Record<string, unknown>,
  relation: JunctionRelationDefinition,
  mutation: RelationMutation<Contract<SqlStorage>, string>,
): Promise<void> {
  const contract = context.contract;
  const parentPkValues = readJunctionParentValues(
    contract,
    parentNamespaceId,
    parentModelName,
    relation,
    parentRow,
  );

  if (isFilteredWrite(mutation)) {
    await applyFilteredWrite(
      scope,
      context,
      resolved,
      relation,
      buildJunctionMembershipWhere(contract, relation, parentPkValues),
      mutation,
    );
    return;
  }

  if (mutation.kind === 'create') {
    for (const row of parsedCreateRows(context, resolved, relation, mutation)) {
      const relatedRow = await createParsedGraph(
        scope,
        context,
        resolved,
        relation.relatedNamespaceId,
        relation.relatedModelName,
        row,
      );
      const targetPkValues = readJunctionTargetValues(contract, relation, relatedRow);
      await insertJunctionLink(scope, context, relation, parentPkValues, targetPkValues, 'create');
    }
    return;
  }

  if (mutation.kind === 'connect') {
    for (const criterion of mutation.criteria) {
      const targetPkValues = await resolveJunctionTargetValues(
        scope,
        context,
        relation,
        'connect',
        criterion,
      );
      await insertJunctionLink(scope, context, relation, parentPkValues, targetPkValues, 'connect');
    }
    return;
  }

  for (const criterion of mutation.criteria ?? []) {
    const targetPkValues = await resolveJunctionTargetValues(
      scope,
      context,
      relation,
      'disconnect',
      criterion,
    );
    await deleteJunctionLink(scope, context, relation, parentPkValues, targetPkValues);
  }
}

async function preflightJunctionOwnedCreateMutation(
  scope: RuntimeScope,
  context: ExecutionContext,
  relation: JunctionRelationDefinition,
  mutation: RelationMutation<Contract<SqlStorage>, string>,
): Promise<void> {
  if (mutation.kind !== 'connect') {
    return;
  }

  const seenTargetKeys = new Set<string>();
  for (const criterion of mutation.criteria) {
    const targetValues = await resolveJunctionTargetValues(
      scope,
      context,
      relation,
      'connect',
      criterion,
    );
    const targetKey = JSON.stringify([...targetValues.entries()]);
    if (seenTargetKeys.has(targetKey)) {
      throw ormError(
        'ORM.RELATION_MUTATION_INVALID',
        `connect() nested mutation for relation "${relation.relationName}" resolved duplicate junction link targets; remove the duplicate criteria`,
        {
          meta: { kind: 'connect', relation: relation.relationName, problem: 'duplicate-criteria' },
        },
      );
    }
    seenTargetKeys.add(targetKey);
  }
}

function assertJunctionPayloadWritable(
  relation: JunctionRelationDefinition,
  mutationKind: RelationMutation<Contract<SqlStorage>, string>['kind'],
): void {
  const through = relation.through;
  if (
    (mutationKind !== 'create' && mutationKind !== 'connect') ||
    through.requiredPayloadColumns.length === 0
  ) {
    return;
  }

  const cols = through.requiredPayloadColumns.map((c) => `\`${c}\``).join(', ');
  throw ormError(
    'ORM.RELATION_MUTATION_UNSUPPORTED',
    `Cannot \`${mutationKind}\` on relation \`${relation.relationName}\`: its junction \`${through.table}\` has required column(s) ${cols} the relation API can't populate. Write the \`${through.table}\` junction directly or use the SQL builder.`,
    {
      meta: {
        kind: mutationKind,
        relation: relation.relationName,
        reason: 'junction-required-columns',
        junction: through.table,
      },
    },
  );
}

async function resolveJunctionTargetValues(
  scope: RuntimeScope,
  context: ExecutionContext,
  relation: JunctionRelationDefinition,
  kind: 'connect' | 'disconnect',
  criterion: Record<string, unknown>,
): Promise<Map<string, unknown>> {
  const relatedRow = await findRowByCriterion(
    scope,
    context,
    relation.relatedNamespaceId,
    relation.relatedModelName,
    criterion,
  );
  if (!relatedRow) {
    throw ormError(
      'ORM.RELATION_ROW_MISSING',
      `${kind}() nested mutation for relation "${relation.relationName}" did not find a matching row`,
      { meta: { kind, relation: relation.relationName } },
    );
  }
  return readJunctionTargetValues(context.contract, relation, relatedRow);
}

function readJunctionParentValues(
  contract: Contract<SqlStorage>,
  parentNamespaceId: string,
  parentModelName: string,
  relation: JunctionRelationDefinition,
  parentRow: Record<string, unknown>,
): Map<string, unknown> {
  const values = new Map<string, unknown>();
  assertJunctionParentMetadataLength(relation);

  for (let i = 0; i < relation.through.parentColumns.length; i++) {
    const junctionColumn = relation.through.parentColumns[i];
    const parentColumn = relation.localColumns[i];
    if (junctionColumn === undefined || parentColumn === undefined) {
      throw new InternalError(
        `Relation "${relation.relationName}" has incomplete junction metadata for parent columns`,
      );
    }

    const parentFieldName = toFieldName(contract, parentNamespaceId, parentModelName, parentColumn);
    const parentValue = parentRow[parentFieldName];
    if (parentValue === undefined) {
      throw new InternalError(
        `Nested mutation requires parent field "${parentFieldName}" to be present in returned row`,
      );
    }

    values.set(junctionColumn, parentValue);
  }

  return values;
}

function readJunctionTargetValues(
  contract: Contract<SqlStorage>,
  relation: JunctionRelationDefinition,
  relatedRow: Record<string, unknown>,
): Map<string, unknown> {
  const values = new Map<string, unknown>();
  assertJunctionTargetMetadataLength(relation);

  for (let i = 0; i < relation.through.childColumns.length; i++) {
    const junctionColumn = relation.through.childColumns[i];
    const targetColumn = relation.through.targetColumns[i];
    if (junctionColumn === undefined || targetColumn === undefined) {
      throw new InternalError(
        `Relation "${relation.relationName}" has incomplete junction metadata for target columns`,
      );
    }

    const targetFieldName = toFieldName(
      contract,
      relation.relatedNamespaceId,
      relation.relatedModelName,
      targetColumn,
    );
    const targetValue = relatedRow[targetFieldName];
    if (targetValue === undefined) {
      throw new InternalError(
        `Nested mutation requires target field "${targetFieldName}" to be present in returned row`,
      );
    }

    values.set(junctionColumn, targetValue);
  }

  return values;
}

function assertJunctionMetadataLength(
  relation: JunctionRelationDefinition,
  throughColumnName: string,
  throughColumns: readonly string[],
  pairedColumnName: string,
  pairedColumns: readonly string[],
): void {
  if (throughColumns.length === pairedColumns.length) {
    return;
  }

  throw new InternalError(
    `Relation "${relation.relationName}" has invalid junction metadata: ${throughColumnName} has ${throughColumns.length} column(s), but ${pairedColumnName} has ${pairedColumns.length}`,
  );
}

export function assertJunctionParentMetadataLength(relation: JunctionRelationDefinition): void {
  assertJunctionMetadataLength(
    relation,
    'parentColumns',
    relation.through.parentColumns,
    'localColumns',
    relation.localColumns,
  );
}

export function assertJunctionTargetMetadataLength(relation: JunctionRelationDefinition): void {
  assertJunctionMetadataLength(
    relation,
    'childColumns',
    relation.through.childColumns,
    'targetColumns',
    relation.through.targetColumns,
  );
}

function assertJunctionMetadataShape(relation: JunctionRelationDefinition): void {
  assertJunctionParentMetadataLength(relation);
  assertJunctionTargetMetadataLength(relation);
}

function writeJunctionColumn(
  junctionRow: Record<string, unknown>,
  through: JunctionThrough,
  column: string,
  value: unknown,
  relationName: string,
): void {
  if (Object.hasOwn(junctionRow, column) && !Object.is(junctionRow[column], value)) {
    throw ormError(
      'ORM.RELATION_MUTATION_INVALID',
      `Cannot write junction "${through.table}": conflicting values for junction column "${column}"`,
      { meta: { relation: relationName, junction: through.table, column } },
    );
  }

  junctionRow[column] = value;
}

async function insertJunctionLink(
  scope: RuntimeScope,
  context: ExecutionContext,
  relation: JunctionRelationDefinition,
  parentPkValues: Map<string, unknown>,
  targetPkValues: Map<string, unknown>,
  mutationKind: 'create' | 'connect',
): Promise<void> {
  const through = relation.through;
  const junctionRow: Record<string, unknown> = {};
  for (const [column, value] of parentPkValues.entries()) {
    writeJunctionColumn(junctionRow, through, column, value, relation.relationName);
  }
  for (const [column, value] of targetPkValues.entries()) {
    writeJunctionColumn(junctionRow, through, column, value, relation.relationName);
  }

  // Mirror insertSingleRow: payload columns whose only source is an
  // execution-time onCreate default pass both the type gate and the runtime
  // guard, so the INSERT must populate them here or hit NOT NULL on the
  // database.
  const applied = context.applyMutationDefaults({
    op: 'create',
    entry: through.table,
    namespace: through.namespaceId,
    values: junctionRow,
  });
  for (const def of applied) {
    junctionRow[def.field] = def.value;
  }

  const compiled = compileInsertCount(context.contract, through.namespaceId, through.table, [
    junctionRow,
  ]);
  try {
    await scope.execute(compiled);
  } catch (error) {
    // The junction PK is the common unique constraint here, but the table may
    // carry others — say a unique constraint was violated rather than
    // asserting the link itself already exists.
    if (mutationKind === 'connect' && isUniqueConstraintViolation(error)) {
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
  // Merge through writeJunctionColumn like the INSERT side: a shared junction
  // column with mismatched parent/target values surfaces the same conflict
  // error as connect instead of emitting contradictory predicates that make
  // the DELETE silently match nothing.
  const through = relation.through;
  const junctionRow: Record<string, unknown> = {};
  for (const [column, value] of parentPkValues.entries()) {
    writeJunctionColumn(junctionRow, through, column, value, relation.relationName);
  }
  for (const [column, value] of targetPkValues.entries()) {
    writeJunctionColumn(junctionRow, through, column, value, relation.relationName);
  }

  const exprs: AnyExpression[] = [];
  for (const [column, value] of Object.entries(junctionRow)) {
    exprs.push(BinaryExpr.eq(ColumnRef.of(through.table, column), LiteralExpr.of(value)));
  }

  const first = exprs[0];
  const where = exprs.length === 1 && first !== undefined ? first : and(...exprs);
  const compiled = compileDeleteCount(context.contract, through.namespaceId, through.table, [
    where,
  ]);
  await scope.execute(compiled);
}

function readParentColumnValues(
  contract: Contract<SqlStorage>,
  parentNamespaceId: string,
  parentModelName: string,
  relation: RelationDefinition,
  parentRow: Record<string, unknown>,
): Map<string, unknown> {
  const values = new Map<string, unknown>();

  for (let i = 0; i < relation.localColumns.length; i++) {
    const localColumn = relation.localColumns[i];
    const targetColumn = relation.targetColumns[i];
    if (!localColumn || !targetColumn) {
      continue;
    }

    const parentFieldName = toFieldName(contract, parentNamespaceId, parentModelName, localColumn);
    const parentValue = parentRow[parentFieldName];
    if (parentValue === undefined) {
      throw new InternalError(
        `Nested mutation requires parent field "${parentFieldName}" to be present in returned row`,
      );
    }

    values.set(targetColumn, parentValue);
  }

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
  const exprs: AnyExpression[] = [];

  for (const [childColumn, parentValue] of childValues.entries()) {
    exprs.push(
      BinaryExpr.eq(
        ColumnRef.of(relation.relatedTableName, childColumn),
        LiteralExpr.of(parentValue),
      ),
    );
  }

  const first = exprs[0];
  if (exprs.length === 1 && first !== undefined) {
    return first;
  }

  return and(...exprs);
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

  const mappedData = mapModelDataToStorageRow(contract, namespaceId, modelName, data);
  const applied = context.applyMutationDefaults({
    op: 'create',
    entry: tableName,
    namespace: namespaceId,
    values: mappedData,
  });

  for (const def of applied) {
    mappedData[def.field] = def.value;
  }

  const compiled = compileInsertReturning(
    contract,
    namespaceId,
    tableName,
    [mappedData],
    undefined,
  );
  const rows = await queryPlanRows<Record<string, unknown>>(scope, compiled).toArray();

  const firstRow = rows[0];
  if (!firstRow) {
    throw ormError(
      'ORM.MUTATION_ROW_MISSING',
      `Nested create for model "${modelName}" did not return a row`,
      { meta: { operation: 'create', model: modelName, phase: 'nested' } },
    );
  }

  return mapStorageRowToModelFields(contract, namespaceId, modelName, firstRow);
}

async function findRowByCriterion(
  scope: RuntimeScope,
  context: ExecutionContext,
  namespaceId: string,
  modelName: string,
  criterion: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const contract = context.contract;
  const whereExpr = modelCriterionWhere(context, namespaceId, modelName, criterion);

  const tableName = resolveModelTableName(contract, namespaceId, modelName);
  const state: CollectionState = {
    ...emptyState(),
    filters: [whereExpr],
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

async function executeUpdateCount(
  scope: RuntimeScope,
  contract: Contract<SqlStorage>,
  namespaceId: string,
  tableName: string,
  setValues: Record<string, unknown>,
  filters: readonly AnyExpression[],
): Promise<void> {
  const compiled = compileUpdateCount(contract, namespaceId, tableName, setValues, filters);
  await scope.execute(compiled);
}

const relationDefsCache = new WeakMap<object, Map<string, RelationDefinition[]>>();

function getRelationDefinitions(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  modelName: string,
): RelationDefinition[] {
  let perContract = relationDefsCache.get(contract);
  if (!perContract) {
    perContract = new Map();
    relationDefsCache.set(contract, perContract);
  }
  const cacheKey = JSON.stringify([namespaceId, modelName]);
  const cached = perContract.get(cacheKey);
  if (cached) return cached;

  // The base model's relations resolve within its namespace; relation
  // targets resolve within the target model's namespace (`relation.toNamespace`,
  // carried by the cross-reference) so a cross-namespace relation does not
  // fall back to the default/first-match path.
  const relations = resolveModelRelations(contract, namespaceId, modelName);
  const definitions = Object.entries(relations).map(([relationName, relation]) => ({
    relationName,
    relatedModelName: relation.to,
    relatedNamespaceId: relation.toNamespace,
    relatedTableName: resolveModelTableName(contract, relation.toNamespace, relation.to),
    cardinality: relation.cardinality,
    localColumns: relation.on.localFields.map((f) =>
      resolveFieldToColumn(contract, namespaceId, modelName, f),
    ),
    targetColumns: relation.on.targetFields.map((f) =>
      resolveFieldToColumn(contract, relation.toNamespace, relation.to, f),
    ),
    through: relation.through
      ? {
          table: relation.through.table,
          namespaceId: relation.through.namespaceId,
          parentColumns: relation.through.parentColumns,
          childColumns: relation.through.childColumns,
          targetColumns: relation.through.targetColumns,
          requiredPayloadColumns: relation.through.requiredPayloadColumns,
        }
      : undefined,
  }));

  perContract.set(cacheKey, definitions);
  return definitions;
}

function toFieldName(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  modelName: string,
  columnName: string,
): string {
  const columnToField = getColumnToFieldMap(contract, namespaceId, modelName);
  return columnToField[columnName] ?? columnName;
}
