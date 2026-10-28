import type { ContractFieldType, ExecutionMutationDefaultPhases } from '@internal/contract/types';
import type mongoFamilyPack from '@internal/family-mongo/pack';
import type sqlFamilyPack from '@internal/family-sql/pack';
import type {
  ContractFactory,
  EnumTypeHandle,
  FieldBuilder,
} from '@internal/mongo-contract-ts/contract-builder';
import { now } from '@internal/postgres/contract-builder';
import type {
  ComposedAuthoringHelpers,
  ScalarFieldBuilder,
} from '@internal/sql-contract-ts/contract-builder';
import type mongoTargetPack from '@internal/target-mongo/pack';
import type postgresPack from '@internal/target-postgres/pack';
import type sqlitePack from '@internal/target-sqlite/pack';

export type PostgresHelpers = ComposedAuthoringHelpers<
  typeof sqlFamilyPack,
  typeof postgresPack,
  undefined
>;
export type SqliteHelpers = ComposedAuthoringHelpers<
  typeof sqlFamilyPack,
  typeof sqlitePack,
  undefined
>;
export type MongoHelpers = Parameters<
  ContractFactory<
    Record<never, never>,
    Record<never, never>,
    undefined,
    typeof mongoFamilyPack,
    typeof mongoTargetPack,
    undefined
  >
>[0];

/**
 * A removed field preset and what replaces it: the PSL preset call, which PSL refuses, and the replacement in PSL and TypeScript. The field is the model's id when `id` is set, and a field beside an `Int` id otherwise. A row with no PSL preset replaces a removed TypeScript-only helper, `field.generated(...)` or an `id` preset's trailing `{ name }`.
 */
export interface PresetReplacementRow<Helpers, Field> {
  readonly model: string;
  readonly id?: true;
  readonly psl: { readonly preset?: string; readonly replacement: string };
  readonly ts: (helpers: Helpers) => Field;
}

export type SqlRow<Helpers> = PresetReplacementRow<Helpers, ScalarFieldBuilder>;
type MongoField = FieldBuilder<
  ContractFieldType,
  boolean,
  false,
  EnumTypeHandle | undefined,
  ExecutionMutationDefaultPhases | undefined
>;

export type MongoRow = PresetReplacementRow<MongoHelpers, MongoField>;

type FamilyHelpers = PostgresHelpers | SqliteHelpers;

type IdentifierAlias = 'UuidString' | 'Ulid' | 'Nanoid' | 'Cuid2' | 'Ksuid';

/** How a target writes fixed-length text and the identifier type aliases: `char` and `alias` in PSL, `charType` and `aliasType` in TypeScript. */
interface IdentifierColumns<Helpers> {
  readonly char: (length: number) => string;
  readonly charType: (helpers: Helpers, length: number) => ScalarFieldBuilder;
  readonly alias: (name: IdentifierAlias) => string;
  readonly aliasType: (helpers: Helpers, name: IdentifierAlias) => ScalarFieldBuilder;
}

