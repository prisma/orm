import type { FamilyPackRef, TargetPackRef } from '@internal/framework-components/components';
import { describe, expect, it } from 'vitest';
import { testTypeLookups } from '../../../1-core/contract/test/test-type-lookups';
import { createComposedAuthoringHelpers } from '../src/composed-authoring-helpers';
import { field } from '../src/contract-dsl';
import { refusingRemovedFieldPresets } from '../src/removed-field-presets';
import { columnDescriptor } from './helpers/column-descriptor';

const GUIDE = 'The upgrade guide "Field presets are removed" lists every rewrite.';

const typeConstructor = (codecId: string) =>
  ({ kind: 'typeConstructor', output: { codecId } }) as const;

function charAlias(length: number) {
  return {
    kind: 'typeAlias',
    output: { type: { codecId: 'sql/char@1', typeParams: { length } } },
  } as const;
}

const generatedIdAliases = {
  UuidString: charAlias(36),
  Ulid: charAlias(26),
  Nanoid: charAlias(21),
  Cuid2: charAlias(24),
  Ksuid: charAlias(27),
} as const;

const postgresLike = {
  String: typeConstructor('pg/text@1'),
  Char: typeConstructor('sql/char@1'),
  ...generatedIdAliases,
  Jsonb: typeConstructor('pg/jsonb@1'),
  Uuid: typeConstructor('pg/uuid@1'),
  TimeTemporal: typeConstructor('pg/time-temporal@1'),
  TimeString: typeConstructor('pg/time-string@1'),
  TimestamptzTemporal: typeConstructor('pg/timestamptz-temporal@1'),
  TimestamptzJsDate: typeConstructor('pg/timestamptz-date@1'),
  DateTime: {
    kind: 'typeChoice',
    args: [
      {
        kind: 'option',
        name: 'as',
        values: ['date', 'temporal'],
        default: 'date',
        optional: true,
      },
    ],
    choices: [
      { when: { as: 'date' }, type: 'TimestamptzJsDate' },
      { when: { as: 'temporal' }, type: 'TimestamptzTemporal' },
    ],
  },
  Time: {
    kind: 'typeChoice',
    args: [
      {
        kind: 'option',
        name: 'as',
        values: ['string', 'temporal'],
        default: 'string',
        optional: true,
      },
      { kind: 'value', name: 'precision', dataType: 'pg/int4', optional: true },
    ],
    choices: [
      { when: { as: 'string' }, type: 'TimeString' },
      { when: { as: 'temporal' }, type: 'TimeTemporal' },
    ],
  },
  sql: { Char: typeConstructor('sql/char@1'), ...generatedIdAliases },
  temporal: {
    UpdatedAt: {
      kind: 'typeAlias',
      output: { type: { codecId: 'pg/timestamptz-date@1' } },
    },
  },
} as const;

const sqliteLike = {
  String: typeConstructor('sqlite/text@1'),
  Json: typeConstructor('sqlite/json@1'),
  DateTime: typeConstructor('sqlite/datetime@1'),
  sql: { Char: typeConstructor('sql/char@1'), ...generatedIdAliases },
} as const;

function readPath(root: object, path: string): unknown {
  return path.split('.').reduce<unknown>((value, key) => Reflect.get(Object(value), key), root);
}

function refusalOf(helpers: object, path: string) {
  try {
    readPath(helpers, path);
  } catch (error) {
    return error;
  }
  throw new Error(`reading field.${path} did not throw`);
}

const removed = (path: string, rewrite: string) => ({
  code: 'CONTRACT.FIELD_HELPER_UNKNOWN',
  message: `field.${path} was a field preset, and Prisma 8 removed field presets. Write ${rewrite}. ${GUIDE}`,
  meta: { helper: `field.${path}` },
});

const unknown = (path: string) => ({
  code: 'CONTRACT.FIELD_HELPER_UNKNOWN',
  message: `field.${path} does not exist. Prisma 8 removed field presets: declare a column as field.column(type.X(...)), add .id(), .onCreate(gen.fn()) and .onUpdate(gen.fn()) for what a preset set, or use a type alias such as field.column(type.temporal.CreatedAt()). ${GUIDE}`,
  meta: { helper: `field.${path}` },
});

