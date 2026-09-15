import type { JsonValue } from '@internal/contract/types';
import { checkAborted, runtimeError } from '@internal/framework-components/runtime';
import type {
  AnyQueryAst,
  Codec,
  ContractCodecRegistry,
  ProjectionItem,
  RawQueryAst,
  SqlCodecCallContext,
} from '@internal/sql-relational-core/ast';
import { blindCast } from '@internal/utils/casts';
import { isStructuredError } from '@internal/utils/structured-error';

type ColumnRef = { table: string; column: string };

export type ListDecoder = (
  wireValue: unknown,
  decodeElement: (value: unknown) => unknown,
) => readonly unknown[];

export const sqlNativeArrayListDecoder: ListDecoder = (wireValue, decodeElement) => {
  if (!Array.isArray(wireValue)) {
    throw new TypeError(
      `expected an array from the driver for many-typed column, got ${typeof wireValue}`,
    );
  }
  const decoded: unknown[] = [];
  for (const elem of wireValue) {
    decoded.push(decodeElement(elem));
  }
  return decoded;
};

export interface DecodeContext {
  readonly aliases: ReadonlyArray<string> | undefined;
  readonly codecs: ReadonlyMap<string, Codec>;
  readonly columnRefs: ReadonlyMap<string, ColumnRef>;
  readonly includeAliases: ReadonlySet<string>;
  readonly manyAliases: ReadonlySet<string>;
  /**
   * Where {@link DecodeContext.aliases} came from, which decides how a row
   * that lacks one of them reads: a projection the builder wrote is the
   * runtime's own doing, while a row spec is the author's declaration about a
   * statement the runtime never inspected.
   */
  readonly aliasSource: 'projection' | 'row-spec';
}

const WIRE_PREVIEW_LIMIT = 100;
const EMPTY_INCLUDE_ALIASES: ReadonlySet<string> = new Set<string>();

function projectionListFromAst(
  ast: Exclude<AnyQueryAst, RawQueryAst>,
): ReadonlyArray<ProjectionItem> | undefined {
  if (ast.kind === 'select') {
    return ast.projection;
  }
  return ast.returning;
}

function resolveProjectionCodec(
  item: ProjectionItem,
  contractCodecs: ContractCodecRegistry | undefined,
): Codec | undefined {
  if (item.codec && contractCodecs) {
    return contractCodecs.forCodecRef(item.codec);
  }
  return undefined;
}

const EMPTY_MANY_ALIASES: ReadonlySet<string> = new Set<string>();

function undecodedContext(): DecodeContext {
  return {
    aliases: undefined,
    codecs: new Map(),
    columnRefs: new Map(),
    includeAliases: EMPTY_INCLUDE_ALIASES,
    manyAliases: EMPTY_MANY_ALIASES,
    aliasSource: 'projection',
  };
}

/**
 * Decode context for a raw statement: the columns come from the row spec its
 * author declared at the terminator, and each carries the codec that decodes
 * it. A statement that reports an affected-row count declares no columns, so
 * its single stats row passes through undecoded.
 *
 * The spec is the only description of the result — the runtime never parses
 * the SQL — so it is also what a mismatched result set is measured against.
 */
function rawQueryDecodeContext(
  ast: RawQueryAst,
  contractCodecs: ContractCodecRegistry | undefined,
): DecodeContext {
  if (ast.result.kind === 'affected-count') {
    return undecodedContext();
  }

  const aliases: string[] = [];
  const codecs = new Map<string, Codec>();
  for (const [name, column] of Object.entries(ast.result.columns)) {
    aliases.push(name);
    if (contractCodecs) {
      codecs.set(name, contractCodecs.forCodecRef({ codecId: column.codecId }));
    }
  }

  return {
    aliases,
    codecs,
    columnRefs: new Map(),
    includeAliases: EMPTY_INCLUDE_ALIASES,
    manyAliases: EMPTY_MANY_ALIASES,
    aliasSource: 'row-spec',
  };
}

