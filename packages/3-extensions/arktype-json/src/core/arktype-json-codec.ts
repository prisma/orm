/**
 * Arktype-json codec (TML-2357).
 *
 * Spec § Case 3: method-level generic over `S extends Type<unknown>`. The schema's TypeScript-level inferred type `S['infer']` is only available at the column-author site (where the user passes their typed schema), not at the descriptor's factory site (where only the serialized IR is available). This drives the shape:
 *
 * 1. {@link ArktypeJsonCodecClass} extends {@link CodecImpl} and is generic over `TInferred` — the application-level JS type the schema validates to. The constructor takes both the descriptor (for `id` proxy) and the rehydrated arktype `Type` (closure-captured so encode/decode/encodeJson/decodeJson can validate through it). 2. {@link ArktypeJsonDescriptor} extends {@link CodecDescriptorImpl} over {@link
 * ArktypeJsonTypeParams}. Factory rehydrates the schema from `params.jsonIr` and returns `(ctx) => new ArktypeJsonCodecClass<unknown>(this, schema)` — `S` is erased to `unknown` because the descriptor only sees IR. The runtime path through `descriptor.factory(params)` always exists (e.g. for `family.deserializeContract` re-materialization); it just loses the typed inferred shape. 3. {@link arktypeJsonColumn} is the column-author
 * surface with the method-level generic over `S extends Type<unknown>`. It bypasses `descriptor.factory` because `S` is only available here, instead constructing the typed codec directly so `S['infer']` flows through `codecFactory`'s return into the column site's resolved output type. Eager serialization at this call site captures `expression` (for the emit-path renderer) and `jsonIr` (for runtime rehydration).
 *
 * `satisfies ColumnHelperFor<ArktypeJsonDescriptor>` (coarse) is applied — the typeParams shape is verified. `ColumnHelperForStrict` is intentionally skipped: the descriptor's factory return is `ArktypeJsonCodecClass<unknown>` while the helper produces `ArktypeJsonCodecClass<S['infer']>`, and `Codec`'s `TInput` is invariant (used contravariantly in `encode`, covariantly in `decode`/`encodeJson`/`decodeJson`). Strict
 * assignment fails by design; the explicit `expectTypeOf` tests in `test/arktype-json-codec.types.test-d.ts` cover the literal-preservation property the strict variant would otherwise enforce.
 */

import type { JsonValue } from '@internal/contract/types';
import {
  type CodecCallContext,
  CodecImpl,
  type CodecInstanceContext,
  type ColumnHelperFor,
  type ColumnSpec,
  column,
} from '@internal/framework-components/codec';
import { isRuntimeError, runtimeError } from '@internal/framework-components/runtime';
import type { ProjectionExpr } from '@internal/sql-relational-core/ast';
import {
  definePostgresCodecs,
  PostgresCodecDescriptor,
} from '@internal/target-postgres/codec-descriptor';
import { pgJsonb } from '@internal/target-postgres/data-types';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { ArkErrors, ark, type Type, type } from 'arktype';

/** Codec id for arktype-backed JSON columns. Library-bound, not target-bound. */
export const ARKTYPE_JSON_CODEC_ID = 'arktype/json@1' as const;

/** Native storage type backing the codec. JSONB on Postgres; binary, indexable. */
export const ARKTYPE_JSON_NATIVE_TYPE = 'jsonb' as const;

/**
 * Eagerly serialized typeParams for the arktype-json column. Carried in the contract IR; the runtime descriptor's factory rehydrates `jsonIr` and the emitter consumes `expression`.
 */
export type ArktypeJsonTypeParams = {
  /**
   * Arktype's TypeScript-source-like rendering of the schema. Read by `renderOutputType` to emit the column's TS type into `contract.d.ts`. Stable across the serialize/rehydrate cycle: the rehydrated schema's `expression` matches the source schema's.
   */
  readonly expression: string;
  /**
   * Arktype's internal IR for the schema. Lossless; the rehydration source. Schema-shape — `ark.schema(jsonIr)` reconstructs a callable `Type`-like structurally identical to the original `type(definition)` output.
   */
  readonly jsonIr: object;
};

type ArktypeSchemaLike = ((value: unknown) => unknown) & {
  readonly expression: string;
  readonly json?: unknown;
};

function isArktypeSchemaLike(value: unknown): value is ArktypeSchemaLike {
  if (typeof value !== 'function') return false;
  const expression = (value as { readonly expression?: unknown }).expression;
  return typeof expression === 'string';
}

function validateSchema<TInferred>(schema: ArktypeSchemaLike, value: unknown): TInferred {
  const result = schema(value);
  if (result instanceof ArkErrors) {
    throw runtimeError(
      'RUNTIME.JSON_SCHEMA_VALIDATION_FAILED',
      `arktype-json schema validation failed (decode): ${result.summary}`,
      { codecId: ARKTYPE_JSON_CODEC_ID, issues: result.summary },
    );
  }
  return result as TInferred;
}

