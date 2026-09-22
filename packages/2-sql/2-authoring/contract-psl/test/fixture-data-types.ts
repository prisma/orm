/**
 * The data types and PSL support a Postgres-like fixture stack registers.
 *
 * Mirrors what the Postgres target and adapter declare, exactly as `fixture-codec-descriptors.ts`
 * mirrors their codecs, so interpreter tests stay isolated from the target packages. ADR 254.
 */

import type { JsonValue } from '@internal/contract/types';
import type { AuthoringDataTypeEntry } from '@internal/framework-components/authoring';
import { loweringEntryKey } from '@internal/framework-components/authoring';
import {
  type Cast,
  createDataTypeLookup,
  type DataType,
  dataType,
} from '@internal/framework-components/codec';
import { structuredError } from '@internal/utils/structured-error';
import type { DataTypeSupport } from '../src/data-type-default';
import { sqlLiteralTagLowering } from './fixture-sql-tag';

const unchanged: Cast = (value) => value;
const asText: Cast = (value) => String(value);
const asNumber: Cast = (value) => {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && NON_FINITE.has(value)) return value;
  const converted = Number(value);
  if (Number.isFinite(converted)) return converted;
  throw structuredError('CONTRACT.CAST_REFUSED', `${String(value)} is out of range.`, {
    why: 'The floating-point types store a double.',
    fix: 'Write a number a double holds.',
  });
};

const NON_FINITE: ReadonlySet<string> = new Set(['NaN', 'Infinity', '-Infinity']);
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

export const pgText: DataType = dataType('pg/text', {});
export const pgBool: DataType = dataType('pg/bool', {});
export const pgJson: DataType = dataType('pg/json', {});
export const pgInt2: DataType = dataType('pg/int2', {});
export const pgInt4: DataType = dataType('pg/int4', { casts: { [pgInt2.id]: unchanged } });
export const pgInt8: DataType = dataType('pg/int8', {
  casts: { [pgInt2.id]: asText, [pgInt4.id]: asText },
});
export const pgNumeric: DataType = dataType('pg/numeric', {
  casts: { [pgInt2.id]: asText, [pgInt4.id]: asText, [pgInt8.id]: unchanged },
});
const floatCasts: Readonly<Record<string, Cast>> = {
  [pgInt2.id]: asNumber,
  [pgInt4.id]: asNumber,
  [pgInt8.id]: asNumber,
  [pgNumeric.id]: asNumber,
};
export const pgFloat4: DataType = dataType('pg/float4', { casts: floatCasts });
export const pgFloat8: DataType = dataType('pg/float8', { casts: floatCasts });
export const pgJsonb: DataType = dataType('pg/jsonb', { casts: { [pgJson.id]: unchanged } });

const fromText: Readonly<Record<string, Cast>> = { [pgText.id]: unchanged };
export const pgChar: DataType = dataType('pg/char', { casts: fromText });
export const pgVarchar: DataType = dataType('pg/varchar', { casts: fromText });
export const pgBytea: DataType = dataType('pg/bytea', { casts: fromText });
export const pgDate: DataType = dataType('pg/date', { casts: fromText });
export const pgTime: DataType = dataType('pg/time', { casts: fromText });
export const pgTimetz: DataType = dataType('pg/timetz', { casts: fromText });
export const pgTimestamp: DataType = dataType('pg/timestamp', { casts: fromText });
export const pgTimestamptz: DataType = dataType('pg/timestamptz', { casts: fromText });
export const pgEnum: DataType = dataType('pg/enum', {});

export const pgvectorVector: DataType = dataType('pgvector/vector', {
  listCast: {
    of: [pgInt2.id, pgInt4.id, pgInt8.id, pgNumeric.id],
    cast: (elements) => elements.map((element) => Number(asNumber(element))),
  },
});

export const fixtureDataTypes: readonly DataType[] = [
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
  if (NON_FINITE.has(text)) return { type: pgNumeric.id, value: text };
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
      { why: 'The body is not a JSON document.', fix: 'Write a JSON document.' },
    );
  }
}

export const fixtureDataTypeEntries: Readonly<Record<string, AuthoringDataTypeEntry>> = {
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
    documentation: 'Reads the body as a JSON document and stores it as the default value.',
  },
  [loweringEntryKey('sql')]: sqlLiteralTagLowering('sql'),
  [loweringEntryKey('pg.sql')]: sqlLiteralTagLowering('pg.sql'),
};

export const fixtureDataTypeSupport: DataTypeSupport = {
  entries: fixtureDataTypeEntries,
  lookup: createDataTypeLookup(fixtureDataTypes),
};
