/**
 * Collection row dispatch.
 *
 * Top-level per-row decoding is performed upstream in `sql-runtime`'s
 * row-yielding async generator (it `await`s `decodeRow` once per row before
 * yielding). Include aggregate aliases arrive as parsed JSON payloads, so this
 * file decodes embedded child row cells after `JSON.parse` and before mapping
 * storage columns to model fields. Every `for await` / `.toArray()` consumer
 * below therefore sees plain `T` values, not `Promise<T>`.
 *
 * See `packages/2-sql/5-runtime/src/codecs/decoding.ts` for the decode-once-
 * per-row contract; this file is the consumer side of that contract. See also
 * ADR 030 (codecs registry & decode boundary) and `test/codec-async.types.test-d.ts`.
 */

import type { Contract, JsonValue } from '@internal/contract/types';
import {
  AsyncIterableResult,
  isRuntimeError,
  runtimeError,
} from '@internal/framework-components/runtime';
import type { SqlStorage, StorageColumn } from '@internal/sql-contract/types';
import {
  AndExpr,
  type AnyExpression,
  BinaryExpr,
  type Codec,
  ColumnRef,
  ListExpression,
  LiteralExpr,
  OrExpr,
} from '@internal/sql-relational-core/ast';
import { blindCast } from '@internal/utils/casts';
import { InternalError } from '@internal/utils/internal-error';
import { resolveAggregate } from './aggregate-codecs';
import { emptyAggregateResult } from './aggregate-empty-result';
import {
  isToOneCardinality,
  resolvePolymorphismInfo,
  resolveRowIdentityColumns,
} from './collection-contract';
import {
  createStorageRowMapper,
  mapPolymorphicRow,
  mapResultRows,
  mapStorageRowToModelFields,
  type RowEnvelope,
} from './collection-runtime';
import { ormError } from './orm-errors';
import { compileSelect, compileSelectWithIncludes } from './query-plan';
import { queryPlanRows } from './query-plan-rows';
import {
  type CollectionContext,
  type CollectionState,
  emptyState,
  type IncludeCombineBranch,
  type IncludeExpr,
  type IncludeScalar,
  type RelationCardinalityTag,
} from './types';
import { bindWhereExpr } from './where-binding';

type CodecExecutionContext = CollectionContext<Contract<SqlStorage>>['context'];

interface DispatchCollectionRowsOptions {
  context: CodecExecutionContext;
  runtime: CollectionContext<Contract<SqlStorage>>['runtime'];
  state: CollectionState;
  tableName: string;
  modelName: string;
  namespaceId: string;
}

export function dispatchCollectionRows<Row>(
  options: DispatchCollectionRowsOptions,
): AsyncIterableResult<Row> {
  const { context, runtime, state, tableName, modelName, namespaceId } = options;
  const { contract } = context;
  const polyInfo = resolvePolymorphismInfo(contract, namespaceId, modelName);

  if (state.includes.length === 0) {
    const compiled = compileSelect(contract, namespaceId, tableName, state, modelName);
    const source = queryPlanRows<Record<string, unknown>>(runtime, compiled);
    const mapper = polyInfo
      ? (rawRow: Record<string, unknown>) =>
          blindCast<
            Row,
            'collection row generic is supplied by the caller and matched to the selected model shape'
          >(
            mapPolymorphicRow(
              contract,
              namespaceId,
              modelName,
              polyInfo,
              rawRow,
              state.variantName,
            ),
          )
      : (rawRow: Record<string, unknown>) =>
          blindCast<
            Row,
            'collection row generic is supplied by the caller and matched to the selected model shape'
          >(mapStorageRowToModelFields(contract, namespaceId, modelName, rawRow));
    return mapResultRows(source, mapper);
  }

  return dispatchWithIncludes<Row>(options);
}

