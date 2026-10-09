/**
 * Codec descriptors for the interpreter fixtures. A written default resolves through the column's
 * codec descriptor, so the fixture lookup carries one per codec: the data type it represents and
 * how it reads that type's canonical form, mirroring the real Postgres codecs closely enough for
 * the interpreter's default path. `test/integration` covers the real packs. ADR 254.
 */

import type { JsonValue } from '@internal/contract/types';
import type { DataTypeSupport } from '@internal/framework-components/authoring';
import {
  type AnyCodecDescriptor,
  type CodecLookupWithDescriptors,
  type CodecTrait,
  type DataType,
  type DataTypeId,
  type DataTypeLookup,
  isNonFiniteText,
} from '@internal/framework-components/codec';
import { blindCast } from '@internal/utils/casts';
import { testSqlTypeLookups } from '../../../1-core/contract/test/test-type-lookups';
import {
  fixtureDataTypeSupport,
  fixtureDataTypes,
  pgBool,
  pgBytea,
  pgChar,
  pgDate,
  pgFloat4,
  pgFloat8,
  pgInt2,
  pgInt4,
  pgInt8,
  pgJson,
  pgJsonb,
  pgNumeric,
  pgText,
  pgTime,
  pgTimestamp,
  pgTimestamptz,
  pgTimetz,
  pgVarchar,
  pgvectorVector,
} from './fixture-data-types';

const dataTypeByCodecId: Readonly<Record<string, DataTypeId>> = {
  'pg/text@1': pgText.id,
  'sql/char@1': pgChar.id,
  'sql/varchar@1': pgVarchar.id,
  'pg/bytea@1': pgBytea.id,
  'pg/timestamptz-temporal@1': pgTimestamptz.id,
  'pg/timestamp-temporal@1': pgTimestamp.id,
  'pg/date-temporal@1': pgDate.id,
  'pg/time-temporal@1': pgTime.id,
  'pg/timetz@1': pgTimetz.id,
  'pg/bool@1': pgBool.id,
  'pg/int2@1': pgInt2.id,
  'pg/int4@1': pgInt4.id,
  'pg/int@1': pgInt4.id,
  'pg/int8@1': pgInt8.id,
  'pg/numeric@1': pgNumeric.id,
  'pg/float4@1': pgFloat4.id,
  'pg/float8@1': pgFloat8.id,
  'pg/json@1': pgJson.id,
  'pg/jsonb@1': pgJsonb.id,
  'pg/vector@1': pgvectorVector.id,
};

/**
 * What each fixture codec accepts as a literal default and how it decodes one. Mirrors the real
 * Postgres codecs closely enough for the interpreter's literal path; `test/integration` covers the
 * real packs.
 */
const fixtureCodecs: Readonly<
  Record<
    string,
    {
      readonly traits: readonly CodecTrait[];
      readonly encodeJson?: (value: unknown) => JsonValue;
      readonly decodeJson: (json: JsonValue, typeParams: Record<string, unknown>) => unknown;
    }
  >
