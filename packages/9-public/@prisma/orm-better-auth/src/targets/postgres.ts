import type { PslField, TargetSupport } from '../target-support';
import { standardPslType } from './standard-psl-type';
import { compareTextBySubstring } from './substring-text';
import { sqlFamilyCodecKinds, valueKindOf } from './value-kinds';

const valueKind = valueKindOf(sqlFamilyCodecKinds, {
  string: ['pg/text@1', 'pg/varchar@1', 'pg/char@1'],
  enum: ['pg/enum@1'],
  uuid: ['pg/uuid@1'],
  date: ['pg/timestamptz-date@1', 'pg/timestamp-date@1'],
  number: [
    'pg/int@1',
    'pg/int2@1',
    'pg/int4@1',
    'pg/int8number@1',
    'pg/float@1',
    'pg/float4@1',
    'pg/float8@1',
  ],
  boolean: ['pg/bool@1'],
  json: ['pg/json@1', 'pg/jsonb@1'],
  other: [
    'pg/int8@1',
    'pg/unboundedint@1',
    'pg/numeric@1',
    'pg/timestamptz-temporal@1',
    'pg/timestamptz-string@1',
    'pg/timestamp-temporal@1',
    'pg/timestamp-string@1',
    'pg/timestamp-instant@1',
    'pg/date-temporal@1',
    'pg/date-string@1',
    'pg/time-temporal@1',
    'pg/time-string@1',
    'pg/timetz@1',
    'pg/inet@1',
    'pg/interval@1',
    'pg/interval-string@1',
    'pg/bit@1',
    'pg/varbit@1',
    'pg/xml@1',
    'pg/oid@1',
    'pg/money@1',
    'pg/bytea@1',
    'pg/text-array@1',
    'pg/tsquery@1',
  ],
});

/** A key that references a `uuid` id is a `Uuid`, since Postgres refuses a `text` foreign key to a `uuid` column. */
function pslType(field: PslField): string {
  return field.isIdReference && field.referencesUuidId ? 'Uuid' : standardPslType(field);
}

export const postgresSupport: TargetSupport = {
  target: 'postgres',
  valueKind,
  compareText: compareTextBySubstring,
  sameStorageName: (a, b) => a === b,
  defaultNamespace: 'public',
  pslType,
};
