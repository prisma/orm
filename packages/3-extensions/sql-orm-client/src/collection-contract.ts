import type {
  Contract,
  ContractField,
  ContractFieldType,
  ContractRelationThrough,
  CrossReference,
} from '@internal/contract/types';
import type { SqlStorage, StorageTable } from '@internal/sql-contract/types';
import { type CapabilityRequirement, missingCapability } from '@internal/sql-relational-core/ast';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { InternalError } from '@internal/utils/internal-error';
import { ormError } from './orm-errors';
import {
  domainModelTableInNamespace,
  resolveTableForContract,
  storageTableForContract,
} from './storage-resolution';
import type { IncludeThroughDescriptor, RelationCardinalityTag } from './types';

type ModelStorageFields = Record<string, { column?: string }>;
type ModelEntry = {
  storage?: { table?: string; fields?: ModelStorageFields };
  relations?: Record<string, unknown>;
  fields?: Record<string, { type?: ContractFieldType; many?: ContractField['many'] }>;
  discriminator?: { field: string };
  variants?: Record<string, { value: string }>;
  base?: CrossReference;
};
type ModelsMap = Record<string, ModelEntry>;

export interface PolymorphismVariantInfo {
  readonly modelName: string;
  readonly value: string;
  readonly table: string;
  readonly strategy: 'sti' | 'mti';
}

export interface PolymorphismInfo {
  readonly discriminatorField: string;
  readonly discriminatorColumn: string;
  readonly baseTable: string;
  readonly variants: ReadonlyMap<string, PolymorphismVariantInfo>;
  readonly variantsByValue: ReadonlyMap<string, PolymorphismVariantInfo>;
  readonly mtiVariants: readonly PolymorphismVariantInfo[];
}

export const POLYMORPHIC_DISCRIMINATOR_ALIAS = '__prisma_polymorphic_discriminator';

// Model map for a model's metadata resolution. The lookup is always scoped to
// an explicit namespace coordinate (`orm.<ns>.<Model>`); bare-name access
// resolves the sole namespace upstream (in the ORM factory) before reaching
// here.
function modelsOf(contract: Contract<SqlStorage>, namespaceId: string): ModelsMap {
  const namespace = contract.domain.namespaces[namespaceId];
  if (namespace === undefined) {
    throw new InternalError(`domain namespace "${namespaceId}" is not present on the contract`);
  }
  return blindCast<ModelsMap, 'domain namespace models are model entries for this SQL contract'>(
    namespace.models,
  );
}

function metadataCacheKey(namespaceId: string, modelName: string): string {
  return JSON.stringify([namespaceId, modelName]);
}

export function modelOf(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  name: string,
): ModelEntry | undefined {
  const model = contract.domain.namespaces[namespaceId]?.models[name];
  return model === undefined
    ? undefined
    : blindCast<ModelEntry, 'domain namespace model is a model entry for this SQL contract'>(model);
}

const fieldToColumnCache = new WeakMap<object, Map<string, Record<string, string>>>();
const polymorphismCache = new WeakMap<object, Map<string, PolymorphismInfo | undefined>>();

export function resolvePolymorphismInfo(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  modelName: string,
): PolymorphismInfo | undefined {
  let perContract = polymorphismCache.get(contract);
  if (!perContract) {
    perContract = new Map();
    polymorphismCache.set(contract, perContract);
  }
  const cacheKey = metadataCacheKey(namespaceId, modelName);
  if (perContract.has(cacheKey)) return perContract.get(cacheKey);

  const models = modelsOf(contract, namespaceId);
  const model = models[modelName];
  if (!model?.discriminator || !model.variants) {
    perContract.set(cacheKey, undefined);
    return undefined;
  }

  const baseTable = model.storage?.table;
  if (!baseTable) {
    perContract.set(cacheKey, undefined);
    return undefined;
  }

  const discriminatorField = model.discriminator.field;
  const discriminatorColumn = resolveFieldToColumn(
    contract,
    namespaceId,
    modelName,
    discriminatorField,
  );

  const variants = new Map<string, PolymorphismVariantInfo>();
  const variantsByValue = new Map<string, PolymorphismVariantInfo>();
  const mtiVariants: PolymorphismVariantInfo[] = [];

  for (const [variantModelName, variantEntry] of Object.entries(model.variants)) {
    const variantModel = models[variantModelName];
    if (!variantModel) {
      throw new InternalError(
        `Model "${modelName}" declares variant "${variantModelName}", but that model is missing from the contract`,
      );
    }
    const variantTable = variantModel.storage?.table ?? baseTable;
    const strategy = variantTable === baseTable ? 'sti' : 'mti';

    const info: PolymorphismVariantInfo = {
      modelName: variantModelName,
      value: variantEntry.value,
      table: variantTable,
      strategy,
    };

    variants.set(variantModelName, info);
    variantsByValue.set(variantEntry.value, info);
    if (strategy === 'mti') {
      mtiVariants.push(info);
    }
  }

  const result: PolymorphismInfo = {
    discriminatorField,
    discriminatorColumn,
    baseTable,
    variants,
    variantsByValue,
    mtiVariants,
  };

  perContract.set(cacheKey, result);
  return result;
}