/** The SQL family's presets, each replaced by its identifier alias, or by fixed-length text for a nanoid of another size. */
function familyRows<Helpers extends FamilyHelpers>({
  char,
  charType,
  alias,
  aliasType,
}: IdentifierColumns<Helpers>): readonly SqlRow<Helpers>[] {
  return [
    {
      model: 'UuidStringColumn',
      psl: { preset: 'uuidString()', replacement: alias('UuidString') },
      ts: (h) => aliasType(h, 'UuidString'),
    },
    {
      model: 'UlidColumn',
      psl: { preset: 'ulid()', replacement: alias('Ulid') },
      ts: (h) => aliasType(h, 'Ulid'),
    },
    {
      model: 'NanoidColumn',
      psl: { preset: 'nanoid()', replacement: alias('Nanoid') },
      ts: (h) => aliasType(h, 'Nanoid'),
    },
    {
      model: 'NanoidSized',
      psl: { preset: 'nanoid({ size: 12 })', replacement: char(12) },
      ts: (h) => charType(h, 12),
    },
    {
      model: 'Cuid2Column',
      psl: { preset: 'cuid2()', replacement: alias('Cuid2') },
      ts: (h) => aliasType(h, 'Cuid2'),
    },
    {
      model: 'KsuidColumn',
      psl: { preset: 'ksuid()', replacement: alias('Ksuid') },
      ts: (h) => aliasType(h, 'Ksuid'),
    },
    {
      model: 'IdUuidv4String',
      id: true,
      psl: {
        preset: 'id.uuidv4String()',
        replacement: `${alias('UuidString')} @id @onCreate(uuid())`,
      },
      ts: (h) => aliasType(h, 'UuidString').id().onCreate(h.gen.uuid()),
    },
    {
      model: 'IdUuidv7String',
      id: true,
      psl: {
        preset: 'id.uuidv7String()',
        replacement: `${alias('UuidString')} @id @onCreate(uuid(7))`,
      },
      ts: (h) => aliasType(h, 'UuidString').id().onCreate(h.gen.uuid(7)),
    },
    {
      model: 'IdUlid',
      id: true,
      psl: { preset: 'id.ulid()', replacement: `${alias('Ulid')} @id @onCreate(ulid())` },
      ts: (h) => aliasType(h, 'Ulid').id().onCreate(h.gen.ulid()),
    },
    {
      model: 'IdNanoid',
      id: true,
      psl: { preset: 'id.nanoid()', replacement: `${alias('Nanoid')} @id @onCreate(nanoid())` },
      ts: (h) => aliasType(h, 'Nanoid').id().onCreate(h.gen.nanoid()),
    },
    {
      model: 'IdNanoidSized',
      id: true,
      psl: {
        preset: 'id.nanoid({ size: 16 })',
        replacement: `${char(16)} @id @onCreate(nanoid(16))`,
      },
      ts: (h) => charType(h, 16).id().onCreate(h.gen.nanoid(16)),
    },
    {
      model: 'IdCuid2',
      id: true,
      psl: { preset: 'id.cuid2()', replacement: `${alias('Cuid2')} @id @onCreate(cuid(2))` },
      ts: (h) => aliasType(h, 'Cuid2').id().onCreate(h.gen.cuid(2)),
    },
    {
      model: 'IdKsuid',
      id: true,
      psl: { preset: 'id.ksuid()', replacement: `${alias('Ksuid')} @id @onCreate(ksuid())` },
      ts: (h) => aliasType(h, 'Ksuid').id().onCreate(h.gen.ksuid()),
    },
  ];
}

/** The replacements of `field.generated(...)`, which only the SQL TypeScript builder had. */
function generatedRows<Helpers extends FamilyHelpers>({
  char,
  charType,
  alias,
  aliasType,
}: IdentifierColumns<Helpers>): readonly SqlRow<Helpers>[] {
  return [
    {
      model: 'GeneratedUuidv4',
      psl: { replacement: `${alias('UuidString')} @onCreate(uuid())` },
      ts: (h) => aliasType(h, 'UuidString').onCreate(h.gen.uuid()),
    },
    {
      model: 'GeneratedUuidv7',
      psl: { replacement: `${alias('UuidString')} @onCreate(uuid(7))` },
      ts: (h) => aliasType(h, 'UuidString').onCreate(h.gen.uuid(7)),
    },
    {
      model: 'GeneratedUlid',
      psl: { replacement: `${alias('Ulid')} @onCreate(ulid())` },
      ts: (h) => aliasType(h, 'Ulid').onCreate(h.gen.ulid()),
    },
    {
      model: 'GeneratedNanoid',
      psl: { replacement: `${alias('Nanoid')} @onCreate(nanoid())` },
      ts: (h) => aliasType(h, 'Nanoid').onCreate(h.gen.nanoid()),
    },
    {
      model: 'GeneratedNanoidSized',
      psl: { replacement: `${char(16)} @onCreate(nanoid(16))` },
      ts: (h) => charType(h, 16).onCreate(h.gen.nanoid(16)),
    },
    {
      model: 'GeneratedCuid2',
      psl: { replacement: `${alias('Cuid2')} @onCreate(cuid(2))` },
      ts: (h) => aliasType(h, 'Cuid2').onCreate(h.gen.cuid(2)),
    },
    {
      model: 'GeneratedKsuid',
      psl: { replacement: `${alias('Ksuid')} @onCreate(ksuid())` },
      ts: (h) => aliasType(h, 'Ksuid').onCreate(h.gen.ksuid()),
    },
    {
      model: 'GeneratedUuidv4Id',
      id: true,
      psl: { replacement: `${alias('UuidString')} @id @onCreate(uuid())` },
      ts: (h) => aliasType(h, 'UuidString').id().onCreate(h.gen.uuid()),
    },
  ];
}

