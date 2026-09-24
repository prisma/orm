import { describe, expect, it } from 'vitest';
import { codecDescriptors } from '../src/core/codecs';

/**
 * Every codec this target ships and the data type it represents. Several codecs of one type differ
 * only in the value they produce in memory; all of them store that type's canonical form.
 * ADR 254, spec B3.
 */
const EXPECTED: Readonly<Record<string, string>> = {
  'pg/text@1': 'pg/text',
  'sql/text@1': 'pg/text',
  'pg/char@1': 'pg/char',
  'sql/char@1': 'pg/char',
  'pg/varchar@1': 'pg/varchar',
  'sql/varchar@1': 'pg/varchar',
  'pg/text-array@1': 'pg/text-array',
  'pg/enum@1': 'pg/enum',
  'pg/uuid@1': 'pg/uuid',
  'pg/inet@1': 'pg/inet',
  'pg/bit@1': 'pg/bit',
  'pg/varbit@1': 'pg/varbit',
  'pg/bytea@1': 'pg/bytea',
  'pg/interval@1': 'pg/interval',
  'pg/timetz@1': 'pg/timetz',
  'pg/date-temporal@1': 'pg/date',
  'pg/date-string@1': 'pg/date',
  'pg/time-temporal@1': 'pg/time',
  'pg/time-string@1': 'pg/time',
  'pg/timestamp-temporal@1': 'pg/timestamp',
  'pg/timestamp-string@1': 'pg/timestamp',
  'pg/timestamptz-temporal@1': 'pg/timestamptz',
  'pg/timestamptz-string@1': 'pg/timestamptz',
  'pg/timestamptz-date@1': 'pg/timestamptz',
  'pg/int2@1': 'pg/int2',
  'pg/int4@1': 'pg/int4',
  'pg/int@1': 'pg/int4',
  'sql/int@1': 'pg/int4',
  'pg/int8@1': 'pg/int8',
  'pg/int8number@1': 'pg/int8',
  'pg/numeric@1': 'pg/numeric',
  'pg/unboundedint@1': 'pg/numeric',
  'pg/float4@1': 'pg/float4',
  'pg/float8@1': 'pg/float8',
  'pg/float@1': 'pg/float8',
  'sql/float@1': 'pg/float8',
  'pg/bool@1': 'pg/bool',
  'pg/json@1': 'pg/json',
  'pg/jsonb@1': 'pg/jsonb',
  'pg/tsquery@1': 'pg/tsquery',
};

describe('postgres data type inventory', () => {
  it('names the data type of every codec it ships', () => {
    expect(
      Object.fromEntries(
        codecDescriptors.map((descriptor) => [descriptor.codecId, descriptor.dataType]),
      ),
    ).toEqual(EXPECTED);
  });
});
