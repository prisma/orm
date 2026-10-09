/**
 * pgvector extension codec.
 *
 * Mirrors the patterns in `postgres/codecs-class.ts` and `sqlite/codecs-class.ts` for the single `pg/vector@1` codec. Three artifacts:
 *
 * 1. `PgVectorCodec` extends {@link CodecImpl} with the runtime encode/decode/encodeJson/decodeJson conversions inline. Conversions are simple enough (PostgreSQL `[1,2,3]` text format) that no shared helper module is warranted; the class body is the source of truth.
 * 2. `PgVectorDescriptor` extends {@link PostgresCodecDescriptor} with the codec id, traits, the `pgvector/vector` data type and its params schema, explicit target behavior, and the emit-path `renderOutputType` producing `Vector` or `Vector<${length}>`. The data type declares the type's name and the bounds of `length`.
 * 3. `pgVectorColumn(length?)` per-codec column helper invoking `descriptor.factory({ length })` directly.
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
  refuseJsonValue,
} from '@internal/framework-components/codec';
import type { ExtractCodecTypes, ProjectionExpr } from '@internal/sql-relational-core/ast';
import { CastExpr, FunctionCallExpr } from '@internal/sql-relational-core/ast';
import {
  definePostgresCodecs,
  PostgresCodecDescriptor,
} from '@internal/target-postgres/codec-descriptor';
import { counted } from '@internal/utils/text';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { VECTOR_CODEC_ID, VECTOR_MAX_DIM } from './constants';
import { pgvectorVector, pgvectorVectorParams } from './data-types';
import { pgVectorError } from './errors';

type VectorConversionCode = 'RUNTIME.ENCODE_FAILED' | 'RUNTIME.DECODE_FAILED';

type VectorParams = { readonly length?: number };

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

  /** Creates a codec with an optional exact dimension; undefined permits variable dimensions. */
  constructor(descriptor: AnyCodecDescriptor, length: number | undefined) {
    super(descriptor);
    this.length = length;
  }

  /** Rejects non-finite elements and lengths outside the declared dimension or supported bounds. */
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
    if (this.length === undefined && !this.acceptsLength(value.length)) {
      throw pgVectorError(
        code,
        `Vector length must be between 1 and ${VECTOR_MAX_DIM}, got ${value.length}`,
        { meta: { ...meta, receivedLength: value.length } },
      );
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

  /** Reads a JSON numeric array, rejecting invalid elements or lengths with a JSON codec error. */
  decodeJson(json: JsonValue): number[] {
    if (!Array.isArray(json) || !this.acceptsLength(json.length)) return this.refuseJson(json);
    const numbers: number[] = [];
    for (const element of json) {
      if (typeof element !== 'number' || !Number.isFinite(element)) return this.refuseJson(json);
      numbers.push(element);
    }
    return numbers;
  }

  /** Checks the exact declared dimension, or the supported 1–16,000 range when none is declared. */
  private acceptsLength(length: number): boolean {
    return this.length === undefined
      ? length >= 1 && length <= VECTOR_MAX_DIM
      : length === this.length;
  }

  /** Throws a JSON codec error describing the numeric array and dimension this codec accepts. */
  private refuseJson(json: JsonValue): never {
    return refuseJsonValue(
      VECTOR_CODEC_ID,
      this.length === undefined
        ? `an array of 1 to ${VECTOR_MAX_DIM} finite numbers`
        : `an array of ${counted(this.length, 'finite number')}`,
      json,
    );
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
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return jsonArrayFromVectorElements(expression);
  }
  override readonly dataType = pgvectorVector.id;
  override readonly codecId = VECTOR_CODEC_ID;
  override readonly traits = ['equality'] as const;
  override readonly paramsSchema: StandardSchemaV1<VectorParams> = pgvectorVectorParams;
  /** Renders Vector for variable dimensions or Vector<N> for a declared dimension. */
  override renderOutputType(params: VectorParams): string {
    return params.length === undefined ? 'Vector' : `Vector<${params.length}>`;
  }
  override factory(params: VectorParams): (ctx: CodecInstanceContext) => PgVectorCodec {
    return () => new PgVectorCodec(this, params.length);
  }
}

export const pgVectorDescriptor = new PgVectorDescriptor();

/** Creates a vector column with variable dimensions and empty type parameters. */
export function pgVectorColumn(): ReturnType<typeof variableVectorColumn>;
/** Creates a vector column that preserves its exact dimension as a type parameter. */
export function pgVectorColumn<N extends number>(
  length: N,
): ReturnType<typeof fixedVectorColumn<N>>;
/** Selects a variable or fixed dimension codec factory from the optional length. */
export function pgVectorColumn(length?: number) {
  return length === undefined ? variableVectorColumn() : fixedVectorColumn(length);
}

/** Binds an undimensioned codec using an explicit empty parameter object. */
function variableVectorColumn() {
  return column(pgVectorDescriptor.factory({}), pgVectorDescriptor.codecId, {});
}

/** Binds a dimensioned codec while preserving the dimension literal in its type parameters. */
function fixedVectorColumn<N extends number>(length: N) {
  return column(pgVectorDescriptor.factory({ length }), pgVectorDescriptor.codecId, { length });
}

pgVectorColumn satisfies ColumnHelperFor<PgVectorDescriptor>;
pgVectorColumn satisfies ColumnHelperForStrict<PgVectorDescriptor>;

const codecDescriptorMap = {
  vector: pgVectorDescriptor,
} as const;

export type CodecTypes = ExtractCodecTypes<typeof codecDescriptorMap>;

export const codecDescriptors = definePostgresCodecs(Object.values(codecDescriptorMap));
