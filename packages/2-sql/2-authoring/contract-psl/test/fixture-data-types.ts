/**
 * The data types and PSL support a Postgres-like fixture stack registers.
 *
 * Mirrors what the SQL family, the Postgres target and the adapter declare, in the order a stack
 * assembles them, exactly as `fixture-codec-descriptors.ts` mirrors their codecs, so interpreter
 * tests stay isolated from the target packages. ADR 254.
 */

import type { JsonValue } from '@internal/contract/types';
import type {
  DataTypeAuthoringEntry,
  DataTypeSupport,
} from '@internal/framework-components/authoring';
import {
  type Cast,
  createDataTypeLookup,
  type DataType,
  isNonFiniteText,
} from '@internal/framework-components/codec';
import { sqlDataType } from '@internal/sql-contract/data-type';
import { sqlExpressionRegistration } from '@internal/sql-contract/sql-expression';
import { structuredError } from '@internal/utils/structured-error';
import { type } from 'arktype';

const unchanged: Cast = (value) => value;
const asText: Cast = (value) => String(value);
const asNumber: Cast = (value) => {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && isNonFiniteText(value)) return value;
  const converted = Number(value);
  if (Number.isFinite(converted)) return converted;
  throw structuredError('CONTRACT.CAST_REFUSED', `${String(value)} is out of range.`, {
    why: 'The floating-point types store a double.',
    fix: 'Write a number a double holds.',
  });
};

const INTEGER_TEXT = /^-?\d+$/;
const DECIMAL_TEXT = /^-?\d+\.\d+$/;
const DECIMAL_NUMERAL = /^(-?)0*(\d+)(\.\d+)?$/;

function canonicalNumeral(text: string): string {
  const numeral = DECIMAL_NUMERAL.exec(text);
  if (numeral === null) return text;
  const [, sign = '', whole = '', fraction = ''] = numeral;
  const digits = `${whole}${fraction}`;
  return /^[0.]+$/.test(digits) ? digits : `${sign}${digits}`;
}

const written = (text: string) => [{ text, written: true as const }];
const precision = type({ 'precision?': 'number.integer >= 0 & number.integer <= 6' });
const temporalTexts = (name: string) => [
  { text: name, written: true as const },
  { text: `${name}({precision})`, written: true as const },
];

export const pgText: DataType = sqlDataType('pg/text', { texts: written('text') });
export const pgBool: DataType = sqlDataType('pg/bool', { texts: written('bool') });
export const pgJson: DataType = sqlDataType('pg/json', { texts: written('json') });
export const pgInt2: DataType = sqlDataType('pg/int2', { texts: written('int2') });
export const pgInt4: DataType = sqlDataType('pg/int4', {
  texts: written('int4'),
  casts: { [pgInt2.id]: unchanged },
});
export const pgInt8: DataType = sqlDataType('pg/int8', {
  texts: written('int8'),
  casts: { [pgInt2.id]: asText, [pgInt4.id]: asText },
});
export const pgNumeric: DataType = sqlDataType('pg/numeric', {
  params: type({
    'precision?': 'number.integer >= 1 & number.integer <= 1000',
    'scale?': 'number.integer >= -1000 & number.integer <= 1000',
  }),
  texts: [
    { text: 'numeric', written: true },
    { text: 'numeric({precision})', written: true },
    { text: 'numeric({precision},{scale})', written: true },
  ],
  casts: { [pgInt2.id]: asText, [pgInt4.id]: asText, [pgInt8.id]: unchanged },
});
const floatCasts: Readonly<Record<string, Cast>> = {
  [pgInt2.id]: asNumber,
  [pgInt4.id]: asNumber,
  [pgInt8.id]: asNumber,
  [pgNumeric.id]: asNumber,
};
export const pgFloat4: DataType = sqlDataType('pg/float4', {
  texts: written('float4'),
  casts: floatCasts,
});
export const pgFloat8: DataType = sqlDataType('pg/float8', {
  texts: written('float8'),
  casts: floatCasts,
});
export const pgJsonb: DataType = sqlDataType('pg/jsonb', {
  texts: written('jsonb'),
  casts: { [pgJson.id]: unchanged },
});