const fieldResolutionCache = new WeakMap<object, Map<string, unknown>>();

function cachedFor<T>(contract: Contract<SqlStorage>, key: readonly unknown[], build: () => T): T {
  let perContract = fieldResolutionCache.get(contract);
  if (!perContract) {
    perContract = new Map();
    fieldResolutionCache.set(contract, perContract);
  }
  const cacheKey = JSON.stringify(key);
  if (perContract.has(cacheKey)) {
    return blindCast<
      T,
      'each cache key is built by one function, which stores its own result type'
    >(perContract.get(cacheKey));
  }
  const built = build();
  perContract.set(cacheKey, built);
  return built;
}

export interface ModelFieldColumn {
  readonly table: string;
  readonly column: string;
}

/**
 * A model's fields, keyed by field name, with the table and column each maps: its own fields on its own table, and the fields it inherits from its base model on the base model's table. This is the one list of a model's fields; a column no field maps has no entry.
 */
export function getModelFields(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  modelName: string,
): Readonly<Record<string, ModelFieldColumn>> {
  return cachedFor(contract, ['fields', namespaceId, modelName], () => {
    const model = modelOf(contract, namespaceId, modelName);
    const table = model?.storage?.table;
    const own =
      table === undefined
        ? {}
        : Object.fromEntries(
            Object.entries(getFieldToColumnMap(contract, namespaceId, modelName)).map(
              ([field, column]) => [field, { table, column }],
            ),
          );
    const base = model?.base;
    return {
      ...(base === undefined ? {} : getModelFields(contract, base.namespace, base.model)),
      ...own,
    };
  });
}

/** The column each of a model's own and inherited fields maps, keyed by field name. */
export function getModelFieldColumns(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  modelName: string,
): Readonly<Record<string, string>> {
  return cachedFor(contract, ['columns', namespaceId, modelName], () =>
    Object.fromEntries(
      Object.entries(getModelFields(contract, namespaceId, modelName)).map(
        ([field, { column }]) => [field, column],
      ),
    ),
  );
}

/**
 * The fields a caller may name on a collection over a model, with their columns: the model's own and inherited fields, plus the fields of the variant the collection is narrowed to.
 */
export function getFieldColumnsInScope(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  modelName: string,
  variantName: string | undefined,
): Readonly<Record<string, string>> {
  return cachedFor(contract, ['scope', namespaceId, modelName, variantName ?? null], () => ({
    ...(variantName === undefined ? {} : getFieldToColumnMap(contract, namespaceId, variantName)),
    ...getModelFieldColumns(contract, namespaceId, modelName),
  }));
}

/**
 * The fields a `select` may name, with their columns: those in scope, and when the collection is not narrowed, every variant's fields too. Only `select` takes them, because the polymorphic projection places each column on its own table.
 */
export function getSelectableFieldColumns(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  modelName: string,
  variantName: string | undefined,
): Readonly<Record<string, string>> {
  if (variantName !== undefined) {
    return getFieldColumnsInScope(contract, namespaceId, modelName, variantName);
  }
  return cachedFor(contract, ['selectable', namespaceId, modelName], () => {
    const variants = resolvePolymorphismInfo(contract, namespaceId, modelName)?.variants;
    const columns: Record<string, string> = {};
    for (const name of variants?.keys() ?? []) {
      Object.assign(columns, getFieldToColumnMap(contract, namespaceId, name));
    }
    return { ...columns, ...getModelFieldColumns(contract, namespaceId, modelName) };
  });
}

/**
 * The column `fieldName` maps in `fieldColumns`. A name that is not a field is refused with `ORM.FIELD_UNKNOWN`, so no caller reaches a column by its column name, including a column no field maps.
 */