export function buildDecodeContext(
  ast: AnyQueryAst,
  contractCodecs: ContractCodecRegistry | undefined,
): DecodeContext {
  if (ast.kind === 'raw-query') {
    return rawQueryDecodeContext(ast, contractCodecs);
  }

  const projection = projectionListFromAst(ast);
  if (!projection || projection.length === 0) {
    return undecodedContext();
  }

  const aliases: string[] = [];
  const codecs = new Map<string, Codec>();
  const columnRefs = new Map<string, ColumnRef>();
  const includeAliases = new Set<string>();
  const manyAliases = new Set<string>();

  for (const item of projection) {
    aliases.push(item.alias);

    const codec = resolveProjectionCodec(item, contractCodecs);
    if (codec) {
      codecs.set(item.alias, codec);
    }

    if (item.codec?.many) {
      manyAliases.add(item.alias);
    }

    if (item.expr.kind === 'column-ref') {
      columnRefs.set(item.alias, {
        table: item.expr.table,
        column: item.expr.column,
      });
    } else if (item.expr.kind === 'subquery' || item.expr.kind === 'json-array-agg') {
      includeAliases.add(item.alias);
    }
  }

  return { aliases, codecs, columnRefs, includeAliases, manyAliases, aliasSource: 'projection' };
}

function previewWireValue(wireValue: unknown): string {
  if (typeof wireValue === 'string') {
    return wireValue.length > WIRE_PREVIEW_LIMIT
      ? `${wireValue.substring(0, WIRE_PREVIEW_LIMIT)}...`
      : wireValue;
  }
  return String(wireValue).substring(0, WIRE_PREVIEW_LIMIT);
}

function wrapDecodeFailure(
  error: unknown,
  alias: string,
  ref: ColumnRef | undefined,
  codec: Codec,
  wireValue: unknown,
): never {
  const message = error instanceof Error ? error.message : String(error);
  const target = ref ? `${ref.table}.${ref.column}` : alias;
  const wrapped = runtimeError(
    'RUNTIME.DECODE_FAILED',
    `Failed to decode column ${target} with codec '${codec.id}': ${message}`,
    {
      ...(ref ? { table: ref.table, column: ref.column } : { alias }),
      codec: codec.id,
      wirePreview: previewWireValue(wireValue),
    },
  );
  wrapped.cause = error;
  throw wrapped;
}

function wrapIncludeAggregateFailure(error: unknown, alias: string, wireValue: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  const wrapped = runtimeError(
    'RUNTIME.DECODE_FAILED',
    `Failed to parse JSON array for include alias '${alias}': ${message}`,
    {
      alias,
      wirePreview: previewWireValue(wireValue),
    },
  );
  wrapped.cause = error;
  throw wrapped;
}

type IncludeAggregateValue = JsonValue | readonly unknown[];

function decodeIncludeAggregate(alias: string, wireValue: unknown): IncludeAggregateValue {
  if (wireValue === null || wireValue === undefined) {
    return [];
  }

  try {
    if (typeof wireValue === 'string') {
      return JSON.parse(wireValue);
    }
    if (typeof wireValue === 'object') {
      // Driver layer has already parsed the JSON wire value (pg returns
      // json / jsonb columns as JS values). Pass through unchanged —
      // both row include arrays (`json_agg`) and scalar / combine
      // include envelopes (`json_build_object`) flow through this path,
      // each with their own downstream shape decoder.
      return blindCast<IncludeAggregateValue, 'JSON aggregates are already parsed by the driver'>(
        wireValue,
      );
    }
    return JSON.parse(String(wireValue));
  } catch (error) {
    wrapIncludeAggregateFailure(error, alias, wireValue);
  }
}

