/**
 * Synthetic SQL data types for the unit tests of the SQL data type module. They
 * mirror the shapes real declarations take (aliases, parameters in the middle
 * of a text, a normal form, a display form, a kind claim) under test ids.
 */

import { type } from 'arktype';
import { sqlDataType } from '../src/sql-data-type';

export const int4 = sqlDataType('t/int4', {
  read: (json) => json,
  texts: [{ text: 'int4', written: true }, { text: 'integer', catalog: true }, { text: 'int' }],
});

export const float8 = sqlDataType('t/float8', {
  read: (json) => json,
  texts: [
    { text: 'float8', written: true },
    { text: 'double precision', catalog: true },
    { text: 'float' },
  ],
});

export const numeric = sqlDataType('t/numeric', {
  read: (json) => json,
  params: type({
    'precision?': 'number.integer >= 1 & number.integer <= 1000',
    'scale?': 'number.integer >= 0 & number.integer <= 1000',
  }),
  texts: [
    { text: 'numeric', written: true, catalog: true },
    { text: 'numeric({precision})', written: true },
    { text: 'numeric({precision},{scale})', written: true, catalog: true },
    { text: 'decimal' },
    { text: 'decimal({precision})' },
    { text: 'decimal({precision},{scale})' },
  ],
  normalize: (params) =>
    params.precision !== undefined && params.scale === undefined ? { ...params, scale: 0 } : params,
});

export const char = sqlDataType('t/char', {
  read: (json) => json,
  params: type({ 'length?': 'number.integer >= 1 & number.integer <= 10485760' }),
  texts: [
    { text: 'character', written: true },
    { text: 'character({length})', written: true, catalog: true },
    { text: 'char' },
    { text: 'char({length})' },
  ],
  normalize: (params) => (params.length === undefined ? { ...params, length: 1 } : params),
});

export const timestamp = sqlDataType('t/timestamp', {
  read: (json) => json,
  params: type({ 'precision?': 'number.integer >= 0 & number.integer <= 6' }),
  texts: [
    { text: 'timestamp', written: true },
    { text: 'timestamp({precision})', written: true },
    { text: 'timestamp without time zone', catalog: true },
    { text: 'timestamp({precision}) without time zone', catalog: true },
  ],
});

/** Like the SQLite character types: the length is written, then forgotten. */
export const character = sqlDataType('t/character', {
  read: (json) => json,
  params: type({ 'length?': 'number.integer >= 1' }),
  texts: [{ text: 'character', written: true }],
  normalize: ({ length: _length, ...rest }) => rest,
});

export const vector = sqlDataType('t/vector', {
  read: (json) => json,
  params: type({ length: 'number.integer >= 1 & number.integer <= 16000' }),
  texts: [{ text: 'vector({length})', written: true, catalog: true }],
});

export const geometry = sqlDataType('t/geometry', {
  read: (json) => json,
  params: type({ 'srid?': 'number.integer >= 1' }),
  texts: [
    { text: 'geometry', written: true, catalog: true },
    {
      text: 'geometry(geometry,{srid})',
      written: true,
      catalog: true,
      display: 'geometry(Geometry,{srid})',
    },
  ],
});

export const enumType = sqlDataType('t/enum', {
  read: (json) => json,
  params: type({ typeName: 'string > 0' }),
  claimsKind: 'enum',
  render: ({ typeName }) =>
    typeName
      .split('.')
      .map((part) => `"${part}"`)
      .join('.'),
  fromReported: (reported) => ({
    typeName:
      reported.schema === undefined || reported.schema === 'public'
        ? (reported.name ?? '')
        : `${reported.schema}.${reported.name}`,
  }),
});

/** Claims nothing and is never written. */
export const textArray = sqlDataType('t/text-array', { read: (json) => json });

export const allTypes = [
  int4,
  float8,
  numeric,
  char,
  timestamp,
  character,
  vector,
  geometry,
  enumType,
  textArray,
];
