import type {
  Contract,
  ContractFieldType,
  ContractRelationThrough,
  CrossReference,
} from '@internal/contract/types';
import type { SqlStorage, StorageTable } from '@internal/sql-contract/types';
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
  fields?: Record<string, { type?: ContractFieldType }>;
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
  return `${namespaceId}\u0000${modelName}`;
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
const columnToFieldCache = new WeakMap<object, Map<string, Record<string, string>>>();
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

export function resolveFieldToColumn(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  modelName: string,
  fieldName: string,
): string {
  return getFieldToColumnMap(contract, namespaceId, modelName)[fieldName] ?? fieldName;
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
 * `baseModelName` is a default-namespace model name, consistent with the rest
 * of this module; namespace context is bound downstream at table resolution.
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

export function getColumnToFieldMap(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  modelName: string,
): Record<string, string> {
  let perContract = columnToFieldCache.get(contract);
  if (!perContract) {
    perContract = new Map();
    columnToFieldCache.set(contract, perContract);
  }
  const cacheKey = metadataCacheKey(namespaceId, modelName);
  let cached = perContract.get(cacheKey);
  if (cached) return cached;

  const storageFields = modelsOf(contract, namespaceId)[modelName]?.storage?.fields ?? {};
  cached = {};
  for (const [f, s] of Object.entries(storageFields)) {
    if (s?.column) cached[s.column] = f;
  }
  perContract.set(cacheKey, cached);
  return cached;
}

const completeColumnToFieldCache = new WeakMap<object, Map<string, Record<string, string>>>();

/**
 * Like getColumnToFieldMap but includes identity-mapped fields (where field name equals column
 * name). getColumnToFieldMap only returns explicit remaps; this returns ALL column→field entries.
 */
export function getCompleteColumnToFieldMap(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  modelName: string,
): Record<string, string> {
  let perContract = completeColumnToFieldCache.get(contract);
  if (!perContract) {
    perContract = new Map();
    completeColumnToFieldCache.set(contract, perContract);
  }
  const cacheKey = metadataCacheKey(namespaceId, modelName);
  let cached = perContract.get(cacheKey);
  if (cached) return cached;

  const storageFields = modelsOf(contract, namespaceId)[modelName]?.storage?.fields ?? {};
  cached = {};
  for (const [f, s] of Object.entries(storageFields)) {
    cached[s?.column ?? f] = f;
  }
  perContract.set(cacheKey, cached);
  return cached;
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
    const candidate = resolveModelRelations(contract, namespaceId, variant.modelName)[relationName];
    if (candidate !== undefined) {
      relation = candidate;
      declaringModelName = variant.modelName;
      localTableName = variant.table;
    }
  }

  relation ??= resolveModelRelations(contract, namespaceId, baseModelName)[relationName];
  if (!relation) {
    throw ormError(
      'ORM.RELATION_UNKNOWN',
      `Relation '${relationName}' not found on model '${baseModelName}'`,
      { meta: { model: baseModelName, relation: relationName } },
    );
  }
  const localFields = relation.on.localFields;
  const targetFields = relation.on.targetFields;
  const localColumns: string[] = [];
  const targetColumns: string[] = [];

  if (localFields.length !== targetFields.length) {
    throw new InternalError(
      `Relation '${relationName}' on model '${declaringModelName}' has incomplete join metadata (missing localFields or targetFields)`,
    );
  }

  for (let i = 0; i < localFields.length; i++) {
    const localField = localFields[i];
    const targetField = targetFields[i];
    if (!localField || !targetField) {
      throw new InternalError(
        `Relation '${relationName}' on model '${declaringModelName}' has incomplete join metadata (missing localFields or targetFields)`,
      );
    }
    localColumns.push(resolveFieldToColumn(contract, namespaceId, declaringModelName, localField));
    targetColumns.push(
      resolveFieldToColumn(contract, relation.toNamespace, relation.to, targetField),
    );
  }

  if (localColumns.length === 0) {
    throw new InternalError(
      `Relation '${relationName}' on model '${declaringModelName}' has incomplete join metadata (missing localFields or targetFields)`,
    );
  }

  const relatedTableName = resolveModelTableName(contract, relation.toNamespace, relation.to);

  let through: IncludeThroughDescriptor | undefined;
  if (relation.through !== undefined) {
    const parentLocalColumns = relation.on.localFields.map((field) =>
      resolveFieldToColumn(contract, namespaceId, declaringModelName, field),
    );
    through = {
      table: relation.through.table,
      namespaceId: relation.through.namespaceId,
      parentColumns: relation.through.parentColumns,
      childColumns: relation.through.childColumns,
      targetColumns: relation.through.targetColumns,
      parentLocalColumns,
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
        mutationDefault.ref.table === table &&
        mutationDefault.ref.column === column &&
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

export function resolvePrimaryKeyColumn(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  tableName: string,
): string {
  const resolved = resolveTableForContract(contract, namespaceId, tableName);
  return resolved?.table.primaryKey?.columns[0] ?? 'id';
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