describe('a read of a removed field preset from the SQL field helpers', () => {
  const postgresField = refusingRemovedFieldPresets(field, postgresLike);
  const sqliteField = refusingRemovedFieldPresets(field, sqliteLike);

  it.each([
    ['text', 'field.column(type.String())'],
    ['json', 'field.column(type.Jsonb())'],
    ['uuidString', 'field.column(type.UuidString())'],
    ['ulid', 'field.column(type.Ulid())'],
    ['cuid2', 'field.column(type.Cuid2())'],
    ['ksuid', 'field.column(type.Ksuid())'],
    [
      'nanoid',
      'field.column(type.Nanoid()), or field.column(type.Char(n)) for nanoid({ size: n })',
    ],
    ['id.uuidv4String', 'field.column(type.UuidString()).id().onCreate(gen.uuid())'],
    ['id.uuidv7String', 'field.column(type.UuidString()).id().onCreate(gen.uuid(7))'],
    ['id.ulid', 'field.column(type.Ulid()).id().onCreate(gen.ulid())'],
    [
      'id.nanoid',
      'field.column(type.Nanoid()).id().onCreate(gen.nanoid()), or field.column(type.Char(n)).id().onCreate(gen.nanoid(n)) for id.nanoid({ size: n })',
    ],
    ['id.cuid2', 'field.column(type.Cuid2()).id().onCreate(gen.cuid(2))'],
    ['id.ksuid', 'field.column(type.Ksuid()).id().onCreate(gen.ksuid())'],
    ['id.uuidv7Native', 'field.column(type.Uuid()).id().onCreate(gen.uuid(7))'],
    [
      'temporal.updatedAt',
      "field.column(type.DateTime({ as: 'temporal' })).onCreate(gen.now()).onUpdate(gen.now())",
    ],
    [
      'temporal.time',
      "field.column(type.Time({ as: 'temporal', precision: p })), with .onCreate(gen.now()) and .onUpdate(gen.now()) for the phases the preset set, and without precision: p when it set no precision",
    ],
    [
      'temporal.timeString',
      'field.column(type.Time({ precision: p })), with .onCreate(gen.now()) and .onUpdate(gen.now()) for the phases the preset set, and without precision: p when it set no precision',
    ],
    [
      'generated',
      'field.column(type.Char(n)).onCreate(gen.fn()), such as field.column(type.UuidString()).onCreate(gen.uuid()) for field.generated(uuidv4())',
    ],
  ])('names the rewrite of field.%s where the stack has its type', (path, rewrite) => {
    expect(refusalOf(postgresField, path)).toMatchObject(removed(path, rewrite));
  });

  it.each([
    ['json', 'the stack has no Jsonb'],
    ['text', 'String stores another codec'],
    ['temporal.updatedAt', 'the stack has no temporal.UpdatedAt'],
  ])('names the forms that replace presets for field.%s where %s', (path) => {
    expect(refusalOf(sqliteField, path)).toMatchObject(unknown(path));
  });

  it('names the forms that replace presets where the type choice call stores another codec, and temporal.UpdatedAt stores another codec than the preset', () => {
    const jsDateOnly = {
      ...postgresLike,
      DateTime: {
        ...postgresLike.DateTime,
        choices: [{ when: { as: 'date' }, type: 'TimestamptzJsDate' }],
      },
    } as const;
    expect(
      refusalOf(refusingRemovedFieldPresets(field, jsDateOnly), 'temporal.updatedAt'),
    ).toMatchObject(unknown('temporal.updatedAt'));
  });

  it('names the forms that replace presets where the rewrite type is a type choice that stores another codec', () => {
    expect(refusalOf(postgresField, 'temporal.datetime')).toMatchObject(
      unknown('temporal.datetime'),
    );
  });

  it.each([
    ['ulid', 'field.column(type.sql.Ulid())'],
    ['id.ulid', 'field.column(type.sql.Ulid()).id().onCreate(gen.ulid())'],
    ['id.uuidv4String', 'field.column(type.sql.UuidString()).id().onCreate(gen.uuid())'],
    [
      'id.nanoid',
      'field.column(type.sql.Nanoid()).id().onCreate(gen.nanoid()), or field.column(type.sql.Char(n)).id().onCreate(gen.nanoid(n)) for id.nanoid({ size: n })',
    ],
    [
      'generated',
      'field.column(type.sql.Char(n)).onCreate(gen.fn()), such as field.column(type.sql.UuidString()).onCreate(gen.uuid()) for field.generated(uuidv4())',
    ],
  ])(
    'names the sql. alias in the rewrite of field.%s where the stack has no top-level alias',
    (path, rewrite) => {
      expect(refusalOf(sqliteField, path)).toMatchObject(removed(path, rewrite));
    },
  );

  it('names the rewrite of a preset whose type the stack has with its codec', () => {
    expect(refusalOf(sqliteField, 'temporal.datetime')).toMatchObject(
      removed(
        'temporal.datetime',
        'field.column(type.DateTime()), with .onCreate(gen.now()) and .onUpdate(gen.now()) for the phases the preset set',
      ),
    );
  });

  it('reads every name that was never a preset as on the helpers', () => {
    expect(
      ['length', 'name', 'default', 'uuidv4String', 'colum', 'id.uuidv7', 'temporal.now'].map(
        (path) => readPath(postgresField, path),
      ),
    ).toEqual([undefined, undefined, undefined, undefined, undefined, undefined, undefined]);
  });

  it('refuses the read on the field a defineContract callback receives', () => {
    const helpers = createComposedAuthoringHelpers({
      ...testTypeLookups,
      family: {
        kind: 'family',
        id: 'sql',
        familyId: 'sql',
        version: '0.0.1',
        authoring: { type: postgresLike },
      } satisfies FamilyPackRef<'sql'>,
      target: {
        kind: 'target',
        id: 'postgres',
        familyId: 'sql',
        targetId: 'postgres',
        version: '0.0.1',
        defaultNamespaceId: 'public',
      } satisfies TargetPackRef<'sql', 'postgres'>,
    });
    expect(refusalOf(helpers.field, 'id.uuidv4String')).toMatchObject(
      removed('id.uuidv4String', 'field.column(type.UuidString()).id().onCreate(gen.uuid())'),
    );
  });

  it('keeps every helper the builder has', () => {
    expect([
      postgresField.column(columnDescriptor('pg/text@1')).build().descriptor,
      Object.keys(postgresField),
    ]).toEqual([{ codecId: 'pg/text@1' }, ['column', 'namedType']]);
  });
});