// The correlated-subquery include builder lowers every include
// descriptor shape (row, scalar reducers, and combine()) at any depth
// into a single query; the read path has no multi-query fallback.
function dispatchWithIncludes<Row>(
  options: DispatchCollectionRowsOptions,
): AsyncIterableResult<Row> {
  const { context, runtime, state, tableName, modelName, namespaceId } = options;
  const { contract } = context;
  const generator = async function* (): AsyncGenerator<Row, void, unknown> {
    const compiled = compileSelectWithIncludes(
      contract,
      context.aggregateDescriptors,
      namespaceId,
      tableName,
      state,
      modelName,
    );

    const parentRowsRaw = await queryPlanRows<Record<string, unknown>>(runtime, compiled).toArray();
    if (parentRowsRaw.length === 0) {
      return;
    }

    const polyInfo = resolvePolymorphismInfo(contract, namespaceId, modelName);
    const parentRows: RowEnvelope[] = parentRowsRaw.map((row) => {
      const mapped = polyInfo
        ? mapPolymorphicRow(contract, namespaceId, modelName, polyInfo, row, state.variantName)
        : mapStorageRowToModelFields(contract, namespaceId, modelName, row);
      return { raw: row, mapped };
    });

    const bindings: IncludedColumnBindings = new WeakMap();
    for (const parent of parentRows) {
      for (const include of state.includes) {
        parent.mapped[include.relationName] = await decodeIncludePayload(
          contract,
          context,
          include,
          parent.raw[include.relationName],
          bindings,
        );
      }
    }

    for (const row of parentRows) {
      yield blindCast<
        Row,
        'collection row generic is supplied by the caller and matched to the selected model shape'
      >(row.mapped);
    }
  };

  return new AsyncIterableResult(generator());
}

/**
 * Reload the rows a mutation just wrote (create / createAll / update /
 * updateAll / upsert) through the read-path dispatch, so `.include()`
 * relations resolve via the exact same correlated-subquery builder,
 * decoding, and polymorphism mapping a read query uses — there is no
 * parallel mutation read-back implementation.
 *
 * The mutation returns only its identity columns (PK / unique); this
 * re-selects those rows with the caller's projection + includes, keyed
 * by `identity IN (...)`. One round-trip regardless of row count or
 * include depth. The read-back observes the just-written rows because
 * it runs on the same runtime — and therefore the same transaction —
 * the mutation ran on.
 *
 * Delete read-back does NOT come through here: a parent-anchored
 * include query can't observe an already-deleted row, so delete reads
 * its snapshot before issuing the DELETE (see `collection.ts`).
 */
export function reloadMutationRowsByIdentities<Row>(options: {
  context: CodecExecutionContext;
  runtime: CollectionContext<Contract<SqlStorage>>['runtime'];
  tableName: string;
  modelName: string;
  namespaceId: string;
  identityRows: readonly Record<string, unknown>[];
  selectedFields: readonly string[] | undefined;
  includes: readonly IncludeExpr[];
}): AsyncIterableResult<Row> {
  const {
    context,
    runtime,
    tableName,
    modelName,
    namespaceId,
    identityRows,
    selectedFields,
    includes,
  } = options;
  const { contract } = context;
  if (identityRows.length === 0) {
    return emptyResult<Row>();
  }

  const identityColumns = resolveRowIdentityColumns(contract, namespaceId, tableName);
  if (identityColumns.length === 0) {
    throw ormError(
      'ORM.ROW_IDENTITY_MISSING',
      `Cannot load includes for the mutation result on model "${modelName}": table "${tableName}" has no primary key or unique constraint to key the include read-back on.`,
      { meta: { model: modelName, table: tableName } },
    );
  }

  const identityFilter = buildIdentityInFilter(
    contract,
    namespaceId,
    tableName,
    identityColumns,
    identityRows,
  );
  if (!identityFilter) {
    return emptyResult<Row>();
  }

  return dispatchCollectionRows<Row>({
    context,
    runtime,
    state: {
      ...emptyState(),
      filters: [identityFilter],
      selectedFields,
      includes,
    },
    tableName,
    modelName,
    namespaceId,
  });
}

