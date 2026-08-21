/**
 * The DDL spelling and the JSON projection of every codec this package ships.
 *
 * Both are declared per codec and consumed entirely from elsewhere — `nativeTypeFor` by the
 * migration planner when it renders a column, `projectJson` by the query lane when it builds a
 * nested read. The suites that exercise them therefore live in other packages, which leaves the
 * declarations themselves unpinned here: a codec could change the type it renders, or lose its
 * array lift, and nothing in this package would notice.
 *
 * The table is the point. It is not a recording of what the code returns — it is the mapping from
 * codec id to PostgreSQL type, checked against PostgreSQL's own type names, and it is what makes an
 * accidental change to one of them visible as a diff in an expectation rather than as a silently
 * different `CREATE TABLE`.
 */

import { ColumnRef } from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { codecDescriptors } from '../src/core/codecs';

/**
 * Codec id → the type PostgreSQL is asked to create.
 *
 * Several spellings are deliberately the long form (`timestamp with time zone`, not
 * `timestamptz`): that is what the planner emits, and the short identifier is a separate string
 * carried on the column. `pg/enum@1` is absent because its type name comes from its params — it is
 * covered by its own suite, which supplies them.
 */
const DDL_TYPES: Readonly<Record<string, string>> = {
  'sql/char@1': 'character',
  'sql/varchar@1': 'character varying',
  'sql/int@1': 'int4',
  'sql/float@1': 'float8',
  'sql/text@1': 'text',
  'pg/text@1': 'text',
  'pg/char@1': 'character',
  'pg/varchar@1': 'character varying',
  'pg/int@1': 'integer',
  'pg/float@1': 'double precision',
  'pg/int4@1': 'integer',
  'pg/int2@1': 'smallint',
  'pg/int8@1': 'bigint',
  'pg/int8number@1': 'bigint',
  'pg/float4@1': 'real',
  'pg/float8@1': 'double precision',
  'pg/numeric@1': 'numeric',
  'pg/unboundedint@1': 'numeric',
  'pg/date-temporal@1': 'date',
  'pg/timestamp-temporal@1': 'timestamp without time zone',
  'pg/timestamptz-temporal@1': 'timestamp with time zone',
  'pg/time-temporal@1': 'time',
  'pg/date-string@1': 'date',
  'pg/timestamp-string@1': 'timestamp without time zone',
  'pg/timestamptz-string@1': 'timestamp with time zone',
  'pg/time-string@1': 'time',
  'pg/timetz@1': 'timetz',
  'pg/bool@1': 'boolean',
  'pg/bit@1': 'bit',
  'pg/varbit@1': 'bit varying',
  'pg/bytea@1': 'bytea',
  'pg/uuid@1': 'uuid',
  'pg/inet@1': 'inet',
  'pg/interval@1': 'interval',
  'pg/json@1': 'json',
  'pg/jsonb@1': 'jsonb',
  'pg/text-array@1': 'text[]',
};

/** Params-bearing descriptors whose native type cannot be rendered from an empty ref. */
const NEEDS_PARAMS = new Set(['pg/enum@1']);

const parameterless = codecDescriptors.filter((d) => !NEEDS_PARAMS.has(d.codecId));
const source = ColumnRef.of('t', 'c');

describe('every shipped codec declares a PostgreSQL type', () => {
  it('the table covers exactly the parameterless codecs this package ships', () => {
    expect(parameterless.map((d) => d.codecId).sort()).toEqual(Object.keys(DDL_TYPES).sort());
  });

  it('ships no duplicate codec id', () => {
    const ids = codecDescriptors.map((d) => d.codecId);
    expect(ids).toHaveLength(new Set(ids).size);
  });

  it.each(parameterless.map((d) => [d.codecId, d] as const))('%s renders its type', (id, d) => {
    expect(d.nativeTypeFor({ codecId: id })).toBe(DDL_TYPES[id]);
  });
});

describe('every shipped codec projects a scalar read and lifts an array read', () => {
  it.each(parameterless.map((d) => [d.codecId, d] as const))('%s', (id, d) => {
    const scalar = d.projectJson(source, { codecId: id });
    const lifted = d.projectJson(source, { codecId: id, many: true });

    expect(scalar).toBeDefined();
    // The array lift always wraps the element projection in a subquery, so it can never be the
    // same node as the scalar one — including for the codecs whose scalar projection is identity.
    expect(lifted).not.toBe(scalar);
  });

  // The two ends of the range, pinned so the assertion above cannot be satisfied by a projection
  // that wraps everything indiscriminately.
  it('passes an identity-projected column through untouched', () => {
    const text = codecDescriptors.find((d) => d.codecId === 'pg/text@1');
    expect(text?.projectJson(source, { codecId: 'pg/text@1' })).toBe(source);
  });

  it('rewrites a column whose wire form JSON cannot carry', () => {
    const bytea = codecDescriptors.find((d) => d.codecId === 'pg/bytea@1');
    expect(bytea?.projectJson(source, { codecId: 'pg/bytea@1' })).not.toBe(source);
  });
});