const postgresIdentifierColumns: IdentifierColumns<PostgresHelpers> = {
  char: (length) => `Char(${length})`,
  charType: ({ field, type }, length) => field.column(type.Char(length)),
  alias: (name) => name,
  aliasType: ({ field, type }, name) => field.column(type[name]()),
};

const sqliteIdentifierColumns: IdentifierColumns<SqliteHelpers> = {
  char: (length) => `sql.Char(${length})`,
  charType: ({ field, type }, length) => field.column(type.sql.Char(length)),
  alias: (name) => `sql.${name}`,
  aliasType: ({ field, type }, name) => field.column(type.sql[name]()),
};

export const postgresRows: readonly SqlRow<PostgresHelpers>[] = [
  ...familyRows(postgresIdentifierColumns),
  ...generatedRows(postgresIdentifierColumns),
  {
    model: 'Text',
    psl: { preset: 'text()', replacement: 'String' },
    ts: ({ field, type }) => field.column(type.String()),
  },
  {
    model: 'Int4',
    psl: { preset: 'int()', replacement: 'Int' },
    ts: ({ field, type }) => field.column(type.Int()),
  },
  {
    model: 'Int8',
    psl: { preset: 'bigint()', replacement: 'BigInt' },
    ts: ({ field, type }) => field.column(type.BigInt()),
  },
  {
    model: 'Float8',
    psl: { preset: 'float()', replacement: 'Float' },
    ts: ({ field, type }) => field.column(type.Float()),
  },
  {
    model: 'NumericColumn',
    psl: { preset: 'decimal()', replacement: 'Decimal' },
    ts: ({ field, type }) => field.column(type.Decimal()),
  },
  {
    model: 'Bool',
    psl: { preset: 'boolean()', replacement: 'Boolean' },
    ts: ({ field, type }) => field.column(type.Boolean()),
  },
  {
    model: 'JsonbColumn',
    psl: { preset: 'json()', replacement: 'Jsonb' },
    ts: ({ field, type }) => field.column(type.Jsonb()),
  },
  {
    model: 'Bytea',
    psl: { preset: 'bytes()', replacement: 'Bytes' },
    ts: ({ field, type }) => field.column(type.Bytes()),
  },
  {
    model: 'DateTimeColumn',
    psl: { preset: 'dateTime()', replacement: 'DateTime' },
    ts: ({ field, type }) => field.column(type.DateTime()),
  },
  {
    model: 'UuidNative',
    psl: { preset: 'uuidNative()', replacement: 'Uuid' },
    ts: ({ field, type }) => field.column(type.Uuid()),
  },
  {
    model: 'IdUuidv4Native',
    id: true,
    psl: { preset: 'id.uuidv4Native()', replacement: 'Uuid @id @onCreate(uuid())' },
    ts: ({ field, type, gen }) => field.column(type.Uuid()).id().onCreate(gen.uuid()),
  },
  {
    model: 'IdUuidv7Native',
    id: true,
    psl: { preset: 'id.uuidv7Native()', replacement: 'Uuid @id @onCreate(uuid(7))' },
    ts: ({ field, type, gen }) => field.column(type.Uuid()).id().onCreate(gen.uuid(7)),
  },
  {
    model: 'CreatedAt',
    psl: { preset: 'temporal.createdAt()', replacement: 'temporal.CreatedAt' },
    ts: ({ field, type }) => field.column(type.temporal.CreatedAt()),
  },
  {
    model: 'UpdatedAt',
    psl: { preset: 'temporal.updatedAt()', replacement: 'temporal.UpdatedAt' },
    ts: ({ field, type }) => field.column(type.temporal.UpdatedAt()),
  },
  {
    model: 'CreatedAtString',
    psl: { preset: 'temporal.createdAtString()', replacement: 'temporal.CreatedAtString' },
    ts: ({ field, type }) => field.column(type.temporal.CreatedAtString()),
  },
  {
    model: 'UpdatedAtString',
    psl: { preset: 'temporal.updatedAtString()', replacement: 'temporal.UpdatedAtString' },
    ts: ({ field, type }) => field.column(type.temporal.UpdatedAtString()),
  },
  {
    model: 'CreatedAtJsDate',
    psl: { preset: 'temporal.createdAtJsDate()', replacement: 'temporal.CreatedAtJsDate' },
    ts: ({ field, type }) => field.column(type.temporal.CreatedAtJsDate()),
  },
  {
    model: 'UpdatedAtJsDate',
    psl: { preset: 'temporal.updatedAtJsDate()', replacement: 'temporal.UpdatedAtJsDate' },
    ts: ({ field, type }) => field.column(type.temporal.UpdatedAtJsDate()),
  },
  {
    model: 'TimestampBothPhases',
    psl: {
      preset: 'temporal.timestamp(3, onCreate: now, onUpdate: now)',
      replacement: 'TimestampTemporal(3) @onCreate(now()) @onUpdate(now())',
    },
    ts: ({ field, type, gen }) =>
      field.column(type.TimestampTemporal(3)).onCreate(gen.now()).onUpdate(gen.now()),
  },
  {
    model: 'TimestampNamedPrecision',
    psl: {
      preset: 'temporal.timestamp(precision: 6, onCreate: now)',
      replacement: 'TimestampTemporal(6) @onCreate(now())',
    },
    ts: ({ field, type, gen }) => field.column(type.TimestampTemporal(6)).onCreate(gen.now()),
  },
  {
    model: 'TimestampBare',
    psl: { preset: 'temporal.timestamp()', replacement: 'TimestampTemporal' },
    ts: ({ field, type }) => field.column(type.TimestampTemporal()),
  },
  {
    model: 'TimestamptzOnCreate',
    psl: {
      preset: 'temporal.timestamptz(onCreate: now)',
      replacement: 'TimestamptzTemporal @onCreate(now())',
    },
    ts: ({ field, type, gen }) => field.column(type.TimestamptzTemporal()).onCreate(gen.now()),
  },
  {
    model: 'TimestamptzBare',
    psl: { preset: 'temporal.timestamptz()', replacement: 'TimestamptzTemporal' },
    ts: ({ field, type }) => field.column(type.TimestamptzTemporal()),
  },
  {
    model: 'TimestampStringOnUpdate',
    psl: {
      preset: 'temporal.timestampString(6, onUpdate: now)',
      replacement: 'TimestampString(6) @onUpdate(now())',
    },
    ts: ({ field, type, gen }) => field.column(type.TimestampString(6)).onUpdate(gen.now()),
  },
  {
    model: 'TimestamptzStringBothPhases',
    psl: {
      preset: 'temporal.timestamptzString(3, onCreate: now, onUpdate: now)',
      replacement: 'TimestamptzString(3) @onCreate(now()) @onUpdate(now())',
    },
    ts: ({ field, type, gen }) =>
      field.column(type.TimestamptzString(3)).onCreate(gen.now()).onUpdate(gen.now()),
  },
  {
    model: 'TimestamptzJsDateOnCreate',
    psl: {
      preset: 'temporal.timestamptzJsDate(3, onCreate: now)',
      replacement: 'TimestamptzJsDate(3) @onCreate(now())',
    },
    ts: ({ field, type, gen }) => field.column(type.TimestamptzJsDate(3)).onCreate(gen.now()),
  },
  {
    model: 'DateColumn',
    psl: { preset: 'temporal.date(onCreate: now)', replacement: 'Date @onCreate(now())' },
    ts: ({ field, type, gen }) => field.column(type.Date()).onCreate(gen.now()),
  },
  {
    model: 'DateStringBothPhases',
    psl: {
      preset: 'temporal.dateString(onCreate: now, onUpdate: now)',
      replacement: 'DateString @onCreate(now()) @onUpdate(now())',
    },
    ts: ({ field, type, gen }) =>
      field.column(type.DateString()).onCreate(gen.now()).onUpdate(gen.now()),
  },
  {
    model: 'TimeOnUpdate',
    psl: { preset: 'temporal.time(3, onUpdate: now)', replacement: 'Time(3) @onUpdate(now())' },
    ts: ({ field, type, gen }) => field.column(type.Time(3)).onUpdate(gen.now()),
  },
  {
    model: 'TimeWithoutPrecision',
    psl: { preset: 'temporal.time(onCreate: now)', replacement: 'Time @onCreate(now())' },
    ts: ({ field, type, gen }) => field.column(type.Time()).onCreate(gen.now()),
  },
  {
    model: 'TimeStringOnCreate',
    psl: {
      preset: 'temporal.timeString(3, onCreate: now)',
      replacement: 'TimeString(3) @onCreate(now())',
    },
    ts: ({ field, type, gen }) => field.column(type.TimeString(3)).onCreate(gen.now()),
  },
  {
    model: 'TimetzBothPhases',
    psl: {
      preset: 'temporal.timetz(6, onCreate: now, onUpdate: now)',
      replacement: 'Timetz(6) @onCreate(now()) @onUpdate(now())',
    },
    ts: ({ field, type, gen }) =>
      field.column(type.Timetz(6)).onCreate(gen.now()).onUpdate(gen.now()),
  },
  {
    model: 'OptionalCreatedAt',
    psl: { preset: 'temporal.createdAt()?', replacement: 'temporal.CreatedAt?' },
    ts: ({ field, type }) => field.column(type.temporal.CreatedAt()).optional(),
  },
  {
    model: 'MappedUpdatedAt',
    psl: {
      preset: 'temporal.updatedAt() @map("updated_at")',
      replacement: 'temporal.UpdatedAt @map("updated_at")',
    },
    ts: ({ field, type }) => field.column(type.temporal.UpdatedAt()).column('updated_at'),
  },
  {
    model: 'UpdateOnlyWithOnCreate',
    psl: {
      preset: 'temporal.timestamptz(onUpdate: now) @onCreate(now())',
      replacement: 'TimestamptzTemporal @onCreate(now()) @onUpdate(now())',
    },
    ts: ({ field, type, gen }) =>
      field.column(type.TimestamptzTemporal()).onCreate(gen.now()).onUpdate(gen.now()),
  },
  {
    model: 'UpdateOnlyWithDefault',
    psl: {
      preset: 'temporal.timestamptz(onUpdate: now) @default(now())',
      replacement: 'TimestamptzTemporal @onUpdate(now()) @default(now())',
    },
    ts: ({ field, type, gen }) =>
      field.column(type.TimestamptzTemporal()).onUpdate(gen.now()).default(now()),
  },
  {
    model: 'IdUuidv4StringNamed',
    id: true,
    psl: { replacement: 'UuidString @id(map: "IdUuidv4StringNamed_pk") @onCreate(uuid())' },
    ts: ({ field, type, gen }) =>
      field.column(type.UuidString()).id({ name: 'IdUuidv4StringNamed_pk' }).onCreate(gen.uuid()),
  },
];