function emptyResult<Row>(): AsyncIterableResult<Row> {
  return new AsyncIterableResult((async function* (): AsyncGenerator<Row, void, unknown> {})());
}

// Identity values come straight from the mutation's `RETURNING`, so they
// are unique by construction — no JS-side dedup; the database evaluates
// the `IN` list (or the composite-key `OR` of equality tuples) directly.
function buildIdentityInFilter(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  tableName: string,
  identityColumns: readonly string[],
  identityRows: readonly Record<string, unknown>[],
): AnyExpression | undefined {
  const [singleColumn, ...rest] = identityColumns;
  if (singleColumn !== undefined && rest.length === 0) {
    const values = identityRows
      .map((row) => row[singleColumn])
      .filter((value) => value !== undefined);
    if (values.length === 0) {
      return undefined;
    }
    return bindWhereExpr(
      contract,
      BinaryExpr.in(ColumnRef.of(tableName, singleColumn), ListExpression.fromValues(values)),
      namespaceId,
    );
  }

  if (identityRows.length === 0) {
    return undefined;
  }
  const tuples = identityRows.map((row) =>
    AndExpr.of(
      identityColumns.map((column) =>
        BinaryExpr.eq(ColumnRef.of(tableName, column), LiteralExpr.of(row[column])),
      ),
    ),
  );
  return bindWhereExpr(contract, OrExpr.of(tuples), namespaceId);
}

/**
 * Decode a single-query include payload from a parent row's raw cell
 * into the model-shaped value that downstream consumers see. Recurses
 * through `include.nested.includes` so depth-2+ trees — emitted by the
 * recursive correlated-subquery builder — are decoded symmetrically.
 *
 * The shape produced by the SQL side is one JSON column per top-level
 * include; values nested inside that JSON are already-parsed JS values
 * after the outer `JSON.parse`, so `parseIncludedRows` recognises both
 * the string (top-level) and array (nested) forms.
 *
 * Scalar leaves arrive wrapped in a `{ value: <primitive> }` JSON
 * envelope (see `buildIncludeChildScalarSelect`); the branch below
 * unwraps that envelope and passes the value straight through. The empty-relation value reads off
 * the operation's declared row via `emptyAggregateResult`: `null` where the row is nullable,
 * otherwise the row's declared empty value (so `count()` is `0`).
 *
 * Combine descriptors arrive as a JSON object keyed by branch name;
 * each branch is dispatched to the row or scalar decoder per its
 * declared shape (see `decodeCombineIncludePayload`).
 */
async function decodeIncludePayload(
  contract: Contract<SqlStorage>,
  context: CodecExecutionContext,
  include: IncludeExpr,
  raw: unknown,
  bindings: IncludedColumnBindings,
): Promise<unknown> {
  if (include.scalar) {
    return Promise.resolve(
      decodeScalarIncludePayload(contract, context, include, include.scalar, raw),
    );
  }
  if (include.combine) {
    return decodeCombineIncludePayload(contract, context, include, include.combine, raw, bindings);
  }
  const rawChildren = parseIncludedRows(include, raw);
  const polyInfo = resolvePolymorphismInfo(
    contract,
    include.relatedNamespaceId,
    include.relatedModelName,
  );
  const mapChildRow = polyInfo
    ? (childRow: Record<string, unknown>) =>
        mapPolymorphicRow(
          contract,
          include.relatedNamespaceId,
          include.relatedModelName,
          polyInfo,
          childRow,
          include.nested.variantName,
        )
    : createStorageRowMapper(contract, include.relatedNamespaceId, include.relatedModelName);
  let columns = bindings.get(include);
  if (!columns) {
    columns = new Map();
    bindings.set(include, columns);
  }
  const mappedChildren: Record<string, unknown>[] = [];
  for (const childRow of rawChildren) {
    const decodedChildRow = decodeIncludedStorageRow(contract, context, include, childRow, columns);
    const mapped = mapChildRow(decodedChildRow);
    // Source each nested-include payload from the RAW child row: it always
    // carries the payload under its relation alias. `mapChildRow` may be the
    // polymorphic mapper, which keeps only variant model-field columns and so
    // drops the relation alias — reading from `mapped` would lose it.
    for (const nestedInclude of include.nested.includes) {
      mapped[nestedInclude.relationName] = await decodeIncludePayload(
        contract,
        context,
        nestedInclude,
        decodedChildRow[nestedInclude.relationName],
        bindings,
      );
    }
    mappedChildren.push(mapped);
  }
  return coerceSingleQueryIncludeResult(mappedChildren, include.cardinality);
}

