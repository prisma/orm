import type { Contract } from '@internal/contract/types';
import {
  type AnnotationValue,
  AsyncIterableResult,
  type OperationKind,
} from '@internal/framework-components/runtime';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { SqlQueryPlan } from '@internal/sql-relational-core/plan';
import { resolvePolymorphismInfo, resolveRowIdentityColumns } from './collection-contract';
import { reloadMutationRowsByIdentities } from './collection-dispatch';
import {
  mapPolymorphicRow,
  mapResultRows,
  mapStorageRowToModelFields,
  stripHiddenMappedFields,
} from './collection-runtime';
import { ormError } from './orm-errors';
import { queryPlanRows } from './query-plan-rows';
import type { CollectionContext, IncludeExpr } from './types';

function createMutationRowMapper(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  modelName: string,
  variantName: string | undefined,
): (row: Record<string, unknown>) => Record<string, unknown> {
  const polyInfo = resolvePolymorphismInfo(contract, namespaceId, modelName);
  return polyInfo
    ? (row) => mapPolymorphicRow(contract, namespaceId, modelName, polyInfo, row, variantName)
    : (row) => mapStorageRowToModelFields(contract, namespaceId, modelName, row);
}

export function mutationReturningColumns(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  modelName: string,
  tableName: string,
  selectedFields: readonly string[] | undefined,
  includes: readonly IncludeExpr[],
): readonly string[] | undefined {
  if (includes.length === 0) {
    return selectedFields;
  }
  const identityColumns = resolveRowIdentityColumns(contract, namespaceId, tableName);
  if (identityColumns.length === 0) {
    throw ormError(
      'ORM.ROW_IDENTITY_MISSING',
      `Cannot load includes for the mutation result on model "${modelName}": table "${tableName}" has no primary key or unique constraint to key the include read-back on.`,
      { meta: { model: modelName, table: tableName } },
    );
  }
  return identityColumns;
}

interface MapMutationRowsOptions<Row> {
  readonly context: CollectionContext<Contract<SqlStorage>>['context'];
  readonly runtime: CollectionContext<Contract<SqlStorage>>['runtime'];
  readonly tableName: string;
  readonly modelName: string;
  readonly namespaceId: string;
  readonly variantName?: string | undefined;
  readonly includes: readonly IncludeExpr[];
  readonly selectedFields: readonly string[] | undefined;
  readonly hiddenColumns: readonly string[];
  readonly mapRow: (mapped: Record<string, unknown>) => Row;
  readonly annotations?: ReadonlyMap<string, AnnotationValue<unknown, OperationKind>> | undefined;
}

interface DispatchMutationRowsOptions<Row> extends MapMutationRowsOptions<Row> {
  readonly compiled: SqlQueryPlan<Record<string, unknown>>;
}

export function dispatchMutationRows<Row>(
  options: DispatchMutationRowsOptions<Row>,
): AsyncIterableResult<Row> {
  return mapMutationRows(
    () => queryPlanRows<Record<string, unknown>>(options.runtime, options.compiled),
    options,
  );
}

export function mapMutationRows<Row>(
  storageRows: () => AsyncIterableResult<Record<string, unknown>>,
  options: MapMutationRowsOptions<Row>,
): AsyncIterableResult<Row> {
  const {
    context,
    runtime,
    tableName,
    modelName,
    namespaceId,
    variantName,
    includes,
    selectedFields,
    hiddenColumns,
    mapRow,
    annotations,
  } = options;
  const { contract } = context;
  const mapStorageRow = createMutationRowMapper(contract, namespaceId, modelName, variantName);

  if (includes.length === 0) {
    return mapResultRows(storageRows(), (rawRow) => {
      const mapped = mapStorageRow(rawRow);
      if (hiddenColumns.length > 0) {
        stripHiddenMappedFields(contract, namespaceId, modelName, mapped, hiddenColumns);
      }
      return mapRow(mapped);
    });
  }

  // With includes the mutation returns identity columns only; the rows
  // are reloaded through the read path so relations resolve via the same
  // single-query builders, decode, and hidden-column stripping the read
  // path uses — no parallel read-back implementation. The reload streams;
  // only the small set of identities is buffered to key it.
  const generator = async function* (): AsyncGenerator<Row, void, unknown> {
    const identityRows = await storageRows().toArray();
    yield* reloadMutationRowsByIdentities<Row>({
      context,
      runtime,
      tableName,
      modelName,
      namespaceId,
      identityRows,
      selectedFields,
      includes,
      annotations,
    });
  };

  return new AsyncIterableResult(generator());
}

