import type { ResolvedTypeConstructorCall } from '@internal/psl-parser';
import {
  presetType,
  type RemovedFieldPreset,
  type RemovedFieldPresets,
  removedPresetWithPhases,
  removedPresetWrittenAs,
} from '@internal/psl-parser/interpret';
import {
  GENERATED_ID_COLUMN_ALIAS_NAMESPACES,
  type GeneratedIdColumnAlias,
  generatedIdColumnAliases,
} from '@internal/sql-contract/generated-id-column-aliases';

const NANOID_OPTIONS = /^\{\s*(?:size\s*:\s*(\d+)\s*,?\s*)?\}$/;

function nanoidSize(call: ResolvedTypeConstructorCall): { readonly size?: string } | undefined {
  const [options, ...rest] = call.args;
  if (options === undefined) return {};
  if (rest.length > 0 || options.kind !== 'positional') return undefined;
  const match = NANOID_OPTIONS.exec(options.value);
  if (match === null) return undefined;
  return match[1] === undefined ? {} : { size: match[1] };
}

function qualified(namespace: readonly string[], name: string): string {
  return [...namespace, name].join('.');
}

/** The rows of a preset whose rewrite writes the generated id column alias `alias`, then `attributes` when given, in each namespace that may name it. */
function idAlias(
  alias: GeneratedIdColumnAlias,
  attributes?: string,
): readonly RemovedFieldPreset[] {
  return GENERATED_ID_COLUMN_ALIAS_NAMESPACES.flatMap((namespace) =>
    removedPresetWrittenAs(
      qualified(namespace, alias),
      generatedIdColumnAliases[alias].output.type.codecId,
      attributes,
    ),
  );
}

function nanoid(id: boolean): readonly RemovedFieldPreset[] {
  return GENERATED_ID_COLUMN_ALIAS_NAMESPACES.map((namespace) => {
    const write = (size: string | undefined, modifier: string) => {
      const column =
        size === undefined ? qualified(namespace, 'Nanoid') : qualified(namespace, `Char(${size})`);
      return `${column}${modifier}${id ? ` @id @onCreate(nanoid(${size ?? ''}))` : ''}`;
    };
    return {
      type: presetType(qualified(namespace, 'Nanoid')),
      codecId: generatedIdColumnAliases.Nanoid.output.type.codecId,
      rewrite: (call, modifier) => {
        const options = nanoidSize(call);
        return options === undefined
          ? `Write ${write(undefined, modifier)}, or ${write('n', modifier)} for a size of n.`
          : `Write ${write(options.size, modifier)}.`;
      },
    };
  });
}

const TEMPORAL_DATE_TIME = presetType('DateTime', { as: 'temporal' });
const STRING_DATE_TIME = presetType('DateTime', { as: 'string' });
const SQLITE_DATETIME = 'sqlite/datetime@1';
const CREATED = '@onCreate(now())';
const UPDATED = '@onCreate(now()) @onUpdate(now())';

