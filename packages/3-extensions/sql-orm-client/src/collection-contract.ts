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
import type { StructuredError } from '@internal/utils/structured-error';
import { cachedFor } from './contract-cache';
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
  const discriminatorColumn = columnOfContractField(
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

/** The table and column a field maps. */
export interface FieldColumn {
  // Bare storage-table name (namespace-flat, like every table name in this
  // module). The namespace is bound separately when the name becomes a
  // `TableSource` via `tableSourceForContract`.
  readonly table: string;
  readonly column: string;
}

/*
 * The field-to-column maps. Each name says which fields it holds:
 * - `Own`: the model's own fields only.
 * - `Model`: the model's own fields and the fields it inherits from its base models.
 * - `ModelAndVariant`: those, plus the fields of one narrowed variant.
 * - `ModelAndEveryVariant`: those, plus the fields of every variant.
 * The column-to-field maps use the same names.
 */

/** The column each of the model's own fields maps, keyed by field name. */
export function getOwnFieldColumns(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  modelName: string,
): Readonly<Record<string, string>> {
  return cachedFor(contract, ['ownFieldColumns', namespaceId, modelName], () => {
    const storageFields = modelsOf(contract, namespaceId)[modelName]?.storage?.fields ?? {};
    const columns: Record<string, string> = {};
    for (const [field, storage] of Object.entries(storageFields)) {
      if (storage?.column) columns[field] = storage.column;
    }
    return columns;
  });
}

/**
 * A model's fields, keyed by field name, with the table and column each maps: its own fields on its own table, and the fields it inherits from its base model on the base model's table. This is the one list of a model's fields; a column no field maps has no entry.
 */
export function getModelFields(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  modelName: string,
): Readonly<Record<string, FieldColumn>> {
  return cachedFor(contract, ['modelFields', namespaceId, modelName], () => {
    const model = modelOf(contract, namespaceId, modelName);
    const table = model?.storage?.table;
    const own =
      table === undefined
        ? {}
        : Object.fromEntries(
            Object.entries(getOwnFieldColumns(contract, namespaceId, modelName)).map(
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
  return cachedFor(contract, ['modelFieldColumns', namespaceId, modelName], () =>
    Object.fromEntries(
      Object.entries(getModelFields(contract, namespaceId, modelName)).map(
        ([field, { column }]) => [field, column],
      ),
    ),
  );
}

/**
 * The column each field of the model and of the variant `variantName` maps, keyed by field name. Without a variant, the model's fields alone.
 *
 * A surface accepts a variant's field only when it can place that field's column on the variant's table. A collection narrowed to a variant reads that variant's table, so `select`, the `where` and `orderBy` accessor and a variant create accept the narrowed variant's fields. A collection that is not narrowed reads the base table only, so only `select`, whose polymorphic projection joins each variant's table, accepts variant fields there (`getModelAndEveryVariantFieldColumns`).
 */
export function getModelAndVariantFieldColumns(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  modelName: string,
  variantName: string | undefined,
): Readonly<Record<string, string>> {
  return cachedFor(
    contract,
    ['modelAndVariantFieldColumns', namespaceId, modelName, variantName ?? null],
    () => ({
      ...(variantName === undefined ? {} : getOwnFieldColumns(contract, namespaceId, variantName)),
      ...getModelFieldColumns(contract, namespaceId, modelName),
    }),
  );
}

/**
 * Every column each field of the model and of every one of its variants maps, keyed by field name. Two variants may map one field name to different columns, so a name can map several columns.
 */
export function getModelAndEveryVariantFieldColumns(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  modelName: string,
): Readonly<Record<string, readonly string[]>> {
  return cachedFor(contract, ['modelAndEveryVariantFieldColumns', namespaceId, modelName], () => {
    const columns: Record<string, string[]> = {};
    const add = (fieldColumns: Readonly<Record<string, string>>) => {
      for (const [field, column] of Object.entries(fieldColumns)) {
        const existing = columns[field] ?? [];
        if (!existing.includes(column)) existing.push(column);
        columns[field] = existing;
      }
    };
    add(getModelFieldColumns(contract, namespaceId, modelName));
    const modelFields = new Set(Object.keys(columns));
    for (const variant of resolvePolymorphismInfo(
      contract,
      namespaceId,
      modelName,
    )?.variants.keys() ?? []) {
      add(
        Object.fromEntries(
          Object.entries(getOwnFieldColumns(contract, namespaceId, variant)).filter(
            ([field]) => !modelFields.has(field),
          ),
        ),
      );
    }
    return columns;
  });
}

/** The field each column of the model's own fields maps, keyed by column. */
export function getOwnColumnFields(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  modelName: string,
): Readonly<Record<string, string>> {
  return cachedFor(contract, ['ownColumnFields', namespaceId, modelName], () =>
    invert(getOwnFieldColumns(contract, namespaceId, modelName)),
  );
}

/** The field each column of the model's own and inherited fields maps, keyed by column. */
export function getModelColumnFields(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  modelName: string,
): Readonly<Record<string, string>> {
  return cachedFor(contract, ['modelColumnFields', namespaceId, modelName], () =>
    invert(getModelFieldColumns(contract, namespaceId, modelName)),
  );
}

function invert(map: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  return Object.fromEntries(Object.entries(map).map(([key, value]) => [value, key]));
}

/**
 * The column a name a caller passed maps in `fieldColumns`. A name that is not a field is refused with `ORM.FIELD_UNKNOWN`, so no caller reaches a column by its column name, including a column no field maps.
 */
export function columnOfCallerField(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  fieldColumns: Readonly<Record<string, string>>,
  modelName: string,
  fieldName: string,
): string {
  const column = Object.hasOwn(fieldColumns, fieldName) ? fieldColumns[fieldName] : undefined;
  if (column === undefined) {
    throw callerFieldUnknown(contract, namespaceId, fieldColumns, modelName, fieldName);
  }
  return column;
}

/**
 * The refusal of a name a caller passed that is not a field of the model it addressed. When the name is the column of one of the fields in `fieldColumns`, or a column that no field maps on a table of the model's hierarchy, the message says so and names the table.
 */
export function callerFieldUnknown(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  fieldColumns: Readonly<Record<string, string | readonly string[]>>,
  modelName: string,
  fieldName: string,
): StructuredError {
  const unknown = `Model "${modelName}" has no field "${fieldName}"`;
  const fieldForColumn = Object.entries(fieldColumns).find(([, columns]) =>
    typeof columns === 'string' ? columns === fieldName : columns.includes(fieldName),
  )?.[0];
  if (fieldForColumn !== undefined) {
    return ormError(
      'ORM.FIELD_UNKNOWN',
      `${unknown}. "${fieldName}" is the column of field "${fieldForColumn}"; pass the field name.`,
      { meta: { model: modelName, field: fieldName, fieldForColumn } },
    );
  }
  const unmapped = getUnmappedColumns(contract, namespaceId, modelName).find(
    ({ column }) => column === fieldName,
  );
  const hint =
    unmapped === undefined
      ? ''
      : `. Table "${unmapped.table}" has a column "${fieldName}" that no field maps, so the ORM cannot read or write it.`;
  return ormError('ORM.FIELD_UNKNOWN', `${unknown}${hint}`, {
    meta: { model: modelName, field: fieldName },
  });
}

/** The columns of the tables of a model's hierarchy that no field of the hierarchy maps. */
function getUnmappedColumns(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  modelName: string,
): readonly { readonly table: string; readonly column: string }[] {
  return cachedFor(contract, ['unmappedColumns', namespaceId, modelName], () => {
    const root = hierarchyRootName(contract, namespaceId, modelName);
    const rootTable = domainModelTableInNamespace(contract, namespaceId, root);
    if (rootTable === undefined) return [];
    const variants = resolvePolymorphismInfo(contract, namespaceId, root)?.variants.values();
    const tables = new Set([rootTable, ...[...(variants ?? [])].map((variant) => variant.table)]);
    return [...tables].flatMap((table) => {
      const read = new Set(getColumnsReadOnTable(contract, namespaceId, root, table));
      return getAllTableColumns(contract, namespaceId, table)
        .filter((column) => !read.has(column))
        .map((column) => ({ table, column }));
    });
  });
}

function hierarchyRootName(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  modelName: string,
): string {
  const base = modelOf(contract, namespaceId, modelName)?.base;
  return base === undefined || base.namespace !== namespaceId
    ? modelName
    : hierarchyRootName(contract, namespaceId, base.model);
}

/**
 * The column a field name the contract itself gives maps among the model's own and inherited fields, such as a relation's join field or a discriminator. The contract was validated, so a name that is not a field is an internal error.
 */
export function columnOfContractField(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  modelName: string,
  fieldName: string,
): string {
  const fieldColumns = getModelFieldColumns(contract, namespaceId, modelName);
  const column = Object.hasOwn(fieldColumns, fieldName) ? fieldColumns[fieldName] : undefined;
  if (column === undefined) {
    throw new InternalError(`Model "${modelName}" has no field "${fieldName}" the contract names`);
  }
  return column;
}

/**
 * The field that maps `column` in `columnFields`. The ORM only asks this for a column it chose itself, such as a key column or a column it projected, so a column no field maps is an internal error.
 */
export function fieldOfColumn(
  columnFields: Readonly<Record<string, string>>,
  modelName: string,
  column: string,
): string {
  const field = Object.hasOwn(columnFields, column) ? columnFields[column] : undefined;
  if (field === undefined) {
    throw new InternalError(`Column "${column}" of model "${modelName}" is mapped by no field`);
  }
  return field;
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
    columnOfContractField(contract, relation.toNamespace, relation.to, field),
  );
}

/**
 * The fields a multi-table variant declares, with the table and column each maps, which is the variant's own table the read path joins. A single-table variant's columns are on the base table, and inherited fields are on the base model's table, so neither appears here.
 */
export function resolveVariantFieldColumns(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  baseModelName: string,
  variantName: string,
): Readonly<Record<string, FieldColumn>> {
  const variant = resolvePolymorphismInfo(contract, namespaceId, baseModelName)?.variants.get(
    variantName,
  );
  if (variant?.strategy !== 'mti') return {};
  return Object.fromEntries(
    Object.entries(getModelFields(contract, namespaceId, variant.modelName)).filter(
      ([, field]) => field.table === variant.table,
    ),
  );
}

/** Every column of a table, in table order. */
export function getAllTableColumns(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  tableName: string,
): string[] {
  try {
    return Object.keys(storageTableForContract(contract, namespaceId, tableName).columns);
  } catch (error) {
    // Surface the ambiguous-bare-name fail-fast rather than masking it as an
    // unknown table.
    if (error instanceof Error && error.message.includes('ambiguous')) {
      throw error;
    }
    throw ormError('ORM.TABLE_UNKNOWN', `Unknown table "${tableName}" in SQL ORM query planner`, {
      meta: { namespaceId, tableName },
    });
  }
}

function isMultiTableVariantTable(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  modelName: string,
  tableName: string,
): boolean {
  const base = modelOf(contract, namespaceId, modelName)?.base;
  return (
    base !== undefined &&
    domainModelTableInNamespace(contract, namespaceId, modelName) === tableName &&
    domainModelTableInNamespace(contract, base.namespace, base.model) !== tableName
  );
}

/**
 * The columns of `tableName` a query on `modelName` reads, in table order: the columns on that table of the model's own and inherited fields and of its variants' fields, and, on a multi-table variant's table, the key the variant inherits. Any other column of the table is storage the model does not map, and the ORM never reads it into a row.
 */
export function getColumnsReadOnTable(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  modelName: string,
  tableName: string,
): string[] {
  return cachedFor(contract, ['columnsReadOnTable', namespaceId, modelName, tableName], () => {
    const read = new Set<string>();
    const addFieldsOnTable = (name: string) => {
      for (const field of Object.values(getModelFields(contract, namespaceId, name))) {
        if (field.table === tableName) read.add(field.column);
      }
    };
    const addInheritedKey = () => {
      for (const column of resolvePrimaryKeyColumns(contract, namespaceId, tableName)) {
        read.add(column);
      }
    };
    addFieldsOnTable(modelName);
    if (isMultiTableVariantTable(contract, namespaceId, modelName, tableName)) addInheritedKey();
    const variants = resolvePolymorphismInfo(contract, namespaceId, modelName)?.variants.values();
    for (const variant of variants ?? []) {
      if (variant.table !== tableName) continue;
      addFieldsOnTable(variant.modelName);
      if (variant.strategy === 'mti') addInheritedKey();
    }
    return getAllTableColumns(contract, namespaceId, tableName).filter((column) =>
      read.has(column),
    );
  });
}

/** The model a query or write addresses: the variant it is narrowed to, otherwise the collection's model. */
export function addressedModelName(modelName: string, variantName: string | undefined): string {
  return variantName ?? modelName;
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
    columnOfContractField(contract, namespaceId, declaringModelName, field),
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
    const fieldColumns = getModelFieldColumns(contract, namespaceId, modelName);
    const columns = Object.keys(conflictOn).map((fieldName) =>
      columnOfCallerField(contract, namespaceId, fieldColumns, modelName, fieldName),
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
  return conflictOn.map((fieldName) =>
    columnOfCallerField(contract, namespaceId, fieldColumns, modelName, fieldName),
  );
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
