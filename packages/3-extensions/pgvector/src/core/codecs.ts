/**
 * pgvector extension codec.
 *
 * Mirrors the patterns in `postgres/codecs-class.ts` and `sqlite/codecs-class.ts` for the single `pg/vector@1` codec. Three artifacts:
 *
 * 1. `PgVectorCodec` extends {@link CodecImpl} with the runtime encode/decode/encodeJson/decodeJson conversions inline. Conversions are simple enough (PostgreSQL `[1,2,3]` text format) that no shared helper module is warranted; the class body is the source of truth.
 * 2. `PgVectorDescriptor` extends {@link PostgresCodecDescriptor} with the codec id, traits, target types, params schema (`{ length?: number }`, validated against {@link VECTOR_MAX_DIM}), the postgres native type `vector`, explicit target behavior, and the emit-path `renderOutputType` producing `Vector` or `Vector<${length}>`.
 * 3. `pgVectorColumn(length?)` per-codec column helper invoking `descriptor.factory({ length })` directly + passing the bare `nativeType: 'vector'`. The family-layer {@link expandNativeType} hook renders the parameterized form (`vector` or `vector(1536)`) at emit/verify time from `nativeType` + `typeParams`.
 *
 * When provided, `length` threads into the runtime codec via the constructor so encode/decode/encodeJson/decodeJson enforce the declared dimension at every ingress path. Without this, `vector(3)` and `vector(1536)` would produce codecs with identical behaviour and a dimension-mismatched value would round-trip undetected.
 */

import type { JsonValue } from '@internal/contract/types';
import {
  type AnyCodecDescriptor,
  type CodecCallContext,
  CodecImpl,
  type CodecInstanceContext,
  type ColumnHelperFor,
  type ColumnHelperForStrict,
  column,
} from '@internal/framework-components/codec';
import type { ExtractCodecTypes, ProjectionExpr } from '@internal/sql-relational-core/ast';
import { CastExpr, FunctionCallExpr } from '@internal/sql-relational-core/ast';
import {
  definePostgresCodecs,
  PostgresCodecDescriptor,
} from '@internal/target-postgres/codec-descriptor';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { type as arktype } from 'arktype';
import { VECTOR_CODEC_ID, VECTOR_MAX_DIM } from './constants';
import { pgVectorError } from './errors';

type VectorConversionCode = 'RUNTIME.ENCODE_FAILED' | 'RUNTIME.DECODE_FAILED';

type VectorParams = { readonly length?: number };

const vectorParamsSchema = arktype({
  'length?': 'number',
}).narrow((params, ctx) => {
  const { length } = params;
  if (length === undefined) return true;
  if (!Number.isInteger(length)) {
    return ctx.mustBe('an integer');
  }
  if (length < 1 || length > VECTOR_MAX_DIM) {
    return ctx.mustBe(`in the range [1, ${VECTOR_MAX_DIM}]`);
  }
  return true;
}) satisfies StandardSchemaV1<VectorParams>;

const PG_VECTOR_NATIVE_TYPE = 'vector';

function parseVector(value: string): number[] {
  if (!value.startsWith('[') || !value.endsWith(']')) {
    throw pgVectorError(
      'RUNTIME.DECODE_FAILED',
      `Invalid vector format: expected "[...]", got "${value}"`,
      {
        why: 'The database returned a vector value that is not in the PostgreSQL "[x,y,z]" text format.',
        meta: { codecId: VECTOR_CODEC_ID, wirePreview: value },
      },
    );
  }
  const content = value.slice(1, -1).trim();
  return content === ''
    ? []
    : content.split(',').map((entry) => {
        const number = Number.parseFloat(entry.trim());
        if (Number.isNaN(number)) {
          throw pgVectorError(
            'RUNTIME.DECODE_FAILED',
            `Invalid vector value: "${entry}" is not a number`,
            {
              why: 'A vector entry returned by the database could not be parsed as a number.',
              meta: { codecId: VECTOR_CODEC_ID, wirePreview: value },
            },
          );
        }
        return number;
      });
}

export class PgVectorCodec extends CodecImpl<
  typeof VECTOR_CODEC_ID,
  readonly ['equality'],
  string,
  number[]
