/**
 * Representative application values for every built-in SQLite codec descriptor,
 * exercised against a real database by the conformance suite.
 *
 * `notYetCanonical` marks a case whose projection disagrees with the codec's
 * **current** `encodeJson` / `decodeJson` — the projection will not execute, or
 * the parsed value differs from what `encodeJson` produces, or the value does
 * not survive the round trip back. The suite asserts a marked case still fails
 * and still fails the recorded way, so a projection cannot be brought into
 * agreement without updating this file.
 *
 * A green run is therefore not a claim that every codec's JSON is canonical.
 * Both conditions are measured against the codec's own two methods, so a codec
 * whose `encodeJson` is itself not canonical conforms here: its projection
 * faithfully realizes a representation that is simply not the one the codec ends
 * up with. Such a codec conforms, then transits through a failing state when its
 * canonical form lands, then conforms again.
 *
 * Which codecs are in that position is deliberately not listed here — that list
 * lives in the plan, and a copy of it in this header would go stale every time
 * one of them landed. What this file names is narrower and self-maintaining: the
 * cases that fail *today*, each carrying its own `notYetCanonical` reason.
 *
 * A case is only as good as the boundary it crosses. A value chosen for being
 * typical is the one least likely to expose a format defect, so prefer values
 * that sit just past a representation's limits over values that sit comfortably
 * inside all of them.
 */

import type { SqliteCodecConformanceCase } from '../../src/index';

