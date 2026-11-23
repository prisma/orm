const codecKinds = ['string', 'enum', 'uuid', 'date', 'number', 'boolean', 'other'] as const;

export type CodecKind = (typeof codecKinds)[number];

const codecIdsByKind: Readonly<Record<CodecKind, readonly string[]>> = {
  string: ['pg/text@1', 'sql/varchar@1', 'sql/char@1', 'sqlite/text@1'],
  enum: ['pg/enum@1'],
  uuid: ['pg/uuid@1'],
  date: ['pg/timestamptz-date@1', 'pg/timestamp-date@1', 'sqlite/datetime@1'],
  number: [
    'pg/int2@1',
    'pg/int4@1',
    'pg/int8number@1',
    'pg/float4@1',
    'pg/float8@1',
    'sqlite/integer@1',
    'sqlite/real@1',
  ],
  boolean: ['pg/bool@1', 'sqlite/boolean@1'],
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
    'pg/json@1',
    'pg/jsonb@1',
    'pg/bytea@1',
    'sqlite/bigint@1',
    'sqlite/decimal@1',
    'sqlite/datetime-temporal@1',
    'sqlite/datetime-string@1',
    'sqlite/date-string@1',
    'sqlite/date-temporal@1',
    'sqlite/time-string@1',
    'sqlite/time-temporal@1',
    'sqlite/duration-string@1',
    'sqlite/json@1',
    'sqlite/blob@1',
  ],
};

const kindByCodecId: ReadonlyMap<string, CodecKind> = new Map(
  codecKinds.flatMap((kind) => codecIdsByKind[kind].map((id): [string, CodecKind] => [id, kind])),
);

/** The kind of JavaScript value a codec reads and writes, or `undefined` for a codec this table does not know. */
export function codecKind(codecId: string): CodecKind | undefined {
  return kindByCodecId.get(codecId);
}
