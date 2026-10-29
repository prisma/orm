import { answerMissingPropertyReads } from '@internal/contract-authoring';
import {
  type AuthoringTypeNamespace,
  instantiateAuthoringTypeCall,
  isAuthoringTypeAliasDescriptor,
  isAuthoringTypeChoiceDescriptor,
  isAuthoringTypeDescriptor,
} from '@internal/framework-components/authoring';
import {
  GENERATED_ID_COLUMN_ALIAS_NAMESPACES,
  type GeneratedIdColumnAlias,
  generatedIdColumnAliases,
} from '@internal/sql-contract/generated-id-column-aliases';
import { isInternalError } from '@internal/utils/internal-error';
import { contractError } from './contract-errors';

const GUIDE = 'The upgrade guide "Field presets are removed" lists every rewrite.';

/** The type a rewrite writes: its path, and for a type choice the options it is called with, such as `{ as: 'temporal' }`. */
interface RewriteType {
  readonly path: readonly string[];
  readonly options: Readonly<Record<string, string>> | undefined;
}

/** A removed field preset: its rewrite, named only where `type` resolves to `codecId`, the codec the preset stored, so a row does not fire on a target the preset never existed on. */
interface RemovedFieldPreset {
  readonly type: RewriteType;
  readonly codecId: string;
  readonly rewrite: string;
}

/** The explicit type constructor at the dotted `path`. */
const explicit = (path: string): RewriteType => ({ path: path.split('.'), options: undefined });

/** The type choice at `path`, called with `options`. */
const choice = (path: string, options: Readonly<Record<string, string>> = {}): RewriteType => ({
  path: path.split('.'),
  options,
});

/** The call to `type` as TypeScript writes it, with `precision` when given: one object of arguments for a type choice, and a positional argument for an explicit type. */
function typeCall({ path, options }: RewriteType, precision?: string): string {
  const name = `type.${path.join('.')}`;
  if (options === undefined) return `${name}(${precision ?? ''})`;
  const members = [
    ...Object.entries(options).map(([option, value]) => `${option}: '${value}'`),
    ...(precision === undefined ? [] : [`precision: ${precision}`]),
  ];
  return members.length === 0 ? `${name}()` : `${name}({ ${members.join(', ')} })`;
}

/** The row of a preset whose rewrite is the column of `type`, then `chain`. */
function writtenAs(type: RewriteType, codecId: string, chain = ''): readonly RemovedFieldPreset[] {
  return [{ type, codecId, rewrite: `field.column(${typeCall(type)})${chain}` }];
}

/** The `type.` prefix of a namespace, such as `sql.` for `['sql']`. */
const prefixOf = (namespace: readonly string[]) => namespace.map((name) => `${name}.`).join('');