> {
  readonly length: number | undefined;

  constructor(descriptor: AnyCodecDescriptor, length: number | undefined) {
    super(descriptor);
    this.length = length;
  }

  assertVector(value: unknown, code: VectorConversionCode): asserts value is number[] {
    const meta = { codecId: VECTOR_CODEC_ID, expectedLength: this.length };
    if (!Array.isArray(value)) {
      throw pgVectorError(code, 'Vector value must be an array of numbers', { meta });
    }
    for (const element of value) {
      if (typeof element !== 'number') {
        throw pgVectorError(code, 'Vector value must contain only numbers', { meta });
      }
      if (!Number.isFinite(element)) {
        throw pgVectorError(code, 'Vector value must contain only finite numbers', { meta });
      }
    }
    if (this.length !== undefined && value.length !== this.length) {
      throw pgVectorError(
        code,
        `Vector length mismatch: expected ${this.length}, got ${value.length}`,
        {
          why: `This column is declared as vector(${this.length}); every value must have exactly that many dimensions.`,
          meta: { ...meta, receivedLength: value.length },
        },
      );
    }
  }

  async encode(value: number[], _ctx: CodecCallContext): Promise<string> {
    this.assertVector(value, 'RUNTIME.ENCODE_FAILED');
    return `[${value.join(',')}]`;
  }

  async decode(wire: string, _ctx: CodecCallContext): Promise<number[]> {
    if (typeof wire !== 'string') {
      throw pgVectorError('RUNTIME.DECODE_FAILED', 'Vector wire value must be a string', {
        meta: { codecId: VECTOR_CODEC_ID },
      });
    }
    const value = parseVector(wire);
    this.assertVector(value, 'RUNTIME.DECODE_FAILED');
    return value;
  }

  encodeJson(value: number[]): JsonValue {
    this.assertVector(value, 'RUNTIME.ENCODE_FAILED');
    return [...value];
  }

  decodeJson(json: JsonValue): number[] {
    if (!Array.isArray(json)) {
      throw pgVectorError('RUNTIME.DECODE_FAILED', 'Vector database JSON value must be an array', {
        meta: { codecId: VECTOR_CODEC_ID },
      });
    }
    const value = [...json];
    this.assertVector(value, 'RUNTIME.DECODE_FAILED');
    return value;
  }
}

/**
 * Projects a `vector` as a JSON numeric array.
 *
 * A `vector` handed straight to a JSON constructor is rendered through its text
 * output function, so it arrives as the *string* `"[1,2,3]"` rather than as an
 * array.
 *
 * The route matters as much as the destination. A vector's elements are `real`,
 * and its text form prints the shortest decimal that round-trips *as a `real`* —
 * `0.1` for a value the application holds as `0.10000000149011612`. Reading that
 * text back as a double therefore lands on a different number, so casting the
 * text to `json` would lose precision the value still had. Widening each element
 * to `float8` first keeps the exact value the `real` denotes, which is what
 * `encodeJson` returns.
 */
const jsonArrayFromVectorElements = (expression: ProjectionExpr): ProjectionExpr =>
  FunctionCallExpr.of('array_to_json', [
    CastExpr.as(CastExpr.as(expression, 'real[]'), 'float8[]'),
  ]);

export class PgVectorDescriptor extends PostgresCodecDescriptor<VectorParams> {
  protected override nativeType(): string {
    return PG_VECTOR_NATIVE_TYPE;
  }
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return jsonArrayFromVectorElements(expression);
  }
  override readonly codecId = VECTOR_CODEC_ID;
  override readonly traits = ['equality'] as const;
  override readonly targetTypes = ['vector'] as const;
  override readonly paramsSchema: StandardSchemaV1<VectorParams> = vectorParamsSchema;
  override renderOutputType(params: VectorParams): string {
    return params.length === undefined ? 'Vector' : `Vector<${params.length}>`;
  }
  override factory(params: VectorParams): (ctx: CodecInstanceContext) => PgVectorCodec {
    return () => new PgVectorCodec(this, params.length);
  }
}

export const pgVectorDescriptor = new PgVectorDescriptor();

export function pgVectorColumn(): ReturnType<typeof variableVectorColumn>;
export function pgVectorColumn<N extends number>(
  length: N,
): ReturnType<typeof fixedVectorColumn<N>>;
export function pgVectorColumn(length?: number) {
  return length === undefined ? variableVectorColumn() : fixedVectorColumn(length);
}

function variableVectorColumn() {
  return column(pgVectorDescriptor.factory({}), pgVectorDescriptor.codecId, {}, 'vector');
}

function fixedVectorColumn<N extends number>(length: N) {
  return column(
    pgVectorDescriptor.factory({ length }),
    pgVectorDescriptor.codecId,
    { length },
    'vector',
  );
}

pgVectorColumn satisfies ColumnHelperFor<PgVectorDescriptor>;
pgVectorColumn satisfies ColumnHelperForStrict<PgVectorDescriptor>;

const codecDescriptorMap = {
  vector: pgVectorDescriptor,
} as const;

export type CodecTypes = ExtractCodecTypes<typeof codecDescriptorMap>;

export const codecDescriptors = definePostgresCodecs(Object.values(codecDescriptorMap));