/** How a decoded value is named when its decode fails. */
interface DecodedValueRef {
  readonly table: string;
  readonly column: string;
}

interface IncludedColumnRef extends DecodedValueRef {
  readonly storageColumn: StorageColumn;
}

interface IncludedColumnBinding {
  readonly ref: IncludedColumnRef;
  readonly codec: Codec;
  readonly codecId: string;
}

type IncludedColumnBindings = WeakMap<IncludeExpr, Map<string, IncludedColumnBinding | null>>;

function decodeIncludedStorageRow(
  contract: Contract<SqlStorage>,
  context: CodecExecutionContext,
  include: IncludeExpr,
  row: Record<string, unknown>,
  bindings: Map<string, IncludedColumnBinding | null>,
): Record<string, unknown> {
  const decoded: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (value === null || value === undefined) {
      decoded[key] = value;
      continue;
    }

    let binding = bindings.get(key);
    if (binding === undefined) {
      binding = resolveIncludedColumnBinding(contract, context, include, key);
      bindings.set(key, binding);
    }
    decoded[key] = binding
      ? decodeIncludedColumnValue(binding.ref, binding.codecId, binding.codec, value)
      : value;
  }
  return decoded;
}

function resolveIncludedColumnBinding(
  contract: Contract<SqlStorage>,
  context: CodecExecutionContext,
  include: IncludeExpr,
  key: string,
): IncludedColumnBinding | null {
  const ref = resolveIncludedColumnRef(contract, include, key);
  if (!ref) return null;
  const codec = context.contractCodecs.forColumn(include.relatedNamespaceId, ref.table, ref.column);
  if (!codec) return null;
  const codecRef = context.codecDescriptors.codecRefForColumn(
    include.relatedNamespaceId,
    ref.table,
    ref.column,
  );
  return { ref, codec, codecId: codecRef?.codecId ?? ref.storageColumn.codecId };
}

function resolveIncludedColumnRef(
  contract: Contract<SqlStorage>,
  include: IncludeExpr,
  key: string,
): IncludedColumnRef | undefined {
  const baseColumn = resolveStorageColumn(
    contract,
    include.relatedNamespaceId,
    include.relatedTableName,
    key,
  );
  if (baseColumn) {
    return { table: include.relatedTableName, column: key, storageColumn: baseColumn };
  }

  const polyInfo = resolvePolymorphismInfo(
    contract,
    include.relatedNamespaceId,
    include.relatedModelName,
  );
  if (!polyInfo) {
    return undefined;
  }

  for (const variant of polyInfo.mtiVariants) {
    const prefix = `${variant.table}__`;
    if (!key.startsWith(prefix)) {
      continue;
    }

    const column = key.slice(prefix.length);
    const variantColumn = resolveStorageColumn(
      contract,
      include.relatedNamespaceId,
      variant.table,
      column,
    );
    if (variantColumn) {
      return { table: variant.table, column, storageColumn: variantColumn };
    }
  }

  return undefined;
}

function resolveStorageColumn(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  tableName: string,
  columnName: string,
): StorageColumn | undefined {
  return contract.storage.namespaces[namespaceId]?.entries.table?.[tableName]?.columns[columnName];
}

