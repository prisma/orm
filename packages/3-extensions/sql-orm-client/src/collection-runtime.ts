import type { Contract } from '@internal/contract/types';
import { AsyncIterableResult } from '@internal/framework-components/runtime';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { RuntimeScope } from '@internal/sql-relational-core/types';
import {
  getColumnToFieldMap,
  getCompleteColumnToFieldMap,
  getFieldToColumnMap,
  POLYMORPHIC_DISCRIMINATOR_ALIAS,
  type PolymorphismInfo,
} from './collection-contract';
import type { CollectionContext } from './types';

export interface RowEnvelope {
  readonly raw: Record<string, unknown>;
  readonly mapped: Record<string, unknown>;
}

export function stripHiddenMappedFields(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  modelName: string,
  mapped: Record<string, unknown>,
  hiddenColumns: readonly string[],
): void {
  if (hiddenColumns.length === 0) {
    return;
  }

  const columnToField = getColumnToFieldMap(contract, namespaceId, modelName);
  for (const hiddenColumn of hiddenColumns) {
    const fieldName = columnToField[hiddenColumn] ?? hiddenColumn;
    delete mapped[fieldName];
  }
}

export function createRowEnvelope(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  modelName: string,
  raw: Record<string, unknown>,
): RowEnvelope {
  return {
    raw,
    mapped: mapStorageRowToModelFields(contract, namespaceId, modelName, raw),
  };
}

export function mapStorageRowToModelFields(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  modelName: string,
  row: Record<string, unknown>,
): Record<string, unknown> {
  const columnToField = getColumnToFieldMap(contract, namespaceId, modelName);
  if (Object.keys(columnToField).length === 0) {
    return { ...row };
  }

  return mapColumnNames(row, columnToField);
}

export function createStorageRowMapper(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  modelName: string,
): (row: Record<string, unknown>) => Record<string, unknown> {
  const columnToField = getColumnToFieldMap(contract, namespaceId, modelName);
  return Object.keys(columnToField).length === 0
    ? (row) => ({ ...row })
    : (row) => mapColumnNames(row, columnToField);
}

function mapColumnNames(
  row: Record<string, unknown>,
  columnToField: Readonly<Record<string, string>>,
): Record<string, unknown> {
  const mapped: Record<string, unknown> = {};
  for (const [columnName, value] of Object.entries(row)) {
    mapped[columnToField[columnName] ?? columnName] = value;
  }
  return mapped;
}

const mergedColumnToFieldCache = new WeakMap<object, Map<string, Record<string, string>>>();

function getMergedColumnToFieldMap(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  baseModelName: string,
  variantModelName: string,
  variantTable: string | undefined,
): Record<string, string> {
  const cacheKey = `${namespaceId}:${baseModelName}:${variantModelName}:${variantTable ?? ''}`;
  let perContract = mergedColumnToFieldCache.get(contract);
  if (!perContract) {
    perContract = new Map();
    mergedColumnToFieldCache.set(contract, perContract);
  }
  const cached = perContract.get(cacheKey);
  if (cached) return cached;

  const baseMap = getCompleteColumnToFieldMap(contract, namespaceId, baseModelName);
  const variantMap = getCompleteColumnToFieldMap(contract, namespaceId, variantModelName);

  const merged: Record<string, string> = { ...baseMap };
  for (const [col, field] of Object.entries(variantMap)) {
    if (variantTable) {
      merged[`${variantTable}__${col}`] = field;
    } else {
      merged[col] = field;
    }
  }

  perContract.set(cacheKey, merged);
  return merged;
}