/** The SQL family's removed field presets: each row applies only where its rewrite's type stores the preset's codec. A generated id preset is written with the target's top-level alias where it has one, and with the `sql.` alias elsewhere. A date and time preset is written with the convenience call that gives the explicit type it stored, where one does (ADR 279). */
export const removedSqlFieldPresets: RemovedFieldPresets = {
  uuidString: idAlias('UuidString'),
  ulid: idAlias('Ulid'),
  nanoid: nanoid(false),
  cuid2: idAlias('Cuid2'),
  ksuid: idAlias('Ksuid'),
  'id.uuidv4String': idAlias('UuidString', '@id @onCreate(uuid())'),
  'id.uuidv7String': idAlias('UuidString', '@id @onCreate(uuid(7))'),
  'id.ulid': idAlias('Ulid', '@id @onCreate(ulid())'),
  'id.nanoid': nanoid(true),
  'id.cuid2': idAlias('Cuid2', '@id @onCreate(cuid(2))'),
  'id.ksuid': idAlias('Ksuid', '@id @onCreate(ksuid())'),
  text: removedPresetWrittenAs('String', 'pg/text@1'),
  int: removedPresetWrittenAs('Int', 'pg/int4@1'),
  bigint: removedPresetWrittenAs('BigInt', 'pg/int8@1'),
  float: removedPresetWrittenAs('Float', 'pg/float8@1'),
  decimal: removedPresetWrittenAs('Decimal', 'pg/numeric@1'),
  boolean: removedPresetWrittenAs('Boolean', 'pg/bool@1'),
  json: removedPresetWrittenAs('Jsonb', 'pg/jsonb@1'),
  bytes: removedPresetWrittenAs('Bytes', 'pg/bytea@1'),
  dateTime: removedPresetWrittenAs(TEMPORAL_DATE_TIME, 'pg/timestamptz-temporal@1'),
  uuidNative: removedPresetWrittenAs('Uuid', 'pg/uuid@1'),
  'id.uuidv4Native': removedPresetWrittenAs('Uuid', 'pg/uuid@1', '@id @onCreate(uuid())'),
  'id.uuidv7Native': removedPresetWrittenAs('Uuid', 'pg/uuid@1', '@id @onCreate(uuid(7))'),
  'temporal.createdAt': [
    ...removedPresetWrittenAs(TEMPORAL_DATE_TIME, 'pg/timestamptz-temporal@1', CREATED),
    ...removedPresetWrittenAs('temporal.CreatedAt', SQLITE_DATETIME),
  ],
  'temporal.updatedAt': [
    ...removedPresetWrittenAs(TEMPORAL_DATE_TIME, 'pg/timestamptz-temporal@1', UPDATED),
    ...removedPresetWrittenAs('temporal.UpdatedAt', SQLITE_DATETIME),
  ],
  'temporal.createdAtString': removedPresetWrittenAs(
    STRING_DATE_TIME,
    'pg/timestamptz-string@1',
    CREATED,
  ),
  'temporal.updatedAtString': removedPresetWrittenAs(
    STRING_DATE_TIME,
    'pg/timestamptz-string@1',
    UPDATED,
  ),
  'temporal.createdAtJsDate': removedPresetWrittenAs(
    'TimestamptzJsDate',
    'pg/timestamptz-date@1',
    CREATED,
  ),
  'temporal.updatedAtJsDate': removedPresetWrittenAs(
    'TimestamptzJsDate',
    'pg/timestamptz-date@1',
    UPDATED,
  ),
  'temporal.timestamp': removedPresetWithPhases(
    'TimestampTemporal',
    'pg/timestamp-temporal@1',
    true,
  ),
  'temporal.timestamptz': removedPresetWithPhases(
    TEMPORAL_DATE_TIME,
    'pg/timestamptz-temporal@1',
    true,
  ),
  'temporal.timestampString': removedPresetWithPhases(
    presetType('DateTime', { as: 'string', storage: 'timestamp' }),
    'pg/timestamp-string@1',
    true,
  ),
  'temporal.timestamptzString': removedPresetWithPhases(
    STRING_DATE_TIME,
    'pg/timestamptz-string@1',
    true,
  ),
  'temporal.timestamptzJsDate': removedPresetWithPhases(
    'TimestamptzJsDate',
    'pg/timestamptz-date@1',
    true,
    { type: presetType('DateTime'), defaultPrecision: '3' },
  ),
  'temporal.date': removedPresetWithPhases(
    presetType('Date', { as: 'temporal' }),
    'pg/date-temporal@1',
    false,
  ),
  'temporal.dateString': removedPresetWithPhases('Date', 'pg/date-string@1', false),
  'temporal.time': removedPresetWithPhases(
    presetType('Time', { as: 'temporal' }),
    'pg/time-temporal@1',
    true,
  ),
  'temporal.timeString': removedPresetWithPhases('Time', 'pg/time-string@1', true),
  'temporal.timetz': removedPresetWithPhases(
    presetType('Time', { storage: 'timetz' }),
    'pg/timetz@1',
    true,
  ),
  'temporal.datetime': removedPresetWithPhases('DateTime', SQLITE_DATETIME, false),
};
