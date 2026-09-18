/**
 * Codec descriptors for the interpreter fixtures. A literal default resolves through the column's
 * codec descriptor, so the fixture lookup carries one per codec: what it accepts as a literal and
 * how it decodes one, mirroring the real Postgres codecs closely enough for the interpreter's
 * literal path. `test/integration` covers the real packs.
 */

import type { JsonValue } from '@internal/contract/types';
import {
  type AnyCodecDescriptor,
  type CodecLookup,
  type CodecTrait,
  integerLiteralTypesUpTo,
  isNonFiniteText,
  isNumeralText,
  type LiteralTypeDeclaration,
  voidParamsSchema,
} from '@internal/framework-components/codec';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';

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

const wholeNumbers = integerLiteralTypesUpTo('i64');

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
      readonly literalTypes?: readonly LiteralTypeDeclaration[];
      readonly encodeJson?: (value: unknown) => JsonValue;
      readonly decodeJson: (json: JsonValue, typeParams: Record<string, unknown>) => unknown;
    }
  >
> = (() => {
  const asText = (json: JsonValue): string => {
    if (typeof json !== 'string') throw new Error('value must be text');
    return json;
  };
  const asNumber = (json: JsonValue): number => {
    if (typeof json === 'number') return json;
    if (typeof json === 'string' && (isNumeralText(json) || isNonFiniteText(json))) {
      return Number(json);
    }
    throw new Error('value must be a number');
  };
  const text = {
    traits: ['equality', 'order', 'textual'] as const,
    literalTypes: ['string'] as const,
    decodeJson: asText,
  };
  const wholeNumber = (accepts: readonly LiteralTypeDeclaration[]) => ({
    traits: ['equality', 'order', 'numeric'] as const,
    literalTypes: accepts,
    decodeJson: (json: JsonValue): number => {
      const value = asNumber(json);
      if (!Number.isInteger(value)) throw new Error('value must be a whole number');
      return value;
    },
  });
  const json = {
    traits: ['equality'] as const,
    literalTypes: ['json'] as const,
    decodeJson: (value: JsonValue) => value,
  };
  return {
    'pg/text@1': text,
    'sql/char@1': text,
    'sql/varchar@1': text,
    'pg/bytea@1': {
      traits: ['equality'] as const,
      literalTypes: ['string'] as const,
      decodeJson: asText,
    },
    'pg/timestamptz-temporal@1': text,
    'pg/timestamp-temporal@1': text,
    'pg/date-temporal@1': text,
    'pg/time-temporal@1': text,
    'pg/timetz@1': text,
    'pg/bool@1': {
      traits: ['equality', 'boolean'] as const,
      literalTypes: ['boolean'] as const,
      decodeJson: (value: JsonValue) => {
        if (typeof value !== 'boolean') throw new Error('value must be a boolean');
        return value;
      },
    },
    'pg/int2@1': wholeNumber(integerLiteralTypesUpTo('i16')),
    'pg/int4@1': wholeNumber(integerLiteralTypesUpTo('i32')),
    'pg/int@1': wholeNumber(integerLiteralTypesUpTo('i32')),
    'pg/int8@1': {
      traits: ['equality', 'order', 'numeric'] as const,
      literalTypes: wholeNumbers,
      encodeJson: (value: unknown) => String(value),
      decodeJson: (value: JsonValue) => BigInt(typeof value === 'number' ? value : asText(value)),
    },
    'pg/numeric@1': {
      traits: ['equality', 'order', 'numeric'] as const,
      literalTypes: [...wholeNumbers, 'bigint', 'decimal', 'float'] as const,
      decodeJson: (value: JsonValue) => (typeof value === 'number' ? String(value) : asText(value)),
    },
    'pg/float4@1': {
      traits: ['equality', 'order', 'numeric'] as const,
      literalTypes: [...wholeNumbers, 'bigint', 'decimal', 'float'] as const,
      decodeJson: asNumber,
    },
    'pg/float8@1': {
      traits: ['equality', 'order', 'numeric'] as const,
      literalTypes: [...wholeNumbers, 'bigint', 'decimal', 'float'] as const,
      decodeJson: asNumber,
    },
    'pg/json@1': json,
    'pg/jsonb@1': json,
    'pg/vector@1': {
      traits: ['equality'] as const,
      literalTypes: [{ list: [...wholeNumbers, 'bigint', 'decimal'] }] as const,
      decodeJson: (value: JsonValue, typeParams: Record<string, unknown>) => {
        if (!Array.isArray(value)) throw new Error('Vector value must be an array of numbers');
        const elements = value.map(asNumber);
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
    traits: codec.traits,
    targetTypes: targetTypesByCodecId[codecId] ?? [],
    ...ifDefined('literalTypes', codec.literalTypes),
    paramsSchema: parameterized ? vectorParamsSchema : voidParamsSchema,
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