function serializeWire<TInferred>(value: TInferred): string {
  let wire: string | undefined;
  try {
    wire = JSON.stringify(value);
  } catch (error) {
    throw Object.assign(
      runtimeError(
        'RUNTIME.ENCODE_FAILED',
        `arktype-json value could not be serialized to JSON (codecId: ${ARKTYPE_JSON_CODEC_ID})`,
        { codecId: ARKTYPE_JSON_CODEC_ID },
      ),
      { cause: error },
    );
  }
  if (typeof wire !== 'string') {
    throw runtimeError(
      'RUNTIME.ENCODE_FAILED',
      `arktype-json value is not representable as JSON (codecId: ${ARKTYPE_JSON_CODEC_ID})`,
      { codecId: ARKTYPE_JSON_CODEC_ID },
    );
  }
  return wire;
}

function serializeJson<TInferred>(value: TInferred): JsonValue {
  // The stringify → parse round-trip both validates JSON-representability
  // (matching `serializeWire`) and produces a deep-cloned `JsonValue` that
  // strips class prototypes / `toJSON` side effects, so callers reading
  // the in-memory `JsonValue` see exactly the shape that would round-trip
  // through the database.
  return JSON.parse(serializeWire(value)) as JsonValue;
}

function parseJsonText(wire: string): JsonValue | undefined {
  try {
    return JSON.parse(wire) as JsonValue;
  } catch {
    return undefined;
  }
}

function decodeWireValue<TInferred>(
  schema: ArktypeSchemaLike,
  wire: string | JsonValue,
): TInferred {
  if (typeof wire !== 'string') return validateSchema<TInferred>(schema, wire);

  // Try the wire as the literal value first. Under `pg` + `jsonb` (the
  // documented native type), wire arrives already-parsed: a JSON object
  // surfaces as a JS object, a JSON string surfaces as a JS string. For
  // string columns that means the wire IS the user's value — including
  // strings whose literal characters happen to start and end with `"`.
  // A `"…"`-shape unwrap heuristic would silently truncate them (the
  // 7-char `"hello"` would decode to the 5-char `hello`).
  //
  // Fall back to JSON.parse only when schema validation rejects the raw
  // wire: that path covers object/array shapes received as raw JSON
  // text (legacy `json` text-OID adapters, or any code path that hands
  // us un-pre-parsed JSON).
  try {
    return validateSchema<TInferred>(schema, wire);
  } catch (error) {
    if (!isRuntimeError(error) || error.code !== 'RUNTIME.JSON_SCHEMA_VALIDATION_FAILED') {
      throw error;
    }
    const parsed = parseJsonText(wire);
    if (parsed === undefined) {
      throw error;
    }
    return validateSchema<TInferred>(schema, parsed);
  }
}

function rehydrateSchema(jsonIr: object): ArktypeSchemaLike {
  let rehydrated: unknown;
  try {
    rehydrated = ark.schema(jsonIr);
  } catch (error) {
    throw runtimeError(
      'RUNTIME.JSON_SCHEMA_VALIDATION_FAILED',
      /* c8 ignore next — the `String(error)` fallback covers throws of non-Error values; arktype only throws Error subclasses, so this branch is defensive only. */
      `Failed to rehydrate arktype schema from contract IR: ${error instanceof Error ? error.message : String(error)}`,
      { codecId: ARKTYPE_JSON_CODEC_ID, jsonIr },
    );
  }
  /* c8 ignore start — defensive: ark.schema either throws (handled above) or returns a callable Type with `expression: string`. The structural guard is kept so a future ark internal change can't silently slip a non-callable past us. */
  if (!isArktypeSchemaLike(rehydrated)) {
    throw runtimeError(
      'RUNTIME.JSON_SCHEMA_VALIDATION_FAILED',
      `Rehydrated arktype schema does not have the expected callable + 'expression: string' shape (codecId: ${ARKTYPE_JSON_CODEC_ID})`,
      { codecId: ARKTYPE_JSON_CODEC_ID, jsonIr },
    );
  }
  /* c8 ignore stop */
  return rehydrated;
}

function renderArktypeJsonOutputType(params: ArktypeJsonTypeParams): string {
  const expression = params.expression.trim();
  return expression.length > 0 ? expression : 'unknown';
}

export class ArktypeJsonCodecClass<TInferred> extends CodecImpl<
  typeof ARKTYPE_JSON_CODEC_ID,
  readonly ['equality'],
  string | JsonValue,
  TInferred
> {
  constructor(
    descriptor: ArktypeJsonDescriptor,
    private readonly schema: ArktypeSchemaLike,
  ) {
    super(descriptor);
  }

  async encode(value: TInferred, _ctx: CodecCallContext): Promise<string> {
    return serializeWire(value);
  }

  async decode(wire: string | JsonValue, _ctx: CodecCallContext): Promise<TInferred> {
    return decodeWireValue<TInferred>(this.schema, wire);
  }

  encodeJson(value: TInferred): JsonValue {
    return serializeJson(value);
  }

  decodeJson(json: JsonValue): TInferred {
    return validateSchema<TInferred>(this.schema, json);
  }
}