export const sqliteConformanceCases: readonly SqliteCodecConformanceCase[] = [
  { codecId: 'sql/char@1', label: 'single character', value: 'a', storageType: 'TEXT' },
  { codecId: 'sql/varchar@1', label: 'text', value: 'hello', storageType: 'TEXT' },
  { codecId: 'sql/int@1', label: 'integer', value: 42, storageType: 'INTEGER' },
  { codecId: 'sql/float@1', label: 'finite float', value: 1.5, storageType: 'REAL' },
  { codecId: 'sqlite/text@1', label: 'text', value: 'hello', storageType: 'TEXT' },
  { codecId: 'sqlite/integer@1', label: 'integer', value: 42, storageType: 'INTEGER' },
  { codecId: 'sqlite/real@1', label: 'finite float', value: 1.5, storageType: 'REAL' },
  // hex() never wraps, so a blob's boundary is not length but case: a value whose
  // hex is all digits cannot tell uppercase from lowercase.
  {
    codecId: 'sqlite/blob@1',
    label: 'byte string whose hex is all digits',
    value: new Uint8Array([0x01, 0x23, 0x45]),
    storageType: 'BLOB',
  },
  {
    codecId: 'sqlite/blob@1',
    label: 'byte string whose hex needs letters',
    value: new Uint8Array([0x0a, 0xbc, 0xde, 0xff]),
    storageType: 'BLOB',
  },
  {
    codecId: 'sqlite/blob@1',
    label: 'byte string past any plausible wrap width',
    value: Uint8Array.from({ length: 200 }, (_, index) => (index * 7) % 256),
    storageType: 'BLOB',
  },
  {
    codecId: 'sqlite/blob@1',
    label: 'empty byte string',
    value: new Uint8Array(),
    storageType: 'BLOB',
  },
  {
    codecId: 'sqlite/datetime@1',
    label: 'instant with milliseconds',
    value: new Date('2026-01-02T03:04:05.678Z'),
    storageType: 'TEXT',
  },
  {
    codecId: 'sqlite/datetime@1',
    label: 'instant with a trailing zero in its milliseconds',
    value: new Date('2026-01-02T03:04:05.500Z'),
    storageType: 'TEXT',
  },
  { codecId: 'sqlite/json@1', label: 'document', value: { a: 1, b: ['x'] }, storageType: 'TEXT' },
  // A document is not always an object: the retag has to carry every JSON shape,
  // including the scalars whose text form is indistinguishable from a stored string.
  {
    codecId: 'sqlite/json@1',
    label: 'array at the top level',
    value: [1, 'two', null],
    storageType: 'TEXT',
  },
  {
    codecId: 'sqlite/json@1',
    label: 'string at the top level',
    value: 'plain',
    storageType: 'TEXT',
  },
  { codecId: 'sqlite/json@1', label: 'number at the top level', value: 42, storageType: 'TEXT' },
  { codecId: 'sqlite/json@1', label: 'null at the top level', value: null, storageType: 'TEXT' },
  {
    codecId: 'sqlite/json@1',
    label: 'document whose strings need escaping',
    value: { 'k"y': 'v\\a"l', nested: ['x\ny'] },
    storageType: 'TEXT',
  },
  {
    codecId: 'sqlite/bigint@1',
    label: 'small integer',
    value: 42n,
    storageType: 'INTEGER',
  },
  {
    codecId: 'sqlite/bigint@1',
    label: 'integer beyond double precision',
    value: 9007199254740993n,
    storageType: 'INTEGER',
  },
  {
    codecId: 'sqlite/bigint@1',
    label: 'int64 lower bound',
    value: -9223372036854775808n,
    storageType: 'INTEGER',
  },
  {
    codecId: 'sqlite/bigint@1',
    label: 'int64 upper bound',
    value: 9223372036854775807n,
    storageType: 'INTEGER',
  },
  // The safe-range boundaries are the values a JSON-number canonical form is
  // most likely to mangle, so they are the ones that pin it.
  {
    codecId: 'sqlite/bigintnumber@1',
    label: 'largest safe integer',
    value: 9007199254740991,
    storageType: 'INTEGER',
  },
  {
    codecId: 'sqlite/bigintnumber@1',
    label: 'smallest safe integer',
    value: -9007199254740991,
    storageType: 'INTEGER',
  },
  {
    codecId: 'sqlite/bigintnumber@1',
    label: 'small integer',
    value: 42,
    storageType: 'INTEGER',
  },
  {
    codecId: 'sqlite/text@1',
    label: 'text needing JSON escaping',
    value: 'quote " backslash \\ newline \n',
    storageType: 'TEXT',
  },
  {
    codecId: 'sqlite/text@1',
    label: 'text beyond the basic plane',
    value: 'a\u{1F600}b',
    storageType: 'TEXT',
  },
  {
    codecId: 'sqlite/real@1',
    label: 'float not exactly representable',
    value: 0.1,
    storageType: 'REAL',
  },
  // Every column can be NULL, and no `value` denotes it: NULL is a state of the
  // column rather than something a codec can be handed. Most codecs reject
  // `null`; the JSON codecs accept it, but there `value: null` means a JSON
  // `null` document stored in the column, not an empty column. A NULL case
  // stores SQL NULL and requires the projection to carry absence through as
  // absence — the dimension that let an assembled projection report an absent
  // value as a present one.
  {
    codecId: 'sql/char@1',
    label: 'null',
    value: undefined,
    storageType: 'TEXT',
    nullValue: true,
  },
  {
    codecId: 'sql/float@1',
    label: 'null',
    value: undefined,
    storageType: 'REAL',
    nullValue: true,
  },
  {
    codecId: 'sql/int@1',
    label: 'null',
    value: undefined,
    storageType: 'INTEGER',
    nullValue: true,
  },
  {
    codecId: 'sql/varchar@1',
    label: 'null',
    value: undefined,
    storageType: 'TEXT',
    nullValue: true,
  },
  {
    codecId: 'sqlite/bigint@1',
    label: 'null',
    value: undefined,
    storageType: 'INTEGER',
    nullValue: true,
  },
  {
    codecId: 'sqlite/bigintnumber@1',
    label: 'null',
    value: undefined,
    storageType: 'INTEGER',
    nullValue: true,
  },
  {
    codecId: 'sqlite/blob@1',
    label: 'null',
    value: undefined,
    storageType: 'BLOB',
    nullValue: true,
  },
  {
    codecId: 'sqlite/datetime@1',
    label: 'null',
    value: undefined,
    storageType: 'TEXT',
    nullValue: true,
  },
  {
    codecId: 'sqlite/integer@1',
    label: 'null',
    value: undefined,
    storageType: 'INTEGER',
    nullValue: true,
  },
  {
    codecId: 'sqlite/json@1',
    label: 'null',
    value: undefined,
    storageType: 'TEXT',
    nullValue: true,
  },
  {
    codecId: 'sqlite/real@1',
    label: 'null',
    value: undefined,
    storageType: 'REAL',
    nullValue: true,
  },
  {
    codecId: 'sqlite/text@1',
    label: 'null',
    value: undefined,
    storageType: 'TEXT',
    nullValue: true,
  },
];