export function resolveFieldColumn(
  fieldColumns: Readonly<Record<string, string>>,
  modelName: string,
  fieldName: string,
): string {
  const column = Object.hasOwn(fieldColumns, fieldName) ? fieldColumns[fieldName] : undefined;
  if (column === undefined) {
    throw ormError('ORM.FIELD_UNKNOWN', `Model "${modelName}" has no field "${fieldName}"`, {
      meta: { model: modelName, field: fieldName },
    });
  }
  return column;
}

/** The column a field of the model maps, among its own and inherited fields. A name that is not a field is refused. */
export function resolveFieldToColumn(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  modelName: string,
  fieldName: string,
): string {
  return resolveFieldColumn(
    getModelFieldColumns(contract, namespaceId, modelName),
    modelName,
    fieldName,
  );
}

/**
 * The columns a relation's target fields name. A relation through a junction table names the junction's columns there, not fields of the target model.
 */
export function resolveRelationTargetColumns(
  contract: Contract<SqlStorage>,
  relation: {
    readonly to: string;
    readonly toNamespace: string;
    readonly on: { readonly targetFields: readonly string[] };
    readonly through?: unknown;
  },
): string[] {
  if (relation.through !== undefined) return [...relation.on.targetFields];
  return relation.on.targetFields.map((field) =>
    resolveFieldToColumn(contract, relation.toNamespace, relation.to, field),
  );
}

/**
 * The field of the model that maps `column`. The ORM only asks this for a column it chose itself, such as a key column, so a column no field maps is an inconsistency in the contract.
 */
export function resolveColumnToField(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  modelName: string,
  column: string,
): string {
  const columnToField = getColumnToFieldMap(contract, namespaceId, modelName);
  const field = Object.hasOwn(columnToField, column) ? columnToField[column] : undefined;
  if (field === undefined) {
    throw new InternalError(`Column "${column}" of model "${modelName}" is mapped by no field`);
  }
  return field;
}

export interface VariantColumnRef {
  // Bare storage-table name (namespace-flat, like every table name in this
  // module). The namespace is bound separately when the name becomes a
  // `TableSource` via `tableSourceForContract`/`requireStorageTableForContract`.
  readonly table: string;
  readonly column: string;
}

/**
 * Map the fields that an MTI variant contributes to `{ table, column }` refs
 * qualified against the variant's own table — the table the read path joins
 * into the correlated child SELECT. STI variants contribute nothing here:
 * their columns live on the base table and resolve through the ordinary
 * base-table field map. Base fields are intentionally absent so callers can
 * gate variant qualification strictly to variant-owned fields.
 *
 * Uncached on purpose: `resolvePolymorphismInfo` already memoizes the variant
 * lookup, and the remaining work is one pass over the variant's field→column
 * map, so a second cache layer would buy nothing.
 */
export function resolveVariantFieldColumns(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  baseModelName: string,
  variantName: string,
): Record<string, VariantColumnRef> {
  const polyInfo = resolvePolymorphismInfo(contract, namespaceId, baseModelName);
  const variant = polyInfo?.variants.get(variantName);
  const result: Record<string, VariantColumnRef> = {};

  if (variant && variant.strategy === 'mti') {
    const variantFieldToColumn = getFieldToColumnMap(contract, namespaceId, variant.modelName);
    for (const [field, column] of Object.entries(variantFieldToColumn)) {
      result[field] = { table: variant.table, column };
    }
  }

  return result;
}

export function getFieldToColumnMap(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  modelName: string,
): Record<string, string> {
  let perContract = fieldToColumnCache.get(contract);
  if (!perContract) {
    perContract = new Map();
    fieldToColumnCache.set(contract, perContract);
  }
  const cacheKey = metadataCacheKey(namespaceId, modelName);
  let cached = perContract.get(cacheKey);
  if (cached) return cached;

  const storageFields = modelsOf(contract, namespaceId)[modelName]?.storage?.fields ?? {};
  cached = {};
  for (const [f, s] of Object.entries(storageFields)) {
    if (s?.column) cached[f] = s.column;
  }
  perContract.set(cacheKey, cached);
  return cached;
}

