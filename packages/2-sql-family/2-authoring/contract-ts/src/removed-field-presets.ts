import { answerMissingPropertyReads } from '@internal/contract-authoring';
import {
  type AuthoringTypeNamespace,
  isAuthoringTypeAliasDescriptor,
  isAuthoringTypeDescriptor,
} from '@internal/framework-components/authoring';
import {
  GENERATED_ID_COLUMN_ALIAS_NAMESPACES,
  type GeneratedIdColumnAlias,
  generatedIdColumnAliases,
} from '@internal/sql-contract/generated-id-column-aliases';
import { contractError } from './contract-errors';

const GUIDE = 'The upgrade guide "Field presets are removed" lists every rewrite.';

/** A removed field preset: its rewrite, named only where the type the rewrite writes resolves, and to `codecId` when one is given, so a row does not fire on a target the preset never existed on. */
interface RemovedFieldPreset {
  readonly type: readonly string[];
  readonly codecId: string | undefined;
  readonly rewrite: string;
}

/** The row of a preset whose rewrite is `rewrite`; its type is the first `type.X(` that `rewrite` writes. */
function writtenAs(rewrite: string, codecId?: string): readonly RemovedFieldPreset[] {
  const type = /type\.([\w.]+)\(/.exec(rewrite)?.[1] ?? '';
  return [{ type: type.split('.'), codecId, rewrite }];
}

/** The `type.` prefix of a namespace, such as `sql.` for `['sql']`. */
const prefixOf = (namespace: readonly string[]) => namespace.map((name) => `${name}.`).join('');

/** The rows of a preset whose rewrite `write` makes from each namespace's `type.` prefix, each named where that namespace has the generated id column alias `alias`. */
function idAlias(
  alias: GeneratedIdColumnAlias,
  write: (prefix: string) => string,
): readonly RemovedFieldPreset[] {
  return GENERATED_ID_COLUMN_ALIAS_NAMESPACES.map((namespace) => ({
    type: [...namespace, alias],
    codecId: generatedIdColumnAliases[alias].output.type.codecId,
    rewrite: write(prefixOf(namespace)),
  }));
}

const column = (prefix: string, type: string) => `field.column(type.${prefix}${type})`;
const id = (columnText: string, generator: string) =>
  `${columnText}.id().onCreate(gen.${generator})`;
const aliasColumn = (alias: GeneratedIdColumnAlias) =>
  idAlias(alias, (prefix) => column(prefix, `${alias}()`));
const aliasId = (alias: GeneratedIdColumnAlias, generator: string) =>
  idAlias(alias, (prefix) => id(column(prefix, `${alias}()`), generator));
const withPhases = (type: string, codecId: string, precision: boolean) =>
  writtenAs(
    `field.column(type.${type}(${precision ? 'p' : ''})), with .onCreate(gen.now()) and .onUpdate(gen.now()) for the phases the preset set${precision ? ', and without p when it set no precision' : ''}`,
    codecId,
  );

export const PRESETS: Readonly<Record<string, readonly RemovedFieldPreset[]>> = {
  uuidString: aliasColumn('UuidString'),
  ulid: aliasColumn('Ulid'),
  nanoid: idAlias(
    'Nanoid',
    (prefix) =>
      `${column(prefix, 'Nanoid()')}, or ${column(prefix, 'Char(n)')} for nanoid({ size: n })`,
  ),
  cuid2: aliasColumn('Cuid2'),
  ksuid: aliasColumn('Ksuid'),
  text: writtenAs('field.column(type.String())', 'pg/text@1'),
  int: writtenAs('field.column(type.Int())', 'pg/int4@1'),
  bigint: writtenAs('field.column(type.BigInt())', 'pg/int8@1'),
  float: writtenAs('field.column(type.Float())', 'pg/float8@1'),
  decimal: writtenAs('field.column(type.Decimal())', 'pg/numeric@1'),
  boolean: writtenAs('field.column(type.Boolean())', 'pg/bool@1'),
  json: writtenAs('field.column(type.Jsonb())', 'pg/jsonb@1'),
  bytes: writtenAs('field.column(type.Bytes())', 'pg/bytea@1'),
  dateTime: writtenAs('field.column(type.DateTime())', 'pg/timestamptz-temporal@1'),
  uuidNative: writtenAs('field.column(type.Uuid())', 'pg/uuid@1'),
  generated: idAlias(
    'UuidString',
    (prefix) =>
      `${column(prefix, 'Char(n)')}.onCreate(gen.fn()), such as ${column(prefix, 'UuidString()')}.onCreate(gen.uuid()) for field.generated(uuidv4())`,
  ),
  'id.uuidv4String': aliasId('UuidString', 'uuid()'),
  'id.uuidv7String': aliasId('UuidString', 'uuid(7)'),
  'id.ulid': aliasId('Ulid', 'ulid()'),
  'id.nanoid': idAlias(
    'Nanoid',
    (prefix) =>
      `${id(column(prefix, 'Nanoid()'), 'nanoid()')}, or ${id(column(prefix, 'Char(n)'), 'nanoid(n)')} for id.nanoid({ size: n })`,
  ),
  'id.cuid2': aliasId('Cuid2', 'cuid(2)'),
  'id.ksuid': aliasId('Ksuid', 'ksuid()'),
  'id.uuidv4Native': writtenAs(id('field.column(type.Uuid())', 'uuid()'), 'pg/uuid@1'),
  'id.uuidv7Native': writtenAs(id('field.column(type.Uuid())', 'uuid(7)'), 'pg/uuid@1'),
  'temporal.createdAt': writtenAs('field.column(type.temporal.CreatedAt())'),
  'temporal.updatedAt': writtenAs('field.column(type.temporal.UpdatedAt())'),
  'temporal.createdAtString': writtenAs('field.column(type.temporal.CreatedAtString())'),
  'temporal.updatedAtString': writtenAs('field.column(type.temporal.UpdatedAtString())'),
  'temporal.createdAtJsDate': writtenAs('field.column(type.temporal.CreatedAtJsDate())'),
  'temporal.updatedAtJsDate': writtenAs('field.column(type.temporal.UpdatedAtJsDate())'),
  'temporal.timestamp': withPhases('TimestampTemporal', 'pg/timestamp-temporal@1', true),
  'temporal.timestamptz': withPhases('TimestamptzTemporal', 'pg/timestamptz-temporal@1', true),
  'temporal.timestampString': withPhases('TimestampString', 'pg/timestamp-string@1', true),
  'temporal.timestamptzString': withPhases('TimestamptzString', 'pg/timestamptz-string@1', true),
  'temporal.timestamptzJsDate': withPhases('TimestamptzJsDate', 'pg/timestamptz-date@1', true),
  'temporal.date': withPhases('Date', 'pg/date-temporal@1', false),
  'temporal.dateString': withPhases('DateString', 'pg/date-string@1', false),
  'temporal.time': withPhases('Time', 'pg/time-temporal@1', true),
  'temporal.timeString': withPhases('TimeString', 'pg/time-string@1', true),
  'temporal.timetz': withPhases('Timetz', 'pg/timetz@1', true),
  'temporal.datetime': withPhases('DateTime', 'sqlite/datetime@1', false),
};

function codecIdAt(types: AuthoringTypeNamespace, path: readonly string[]): string | undefined {
  const [name, ...rest] = path;
  if (name === undefined || !Object.hasOwn(types, name)) return undefined;
  const value = types[name];
  if (value === undefined) return undefined;
  if (!isAuthoringTypeDescriptor(value)) return codecIdAt(value, rest);
  if (rest.length > 0) return undefined;
  return isAuthoringTypeAliasDescriptor(value) ? value.output.type.codecId : value.output.codecId;
}

function appliesTo(preset: RemovedFieldPreset, types: AuthoringTypeNamespace): boolean {
  const codecId = codecIdAt(types, preset.type);
  return codecId !== undefined && (preset.codecId === undefined || codecId === preset.codecId);
}

function refuse(path: string, types: AuthoringTypeNamespace): never {
  const helper = `field.${path}`;
  const rows = Object.hasOwn(PRESETS, path) ? PRESETS[path] : undefined;
  const preset = rows?.find((row) => appliesTo(row, types));
  throw contractError(
    'CONTRACT.FIELD_HELPER_UNKNOWN',
    preset !== undefined
      ? `${helper} was a field preset, and Prisma 8 removed field presets. Write ${preset.rewrite}. ${GUIDE}`
      : `${helper} does not exist. Prisma 8 removed field presets: declare a column as field.column(type.X(...)), add .id(), .onCreate(gen.fn()) and .onUpdate(gen.fn()) for what a preset set, or use a type alias such as field.column(type.temporal.CreatedAt()). ${GUIDE}`,
    { meta: { helper } },
  );
}

function membersOf(namespace: string): ReadonlySet<string> {
  return new Set(
    Object.keys(PRESETS)
      .filter((path) => path.startsWith(`${namespace}.`))
      .map((path) => path.slice(namespace.length + 1)),
  );
}

const NAMES: ReadonlySet<string> = new Set(
  Object.keys(PRESETS).map((path) => path.split('.')[0] ?? path),
);

/**
 * The SQL `field` helpers, where a read of a removed field preset throws `CONTRACT.FIELD_HELPER_UNKNOWN`, so a JavaScript caller, or a contract emitted before it is type-checked, learns what to write instead. The rewrite is named where `types`, the stack's `type` namespace, has the type it writes and that type stores the preset's codec; elsewhere the message names the forms that replace presets. `field.id` and `field.temporal`, which held presets, answer the same way for the presets read from them. Every other read behaves as on `helpers`.
 */
export function refusingRemovedFieldPresets<Helpers extends object>(
  helpers: Helpers,
  types: AuthoringTypeNamespace,
): Helpers {
  return answerMissingPropertyReads(helpers, NAMES, (name) =>
    Object.hasOwn(PRESETS, name)
      ? refuse(name, types)
      : answerMissingPropertyReads({}, membersOf(name), (member) =>
          refuse(`${name}.${member}`, types),
        ),
  );
}