export const sqliteRows: readonly SqlRow<SqliteHelpers>[] = [
  ...familyRows(sqliteIdentifierColumns),
  ...generatedRows(sqliteIdentifierColumns),
  {
    model: 'CreatedAt',
    psl: { preset: 'temporal.createdAt()', replacement: 'temporal.CreatedAt' },
    ts: ({ field, type }) => field.column(type.temporal.CreatedAt()),
  },
  {
    model: 'UpdatedAt',
    psl: { preset: 'temporal.updatedAt()', replacement: 'temporal.UpdatedAt' },
    ts: ({ field, type }) => field.column(type.temporal.UpdatedAt()),
  },
  {
    model: 'DatetimeBothPhases',
    psl: {
      preset: 'temporal.datetime(onCreate: now, onUpdate: now)',
      replacement: 'DateTime @onCreate(now()) @onUpdate(now())',
    },
    ts: ({ field, type, gen }) =>
      field.column(type.DateTime()).onCreate(gen.now()).onUpdate(gen.now()),
  },
  {
    model: 'DatetimeOnCreate',
    psl: { preset: 'temporal.datetime(onCreate: now)', replacement: 'DateTime @onCreate(now())' },
    ts: ({ field, type, gen }) => field.column(type.DateTime()).onCreate(gen.now()),
  },
];

export const mongoRows: readonly MongoRow[] = [
  {
    model: 'CreatedAt',
    psl: { preset: 'temporal.createdAt()', replacement: 'temporal.CreatedAt' },
    ts: ({ field, gen }) => field.date().onCreate(gen.now()),
  },
  {
    model: 'UpdatedAt',
    psl: { preset: 'temporal.updatedAt()', replacement: 'temporal.UpdatedAt' },
    ts: ({ field, gen }) => field.date().onCreate(gen.now()).onUpdate(gen.now()),
  },
  {
    model: 'TimestampBothPhases',
    psl: {
      preset: 'temporal.timestamp(onCreate: now, onUpdate: now)',
      replacement: 'Date @onCreate(now()) @onUpdate(now())',
    },
    ts: ({ field, gen }) => field.date().onCreate(gen.now()).onUpdate(gen.now()),
  },
  {
    model: 'TimestampOnUpdate',
    psl: { preset: 'temporal.timestamp(onUpdate: now)', replacement: 'Date @onUpdate(now())' },
    ts: ({ field, gen }) => field.date().onUpdate(gen.now()),
  },
];
