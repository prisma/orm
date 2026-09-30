/**
 * The codec `contract emit` binds to a column `contract infer` writes, and the data type that codec
 * represents.
 *
 * `contract emit` binds a codec to each PSL type constructor `contract infer` names, and builds it with
 * the type parameters the constructor's arguments give, so a default has to be written in the form
 * that codec reads back. The binding itself lives in the adapter's
 * authoring type namespaces, which sit above this package, and `contract infer` has no stack to ask;
 * the table below restates it for the type names `contract infer` writes, and
 * `adapter-postgres/test/inferred-type-codecs.test.ts` fails if the two disagree or if the type map
 * gains a type name this table does not cover.
 */

import type { ColumnDefaultLiteralInputValue, JsonValue } from '@internal/contract/types';
import {
  type Codec,
  type CodecRef,
  codecForRef,
  type DataTypeId,
} from '@internal/framework-components/codec';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { PG_TEXT_CODEC_ID } from '../codec-ids';
import { createPostgresBuiltinCodecLookup } from '../codec-registry';
import { postgresCodecDescriptorRegistry } from '../registry';

/** A type parameter taken from the type constructor's argument at `index`, as the authoring type namespaces write it. */
interface TypeConstructorArg {
  readonly kind: 'arg';
  readonly index: number;
}

/** The codec `contract emit` binds to a PSL type name, and the type constructor's arguments that become its type parameters. */
export interface InferredTypeBinding {
  readonly codecId: string;
  readonly typeParams?: Readonly<Record<string, TypeConstructorArg>>;
}

const lengthParam = { length: { kind: 'arg', index: 0 } } as const;
const precisionParam = { precision: { kind: 'arg', index: 0 } } as const;

/** The binding `contract emit` uses for each PSL type name the type map writes. */
export const BINDING_BY_INFERRED_TYPE: ReadonlyMap<string, InferredTypeBinding> = new Map<
  string,
  InferredTypeBinding
>([
  ['String', { codecId: 'pg/text@1' }],
  ['Boolean', { codecId: 'pg/bool@1' }],
  ['Int', { codecId: 'pg/int4@1' }],
  ['SmallInt', { codecId: 'pg/int2@1' }],
  ['BigInt', { codecId: 'pg/int8@1' }],
  ['Float', { codecId: 'pg/float8@1' }],
  ['Real', { codecId: 'pg/float4@1' }],
  [
    'Numeric',
    {
      codecId: 'pg/numeric@1',
      typeParams: { precision: { kind: 'arg', index: 0 }, scale: { kind: 'arg', index: 1 } },
    },
  ],
  ['Timestamp', { codecId: 'pg/timestamp-temporal@1', typeParams: precisionParam }],
  ['Timestamptz', { codecId: 'pg/timestamptz-temporal@1', typeParams: precisionParam }],
  ['Date', { codecId: 'pg/date-temporal@1' }],
  ['Time', { codecId: 'pg/time-temporal@1', typeParams: precisionParam }],
  ['Timetz', { codecId: 'pg/timetz@1', typeParams: precisionParam }],
  ['Json', { codecId: 'pg/json@1' }],
  ['Jsonb', { codecId: 'pg/jsonb@1' }],
  ['Bytes', { codecId: 'pg/bytea@1' }],
  ['Uuid', { codecId: 'pg/uuid@1' }],
  ['Inet', { codecId: 'pg/inet@1' }],
  ['VarChar', { codecId: 'sql/varchar@1', typeParams: lengthParam }],
  ['Char', { codecId: 'sql/char@1', typeParams: lengthParam }],
]);

/** The type `contract infer` writes for a column: a PSL type name and the arguments of its type constructor. */
export interface InferredPslType {
  readonly name: string;
  readonly args?: readonly string[];
}

/**
 * The data type a column of `pslTypeName` holds values of, which is the one its codec represents.
 * An enum column's default is a member name, which is text either way, so it reads through the text
 * codec.
 */
export function dataTypeForInferredType(
  pslTypeName: string,
  isEnum: boolean,
): DataTypeId | undefined {
  const codecId = isEnum ? PG_TEXT_CODEC_ID : BINDING_BY_INFERRED_TYPE.get(pslTypeName)?.codecId;
  if (codecId === undefined) return undefined;
  return postgresCodecDescriptorRegistry.descriptorFor(codecId)?.dataType;
}

/** The codec reference `contract emit` builds for the column: its codec, with the type parameters its type constructor's arguments give. */
function inferredCodecRef(pslType: InferredPslType, isEnum: boolean): CodecRef | undefined {
  if (isEnum) return { codecId: PG_TEXT_CODEC_ID };
  const binding = BINDING_BY_INFERRED_TYPE.get(pslType.name);
  if (binding === undefined) return undefined;
  const typeParams = Object.fromEntries(
    Object.entries(binding.typeParams ?? {}).flatMap(([name, { index }]) => {
      const arg = pslType.args?.[index];
      return arg === undefined ? [] : [[name, Number(arg)]];
    }),
  );
  return {
    codecId: binding.codecId,
    ...ifDefined('typeParams', Object.keys(typeParams).length === 0 ? undefined : typeParams),
  };
}

const codecLookup = createPostgresBuiltinCodecLookup();
const codecs = new Map<string, Codec | undefined>();

/** The column's codec, built with its type parameters, since a parameterized codec reads JSON against them. */
function inferredTypeCodec(pslType: InferredPslType, isEnum: boolean): Codec | undefined {
  const ref = inferredCodecRef(pslType, isEnum);
  if (ref === undefined) return undefined;
  const key = JSON.stringify(ref);
  if (!codecs.has(key)) codecs.set(key, codecForRef(codecLookup, ref));
  return codecs.get(key);
}

/**
 * Whether the column's codec reads the value back.
 *
 * A data type says which values its column takes, not that every codec of it accepts each one: the
 * temporal codecs represent types that cast from text but refuse `infinity`, which PostgreSQL
 * stores and reports verbatim. A default the codec refuses has no PSL literal, so the raw
 * expression prints instead of a schema `contract emit` would reject. A codec that cannot be built
 * with the column's type parameters is treated the same way.
 */
export function inferredDefaultReadsBack(
  value: ColumnDefaultLiteralInputValue,
  pslType: InferredPslType,
  isEnum: boolean,
  isList: boolean,
): boolean {
  const values = isList && Array.isArray(value) ? value : [value];
  try {
    const codec = inferredTypeCodec(pslType, isEnum);
    if (codec === undefined) return false;
    for (const element of values) {
      codec.decodeJson(blindCast<JsonValue, 'a stored literal default is JSON'>(element));
    }
    return true;
  } catch {
    return false;
  }
}
