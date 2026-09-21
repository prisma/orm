/**
 * The data types this target owns, with the casts that say which other types' values each one takes.
 *
 * SQLite's storage classes are shared by several logical types, so the target declares the types it
 * distinguishes rather than one per storage class: `sqlite/integer` and `sqlite/bigint` are
 * distinct although both store as INTEGER, and `sqlite/text`, `sqlite/datetime` and `sqlite/json`
 * are distinct although all store as TEXT.
 *
 * ADR 254.
 */

import { type Cast, type DataType, dataType } from '@internal/framework-components/codec';
import { numeralText } from '@internal/sql-relational-core/ast';

const unchanged: Cast = (value) => value;

const asNumeralText: Cast = (value) => (typeof value === 'number' ? numeralText(value) : value);

const asReal: Cast = (value) => (typeof value === 'string' ? Number(value) : value);

export const sqliteText: DataType = dataType('sqlite/text', {});
export const sqliteJson: DataType = dataType('sqlite/json', {});
export const sqliteInteger: DataType = dataType('sqlite/integer', {});

export const sqliteDatetime: DataType = dataType('sqlite/datetime', {
  casts: { [sqliteText.id]: unchanged },
});

export const sqliteBlob: DataType = dataType('sqlite/blob', {
  casts: { [sqliteText.id]: unchanged },
});

export const sqliteBigint: DataType = dataType('sqlite/bigint', {
  casts: { [sqliteInteger.id]: asNumeralText },
});

export const sqliteReal: DataType = dataType('sqlite/real', {
  casts: { [sqliteInteger.id]: asReal, [sqliteBigint.id]: asReal },
});

/** Every data type this target registers. */
export const sqliteDataTypes: readonly DataType[] = [
  sqliteText,
  sqliteJson,
  sqliteInteger,
  sqliteDatetime,
  sqliteBlob,
  sqliteBigint,
  sqliteReal,
];
