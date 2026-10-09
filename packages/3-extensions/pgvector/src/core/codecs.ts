/**
 * pgvector extension codec.
 *
 * Mirrors the patterns in `postgres/codecs-class.ts` and `sqlite/codecs-class.ts` for the single `pg/vector@1` codec. Three artifacts:
 *
 * 1. `PgVectorCodec` extends {@link CodecImpl} with the wire and value conversions inline. Conversions are simple enough (PostgreSQL `[1,2,3]` text format) that no shared helper module is warranted; the class body is the source of truth.
 * 2. `PgVectorDescriptor` extends {@link PostgresCodecDescriptor} with the codec id, traits, the `pgvector/vector` data type and its params schema, and explicit target behavior. The column's type, `Vector` or `Vector<${length}>`, comes from the pack's type function in `types/codec-types.ts`. The data type declares the type's name and the bounds of `length`.
 * 3. `pgVectorColumn(length?)` per-codec column helper invoking `descriptor.factory({ length })` directly.
 *
 * When provided, `length` threads into the runtime codec via the constructor so the wire methods enforce the declared dimension, and `pgvector/vector` checks it for every stored value. Without this, `vector(3)` and `vector(1536)` would produce codecs with identical behaviour and a dimension-mismatched value would round-trip undetected.
 */

import {
  type AnyCodecDescriptor,
  type CodecCallContext,
  CodecImpl,
  type CodecInstanceContext,
  type ColumnHelperFor,
  type ColumnHelperForStrict,
  column,
  type DataTypeValue,
} from '@internal/framework-components/codec';
import type { ExtractCodecTypes, ProjectionExpr } from '@internal/sql-relational-core/ast';
import { CastExpr } from '@internal/sql-relational-core/ast';
import {
  definePostgresCodecs,
  PostgresCodecDescriptor,
} from '@internal/target-postgres/codec-descriptor';
import { ifDefined } from '@internal/utils/defined';
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
    super(descriptor, pgvectorVector, ifDefined('length', length));
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

  async toWire(value: number[], _ctx: CodecCallContext): Promise<string> {
    this.assertVector(value, 'RUNTIME.ENCODE_FAILED');
    return `[${value.join(',')}]`;
  }

  async fromWire(wire: string, _ctx: CodecCallContext): Promise<number[]> {
    if (typeof wire !== 'string') {
      throw pgVectorError('RUNTIME.DECODE_FAILED', 'Vector wire value must be a string', {
        meta: { codecId: VECTOR_CODEC_ID },
      });
    }
    const value = parseVector(wire);
    this.assertVector(value, 'RUNTIME.DECODE_FAILED');
    return value;
  }

  fromDataTypeValue(value: DataTypeValue<readonly number[]>): number[] {
    return [...value.value];
  }

  toDataTypeValue(input: number[]): DataTypeValue {
    this.assertVector(input, 'RUNTIME.ENCODE_FAILED');
    return this.dataTypeValueOf([...input]);
  }

  /** Checks the exact declared dimension, or the supported 1–16,000 range when none is declared. */
  private acceptsLength(length: number): boolean {
    return this.length === undefined
      ? length >= 1 && length <= VECTOR_MAX_DIM
      : length === this.length;
  }
}

/**
 * Projects a `vector` as the text PostgreSQL prints for it, the value the runtime driver returns for
 * an ordinary row, so `fromWire` reads an included vector as it reads a row. A JSON array of the
 * elements would not do: an element is a `real`, and the text holds the shortest decimal that
 * reads back as that `real`, so the row reads `0.1` where the element widened to a double is
 * `0.10000000149011612`.
 */
const vectorTextJsonProjection = (expression: ProjectionExpr): ProjectionExpr =>
  CastExpr.as(expression, 'text');

export class PgVectorDescriptor extends PostgresCodecDescriptor<VectorParams> {
  override readonly jsonType = 'array' as const;
  protected override jsonProjection(expression: ProjectionExpr): ProjectionExpr {
    return vectorTextJsonProjection(expression);
  }
  override readonly dataType = pgvectorVector.id;
  override readonly codecId = VECTOR_CODEC_ID;
  override readonly traits = ['equality'] as const;
  override readonly enumRefusal =
    'The contract stores a vector member as an array of numbers, which no CHECK can list. No enum can use a vector codec; use a text enum instead.';
  override readonly paramsSchema: StandardSchemaV1<VectorParams> = pgvectorVectorParams;
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
/** Creates a vector column whose dimension may be absent, binding variable dimensions when it is. */
export function pgVectorColumn(
  length?: number,
): ReturnType<typeof variableVectorColumn> | ReturnType<typeof fixedVectorColumn<number>>;
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
