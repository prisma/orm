/**
 * The data types this target owns. SQLite's storage classes are shared by several logical types,
 * so the target declares the types it distinguishes rather than one per storage class:
 * `sqlite/integer` and `sqlite/bigint` are distinct although both store as INTEGER, and
 * `sqlite/text`, `sqlite/datetime` and `sqlite/json` are distinct although all store as TEXT.
 *
 * ADR 254. These are the ids; the declarations that carry each type's casts follow.
 */

import { dataTypeId } from '@internal/framework-components/codec';

export const SQLITE_TEXT = dataTypeId('sqlite/text');
export const SQLITE_DATETIME = dataTypeId('sqlite/datetime');
export const SQLITE_JSON = dataTypeId('sqlite/json');
export const SQLITE_BLOB = dataTypeId('sqlite/blob');
export const SQLITE_INTEGER = dataTypeId('sqlite/integer');
export const SQLITE_BIGINT = dataTypeId('sqlite/bigint');
export const SQLITE_REAL = dataTypeId('sqlite/real');