const fromText: Readonly<Record<string, Cast>> = { [pgText.id]: unchanged };
const length = type({ 'length?': 'number.integer >= 1 & number.integer <= 10485760' });
export const pgChar: DataType = sqlDataType('pg/char', {
  params: length,
  texts: [
    { text: 'character', written: true },
    { text: 'character({length})', written: true },
  ],
  casts: fromText,
});
export const pgVarchar: DataType = sqlDataType('pg/varchar', {
  params: length,
  texts: [
    { text: 'character varying', written: true },
    { text: 'character varying({length})', written: true },
  ],
  casts: fromText,
});
export const pgBytea: DataType = sqlDataType('pg/bytea', {
  texts: written('bytea'),
  casts: fromText,
});
export const pgDate: DataType = sqlDataType('pg/date', { texts: written('date'), casts: fromText });
export const pgTime: DataType = sqlDataType('pg/time', {
  params: precision,
  texts: temporalTexts('time'),
  casts: fromText,
});
export const pgTimetz: DataType = sqlDataType('pg/timetz', {
  params: precision,
  texts: temporalTexts('timetz'),
  casts: fromText,
});
export const pgTimestamp: DataType = sqlDataType('pg/timestamp', {
  params: precision,
  texts: temporalTexts('timestamp'),
  casts: fromText,
});
export const pgTimestamptz: DataType = sqlDataType('pg/timestamptz', {
  params: precision,
  texts: temporalTexts('timestamptz'),
  casts: fromText,
});
export const pgEnum: DataType = sqlDataType('pg/enum', {
  params: type({ typeName: 'string > 0' }),
  claimsKind: 'enum',
  render: ({ typeName }) => `"${typeName}"`,
});

/** Bounded at 2000, not pgvector's 16000, so interpreter tests stay isolated from the real pack. */
export const pgvectorVector: DataType = sqlDataType('pgvector/vector', {
  params: type({ length: 'number.integer >= 1 & number.integer <= 2000' }),
  texts: [{ text: 'vector({length})', written: true }],
  listCast: {
    of: [pgInt2.id, pgInt4.id, pgInt8.id, pgNumeric.id],
    cast: (elements) => elements.map((element) => Number(asNumber(element))),
  },
});

export const fixtureDataTypes: readonly DataType[] = [
  ...sqlExpressionRegistration.dataTypes,
  pgText,
  pgBool,
  pgJson,
  pgJsonb,
  pgInt2,
  pgInt4,
  pgInt8,
  pgNumeric,
  pgFloat4,
  pgFloat8,
  pgChar,
  pgVarchar,
  pgBytea,
  pgDate,
  pgTime,
  pgTimetz,
  pgTimestamp,
  pgTimestamptz,
  pgEnum,
  pgvectorVector,
];

function classifyNumber(
  text: string,
): { readonly type: DataType['id']; readonly value: JsonValue } | undefined {
  if (isNonFiniteText(text)) return { type: pgNumeric.id, value: text };
  if (DECIMAL_TEXT.test(text)) return { type: pgNumeric.id, value: canonicalNumeral(text) };
  if (!INTEGER_TEXT.test(text)) return undefined;
  const digits = BigInt(text);
  if (digits >= -32768n && digits <= 32767n) return { type: pgInt2.id, value: Number(digits) };
  if (digits >= -2147483648n && digits <= 2147483647n) {
    return { type: pgInt4.id, value: Number(digits) };
  }
  if (digits >= -9223372036854775808n && digits <= 9223372036854775807n) {
    return { type: pgInt8.id, value: digits.toString() };
  }
  return { type: pgNumeric.id, value: digits.toString() };
}

function readBoolean(text: string): JsonValue {
  if (text === 'true' || text === 'false') return text === 'true';
  throw structuredError('CONTRACT.CAST_REFUSED', `"${text}" is not a boolean.`, {
    why: 'A boolean is written as true or false.',
    fix: 'Write true or false.',
  });
}

function parseJson(text: string): JsonValue {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw structuredError(
      'CONTRACT.INVALID_JSON_LITERAL',
      error instanceof Error ? error.message : String(error),
      { why: 'The text is not a JSON document.', fix: 'Write a JSON document.' },
    );
  }
}

export const fixtureDataTypeEntries: Readonly<Record<string, DataTypeAuthoringEntry>> = {
  ...sqlExpressionRegistration.authoring.dataTypes,
  [pgText.id]: {
    written: { kind: 'plain', syntax: 'string', parse: (text) => text },
    print: (value) => String(value),
    documentation: 'Text.',
  },
  [pgBool.id]: {
    written: { kind: 'plain', syntax: 'boolean', parse: readBoolean },
    print: (value) => String(value),
    documentation: 'A boolean, written true or false.',
  },
  [pgNumeric.id]: {
    written: {
      kind: 'plain',
      syntax: 'number',
      types: [pgInt2.id, pgInt4.id, pgInt8.id, pgNumeric.id],
      classify: classifyNumber,
    },
    print: (value) => String(value),
    documentation: 'A number, whose type comes from its own size and precision.',
  },
  [pgJson.id]: {
    written: { kind: 'tag', tag: 'json', parse: parseJson },
    print: (value) => JSON.stringify(value),
    documentation: 'Reads the text as a JSON document and stores it as the default value.',
  },
};

export const fixtureDataTypeSupport: DataTypeSupport = {
  entries: fixtureDataTypeEntries,
  lookup: createDataTypeLookup(fixtureDataTypes),
};
