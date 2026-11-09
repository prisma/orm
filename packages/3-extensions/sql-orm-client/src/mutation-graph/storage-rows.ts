import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { ExecutionContext } from '@internal/sql-relational-core/query-lane-context';
import { ifDefined } from '@internal/utils/defined';
import type { Simplify } from '@internal/utils/types';
import {
  columnOfCallerField,
  getModelAndVariantFieldColumns,
  getModelFieldColumns,
  getOwnFieldColumns,
  type PolymorphismInfo,
  type PolymorphismVariantInfo,
  resolvePolymorphismInfo,
} from '../collection-contract';
import type { DescribeCollectionRowsOptions } from '../collection-dispatch';
import { mapModelDataToStorageRow } from '../collection-runtime';
import type { AliasedTable } from '../table-scope';
import type { Model } from './model-statements';
import type { BeforeWrite } from './nested-mutations';

type ModelData = Readonly<Record<string, unknown>>;

type MtiVariantInfo = Simplify<PolymorphismVariantInfo & { readonly strategy: 'mti' }>;

export interface MtiCreateContext {
  readonly polyInfo: PolymorphismInfo;
  readonly variant: MtiVariantInfo;
  readonly baseFieldToColumn: Readonly<Record<string, string>>;
  readonly variantFieldToColumn: Readonly<Record<string, string>>;
  readonly mergedFieldToColumn: Readonly<Record<string, string>>;
}

export interface VariantCreateRow {
  readonly base: Readonly<Record<string, unknown>>;
  readonly variant: Readonly<Record<string, unknown>>;
}

const nothingBefore: BeforeWrite = { keys: [], nullColumns: {} };

export function modelOf(collection: DescribeCollectionRowsOptions): Model {
  const { modelName, namespaceId, state } = collection;
  return { namespaceId, modelName, tables: state.tables };
}

export function createRowsOf(
  collection: DescribeCollectionRowsOptions,
  rows: readonly ModelData[],
): Record<string, unknown>[] {
  const model = modelOf(collection);
  const defaultValueCache = new Map<string, unknown>();
  return rows.map((row) =>
    createRowOf(collection.context, model, collection.state.variantValue, row, defaultValueCache),
  );
}

export function createRowOf(
  context: ExecutionContext,
  model: Model,
  variantValue: string | undefined,
  row: ModelData,
  defaultValueCache: Map<string, unknown> | undefined,
): Record<string, unknown> {
  const { namespaceId, tableName } = model.tables.root.storage;
  return withCreateDefaults(
    context,
    namespaceId,
    tableName,
    mappedCreateRow(context.contract, model, variantValue, row),
    defaultValueCache,
  );
}

export function withCreateDefaults(
  context: ExecutionContext,
  namespaceId: string,
  tableName: string,
  values: Readonly<Record<string, unknown>>,
  defaultValueCache: Map<string, unknown> | undefined,
): Record<string, unknown> {
  const withDefaults = { ...values };
  for (const applied of context.applyMutationDefaults({
    op: 'create',
    entry: tableName,
    namespace: namespaceId,
    values,
    ...ifDefined('defaultValueCache', defaultValueCache),
  })) {
    withDefaults[applied.field] = applied.value;
  }
  return withDefaults;
}

function mappedCreateRow(
  contract: Contract<SqlStorage>,
  model: Model,
  variantValue: string | undefined,
  row: ModelData,
): Record<string, unknown> {
  const { namespaceId, modelName } = model;
  const polyInfo =
    variantValue === undefined
      ? undefined
      : resolvePolymorphismInfo(contract, namespaceId, modelName);
  const variant = variantValue === undefined ? undefined : polyInfo?.variants.get(variantValue);
  if (polyInfo === undefined || variant === undefined) {
    return mapModelDataToStorageRow(contract, namespaceId, modelName, row);
  }
  const mergedFieldToColumn = getModelAndVariantFieldColumns(
    contract,
    namespaceId,
    modelName,
    variant.value,
  );
  const mapped: Record<string, unknown> = {};
  for (const [fieldName, value] of Object.entries(row)) {
    if (value === undefined) continue;
    mapped[
      columnOfCallerField(
        contract,
        variant.namespaceId,
        mergedFieldToColumn,
        variant.modelName,
        fieldName,
      )
    ] = value;
  }
  mapped[polyInfo.discriminatorColumn] = variant.value;
  return mapped;
}

