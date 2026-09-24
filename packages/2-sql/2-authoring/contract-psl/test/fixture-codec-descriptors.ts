/**
 * Codec descriptors for the interpreter fixtures. A written default resolves through the column's
 * codec descriptor, so the fixture lookup carries one per codec: the data type it represents and
 * how it reads that type's canonical form, mirroring the real Postgres codecs closely enough for
 * the interpreter's default path. `test/integration` covers the real packs. ADR 254.
 */

import type { JsonValue } from '@internal/contract/types';
import type {
  AnyCodecDescriptor,
  CodecLookup,
  CodecTrait,
  DataTypeId,
} from '@internal/framework-components/codec';
import { blindCast } from '@internal/utils/casts';
import {
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

const targetTypesByCodecId: Record<string, readonly string[]> = {
  'pg/text@1': ['text'],
  'pg/int@1': ['int4'],
  'pg/bool@1': ['bool'],
  'pg/int4@1': ['int4'],
  'pg/int8@1': ['int8'],
  'pg/float8@1': ['float8'],
  'pg/numeric@1': ['numeric'],
  'pg/timestamptz-temporal@1': ['timestamptz'],
  'pg/jsonb@1': ['jsonb'],
  'pg/bytea@1': ['bytea'],
  'sql/char@1': ['character'],
  'sql/varchar@1': ['character varying'],
  'pg/int2@1': ['int2'],
  'pg/float4@1': ['float4'],
  'pg/timestamp-temporal@1': ['timestamp'],
  'pg/date-temporal@1': ['date'],
  'pg/time-temporal@1': ['time'],
  'pg/timetz@1': ['timetz'],
  'pg/json@1': ['json'],
  'pg/vector@1': ['vector'],
};

const NON_FINITE: ReadonlySet<string> = new Set(['NaN', 'Infinity', '-Infinity']);

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
    if (typeof json === 'string' && NON_FINITE.has(json)) return Number(json);
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

/** Passes `typeParams` through: the fixture vector type constructor already validates its length. */
const vectorParamsSchema: AnyCodecDescriptor['paramsSchema'] = {
  '~standard': {
    version: 1,
    vendor: 'contract-psl-fixtures',
    validate: (value: unknown) => ({ value }),
  },
};

/** A descriptor for a fixture codec, parameterized only for `pg/vector@1`, whose length the codec checks. */
function fixtureDescriptor(codecId: string): AnyCodecDescriptor | undefined {
  const codec = fixtureCodecs[codecId];
  if (codec === undefined) return undefined;
  const parameterized = codecId === 'pg/vector@1';
  return {
    codecId,
    dataType: dataTypeByCodecId[codecId] ?? pgText.id,
    traits: codec.traits,
    targetTypes: targetTypesByCodecId[codecId] ?? [],
    paramsSchema: parameterized ? vectorParamsSchema : undefined,
    isParameterized: parameterized,
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
          blindCast<Record<string, unknown>, 'the fixture vector schema passes typeParams through'>(
            params ?? {},
          ),
        ),
    }),
  };
}

export const postgresCodecLookup: CodecLookup = {
  // A representative instance, built with no params — the same shape the control stack builds.
  get: (id: string) => fixtureDescriptor(id)?.factory({})({ name: id }),
  descriptorFor: fixtureDescriptor,
  targetTypesFor: (id: string) => targetTypesByCodecId[id],
  renderOutputTypeFor: () => undefined,
};
