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
import { ifDefined } from '@internal/utils/defined';
import { InternalError } from '@internal/utils/internal-error';
import {
  getColumnToFieldMap,
  type ResolvedThrough,
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
import { applyCreateDefaults, applyUpdateDefaults, insertRowReturning } from './row-writes';
import { tableSourceForContract } from './storage-resolution';
import type {
  CollectionState,
  MutationCreateInput,
  MutationUpdateInput,
  RelationCardinalityTag,
  RelationMutation,
  RelationMutationCreate,
  RelationMutationDeleteAll,
  RelationMutationUpdateAll,
  RuntimeQueryable,
  RuntimeTransaction,
} from './types';
import { emptyState } from './types';
import { resolveWhereInput } from './where-interop';
import { combineWhereExprs } from './where-utils';

interface RelationDefinitionBase {
  readonly relationName: string;
  readonly relatedModelName: string;
  readonly relatedNamespaceId: string;
  readonly relatedTableName: string;
  readonly cardinality: RelationCardinalityTag | undefined;
  readonly localColumns: readonly string[];
  readonly targetColumns: readonly string[];
}

export interface JunctionRelationDefinition extends RelationDefinitionBase {
  readonly through: ResolvedThrough;
}

type RelationDefinition =
  | (RelationDefinitionBase & { readonly ownership: 'parent' })
  | (RelationDefinitionBase & { readonly ownership: 'child' })
  | (JunctionRelationDefinition & { readonly ownership: 'junction' });

type RelationOwnership = RelationDefinition['ownership'];

const resolutionOrder: Record<RelationOwnership, number> = { parent: 0, junction: 1, child: 2 };

interface ParsedRelationMutation {
  readonly relation: RelationDefinition;
  readonly mutations: readonly RelationMutation<Contract<SqlStorage>, string>[];
}

interface ParsedMutationInput {
  readonly scalarData: Record<string, unknown>;
  readonly relationMutations: readonly ParsedRelationMutation[];
}

type ResolvedOperation =
  | { readonly kind: 'create'; readonly rows: readonly ResolvedMutationInput[] }
  | { readonly kind: 'connect'; readonly criteria: readonly AnyExpression[] }
  | { readonly kind: 'disconnect'; readonly criteria: readonly AnyExpression[] }
  | {
      readonly kind: 'updateAll';
      readonly filters: readonly AnyExpression[];
      readonly setValues: Record<string, unknown>;
    }
  | { readonly kind: 'deleteAll'; readonly filters: readonly AnyExpression[] };

interface ResolvedRelationMutation {
  readonly relation: RelationDefinition;
  readonly operations: readonly ResolvedOperation[];
}

interface ResolvedMutationInput {
  readonly scalarData: Record<string, unknown>;
  readonly relationMutations: readonly ResolvedRelationMutation[];
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

  for (const { relation, operation } of operationsOwnedBy(input, 'junction')) {
    await preflightJunctionOwnedCreateMutation(scope, context, relation, operation);
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
      throw invalidRelationField(
        fieldName,
        modelName,
        'missing-callback',
        'expects a mutator callback',
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

function invalidRelationField(
  fieldName: string,
  modelName: string,
  problem: string,
  detail: string,
  index?: number,
) {
  return ormError(
    'ORM.RELATION_MUTATION_INVALID',
    `Relation field "${fieldName}" on model "${modelName}" ${detail}`,
    { meta: { relation: fieldName, model: modelName, problem, ...ifDefined('index', index) } },
  );
}

function invalidMutation(
  kind: string,
  relation: RelationDefinitionBase,
  problem: string,
  detail: string,
  extraMeta: Record<string, unknown> = {},
) {
  return ormError(
    'ORM.RELATION_MUTATION_INVALID',
    `${kind}() nested mutation for relation "${relation.relationName}" ${detail}`,
    { meta: { kind, relation: relation.relationName, problem, ...extraMeta } },
  );
}

function unsupportedMutation(
  kind: string,
  relation: RelationDefinitionBase,
  message: string,
  extraMeta: Record<string, unknown> = {},
) {
  return ormError('ORM.RELATION_MUTATION_UNSUPPORTED', message, {
    meta: { kind, relation: relation.relationName, ...extraMeta },
  });
}

function toRelationMutationList(
  fieldName: string,
  modelName: string,
  result: unknown,
): readonly RelationMutation<Contract<SqlStorage>, string>[] {
  if (!Array.isArray(result)) {
    if (!isRelationMutationDescriptor(result)) {
      throw invalidRelationField(
        fieldName,
        modelName,
        'invalid-descriptor',
        'returned an invalid mutation descriptor',
      );
    }
    return [result];
  }

  const elements: readonly unknown[] = result;
  const mutations: RelationMutation<Contract<SqlStorage>, string>[] = [];
  for (const [index, element] of elements.entries()) {
    if (Array.isArray(element)) {
      throw invalidRelationField(
        fieldName,
        modelName,
        'nested-array',
        `returned a nested array at index ${index}; return one flat array of mutations`,
        index,
      );
    }
    if (!isRelationMutationDescriptor(element)) {
      throw invalidRelationField(
        fieldName,
        modelName,
        'invalid-descriptor',
        `returned an invalid mutation descriptor at index ${index}`,
        index,
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
    throw unsupportedMutation(
      mutation.kind,
      relation,
      `${mutation.kind}() is only supported in update() nested mutations`,
    );
  }
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
    throw invalidMutation(kind, relation, 'empty-criterion', 'requires non-empty criterion');
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
    throw invalidMutation(
      'updateAll',
      relation,
      'parent-link-column',
      `cannot set ${parentLinkFields.map((field) => `"${field}"`).join(', ')}, which links the related rows to their parent`,
      { fields: parentLinkFields },
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

function resolveMutationInput(
  context: ExecutionContext,
  namespaceId: string,
  modelName: string,
  input:
    | MutationCreateInput<Contract<SqlStorage>, string>
    | MutationUpdateInput<Contract<SqlStorage>, string>,
  entryPoint: 'create' | 'update',
): ResolvedMutationInput {
  return resolveParsedInput(
    context,
    parseMutationInput(context.contract, namespaceId, modelName, input),
    entryPoint,
  );
}

function resolveParsedInput(
  context: ExecutionContext,
  parsed: ParsedMutationInput,
  entryPoint: 'create' | 'update',
): ResolvedMutationInput {
  return {
    scalarData: parsed.scalarData,
    relationMutations: [...parsed.relationMutations]
      .sort((a, b) => resolutionOrder[a.relation.ownership] - resolutionOrder[b.relation.ownership])
      .map(({ relation, mutations }) => ({
        relation,
        operations: mutations.map((mutation) => {
          if (entryPoint === 'create') {
            assertAllowedInCreate(relation, mutation);
          }
          return resolveOperation(context, relation, mutation);
        }),
      })),
  };
}

function assertCreateRowsAreObjects(
  relation: RelationDefinition,
  mutation: RelationMutationCreate<Contract<SqlStorage>, string>,
): void {
  const rows: readonly unknown[] = mutation.data;
  rows.forEach((row, index) => {
    if (row === null || row === undefined) {
      throw invalidMutation('create', relation, 'missing-data', 'requires data');
    }
    if (typeof row !== 'object' || Array.isArray(row)) {
      throw invalidMutation(
        'create',
        relation,
        'invalid-data',
        `requires an object for each row; the value at index ${index} is not an object`,
        { index },
      );
    }
  });
}

function resolveOperation(
  context: ExecutionContext,
  relation: RelationDefinition,
  mutation: RelationMutation<Contract<SqlStorage>, string>,
): ResolvedOperation {
  const contract = context.contract;
  const namespaceId = relation.relatedNamespaceId;
  const modelName = relation.relatedModelName;
  const junction = relation.ownership === 'junction';
  const parentOwned = relation.ownership === 'parent';
  if (relation.ownership === 'junction') {
    assertJunctionPayloadWritable(relation, mutation.kind);
  }

  if (isFilteredWrite(mutation)) {
    if (parentOwned || (relation.ownership === 'child' && relation.cardinality === '1:1')) {
      throw unsupportedMutation(
        mutation.kind,
        relation,
        `${mutation.kind}() nested mutation for relation "${relation.relationName}" is only supported on to-many relations`,
        { reason: 'to-one-relation' },
      );
    }
    const filters = mutation.filters.flatMap((input) => {
      const filter = resolveWhereInput(input, {
        contract,
        namespaceId,
        accessor: () => createModelAccessor(context, namespaceId, modelName),
        shorthand: (shorthand) => shorthandToWhereExpr(context, namespaceId, modelName, shorthand),
      });
      return filter ? [filter] : [];
    });
    if (mutation.kind === 'deleteAll') {
      return { kind: 'deleteAll', filters };
    }
    const setValues = mapModelDataToStorageRow(contract, namespaceId, modelName, mutation.data);
    assertNoParentLinkColumn(
      contract,
      relation,
      setValues,
      junction ? new Set() : childLinkColumns(relation),
    );
    return { kind: 'updateAll', filters, setValues };
  }

  if (mutation.kind === 'create') {
    assertCreateRowsAreObjects(relation, mutation);
    const inputs = parentOwned ? mutation.data.slice(0, 1) : mutation.data;
    if (parentOwned && inputs.length === 0) {
      throw invalidMutation('create', relation, 'missing-data', 'requires data');
    }
    return {
      kind: 'create',
      rows: inputs
        .map((input) => parseMutationInput(contract, namespaceId, modelName, input))
        .map((parsed) => resolveParsedInput(context, parsed, 'create')),
    };
  }

  if (parentOwned) {
    if (mutation.kind === 'disconnect') {
      return { kind: 'disconnect', criteria: [] };
    }
    const criterion = mutation.criteria[0];
    if (!criterion) {
      throw invalidMutation('connect', relation, 'missing-criterion', 'requires criterion');
    }
    return {
      kind: 'connect',
      criteria: [
        modelCriterionWhere(
          context,
          namespaceId,
          modelName,
          castAs<Record<string, unknown>>(criterion),
        ),
      ],
    };
  }

  const criteria = mutation.criteria ?? [];
  if (junction && mutation.kind === 'disconnect' && criteria.length === 0) {
    throw invalidMutation('disconnect', relation, 'missing-criterion', 'requires criterion');
  }
  return {
    kind: mutation.kind,
    criteria: criteria.map((criterion) =>
      junction
        ? modelCriterionWhere(context, namespaceId, modelName, criterion)
        : relationCriterionWhere(context, relation, mutation.kind, criterion),
    ),
  };
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
      const relatedRow = await findFirstByFilters(
        scope,
        contract,
        relation.relatedNamespaceId,
        relation.relatedModelName,
        [criterion],
      );
      if (!relatedRow) {
        throw ormError(
          'ORM.RELATION_ROW_MISSING',
          `connect() nested mutation for relation "${relation.relationName}" did not find a matching row`,
          { meta: { kind: 'connect', relation: relation.relationName } },
        );
      }
      relatedRows.push(relatedRow);
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
      scalarData[toFieldName(contract, parentNamespaceId, parentModelName, localColumn)] = value;
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
        const childFieldName = toFieldName(
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

  const parentJoinWhere = buildChildJoinWhere(relation, parentValues);
  const disconnectFilters =
    operation.criteria.length === 0
      ? [parentJoinWhere]
      : operation.criteria.map((criterionWhere) => and(parentJoinWhere, criterionWhere));
  for (const filter of disconnectFilters) {
    await executeUpdateCount(
      scope,
      contract,
      relation.relatedNamespaceId,
      relation.relatedTableName,
      setValues,
      [filter],
    );
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
  await executeUpdateCount(scope, contract, namespaceId, tableName, setValues, filters);
}

async function applyJunctionOwnedMutation(
  scope: RuntimeScope,
  context: ExecutionContext,
  parentNamespaceId: string,
  parentModelName: string,
  parentRow: Record<string, unknown>,
  relation: JunctionRelationDefinition,
  operation: ResolvedOperation,
): Promise<void> {
  const contract = context.contract;
  const parentPkValues = readLinkValues(
    contract,
    parentNamespaceId,
    parentModelName,
    parentRow,
    'parent',
    relation.localColumns,
    relation.through.parentColumns,
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

  for (const criterion of operation.criteria) {
    const targetPkValues = await resolveJunctionTargetValues(
      scope,
      context,
      relation,
      operation.kind,
      criterion,
    );
    if (operation.kind === 'connect') {
      await insertJunctionLink(scope, context, relation, parentPkValues, targetPkValues, 'connect');
    } else {
      await deleteJunctionLink(scope, context, relation, parentPkValues, targetPkValues);
    }
  }
}

async function preflightJunctionOwnedCreateMutation(
  scope: RuntimeScope,
  context: ExecutionContext,
  relation: JunctionRelationDefinition,
  operation: ResolvedOperation,
): Promise<void> {
  if (operation.kind !== 'connect') {
    return;
  }

  const seenTargetKeys = new Set<string>();
  for (const criterion of operation.criteria) {
    const targetValues = await resolveJunctionTargetValues(
      scope,
      context,
      relation,
      'connect',
      criterion,
    );
    const targetKey = JSON.stringify([...targetValues.entries()]);
    if (seenTargetKeys.has(targetKey)) {
      throw invalidMutation(
        'connect',
        relation,
        'duplicate-criteria',
        'resolved duplicate junction link targets; remove the duplicate criteria',
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
  throw unsupportedMutation(
    mutationKind,
    relation,
    `Cannot \`${mutationKind}\` on relation \`${relation.relationName}\`: its junction \`${through.table}\` has required column(s) ${cols} the relation API can't populate. Write the \`${through.table}\` junction directly or use the SQL builder.`,
    { reason: 'junction-required-columns', junction: through.table },
  );
}

async function resolveJunctionTargetValues(
  scope: RuntimeScope,
  context: ExecutionContext,
  relation: JunctionRelationDefinition,
  kind: 'connect' | 'disconnect',
  criterion: AnyExpression,
): Promise<Map<string, unknown>> {
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
  return readJunctionTargetValues(context.contract, relation, relatedRow);
}

function readJunctionTargetValues(
  contract: Contract<SqlStorage>,
  relation: JunctionRelationDefinition,
  relatedRow: Record<string, unknown>,
): Map<string, unknown> {
  return readLinkValues(
    contract,
    relation.relatedNamespaceId,
    relation.relatedModelName,
    relatedRow,
    'target',
    relation.through.targetColumns,
    relation.through.childColumns,
  );
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
  relation: JunctionRelationDefinition,
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
  const junctionRow = buildJunctionRow(relation, parentPkValues, targetPkValues);

  const exprs = Object.entries(junctionRow).map(([column, value]) =>
    BinaryExpr.eq(ColumnRef.of(through.table, column), LiteralExpr.of(value)),
  );
  const compiled = compileDeleteCount(context.contract, through.namespaceId, through.table, [
    combineWhereExprs(exprs) ?? and(),
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
    const fieldName = toFieldName(contract, namespaceId, modelName, sourceColumn);
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
      return;
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
  const exprs = [...childValues].map(([childColumn, parentValue]) =>
    BinaryExpr.eq(
      ColumnRef.of(relation.relatedTableName, childColumn),
      LiteralExpr.of(parentValue),
    ),
  );
  return combineWhereExprs(exprs) ?? and();
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
  const definitions = Object.entries(relations).map(
    ([relationName, relation]): RelationDefinition => {
      const definition: RelationDefinitionBase = {
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
      };
      if (relation.through) {
        const junction = { ...definition, through: relation.through };
        assertJunctionParentMetadataLength(junction);
        assertJunctionTargetMetadataLength(junction);
        return { ...junction, ownership: 'junction' };
      }
      return {
        ...definition,
        ownership: relation.cardinality === 'N:1' ? 'parent' : 'child',
      };
    },
  );

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