/** The field each column of the model's own and inherited fields maps, keyed by column. */
export function getColumnToFieldMap(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  modelName: string,
): Readonly<Record<string, string>> {
  return cachedFor(contract, ['columnToField', namespaceId, modelName], () =>
    Object.fromEntries(
      Object.entries(getModelFieldColumns(contract, namespaceId, modelName)).map(
        ([field, column]) => [column, field],
      ),
    ),
  );
}

/** The field each column of the model's own fields maps, keyed by column. */
export function getOwnColumnToFieldMap(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  modelName: string,
): Readonly<Record<string, string>> {
  return cachedFor(contract, ['ownColumnToField', namespaceId, modelName], () =>
    Object.fromEntries(
      Object.entries(getFieldToColumnMap(contract, namespaceId, modelName)).map(
        ([field, column]) => [column, field],
      ),
    ),
  );
}

interface ResolvedThrough extends ContractRelationThrough {
  readonly requiredPayloadColumns: readonly string[];
}

interface ResolvedRelation {
  readonly to: string;
  readonly toNamespace: string;
  readonly cardinality: RelationCardinalityTag | undefined;
  readonly on: {
    readonly localFields: readonly string[];
    readonly targetFields: readonly string[];
  };
  readonly through?: ResolvedThrough;
}

export interface ResolvedIncludeRelation {
  readonly relatedModelName: string;
  readonly relatedNamespaceId: string;
  readonly relatedTableName: string;
  readonly localTableName: string;
  /** Target-side join columns, positionally paired with `localColumns`. */
  readonly targetColumns: readonly string[];
  /** Local-side join columns, positionally paired with `targetColumns`. */
  readonly localColumns: readonly string[];
  readonly cardinality: RelationCardinalityTag | undefined;
  readonly through?: IncludeThroughDescriptor;
}

export function resolveIncludeRelation(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  baseModelName: string,
  relationName: string,
  variantName?: string,
): ResolvedIncludeRelation {
  const polymorphism = resolvePolymorphismInfo(contract, namespaceId, baseModelName);
  const variant = variantName === undefined ? undefined : polymorphism?.variants.get(variantName);
  let declaringModelName = baseModelName;
  let localTableName = resolveModelTableName(contract, namespaceId, baseModelName);
  let relation: ResolvedRelation | undefined;

  if (variant !== undefined) {
    const variantRelations = resolveModelRelations(contract, namespaceId, variant.modelName);
    const candidate = Object.hasOwn(variantRelations, relationName)
      ? variantRelations[relationName]
      : undefined;
    if (candidate !== undefined) {
      relation = candidate;
      declaringModelName = variant.modelName;
      localTableName = variant.table;
    }
  }

  const baseRelations = resolveModelRelations(contract, namespaceId, baseModelName);
  relation ??= Object.hasOwn(baseRelations, relationName) ? baseRelations[relationName] : undefined;
  if (!relation) {
    throw ormError(
      'ORM.RELATION_UNKNOWN',
      `Relation '${relationName}' not found on model '${baseModelName}'`,
      { meta: { model: baseModelName, relation: relationName } },
    );
  }
  const { localFields, targetFields } = relation.on;
  if (localFields.length === 0 || localFields.length !== targetFields.length) {
    throw new InternalError(
      `Relation '${relationName}' on model '${declaringModelName}' has incomplete join metadata: ${localFields.length} local field(s), ${targetFields.length} target field(s)`,
    );
  }
  const localColumns = localFields.map((field) =>
    resolveFieldToColumn(contract, namespaceId, declaringModelName, field),
  );
  const targetColumns = resolveRelationTargetColumns(contract, relation);

  const relatedTableName = resolveModelTableName(contract, relation.toNamespace, relation.to);

  let through: IncludeThroughDescriptor | undefined;
  if (relation.through !== undefined) {
    through = {
      table: relation.through.table,
      namespaceId: relation.through.namespaceId,
      parentColumns: relation.through.parentColumns,
      childColumns: relation.through.childColumns,
      targetColumns: relation.through.targetColumns,
      parentLocalColumns: localColumns,
    };
  }

  return {
    relatedModelName: relation.to,
    relatedNamespaceId: relation.toNamespace,
    relatedTableName,
    localTableName,
    targetColumns,
    localColumns,
    cardinality: relation.cardinality,
    ...ifDefined('through', through),
  };
}