interface DispatchSplitMutationRowsOptions<Row> {
  readonly context: CollectionContext<Contract<SqlStorage>>['context'];
  readonly runtime: CollectionContext<Contract<SqlStorage>>['runtime'];
  readonly plans: ReadonlyArray<SqlQueryPlan<Record<string, unknown>>>;
  readonly tableName: string;
  readonly modelName: string;
  readonly namespaceId: string;
  readonly variantName?: string | undefined;
  readonly includes: readonly IncludeExpr[];
  readonly selectedFields: readonly string[] | undefined;
  readonly hiddenColumns: readonly string[];
  readonly mapRow: (mapped: Record<string, unknown>) => Row;
}

export function dispatchSplitMutationRows<Row>(
  options: DispatchSplitMutationRowsOptions<Row>,
): AsyncIterableResult<Row> {
  const {
    context,
    runtime,
    plans,
    tableName,
    modelName,
    namespaceId,
    variantName,
    includes,
    selectedFields,
    hiddenColumns,
    mapRow,
  } = options;
  const { contract } = context;
  const mapStorageRow = createMutationRowMapper(contract, namespaceId, modelName, variantName);

  const generator = async function* (): AsyncGenerator<Row, void, unknown> {
    if (includes.length > 0) {
      const identityRows: Record<string, unknown>[] = [];
      for (const plan of plans) {
        identityRows.push(
          ...(await queryPlanRows<Record<string, unknown>>(runtime, plan).toArray()),
        );
      }
      yield* reloadMutationRowsByIdentities<Row>({
        context,
        runtime,
        tableName,
        modelName,
        namespaceId,
        identityRows,
        selectedFields,
        includes,
      });
      return;
    }

    for (const plan of plans) {
      for await (const rawRow of queryPlanRows<Record<string, unknown>>(runtime, plan)) {
        const mapped = mapStorageRow(rawRow);
        if (hiddenColumns.length > 0) {
          stripHiddenMappedFields(contract, namespaceId, modelName, mapped, hiddenColumns);
        }
        yield mapRow(mapped);
      }
    }
  };

  return new AsyncIterableResult(generator());
}

interface ExecuteSingleMutationOptions<Row> {
  readonly context: CollectionContext<Contract<SqlStorage>>['context'];
  readonly runtime: CollectionContext<Contract<SqlStorage>>['runtime'];
  readonly compiled: SqlQueryPlan<Record<string, unknown>>;
  readonly tableName: string;
  readonly modelName: string;
  readonly namespaceId: string;
  readonly variantName?: string | undefined;
  readonly includes: readonly IncludeExpr[];
  readonly selectedFields: readonly string[] | undefined;
  readonly hiddenColumns: readonly string[];
  readonly mapRow: (mapped: Record<string, unknown>) => Row;
  readonly operation: string;
  readonly onMissingRowMessage: string;
}

export async function executeMutationReturningSingleRow<Row>(
  options: ExecuteSingleMutationOptions<Row>,
): Promise<Row | null> {
  const {
    context,
    runtime,
    compiled,
    tableName,
    modelName,
    namespaceId,
    variantName,
    includes,
    selectedFields,
    hiddenColumns,
    mapRow,
    operation,
    onMissingRowMessage,
  } = options;
  const { contract } = context;
  const mapStorageRow = createMutationRowMapper(contract, namespaceId, modelName, variantName);

  if (includes.length === 0) {
    const rows = await queryPlanRows<Record<string, unknown>>(runtime, compiled).toArray();
    const first = rows[0];
    if (!first) {
      return null;
    }

    const mapped = mapStorageRow(first);
    if (hiddenColumns.length > 0) {
      stripHiddenMappedFields(contract, namespaceId, modelName, mapped, hiddenColumns);
    }
    return mapRow(mapped);
  }

  const identityRows = await queryPlanRows<Record<string, unknown>>(runtime, compiled).toArray();
  if (identityRows.length === 0) {
    return null;
  }

  // Pull only the first reloaded row — a single mutated identity reloads
  // to a single row, so the stream is advanced once rather than drained.
  for await (const row of reloadMutationRowsByIdentities<Row>({
    context,
    runtime,
    tableName,
    modelName,
    namespaceId,
    identityRows,
    selectedFields,
    includes,
  })) {
    return row;
  }
  throw ormError('ORM.MUTATION_ROW_MISSING', onMissingRowMessage, {
    meta: { operation, model: modelName, tableName },
  });
}
