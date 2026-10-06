import { CastExpr, ColumnRef } from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { codecDescriptors } from '../src/core/codecs';
import { postgresTypeLookups } from './postgres-type-lookups';

const postgresDataTypeLookup = postgresTypeLookups.dataTypeLookup;

const PARAMETERLESS_CODEC_IDS: readonly string[] = [
  'sql/char@1',
  'sql/varchar@1',
  'sql/int@1',
  'sql/float@1',
  'sql/text@1',
  'pg/text@1',
  'pg/char@1',
  'pg/varchar@1',
  'pg/int@1',
  'pg/float@1',
  'pg/int4@1',
  'pg/int2@1',
  'pg/int8@1',
  'pg/int8number@1',
  'pg/float4@1',
  'pg/float8@1',
  'pg/numeric@1',
  'pg/unboundedint@1',
  'pg/date-temporal@1',
  'pg/timestamp-temporal@1',
  'pg/timestamptz-temporal@1',
  'pg/time-temporal@1',
  'pg/date-string@1',
  'pg/timestamp-string@1',
  'pg/timestamptz-string@1',
  'pg/timestamptz-date@1',
  'pg/time-string@1',
  'pg/timetz@1',
  'pg/bool@1',
  'pg/bit@1',
  'pg/varbit@1',
  'pg/bytea@1',
  'pg/uuid@1',
  'pg/inet@1',
  'pg/interval@1',
  'pg/json@1',
  'pg/jsonb@1',
  'pg/text-array@1',
  'pg/tsquery@1',
];

const NEEDS_PARAMS = new Set(['pg/enum@1']);

const parameterless = codecDescriptors.filter((d) => !NEEDS_PARAMS.has(d.codecId));
const source = ColumnRef.of('t', 'c');

describe('every shipped codec represents a Postgres data type', () => {
  it('the table covers exactly the parameterless codecs this package ships', () => {
    expect(parameterless.map((d) => d.codecId).sort()).toEqual([...PARAMETERLESS_CODEC_IDS].sort());
  });

  it('ships no duplicate codec id', () => {
    const ids = codecDescriptors.map((d) => d.codecId);
    expect(ids).toHaveLength(new Set(ids).size);
  });

  it.each(parameterless.map((d) => [d.codecId, d] as const))(
    '%s represents a registered data type',
    (_id, d) => {
      expect(postgresDataTypeLookup.get(d.dataType)).toBeDefined();
    },
  );
});

describe('every shipped codec projects a scalar read and lifts an array read', () => {
  it.each(parameterless.map((d) => [d.codecId, d] as const))('%s', (id, d) => {
    const scalar = d.projectJson(source, { codecId: id });
    const lifted = d.projectJson(source, { codecId: id, many: true });

    expect(scalar).toBeDefined();
    expect(lifted).not.toBe(scalar);
  });

  it('passes an identity-projected column through untouched', () => {
    const text = codecDescriptors.find((d) => d.codecId === 'pg/text@1');
    expect(text?.projectJson(source, { codecId: 'pg/text@1' })).toBe(source);
  });

  it.each(['sql/char@1', 'pg/char@1'])(
    'projects a %s column as text, which drops the padding a flat read drops',
    (codecId) => {
      const char = codecDescriptors.find((d) => d.codecId === codecId);
      expect(char?.projectJson(source, { codecId, typeParams: { length: 3 } })).toEqual(
        CastExpr.as(source, 'text'),
      );
    },
  );

  it('rewrites a column whose wire form JSON cannot carry', () => {
    const bytea = codecDescriptors.find((d) => d.codecId === 'pg/bytea@1');
    expect(bytea?.projectJson(source, { codecId: 'pg/bytea@1' })).not.toBe(source);
  });
});
