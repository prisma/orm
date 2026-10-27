import type { AuthoringTypeNamespace } from '@internal/framework-components/authoring';
import { collectScalarTypeConstructors } from '@internal/framework-components/authoring';
import { describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../1-core/contract/test/test-support';
import { fixtureInterpreterTypes } from './fixture-codec-descriptors';
import {
  createBuiltinLikeControlMutationDefaults,
  interpretSqlContract,
  postgresScalarAuthoringTypes,
  postgresTarget,
  sqliteScalarAuthoringTypes,
  sqliteTarget,
} from './fixtures';

const char = {
  kind: 'typeConstructor',
  args: [{ kind: 'value', dataType: 'pg/int4', name: 'length' }],
  output: { codecId: 'sql/char@1', typeParams: { length: { kind: 'arg', index: 0 } } },
} as const;

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

const sqlChar = { Char: char, ...generatedIdAliases } as const;

function precisionType(codecId: string) {
  return {
    kind: 'typeConstructor',
    args: [{ kind: 'value', dataType: 'pg/int4', name: 'precision', optional: true }],
    output: { codecId, typeParams: { precision: { kind: 'arg', index: 0 } } },
  } as const;
}

function temporalAliases(codecId: string) {
  return {
    CreatedAt: { kind: 'typeAlias', output: { type: { codecId } } },
    UpdatedAt: { kind: 'typeAlias', output: { type: { codecId } } },
  } as const;
}

const postgresTypes: AuthoringTypeNamespace = {
  ...postgresScalarAuthoringTypes,
  Char: char,
  ...generatedIdAliases,
  DateString: { kind: 'typeConstructor', output: { codecId: 'pg/date-string@1' } },
  TimestampString: precisionType('pg/timestamp-string@1'),
  TimestamptzString: precisionType('pg/timestamptz-string@1'),
  TimestamptzJsDate: precisionType('pg/timestamptz-date@1'),
  TimeString: precisionType('pg/time-string@1'),
  sql: sqlChar,
  temporal: {
    ...temporalAliases('pg/timestamptz-temporal@1'),
    CreatedAtString: {
      kind: 'typeAlias',
      output: { type: { codecId: 'pg/timestamptz-string@1' } },
    },
    UpdatedAtString: {
      kind: 'typeAlias',
      output: { type: { codecId: 'pg/timestamptz-string@1' } },
    },
    CreatedAtJsDate: {
      kind: 'typeAlias',
      output: { type: { codecId: 'pg/timestamptz-date@1' } },
    },
    UpdatedAtJsDate: {
      kind: 'typeAlias',
      output: { type: { codecId: 'pg/timestamptz-date@1' } },
    },
  },
};

const sqliteTypes: AuthoringTypeNamespace = {
  ...sqliteScalarAuthoringTypes,
  sql: sqlChar,
  temporal: temporalAliases('sqlite/datetime@1'),
};

function inputFor(
  types: AuthoringTypeNamespace,
  target: typeof postgresTarget | typeof sqliteTarget,
) {
  return {
    ...fixtureInterpreterTypes,
    target,
    scalarColumnDescriptors: collectScalarTypeConstructors(types),
    authoringContributions: {
      entityTypes: {},
      pslBlockDescriptors: {},
      modelAttributes: {},
      type: types,
    },
    composedExtensionContracts: new Map(),
    createNamespace: createTestSqlNamespace,
    capabilities: {},
    controlMutationDefaults: createBuiltinLikeControlMutationDefaults(),
  } as const;
}

const postgresInput = inputFor(postgresTypes, postgresTarget);
const sqliteInput = inputFor(sqliteTypes, sqliteTarget);

function diagnosticsOf(field: string, input: typeof postgresInput | typeof sqliteInput) {
  const result = interpretSqlContract(
    `model Event {\n  id    Int @id\n  value ${field}\n}\n`,
    input,
  );
  return result.ok
    ? []
    : result.failure.diagnostics.map(({ code, message }) => ({ code, message }));
}

function removed(call: string, rewrite: string) {
  return [
    {
      code: 'PSL_UNRESOLVED_REFERENCE',
      message: `${call} was a field preset, and Prisma 8 removed field presets. ${rewrite}`,
    },
  ];
}

describe('a removed field preset in a SQL schema', () => {
  describe('on Postgres', () => {
    it.each([
      ['uuidString()', 'Write UuidString.'],
      ['ulid()', 'Write Ulid.'],
      ['nanoid()', 'Write Nanoid.'],
      ['nanoid({ size: 12 })', 'Write Char(12).'],
      ['cuid2()', 'Write Cuid2.'],
      ['ksuid()', 'Write Ksuid.'],
      ['id.uuidv4String()', 'Write UuidString @id @onCreate(uuid()).'],
      ['id.uuidv7String()', 'Write UuidString @id @onCreate(uuid(7)).'],
      ['id.ulid()', 'Write Ulid @id @onCreate(ulid()).'],
      ['id.nanoid()', 'Write Nanoid @id @onCreate(nanoid()).'],
      ['id.nanoid({ size: 16 })', 'Write Char(16) @id @onCreate(nanoid(16)).'],
      ['id.cuid2()', 'Write Cuid2 @id @onCreate(cuid(2)).'],
      ['id.ksuid()', 'Write Ksuid @id @onCreate(ksuid()).'],
      ['text()', 'Write String.'],
      ['int()', 'Write Int.'],
      ['bigint()', 'Write BigInt.'],
      ['float()', 'Write Float.'],
      ['decimal()', 'Write Decimal.'],
      ['boolean()', 'Write Boolean.'],
      ['json()', 'Write Jsonb.'],
      ['bytes()', 'Write Bytes.'],
      ['dateTime()', 'Write DateTime.'],
      ['uuidNative()', 'Write Uuid.'],
      ['id.uuidv4Native()', 'Write Uuid @id @onCreate(uuid()).'],
      ['id.uuidv7Native()', 'Write Uuid @id @onCreate(uuid(7)).'],
      ['temporal.createdAt()', 'Write temporal.CreatedAt.'],
      ['temporal.updatedAt()', 'Write temporal.UpdatedAt.'],
      ['temporal.createdAtString()', 'Write temporal.CreatedAtString.'],
      ['temporal.updatedAtString()', 'Write temporal.UpdatedAtString.'],
      ['temporal.createdAtJsDate()', 'Write temporal.CreatedAtJsDate.'],
      ['temporal.updatedAtJsDate()', 'Write temporal.UpdatedAtJsDate.'],
      [
        'temporal.timestamp(3, onCreate: now, onUpdate: now)',
        'Write TimestampTemporal(3) @onCreate(now()) @onUpdate(now()).',
      ],
      [
        'temporal.timestamp(precision: 6, onCreate: now)',
        'Write TimestampTemporal(6) @onCreate(now()).',
      ],
      [
        'temporal.timestamp(3, now, now)',
        'Write TimestampTemporal(3) @onCreate(now()) @onUpdate(now()).',
      ],
      ['temporal.timestamptz()', 'Write TimestamptzTemporal.'],
      ['temporal.timestamptz(onUpdate: now)', 'Write TimestamptzTemporal @onUpdate(now()).'],
      ['temporal.timestampString(6, onUpdate: now)', 'Write TimestampString(6) @onUpdate(now()).'],
      [
        'temporal.timestamptzString(3, onCreate: now, onUpdate: now)',
        'Write TimestamptzString(3) @onCreate(now()) @onUpdate(now()).',
      ],
      [
        'temporal.timestamptzJsDate(3, onCreate: now)',
        'Write TimestamptzJsDate(3) @onCreate(now()).',
      ],
      ['temporal.date(onCreate: now)', 'Write Date @onCreate(now()).'],
      [
        'temporal.dateString(onCreate: now, onUpdate: now)',
        'Write DateString @onCreate(now()) @onUpdate(now()).',
      ],
      ['temporal.time(3, onUpdate: now)', 'Write Time(3) @onUpdate(now()).'],
      ['temporal.time(3, onUpdate: now, now)', 'Write Time(3) @onCreate(now()) @onUpdate(now()).'],
      ['temporal.timeString(3, onCreate: now)', 'Write TimeString(3) @onCreate(now()).'],
      [
        'temporal.timetz(6, onCreate: now, onUpdate: now)',
        'Write Timetz(6) @onCreate(now()) @onUpdate(now()).',
      ],
    ])('refuses %s with its rewrite', (call, rewrite) => {
      expect(diagnosticsOf(call, postgresInput)).toEqual(removed(call, rewrite));
    });

    it.each([
      ['temporal.timestamp(onCreate: later)', 'TimestampTemporal(...)'],
      ['temporal.timestamp(onCreate: "now")', 'TimestampTemporal(...)'],
      ['temporal.timestamp(3, precision: 4)', 'TimestampTemporal(...)'],
      ['temporal.timestamp(frequency: now)', 'TimestampTemporal(...)'],
      ['temporal.timestamp(-1)', 'TimestampTemporal(...)'],
      ['temporal.time(onCreate: now, 3, now)', 'Time(...)'],
      ['temporal.date(3)', 'Date'],
    ])(
      'names the rewrite without the arguments of %s, which the preset did not take',
      (call, type) => {
        expect(diagnosticsOf(call, postgresInput)).toEqual(
          removed(
            call,
            `Write ${type} with @onCreate(now()) and @onUpdate(now()) for the phases the preset set.`,
          ),
        );
      },
    );

    it('names the nanoid rewrite for a size it cannot read', () => {
      expect(diagnosticsOf('id.nanoid({ length: 16 })', postgresInput)).toEqual(
        removed(
          'id.nanoid({ length: 16 })',
          'Write Nanoid @id @onCreate(nanoid()), or Char(n) @id @onCreate(nanoid(n)) for a size of n.',
        ),
      );
    });

    it('refuses preset keys and foreign keys of related models, with no relation error', () => {
      const result = interpretSqlContract(
        'model User {\n  id    id.ulid()\n  posts Post[]\n}\n\nmodel Post {\n  id       id.ulid()\n  authorId ulid()\n  author   User @relation(fields: [authorId], references: [id])\n}\n',
        postgresInput,
      );
      expect(
        result.ok ? [] : result.failure.diagnostics.map(({ code, message }) => ({ code, message })),
      ).toEqual([
        ...removed('id.ulid()', 'Write Ulid @id @onCreate(ulid()).'),
        ...removed('id.ulid()', 'Write Ulid @id @onCreate(ulid()).'),
        ...removed('ulid()', 'Write Ulid.'),
      ]);
    });

    it('names the sql. alias where the schema declares a model of the top-level name', () => {
      const result = interpretSqlContract(
        'model Ulid {\n  id Int @id\n}\n\nmodel Event {\n  id    Int @id\n  value id.ulid()\n}\n',
        postgresInput,
      );
      expect(
        result.ok ? [] : result.failure.diagnostics.map(({ code, message }) => ({ code, message })),
      ).toEqual(removed('id.ulid()', 'Write sql.Ulid @id @onCreate(ulid()).'));
    });

    it('keeps the binder message for a preset written without a call', () => {
      expect(diagnosticsOf('temporal.createdAt', postgresInput)).toEqual([
        { code: 'PSL_UNRESOLVED_REFERENCE', message: 'Cannot find type "temporal.createdAt"' },
      ]);
    });

    it('refuses each preset field once, keeping the field modifiers out of the call', () => {
      expect(diagnosticsOf('temporal.createdAt()?', postgresInput)).toEqual(
        removed('temporal.createdAt()', 'Write temporal.CreatedAt.'),
      );
    });

    it('keeps the binder message for a SQLite preset', () => {
      expect(diagnosticsOf('temporal.datetime(onCreate: now)', postgresInput)).toEqual([
        {
          code: 'PSL_UNRESOLVED_REFERENCE',
          message: 'Cannot find type "temporal.datetime"',
        },
      ]);
    });
  });

  describe('on SQLite', () => {
    it.each([
      ['temporal.datetime(onCreate: now)', 'Write DateTime @onCreate(now()).'],
      [
        'temporal.datetime(onCreate: now, onUpdate: now)',
        'Write DateTime @onCreate(now()) @onUpdate(now()).',
      ],
      ['temporal.createdAt()', 'Write temporal.CreatedAt.'],
      ['temporal.updatedAt()', 'Write temporal.UpdatedAt.'],
      ['id.uuidv4String()', 'Write sql.UuidString @id @onCreate(uuid()).'],
      ['id.ulid()', 'Write sql.Ulid @id @onCreate(ulid()).'],
      ['ksuid()', 'Write sql.Ksuid.'],
      ['nanoid()', 'Write sql.Nanoid.'],
      ['nanoid({ size: 12 })', 'Write sql.Char(12).'],
      [
        'id.nanoid({ length: 16 })',
        'Write sql.Nanoid @id @onCreate(nanoid()), or sql.Char(n) @id @onCreate(nanoid(n)) for a size of n.',
      ],
    ])('refuses %s with its rewrite', (call, rewrite) => {
      expect(diagnosticsOf(call, sqliteInput)).toEqual(removed(call, rewrite));
    });

    it.each([
      ['Ulid', 'Cannot find type "Ulid". Did you mean sql.Ulid?'],
      ['Ulid?', 'Cannot find type "Ulid". Did you mean sql.Ulid?'],
      ['Nope', 'Cannot find type "Nope"'],
      ['sql.Nope', 'Cannot find type "sql.Nope"'],
    ])('names the namespaced type of the same name for %s', (field, message) => {
      expect(diagnosticsOf(field, sqliteInput)).toEqual([
        { code: 'PSL_UNRESOLVED_REFERENCE', message },
      ]);
    });

    it('names every namespaced type of the same name, sorted', () => {
      const input = inputFor(
        { ...sqliteScalarAuthoringTypes, zz: { Ulid: charAlias(26) }, sql: sqlChar },
        sqliteTarget,
      );
      expect(diagnosticsOf('Ulid', input)).toEqual([
        {
          code: 'PSL_UNRESOLVED_REFERENCE',
          message: 'Cannot find type "Ulid". Did you mean sql.Ulid or zz.Ulid?',
        },
      ]);
    });

    it.each([
      ['json()', 'json'],
      ['text()', 'text'],
      ['dateTime()', 'dateTime'],
      ['temporal.timestamp(3)', 'temporal.timestamp'],
      ['temporal.createdAtString()', 'temporal.createdAtString'],
    ])('keeps the binder message for %s, which was never a SQLite preset', (call, written) => {
      expect(diagnosticsOf(call, sqliteInput)).toEqual([
        { code: 'PSL_UNRESOLVED_REFERENCE', message: `Cannot find type "${written}"` },
      ]);
    });
  });
});