export function mapPolymorphicRow(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  baseModelName: string,
  polyInfo: PolymorphismInfo,
  row: Record<string, unknown>,
  variantName?: string,
): Record<string, unknown> {
  const discriminatorValue =
    row[polyInfo.discriminatorColumn] ?? row[POLYMORPHIC_DISCRIMINATOR_ALIAS];
  const variant = variantName
    ? polyInfo.variants.get(variantName)
    : typeof discriminatorValue === 'string'
      ? polyInfo.variantsByValue.get(discriminatorValue)
      : undefined;

  if (!variant) {
    const baseMap = getCompleteColumnToFieldMap(contract, namespaceId, baseModelName);
    return mapKnownColumnNames(row, baseMap);
  }

  const mtiTable = variant.strategy === 'mti' ? variant.table : undefined;
  const mergedMap = getMergedColumnToFieldMap(
    contract,
    namespaceId,
    baseModelName,
    variant.modelName,
    mtiTable,
  );
  return mapKnownColumnNames(row, mergedMap);
}

export function createPolymorphicRowMapper(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  baseModelName: string,
  polyInfo: PolymorphismInfo,
  variantName?: string,
): (row: Record<string, unknown>) => Record<string, unknown> {
  const baseMapper = captureColumnMapper(() =>
    getCompleteColumnToFieldMap(contract, namespaceId, baseModelName),
  );
  const mappersByValue = new Map<string, typeof baseMapper>();
  let pinnedMapper = baseMapper;
  for (const [name, variant] of polyInfo.variants) {
    if (variantName && name !== variantName) continue;
    const mapper = captureColumnMapper(() =>
      getMergedColumnToFieldMap(
        contract,
        namespaceId,
        baseModelName,
        variant.modelName,
        variant.strategy === 'mti' ? variant.table : undefined,
      ),
    );
    if (variantName) pinnedMapper = mapper;
    for (const [value, candidate] of polyInfo.variantsByValue) {
      if (candidate === variant) mappersByValue.set(value, mapper);
    }
  }
  const discriminatorColumn = polyInfo.discriminatorColumn;
  return (row) => {
    const value = row[discriminatorColumn] ?? row[POLYMORPHIC_DISCRIMINATOR_ALIAS];
    const mapper = variantName
      ? pinnedMapper
      : typeof value === 'string'
        ? (mappersByValue.get(value) ?? baseMapper)
        : baseMapper;
    return mapper(row);
  };
}

function captureColumnMapper(
  resolve: () => Readonly<Record<string, string>>,
): (row: Record<string, unknown>) => Record<string, unknown> {
  try {
    const columns = resolve();
    return (row) => mapKnownColumnNames(row, columns);
  } catch (error) {
    return () => {
      throw error;
    };
  }
}

function mapKnownColumnNames(
  row: Record<string, unknown>,
  columns: Readonly<Record<string, string>>,
): Record<string, unknown> {
  const mapped: Record<string, unknown> = {};
  for (const [col, val] of Object.entries(row)) {
    const field = columns[col];
    if (field !== undefined) {
      mapped[field] = val;
    }
  }
  return mapped;
}

export function mapModelDataToStorageRow(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  modelName: string,
  row: Record<string, unknown>,
): Record<string, unknown> {
  const fieldToColumn = getFieldToColumnMap(contract, namespaceId, modelName);
  const mapped: Record<string, unknown> = {};
  for (const [fieldName, value] of Object.entries(row)) {
    if (value === undefined) {
      continue;
    }
    const columnName = fieldToColumn[fieldName] ?? fieldName;
    mapped[columnName] = value;
  }
  return mapped;
}

export function mapResultRows<TIn, TOut>(
  result: AsyncIterableResult<TIn>,
  mapper: (value: TIn) => TOut,
): AsyncIterableResult<TOut> {
  const generator = async function* (): AsyncGenerator<TOut, void, unknown> {
    for await (const value of result) {
      yield mapper(value);
    }
  };
  return new AsyncIterableResult(generator());
}

export async function acquireRuntimeScope(
  runtime: CollectionContext<Contract<SqlStorage>>['runtime'],
): Promise<{
  scope: RuntimeScope;
  release?: () => Promise<void>;
}> {
  if (typeof runtime.connection !== 'function') {
    return { scope: runtime };
  }

  const connection = await runtime.connection();
  const release = connection.release;
  if (typeof release === 'function') {
    return {
      scope: connection,
      release: () => release.call(connection) ?? Promise.resolve(),
    };
  }

  return { scope: connection };
}