const arktypeJsonParamsSchema = type({
  expression: 'string',
  jsonIr: 'object',
}) satisfies StandardSchemaV1<ArktypeJsonTypeParams>;

export class ArktypeJsonDescriptor extends PostgresCodecDescriptor<ArktypeJsonTypeParams> {
  protected override nativeType(): string {
    return ARKTYPE_JSON_NATIVE_TYPE;
  }
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return expression;
  }
  override readonly dataType = pgJsonb.id;
  override readonly codecId = ARKTYPE_JSON_CODEC_ID;
  override readonly traits = ['equality'] as const;
  override readonly targetTypes = [ARKTYPE_JSON_NATIVE_TYPE] as const;
  override readonly paramsSchema: StandardSchemaV1<ArktypeJsonTypeParams> = arktypeJsonParamsSchema;
  override renderOutputType(params: ArktypeJsonTypeParams): string {
    return renderArktypeJsonOutputType(params);
  }
  override factory(
    params: ArktypeJsonTypeParams,
  ): (ctx: CodecInstanceContext) => ArktypeJsonCodecClass<unknown> {
    const schema = rehydrateSchema(params.jsonIr);
    const rehydratedExpression = (schema as { readonly expression?: unknown }).expression;
    if (typeof rehydratedExpression === 'string' && rehydratedExpression !== params.expression) {
      throw runtimeError(
        'RUNTIME.TYPE_PARAMS_INVALID',
        `arktype-json: typeParams.expression (${params.expression}) does not match the rehydrated schema's expression (${rehydratedExpression}). The contract was likely emitted against a different arktype version or hand-edited; re-run \`pnpm emit\` to regenerate.`,
        {
          codecId: ARKTYPE_JSON_CODEC_ID,
          serializedExpression: params.expression,
          rehydratedExpression,
        },
      );
    }
    return () => new ArktypeJsonCodecClass<unknown>(this, schema);
  }
}

export const arktypeJsonDescriptor = new ArktypeJsonDescriptor();

/**
 * Per-codec column helper for `arktype/json@1`. Method-level generic over `S extends Type<unknown>` so the column site preserves the schema's inferred TS type in the resolved codec (`ArktypeJsonCodecClass<S['infer']>`). Bypasses `descriptor.factory` because `S` is only available at the column-author site; constructs the typed codec directly with the closure-captured schema.
 *
 * Eager serialization at this call site captures `expression` (for the emit-path renderer) and `jsonIr` (for runtime rehydration via the descriptor's factory).
 *
 * @throws `CONTRACT.ARGUMENT_INVALID` if the schema doesn't expose `expression` and `json` fields (i.e. is not an arktype `Type`). Validates the schema shape at the call site so configuration errors surface during contract authoring, not at runtime.
 */
export function arktypeJsonColumn<S extends Type<unknown>>(
  schema: S,
): ColumnSpec<ArktypeJsonCodecClass<S['infer']>, ArktypeJsonTypeParams> {
  if (!isArktypeSchemaLike(schema)) {
    throw runtimeError(
      'CONTRACT.ARGUMENT_INVALID',
      typeof schema !== 'function'
        ? 'arktypeJsonColumn(schema) expects a callable arktype Type.'
        : 'arktypeJsonColumn(schema) expects an arktype Type (missing `expression: string`).',
      { helperPath: 'arktypeJsonColumn', expected: 'arktype Type', received: typeof schema },
    );
  }
  const jsonIr: unknown = schema.json;
  if (jsonIr === null || typeof jsonIr !== 'object') {
    throw runtimeError(
      'CONTRACT.ARGUMENT_INVALID',
      'arktypeJsonColumn(schema) expects an arktype Type (missing `json` IR).',
      { helperPath: 'arktypeJsonColumn', expected: 'arktype Type', received: typeof jsonIr },
    );
  }
  const params: ArktypeJsonTypeParams = { expression: schema.expression, jsonIr };
  return column(
    (_ctx: CodecInstanceContext) =>
      new ArktypeJsonCodecClass<S['infer']>(arktypeJsonDescriptor, schema),
    arktypeJsonDescriptor.codecId,
    params,
    ARKTYPE_JSON_NATIVE_TYPE,
  );
}

arktypeJsonColumn satisfies ColumnHelperFor<ArktypeJsonDescriptor>;
// Note: `ColumnHelperForStrict` is intentionally not applied — `Codec` is invariant in `TInput` (encode contravariant, decode covariant), so `ArktypeJsonCodecClass<S['infer']>` is not assignable to `ArktypeJsonCodecClass<unknown>` (the descriptor.factory return). `expectTypeOf` tests cover the literal-preservation property strict satisfies would otherwise enforce.

/**
 * Codec instance returned by `arktypeJsonColumn(schema).codecFactory(ctx)` and by `arktypeJsonDescriptor.factory(typeParams)(ctx)`. The `TInferred` slot carries the arktype schema's inferred output type at the column-author site; descriptor-side factories erase to `unknown`.
 */
export type ArktypeJsonCodec<TInferred> = ArktypeJsonCodecClass<TInferred>;

export const codecDescriptors = definePostgresCodecs([arktypeJsonDescriptor]);