/** The rows of a preset whose rewrite `write` makes from each namespace's `type.` prefix, each named where that namespace has the generated id column alias `alias`. */
function idAlias(
  alias: GeneratedIdColumnAlias,
  write: (prefix: string) => string,
): readonly RemovedFieldPreset[] {
  return GENERATED_ID_COLUMN_ALIAS_NAMESPACES.map((namespace) => ({
    type: { path: [...namespace, alias], options: undefined },
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
const withPhases = (type: RewriteType, codecId: string, precision: boolean) => [
  {
    type,
    codecId,
    rewrite: `field.column(${typeCall(type, precision ? 'p' : undefined)}), with .onCreate(gen.now()) and .onUpdate(gen.now()) for the phases the preset set${precision ? `, and without ${type.options === undefined ? 'p' : 'precision: p'} when it set no precision` : ''}`,
  },
];

const SQLITE_DATETIME = 'sqlite/datetime@1';
const CREATED = '.onCreate(gen.now())';
const UPDATED = '.onCreate(gen.now()).onUpdate(gen.now())';
const TEMPORAL_DATE_TIME = choice('DateTime', { as: 'temporal' });
const STRING_DATE_TIME = choice('DateTime', { as: 'string' });

/** Each removed SQL preset and its rewrites. A date and time preset is written with the convenience call that gives the explicit type it stored, where one does (ADR 279). */
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
  text: writtenAs(explicit('String'), 'pg/text@1'),
  int: writtenAs(explicit('Int'), 'pg/int4@1'),
  bigint: writtenAs(explicit('BigInt'), 'pg/int8@1'),
  float: writtenAs(explicit('Float'), 'pg/float8@1'),
  decimal: writtenAs(explicit('Decimal'), 'pg/numeric@1'),
  boolean: writtenAs(explicit('Boolean'), 'pg/bool@1'),
  json: writtenAs(explicit('Jsonb'), 'pg/jsonb@1'),
  bytes: writtenAs(explicit('Bytes'), 'pg/bytea@1'),
  dateTime: writtenAs(TEMPORAL_DATE_TIME, 'pg/timestamptz-temporal@1'),
  uuidNative: writtenAs(explicit('Uuid'), 'pg/uuid@1'),
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
  'id.uuidv4Native': writtenAs(explicit('Uuid'), 'pg/uuid@1', '.id().onCreate(gen.uuid())'),
  'id.uuidv7Native': writtenAs(explicit('Uuid'), 'pg/uuid@1', '.id().onCreate(gen.uuid(7))'),
  'temporal.createdAt': [
    ...writtenAs(TEMPORAL_DATE_TIME, 'pg/timestamptz-temporal@1', CREATED),
    ...writtenAs(explicit('temporal.CreatedAt'), SQLITE_DATETIME),
  ],
  'temporal.updatedAt': [
    ...writtenAs(TEMPORAL_DATE_TIME, 'pg/timestamptz-temporal@1', UPDATED),
    ...writtenAs(explicit('temporal.UpdatedAt'), SQLITE_DATETIME),
  ],
  'temporal.createdAtString': writtenAs(STRING_DATE_TIME, 'pg/timestamptz-string@1', CREATED),
  'temporal.updatedAtString': writtenAs(STRING_DATE_TIME, 'pg/timestamptz-string@1', UPDATED),
  'temporal.createdAtJsDate': writtenAs(
    explicit('TimestamptzJsDate'),
    'pg/timestamptz-date@1',
    CREATED,
  ),
  'temporal.updatedAtJsDate': writtenAs(
    explicit('TimestamptzJsDate'),
    'pg/timestamptz-date@1',
    UPDATED,
  ),
  'temporal.timestamp': withPhases(explicit('TimestampTemporal'), 'pg/timestamp-temporal@1', true),
  'temporal.timestamptz': withPhases(TEMPORAL_DATE_TIME, 'pg/timestamptz-temporal@1', true),
  'temporal.timestampString': withPhases(
    choice('DateTime', { as: 'string', storage: 'timestamp' }),
    'pg/timestamp-string@1',
    true,
  ),
  'temporal.timestamptzString': withPhases(STRING_DATE_TIME, 'pg/timestamptz-string@1', true),
  'temporal.timestamptzJsDate': withPhases(
    explicit('TimestamptzJsDate'),
    'pg/timestamptz-date@1',
    true,
  ),
  'temporal.date': withPhases(choice('Date', { as: 'temporal' }), 'pg/date-temporal@1', false),
  'temporal.dateString': withPhases(choice('Date'), 'pg/date-string@1', false),
  'temporal.time': withPhases(choice('Time', { as: 'temporal' }), 'pg/time-temporal@1', true),
  'temporal.timeString': withPhases(choice('Time'), 'pg/time-string@1', true),
  'temporal.timetz': withPhases(choice('Time', { storage: 'timetz' }), 'pg/timetz@1', true),
  'temporal.datetime': withPhases(explicit('DateTime'), SQLITE_DATETIME, false),
};

/** The codec a column of `type` is stored with in `types`, a type choice resolved with its options as a column resolves it; `undefined` when `types` has no such type or the options choose none. */
function codecIdAt(
  types: AuthoringTypeNamespace,
  path: readonly string[],
  options: Readonly<Record<string, string>> | undefined,
): string | undefined {
  const [name, ...rest] = path;
  if (name === undefined || !Object.hasOwn(types, name)) return undefined;
  const value = types[name];
  if (value === undefined) return undefined;
  if (!isAuthoringTypeDescriptor(value)) return codecIdAt(value, rest, options);
  if (rest.length > 0) return undefined;
  if (isAuthoringTypeChoiceDescriptor(value)) {
    const args = value.args.map((argument) =>
      argument.name !== undefined && options !== undefined && Object.hasOwn(options, argument.name)
        ? options[argument.name]
        : undefined,
    );
    try {
      return instantiateAuthoringTypeCall(types, name, args).codecId;
    } catch (error) {
      if (isInternalError(error) || !(error instanceof Error)) throw error;
      return undefined;
    }
  }
  return isAuthoringTypeAliasDescriptor(value) ? value.output.type.codecId : value.output.codecId;
}

function appliesTo(preset: RemovedFieldPreset, types: AuthoringTypeNamespace): boolean {
  return codecIdAt(types, preset.type.path, preset.type.options) === preset.codecId;
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