export function resolveThrough(
  contract: Contract<SqlStorage>,
  through: ContractRelationThrough | undefined,
): ResolvedThrough | undefined {
  if (!through) return undefined;
  const { table, namespaceId, parentColumns, childColumns, targetColumns } = through;

  const ns = contract.storage.namespaces[namespaceId];
  const junctionTable = ns?.entries.table?.[table];
  if (!junctionTable) return undefined;

  const fkColumnSet = new Set<string>([...parentColumns, ...childColumns]);
  const requiredPayloadColumns: string[] = [];
  for (const [colName, col] of Object.entries(junctionTable.columns)) {
    if (
      !fkColumnSet.has(colName) &&
      !col.nullable &&
      col.default === undefined &&
      !hasExecutionCreateDefault(contract, namespaceId, table, colName)
    ) {
      requiredPayloadColumns.push(colName);
    }
  }

  return {
    table,
    namespaceId,
    parentColumns,
    childColumns,
    targetColumns,
    requiredPayloadColumns,
  };
}

function hasExecutionCreateDefault(
  contract: Contract<SqlStorage>,
  namespace: string,
  table: string,
  column: string,
): boolean {
  return (
    contract.execution?.mutations.defaults.some(
      (mutationDefault) =>
        mutationDefault.ref.namespace === namespace &&
        mutationDefault.ref.entry === table &&
        mutationDefault.ref.field === column &&
        mutationDefault.onCreate !== undefined,
    ) ?? false
  );
}

const modelRelationsCache = new WeakMap<object, Map<string, Record<string, ResolvedRelation>>>();

export function resolveModelRelations(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  modelName: string,
): Record<string, ResolvedRelation> {
  let perContract = modelRelationsCache.get(contract);
  if (!perContract) {
    perContract = new Map();
    modelRelationsCache.set(contract, perContract);
  }
  const cacheKey = metadataCacheKey(namespaceId, modelName);
  const cached = perContract.get(cacheKey);
  if (cached) return cached;

  const models = modelsOf(contract, namespaceId);
  const relationMap = models[modelName]?.relations ?? {};
  const resolved: Record<string, ResolvedRelation> = {};

  for (const [name, value] of Object.entries(relationMap)) {
    if (!value || typeof value !== 'object') continue;

    const rel = blindCast<
      {
        to?: CrossReference;
        cardinality?: unknown;
        on?: { localFields?: unknown; targetFields?: unknown };
        through?: ContractRelationThrough;
      },
      'relation metadata is object-shaped and validated before use'
    >(value);
    const localFields = rel.on?.localFields;
    const targetFields = rel.on?.targetFields;

    if (
      !rel.to ||
      typeof rel.to !== 'object' ||
      typeof rel.to.model !== 'string' ||
      !Array.isArray(localFields) ||
      !Array.isArray(targetFields)
    ) {
      continue;
    }

    const through = resolveThrough(contract, rel.through);

    resolved[name] = {
      to: rel.to.model,
      toNamespace: rel.to.namespace,
      cardinality: parseRelationCardinality(rel.cardinality),
      on: {
        localFields: blindCast<readonly string[], 'relation localFields array was validated above'>(
          localFields,
        ),
        targetFields: blindCast<
          readonly string[],
          'relation targetFields array was validated above'
        >(targetFields),
      },
      ...(through !== undefined ? { through } : {}),
    };
  }

  perContract.set(cacheKey, resolved);
  return resolved;
}

export function parseRelationCardinality(value: unknown): RelationCardinalityTag | undefined {
  if (value === '1:1' || value === 'N:1' || value === '1:N' || value === 'N:M') {
    return value;
  }
  return undefined;
}

export function resolveUpsertConflictColumns(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  modelName: string,
  conflictOn: Record<string, unknown> | undefined,
): string[] {
  if (conflictOn && typeof conflictOn === 'object') {
    const columns = Object.keys(conflictOn).map((fieldName) =>
      resolveFieldToColumn(contract, namespaceId, modelName, fieldName),
    );
    if (columns.length > 0) {
      return columns;
    }
  }

  const tableName = resolveModelTableName(contract, namespaceId, modelName);
  const primaryKeyColumns =
    storageTableForContract(contract, namespaceId, tableName).primaryKey?.columns ?? [];
  return [...primaryKeyColumns];
}

export function resolveModelTableName(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  modelName: string,
): string {
  const table = domainModelTableInNamespace(contract, namespaceId, modelName);
  if (table === undefined) {
    throw new InternalError(
      `Model "${modelName}" has invalid or missing storage.table in namespace "${namespaceId}"`,
    );
  }
  return table;
}