function decodeIncludedColumnValue(
  ref: IncludedColumnRef,
  codecId: string,
  codec: Codec,
  value: unknown,
): unknown {
  if (ref.storageColumn.many === true) {
    if (!Array.isArray(value)) {
      wrapIncludedDecodeFailure(
        new TypeError(
          `expected an array from the driver for many-typed column, got ${typeof value}`,
        ),
        ref,
        codecId,
      );
    }

    const decoded: unknown[] = [];
    for (const element of value) {
      if (element === null || element === undefined) {
        decoded.push(null);
        continue;
      }
      decoded.push(decodeIncludedJsonValue(ref, codecId, codec, element));
    }
    return decoded;
  }

  return decodeIncludedJsonValue(ref, codecId, codec, value);
}

/** `ref` names the value for a decode failure; an aggregate names its relation where a column would name itself. */
function decodeIncludedJsonValue(
  ref: DecodedValueRef,
  codecId: string,
  codec: Codec,
  value: unknown,
): unknown {
  try {
    return codec.decodeJson(
      blindCast<JsonValue, 'SQL JSON aggregate values are JSON values'>(value),
    );
  } catch (error) {
    if (isRuntimeError(error)) throw error;
    wrapIncludedDecodeFailure(error, ref, codecId);
  }
}

function wrapIncludedDecodeFailure(error: unknown, ref: DecodedValueRef, codecId: string): never {
  const message = error instanceof Error ? error.message : String(error);
  const wrapped = runtimeError(
    'RUNTIME.DECODE_FAILED',
    `Failed to decode column ${ref.table}.${ref.column} with codec '${codecId}': ${message}`,
    {
      table: ref.table,
      column: ref.column,
      codec: codecId,
    },
  );
  wrapped.cause = error;
  throw wrapped;
}

/**
 * Decode the combine payload produced by `buildIncludeChildCombineSelect`.
 *
 * The raw value is a JSON object (already parsed by the SQL layer when
 * top-level, or already a JS object when nested) whose keys are branch
 * names. Each branch value is decoded per its declared kind:
 *  - row branch -> recurse via `decodeIncludePayload` with a synthetic
 *    IncludeExpr carrying the branch's state in `nested`. This walks
 *    nested row-level includes the same way a plain row include would.
 *  - scalar branch -> unwrap the `{value: ...}` envelope via the
 *    standalone scalar decoder.
 *
 * On a parent with zero matching child rows the correlated subquery
 * still produces one row (aggregates collapse the empty input to a
 * single row), so the combine envelope here is always present in the
 * read path. Mutation read-back goes through the same read dispatch,
 * so a missing or non-object envelope here is always a planner/decoder
 * bug — `parseCombineEnvelope` throws loudly rather than papering over
 * it with an empty shape.
 */
async function decodeCombineIncludePayload(
  contract: Contract<SqlStorage>,
  context: CodecExecutionContext,
  include: IncludeExpr,
  branches: Readonly<Record<string, IncludeCombineBranch>>,
  raw: unknown,
  bindings: IncludedColumnBindings,
): Promise<Record<string, unknown>> {
  const parsed = parseCombineEnvelope(include, raw);
  const result: Record<string, unknown> = {};
  for (const [branchName, branch] of Object.entries(branches)) {
    const branchRaw = parsed[branchName];
    if (branch.kind === 'rows') {
      const syntheticInclude: IncludeExpr = {
        ...include,
        nested: branch.state,
        scalar: undefined,
        combine: undefined,
      };
      result[branchName] = await decodeIncludePayload(
        contract,
        context,
        syntheticInclude,
        branchRaw,
        bindings,
      );
    } else {
      result[branchName] = decodeScalarIncludePayload(
        contract,
        context,
        include,
        branch.selector,
        branchRaw,
      );
    }
  }
  return result;
}

