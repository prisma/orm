import type { ResolvedTypeConstructorCall } from '@internal/psl-parser';
import {
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
      `${qualified(namespace, alias)}${attributes === undefined ? '' : ` ${attributes}`}`,
      generatedIdColumnAliases[alias].output.type.codecId,
    ),
  );
}

function nanoid(id: boolean): readonly RemovedFieldPreset[] {
  return GENERATED_ID_COLUMN_ALIAS_NAMESPACES.map((namespace) => {
    const write = (size: string | undefined) => {
      const column =
        size === undefined ? qualified(namespace, 'Nanoid') : qualified(namespace, `Char(${size})`);
      return id ? `${column} @id @onCreate(nanoid(${size ?? ''}))` : column;
    };
    return {
      type: [...namespace, 'Nanoid'],
      codecId: generatedIdColumnAliases.Nanoid.output.type.codecId,
      rewrite: (call) => {
        const options = nanoidSize(call);
        return options === undefined
          ? `Write ${write(undefined)}, or ${write('n')} for a size of n.`
          : `Write ${write(options.size)}.`;
      },
    };
  });
}

/** The SQL family's removed field presets: each row applies only where its rewrite's type stores the preset's codec, and a row with no codec id writes a type alias only the targets with the preset contribute. A generated id preset is written with the target's top-level alias where it has one, and with the `sql.` alias elsewhere. */
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
  dateTime: removedPresetWrittenAs('DateTime', 'pg/timestamptz-temporal@1'),
  uuidNative: removedPresetWrittenAs('Uuid', 'pg/uuid@1'),
  'id.uuidv4Native': removedPresetWrittenAs('Uuid @id @onCreate(uuid())', 'pg/uuid@1'),
  'id.uuidv7Native': removedPresetWrittenAs('Uuid @id @onCreate(uuid(7))', 'pg/uuid@1'),
  'temporal.createdAt': removedPresetWrittenAs('temporal.CreatedAt'),
  'temporal.updatedAt': removedPresetWrittenAs('temporal.UpdatedAt'),
  'temporal.createdAtString': removedPresetWrittenAs('temporal.CreatedAtString'),
  'temporal.updatedAtString': removedPresetWrittenAs('temporal.UpdatedAtString'),
  'temporal.createdAtJsDate': removedPresetWrittenAs('temporal.CreatedAtJsDate'),
  'temporal.updatedAtJsDate': removedPresetWrittenAs('temporal.UpdatedAtJsDate'),
  'temporal.timestamp': removedPresetWithPhases(
    'TimestampTemporal',
    'pg/timestamp-temporal@1',
    true,
  ),
  'temporal.timestamptz': removedPresetWithPhases(
    'TimestamptzTemporal',
    'pg/timestamptz-temporal@1',
    true,
  ),
  'temporal.timestampString': removedPresetWithPhases(
    'TimestampString',
    'pg/timestamp-string@1',
    true,
  ),
  'temporal.timestamptzString': removedPresetWithPhases(
    'TimestamptzString',
    'pg/timestamptz-string@1',
    true,
  ),
  'temporal.timestamptzJsDate': removedPresetWithPhases(
    'TimestamptzJsDate',
    'pg/timestamptz-date@1',
    true,
  ),
  'temporal.date': removedPresetWithPhases('Date', 'pg/date-temporal@1', false),
  'temporal.dateString': removedPresetWithPhases('DateString', 'pg/date-string@1', false),
  'temporal.time': removedPresetWithPhases('Time', 'pg/time-temporal@1', true),
  'temporal.timeString': removedPresetWithPhases('TimeString', 'pg/time-string@1', true),
  'temporal.timetz': removedPresetWithPhases('Timetz', 'pg/timetz@1', true),
  'temporal.datetime': removedPresetWithPhases('DateTime', 'sqlite/datetime@1', false),
};