export function resolvePrimaryKeyColumns(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  tableName: string,
): readonly string[] {
  const columns =
    resolveTableForContract(contract, namespaceId, tableName)?.table.primaryKey?.columns ?? [];
  if (columns.length === 0) {
    throw new InternalError(
      `Table "${tableName}" in namespace "${namespaceId}" has no primary key to join its multi-table variants on`,
    );
  }
  return columns;
}

export function resolveRowIdentityColumns(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  tableName: string,
): readonly string[] {
  let table: StorageTable;
  try {
    table = storageTableForContract(contract, namespaceId, tableName);
  } catch (error) {
    // An ambiguous bare name is a real diagnostic the caller must see — never
    // mask it as "table has no identity columns" (which surfaces as a
    // misleading "no primary key" error). A genuinely unknown table stays
    // lenient and resolves to no identity columns.
    if (error instanceof Error && error.message.includes('ambiguous')) {
      throw error;
    }
    return [];
  }
  if (table.primaryKey && table.primaryKey.columns.length > 0) {
    return table.primaryKey.columns;
  }
  for (const unique of table.uniques) {
    if (unique.columns.length > 0) {
      return unique.columns;
    }
  }
  return [];
}

export function assertReturningCapability(contract: Contract<SqlStorage>, action: string): void {
  if (hasContractCapability(contract, 'returning')) {
    return;
  }

  throw ormError('ORM.CAPABILITY_MISSING', `${action} requires contract capability "returning"`, {
    meta: { capability: 'returning', action },
  });
}

export function assertInsertConflictSkipCapability(
  contract: Contract<SqlStorage>,
  action: string,
  targeted: boolean,
): void {
  requireCapability(contract, action, 'insertOnConflictSkip');
  if (!targeted) {
    requireCapability(contract, action, 'insertOnConflictWithoutTarget');
  }
}

function requireCapability(
  contract: Contract<SqlStorage>,
  action: string,
  capability: string,
): void {
  if (hasContractCapability(contract, capability)) return;

  throw ormError(
    'ORM.CAPABILITY_MISSING',
    `${action} requires contract capability "${capability}". Re-emit the contract against an adapter that reports it.`,
    { meta: { capability, action } },
  );
}

export function resolveInsertConflictColumns(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  modelName: string,
  conflictOn: readonly string[],
): string[] {
  const fieldColumns = getModelFieldColumns(contract, namespaceId, modelName);
  return conflictOn.map((fieldName) => resolveFieldColumn(fieldColumns, modelName, fieldName));
}

export function assertDistinctOnCapability(
  contract: Contract<SqlStorage>,
  methodName: string,
): void {
  // Checked against `postgres` specifically, not the generic hasContractCapability
  // scan: a contract declaring distinctOn under any other group can't render it.
  if (contract.capabilities['postgres']?.['distinctOn'] === true) {
    return;
  }

  throw ormError(
    'ORM.CAPABILITY_MISSING',
    `${methodName}() requires capability postgres.distinctOn`,
    { meta: { capability: 'postgres.distinctOn', method: methodName } },
  );
}

export function assertLockCapability(
  contract: Contract<SqlStorage>,
  requirement: CapabilityRequirement,
  methodName: string,
): void {
  const capability = missingCapability(contract.capabilities, requirement);
  if (capability === undefined) {
    return;
  }

  throw ormError('ORM.CAPABILITY_MISSING', `${methodName}() requires capability ${capability}`, {
    meta: { capability, method: methodName },
  });
}

export function hasContractCapability(contract: Contract<SqlStorage>, capability: string): boolean {
  const capabilities = contract.capabilities;
  const value = capabilities[capability];

  if (capabilityEnabled(value)) {
    return true;
  }

  return Object.values(capabilities).some((targetCapabilities) => {
    if (typeof targetCapabilities !== 'object' || targetCapabilities === null) {
      return false;
    }
    return capabilityEnabled(targetCapabilities[capability]);
  });
}

function capabilityEnabled(value: unknown): boolean {
  if (value === true) {
    return true;
  }

  if (typeof value !== 'object' || value === null) {
    return false;
  }

  return Object.values(
    blindCast<Record<string, unknown>, 'capability object maps names to capability flags'>(value),
  ).some((flag) => flag === true);
}

export function isToOneCardinality(cardinality: RelationCardinalityTag | undefined): boolean {
  return cardinality === '1:1' || cardinality === 'N:1';
}