> = (() => {
  const asText = (json: JsonValue): string => {
    if (typeof json !== 'string') throw new Error('value must be text');
    return json;
  };
  const asWholeNumber = (json: JsonValue): number => {
    if (typeof json !== 'number' || !Number.isInteger(json)) {
      throw new Error('value must be a whole number');
    }
    return json;
  };
  const asDouble = (json: JsonValue): number => {
    if (typeof json === 'number') return json;
    if (typeof json === 'string' && isNonFiniteText(json)) return Number(json);
    throw new Error('value must be a number');
  };
  const text = {
    traits: ['equality', 'order', 'textual'] as const,
    decodeJson: asText,
  };
  const wholeNumber = {
    traits: ['equality', 'order', 'numeric'] as const,
    decodeJson: asWholeNumber,
  };
  const json = {
    traits: ['equality'] as const,
    decodeJson: (value: JsonValue) => value,
  };
  return {
    'pg/text@1': text,
    'sql/char@1': text,
    'sql/varchar@1': text,
    'pg/bytea@1': { traits: ['equality'] as const, decodeJson: asText },
    'pg/timestamptz-temporal@1': text,
    'pg/timestamp-temporal@1': text,
    'pg/date-temporal@1': text,
    'pg/time-temporal@1': text,
    'pg/timetz@1': text,
    'pg/bool@1': {
      traits: ['equality', 'boolean'] as const,
      decodeJson: (value: JsonValue) => {
        if (typeof value !== 'boolean') throw new Error('value must be a boolean');
        return value;
      },
    },
    'pg/int2@1': wholeNumber,
    'pg/int4@1': wholeNumber,
    'pg/int@1': wholeNumber,
    'pg/int8@1': {
      traits: ['equality', 'order', 'numeric'] as const,
      encodeJson: (value: unknown) => String(value),
      decodeJson: (value: JsonValue) => BigInt(asText(value)),
    },
    'pg/numeric@1': {
      traits: ['equality', 'order', 'numeric'] as const,
      decodeJson: asText,
    },
    'pg/float4@1': { traits: ['equality', 'order', 'numeric'] as const, decodeJson: asDouble },
    'pg/float8@1': { traits: ['equality', 'order', 'numeric'] as const, decodeJson: asDouble },
    'pg/json@1': json,
    'pg/jsonb@1': json,
    'pg/vector@1': {
      traits: ['equality'] as const,
      decodeJson: (value: JsonValue, typeParams: Record<string, unknown>) => {
        if (!Array.isArray(value)) throw new Error('Vector value must be an array of numbers');
        const elements = value.map(asDouble);
        if (elements.length !== typeParams['length']) {
          throw new Error(
            `Vector length mismatch: expected ${String(typeParams['length'])}, got ${elements.length}`,
          );
        }
        return elements;
      },
    },
  };
})();

const fixtureDataTypeById: ReadonlyMap<string, DataType> = new Map(
  fixtureDataTypes.map((type) => [type.id, type]),
);

/** A descriptor for a fixture codec, taking the parameters its data type declares. */
function fixtureDescriptor(codecId: string): AnyCodecDescriptor | undefined {
  const codec = fixtureCodecs[codecId];
  if (codec === undefined) return undefined;
  const dataType = dataTypeByCodecId[codecId] ?? pgText.id;
  const paramsSchema = fixtureDataTypeById.get(dataType)?.params;
  return {
    codecId,
    dataType,
    traits: codec.traits,
    paramsSchema,
    isParameterized: paramsSchema !== undefined,
    factory: (params: unknown) => () => ({
      id: codecId,
      encode: async (value: unknown) =>
        blindCast<never, 'fixture codecs do not reach the wire'>(value),
      decode: async (wire: unknown) => wire,
      encodeJson: (value: unknown) =>
        codec.encodeJson === undefined
          ? blindCast<JsonValue, 'fixture codecs store what they decoded'>(value)
          : codec.encodeJson(value),
      decodeJson: (value: JsonValue) =>
        codec.decodeJson(
          value,
          blindCast<Record<string, unknown>, 'the parameter schema accepted these parameters'>(
            params ?? {},
          ),
        ),
    }),
  };
}

export const postgresCodecLookup: CodecLookupWithDescriptors = {
  // A representative instance, built with no params — the same shape the control stack builds.
  get: (id: string) => fixtureDescriptor(id)?.factory({})({ name: id }),
  descriptorFor: fixtureDescriptor,
  renderOutputTypeFor: () => undefined,
};

const lenient = testSqlTypeLookups(
  { 'custom/varchar@1': 'character varying', 'custom/text@1': 'custom_text' },
  postgresCodecLookup,
);

/**
 * The fixture stack's lookups, which also name a column of any codec the fixture does not declare,
 * so tests about other things can use codecs of their own.
 */
export const fixtureTypeLookups: {
  readonly codecLookup: CodecLookupWithDescriptors;
  readonly dataTypeLookup: DataTypeLookup;
} = {
  codecLookup: lenient.codecLookup,
  dataTypeLookup: {
    get: (id) => fixtureDataTypeSupport.lookup.get(id) ?? lenient.dataTypeLookup.get(id),
    has: (id) => fixtureDataTypeSupport.lookup.has(id) || lenient.dataTypeLookup.has(id),
  },
};

/** {@link fixtureTypeLookups} as the PSL interpreter and its contract source context take them. */
export const fixtureInterpreterTypes: {
  readonly codecLookup: CodecLookupWithDescriptors;
  readonly dataTypes: DataTypeSupport;
} = {
  codecLookup: fixtureTypeLookups.codecLookup,
  dataTypes: { entries: fixtureDataTypeSupport.entries, lookup: fixtureTypeLookups.dataTypeLookup },
};