function parseCombineEnvelope(include: IncludeExpr, raw: unknown): Record<string, unknown> {
  if (raw === null || raw === undefined) {
    throw new InternalError(
      `combine() envelope for include "${include.relationName}" is missing (got ${raw === null ? 'null' : 'undefined'}); the correlated subquery should always produce a JSON object — this indicates a planner or decoder bug.`,
    );
  }
  const parsed = parseIncludePayload(raw);
  if (!isPlainObjectEnvelope(parsed)) {
    throw new InternalError(
      `combine() envelope for include "${include.relationName}" has unexpected shape (expected object, got ${describeEnvelopeShape(parsed)}); this indicates a planner or decoder bug.`,
    );
  }
  return parsed;
}

function isPlainObjectEnvelope(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describeEnvelopeShape(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/**
 * Pull the primitive scalar value out of the JSON envelope emitted by
 * the correlated scalar builder.
 *
 * Contract: the envelope is always either
 *   - a `{ value: <primitive> }` JSON object (the SQL path), or
 *   - `null` / `undefined` (no row reached the decoder), answered with `emptyAggregateResult`.
 *
 * Any other shape — array, primitive, string that JSON-parses to
 * non-object — indicates a planner / decoder bug, so we throw
 * loudly naming the include relation rather than soft-handling.
 * Mirrors `parseCombineEnvelope`'s strict shape gate.
 *
 * The value passes through its own codec — the one the planner projected it
 * under — because it arrived inside a JSON document, where a count past 2^53
 * would otherwise have been read as a rounded number. Resolution mirrors
 * planning — the same registry, operation, and column — so the empty-relation
 * answer derives from the operation's declared row: NULL where the row is
 * nullable, else the value that row declares. The outer `raw === null` fallback is
 * defensive cover for an empty parent set; in single-query dispatch the
 * correlated subquery always produces a row, so the inner envelope's `value`
 * is always set by SQL.
 */
function decodeScalarIncludePayload(
  contract: Contract<SqlStorage>,
  context: CodecExecutionContext,
  include: IncludeExpr,
  scalar: IncludeScalar<unknown>,
  raw: unknown,
): unknown {
  const resolved = resolveAggregate({
    aggregates: context.aggregateDescriptors,
    contract,
    namespaceId: include.relatedNamespaceId,
    tableName: include.relatedTableName,
    fn: scalar.fn,
    column: scalar.column,
  });
  const codec = context.contractCodecs.forCodecRef(resolved.codec);

  if (raw === null || raw === undefined) {
    return emptyAggregateResult(resolved, codec);
  }
  const parsed = parseIncludePayload(raw);
  if (!isPlainObjectEnvelope(parsed)) {
    throw new InternalError(
      `scalar() envelope for include "${include.relationName}" has unexpected shape (expected object, got ${describeEnvelopeShape(parsed)}); this indicates a planner or decoder bug.`,
    );
  }

  const value = parsed['value'];
  if (value === null || value === undefined) return emptyAggregateResult(resolved, codec);

  return decodeIncludedJsonValue(
    { table: include.relatedTableName, column: include.relationName },
    resolved.codec.codecId,
    codec,
    value,
  );
}

function parseIncludedRows(include: IncludeExpr, value: unknown): Record<string, unknown>[] {
  if (value === null || value === undefined) {
    return [];
  }

  const parsed = parseIncludePayload(value);
  if (!Array.isArray(parsed)) {
    return [];
  }

  const rows: Record<string, unknown>[] = [];
  for (const item of parsed) {
    if (!isPlainObjectEnvelope(item)) {
      throw new InternalError(
        `Include row envelope for relation "${include.relationName}" has unexpected shape (expected object, got ${describeEnvelopeShape(item)}); this indicates a planner or decoder bug.`,
      );
    }
    rows.push({ ...item });
  }

  return rows;
}

function parseIncludePayload(value: unknown): unknown {
  if (typeof value !== 'string') {
    return value;
  }

  try {
    return JSON.parse(value);
  } catch {
    return [];
  }
}

function coerceSingleQueryIncludeResult(
  rows: Record<string, unknown>[],
  cardinality: RelationCardinalityTag | undefined,
): Record<string, unknown>[] | Record<string, unknown> | null {
  return isToOneCardinality(cardinality) ? (rows[0] ?? null) : rows;
}