export function mtiCreateContextOf(
  collection: DescribeCollectionRowsOptions,
): MtiCreateContext | undefined {
  const { context, modelName, namespaceId, state } = collection;
  const { contract } = context;
  const { variantValue } = state;
  if (!variantValue) return undefined;

  const polyInfo = resolvePolymorphismInfo(contract, namespaceId, modelName);
  if (!polyInfo) return undefined;

  const variant = polyInfo.variants.get(variantValue);
  if (!isMtiVariantInfo(variant)) return undefined;

  return {
    polyInfo,
    variant,
    baseFieldToColumn: getModelFieldColumns(contract, namespaceId, modelName),
    variantFieldToColumn: getOwnFieldColumns(contract, variant.namespaceId, variant.modelName),
    mergedFieldToColumn: getModelAndVariantFieldColumns(
      contract,
      namespaceId,
      modelName,
      variant.value,
    ),
  };
}

function isMtiVariantInfo(variant: PolymorphismVariantInfo | undefined): variant is MtiVariantInfo {
  return variant?.strategy === 'mti';
}

export function variantCreateRowsOf(
  collection: DescribeCollectionRowsOptions,
  mti: MtiCreateContext,
  variantTable: AliasedTable,
  rows: readonly ModelData[],
): VariantCreateRow[] {
  const { context, namespaceId, state } = collection;
  const { contract } = context;
  const { polyInfo, variant, baseFieldToColumn, variantFieldToColumn, mergedFieldToColumn } = mti;
  const baseFieldColumns = new Set(Object.values(baseFieldToColumn));
  const variantFieldColumns = new Set(Object.values(variantFieldToColumn));
  const defaultValueCache = new Map<string, unknown>();
  const base = state.tables.root.storage;

  return rows.map((row) => {
    const allMapped: Record<string, unknown> = {};
    for (const [fieldName, value] of Object.entries(row)) {
      if (value === undefined) continue;
      allMapped[
        columnOfCallerField(
          contract,
          namespaceId,
          mergedFieldToColumn,
          variant.modelName,
          fieldName,
        )
      ] = value;
    }
    allMapped[polyInfo.discriminatorColumn] = variant.value;

    const baseRow: Record<string, unknown> = {};
    const variantRow: Record<string, unknown> = {};
    for (const [column, value] of Object.entries(allMapped)) {
      if (baseFieldColumns.has(column) || column === polyInfo.discriminatorColumn) {
        baseRow[column] = value;
      }
      if (variantFieldColumns.has(column)) {
        variantRow[column] = value;
      }
    }

    return {
      base: withCreateDefaults(
        context,
        base.namespaceId,
        base.tableName,
        baseRow,
        defaultValueCache,
      ),
      variant: withCreateDefaults(
        context,
        variantTable.storage.namespaceId,
        variantTable.storage.tableName,
        variantRow,
        defaultValueCache,
      ),
    };
  });
}

export function updateValuesOf(
  collection: DescribeCollectionRowsOptions,
  data: ModelData,
): Record<string, unknown> {
  return withUpdateDefaults(collection, mappedUpdateRow(collection, data), nothingBefore);
}

export function mappedUpdateRow(
  collection: DescribeCollectionRowsOptions,
  data: ModelData,
): Record<string, unknown> {
  const { context, modelName, namespaceId } = collection;
  return mapModelDataToStorageRow(context.contract, namespaceId, modelName, data);
}

export function withUpdateDefaults(
  collection: DescribeCollectionRowsOptions,
  set: Readonly<Record<string, unknown>>,
  before: BeforeWrite,
): Record<string, unknown> {
  const values: Record<string, unknown> = { ...set, ...before.nullColumns };
  if (Object.keys(values).length === 0 && before.keys.length === 0) {
    return values;
  }
  const { namespaceId, tableName } = collection.state.tables.root.storage;
  for (const applied of collection.context.applyMutationDefaults({
    op: 'update',
    entry: tableName,
    namespace: namespaceId,
    values,
  })) {
    values[applied.field] = applied.value;
  }
  return values;
}