/**
 * Decodes a single field synchronously. JSON-Schema validation, when required, lives inside the resolved codec's `decode` body (e.g. `arktype-json` validates against its rehydrated schema and throws `RUNTIME.JSON_SCHEMA_VALIDATION_FAILED` from `decode` directly); there is
 * no separate validator-registry pass.
 *
 * The row-level `rowCtx` is repackaged into a per-cell `SqlCodecCallContext` whose `column = { table, name }` is a structural projection of the per-cell `ColumnRef = { table, column }` resolved from the AST-backed `DecodeContext` (the same resolution `wrapDecodeFailure` uses for envelope construction — one resolution per cell, two consumers). Cells the runtime cannot resolve to a single underlying column (aggregate
 * aliases, computed projections without a simple ref) get `column: undefined`, matching the spec contract that the runtime never silently defaults this field.
 *
 * For `many`-flagged aliases this function delegates frame traversal to the selected `ListDecoder`, passing `null` elements through unchanged and mapping the same element codec over every non-null element. SQL runtimes without a target-owned contribution select `sqlNativeArrayListDecoder` explicitly before row decoding. Element-level failures surface through the existing `RUNTIME.DECODE_FAILED` envelope with the column/codec context from the parent cell.
 */
function decodeField(
  alias: string,
  wireValue: unknown,
  decodeCtx: DecodeContext,
  rowCtx: SqlCodecCallContext,
  listDecoder: ListDecoder,
): unknown {
  if (wireValue === null) {
    return null;
  }

  const codec = decodeCtx.codecs.get(alias);
  if (!codec) {
    return wireValue;
  }

  const ref = decodeCtx.columnRefs.get(alias);

  let cellCtx: SqlCodecCallContext;
  if (ref) {
    cellCtx = { ...rowCtx, column: { table: ref.table, name: ref.column } };
  } else {
    const { column: _drop, ...rowCtxWithoutColumn } = rowCtx;
    cellCtx = rowCtxWithoutColumn;
  }

  const decodeElement = (elem: unknown): unknown => {
    if (elem === null || elem === undefined) {
      return null;
    }

    try {
      return codec.decode(elem, cellCtx);
    } catch (error) {
      if (isStructuredError(error)) throw error;
      wrapDecodeFailure(error, alias, ref, codec, elem);
    }
  };

  if (decodeCtx.manyAliases.has(alias)) {
    try {
      return listDecoder(wireValue, decodeElement);
    } catch (error) {
      if (isStructuredError(error)) throw error;
      wrapDecodeFailure(error, alias, ref, codec, wireValue);
    }
  }

  try {
    return codec.decode(wireValue, cellCtx);
  } catch (error) {
    // Any structured envelope (dotted `code` per `isStructuredError`) is
    // stable by construction — let it pass through unchanged. This covers
    // every `runtimeError`-built envelope and plain `structuredError`
    // envelopes from extension codecs (e.g. a codec-authored
    // `RUNTIME.DECODE_FAILED` — no double wrap). Symmetric with the
    // encode-side guard.
    if (isStructuredError(error)) {
      throw error;
    }
    wrapDecodeFailure(error, alias, ref, codec, wireValue);
  }
}

export function decodeRow(
  row: Record<string, unknown>,
  decodeCtx: DecodeContext,
  rowCtx: SqlCodecCallContext,
  listDecoder: ListDecoder,
): Record<string, unknown> {
  checkAborted(rowCtx, 'decode');

  const aliases = decodeCtx.aliases ?? Object.keys(row);

  if (decodeCtx.aliases !== undefined) {
    for (const alias of decodeCtx.aliases) {
      if (!Object.hasOwn(row, alias)) {
        throw decodeCtx.aliasSource === 'row-spec'
          ? runtimeError(
              'RUNTIME.RAW_ROW_COLUMN_MISSING',
              `Raw statement result has no column "${alias}", which its row spec declares`,
              {
                column: alias,
                declaredColumns: decodeCtx.aliases,
                resultColumns: Object.keys(row),
              },
            )
          : runtimeError('RUNTIME.DECODE_FAILED', `Row missing projection alias "${alias}"`, {
              alias,
              expectedAliases: decodeCtx.aliases,
              presentKeys: Object.keys(row),
            });
      }
    }
  }

  const decoded: Record<string, unknown> = {};
  for (const alias of aliases) {
    const wireValue = row[alias];
    decoded[alias] = decodeCtx.includeAliases.has(alias)
      ? decodeIncludeAggregate(alias, wireValue)
      : decodeField(alias, wireValue, decodeCtx, rowCtx, listDecoder);
  }
  return decoded;
}
