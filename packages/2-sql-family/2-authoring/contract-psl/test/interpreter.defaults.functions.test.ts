import { describe, expect, it } from 'vitest';
import { sqlStorageFromSuccessfulSqlInterpretation } from './interpret-sql-contract-storage';
import {
  builtinControlMutationDefaults,
  interpretPostgresSchema,
} from './interpreter-defaults-support';
import { unboundTables } from './unbound-tables';

describe('interpretPslDocumentToSqlContract default function lowering', () => {
  it('lowers generator attributes and database default functions into execution and storage contract shapes', () => {
    const result = interpretPostgresSchema(
      `model Defaults {
  id Int @id
  idCuid2 String @onCreate(cuid(2))
  idUuidV4 String @onCreate(uuid())
  idUuidV7 String @onCreate(uuid(7))
  idUlid String @onCreate(ulid())
  idNanoidDefault String @onCreate(nanoid())
  idNanoidSized String @onCreate(nanoid(16))
  dbExpr String @default(sql\`gen_random_uuid()\`)
  createdAt DateTime @default(now())
}`,
      {
        controlMutationDefaults: builtinControlMutationDefaults,
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.execution).toMatchObject({
      mutations: {
        defaults: [
          {
            ref: { namespace: 'public', entry: 'Defaults', field: 'idCuid2' },
            onCreate: { kind: 'generator', id: 'cuid2' },
          },
          {
            ref: { namespace: 'public', entry: 'Defaults', field: 'idNanoidDefault' },
            onCreate: { kind: 'generator', id: 'nanoid' },
          },
          {
            ref: { namespace: 'public', entry: 'Defaults', field: 'idNanoidSized' },
            onCreate: { kind: 'generator', id: 'nanoid', params: { size: 16 } },
          },
          {
            ref: { namespace: 'public', entry: 'Defaults', field: 'idUlid' },
            onCreate: { kind: 'generator', id: 'ulid' },
          },
          {
            ref: { namespace: 'public', entry: 'Defaults', field: 'idUuidV4' },
            onCreate: { kind: 'generator', id: 'uuidv4' },
          },
          {
            ref: { namespace: 'public', entry: 'Defaults', field: 'idUuidV7' },
            onCreate: { kind: 'generator', id: 'uuidv7' },
          },
        ],
      },
    });
    expect(result.value.storage).toMatchObject({
      namespaces: {
        public: {
          entries: {
            table: {
              Defaults: {
                columns: {
                  // Generator defaults never mutate storage: the String type
                  // position alone decides the column type (pg: text).
                  idUuidV4: {
                    codecId: 'pg/text@1',
                  },
                  idNanoidDefault: {
                    codecId: 'pg/text@1',
                  },
                  idNanoidSized: {
                    codecId: 'pg/text@1',
                  },
                  dbExpr: {
                    default: {
                      kind: 'function',
                      expression: 'gen_random_uuid()',
                    },
                  },
                  createdAt: {
                    default: {
                      kind: 'function',
                      expression: 'now()',
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
  });

  it('accepts @onCreate(uuid()) and @onCreate(uuid(7)) on Uuid columns, preserving native uuid storage type', () => {
    const result = interpretPostgresSchema(
      `types {
  UuidNativeId = Uuid
}

model UuidNative {
  idV4 UuidNativeId @id @onCreate(uuid())
  idV7 UuidNativeId @onCreate(uuid(7))
}`,
      {
        controlMutationDefaults: builtinControlMutationDefaults,
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.execution).toMatchObject({
      mutations: {
        defaults: expect.arrayContaining([
          {
            ref: { namespace: 'public', entry: 'UuidNative', field: 'idV4' },
            onCreate: { kind: 'generator', id: 'uuidv4' },
          },
          {
            ref: { namespace: 'public', entry: 'UuidNative', field: 'idV7' },
            onCreate: { kind: 'generator', id: 'uuidv7' },
          },
        ]),
      },
    });

    const storage = sqlStorageFromSuccessfulSqlInterpretation(result.value);
    const uuidNativeTable = storage.namespaces['public']?.entries.table?.['UuidNative'];
    expect(uuidNativeTable?.columns['idV4']).toMatchObject({
      codecId: 'pg/uuid@1',
    });
    expect(uuidNativeTable?.columns['idV7']).toMatchObject({
      codecId: 'pg/uuid@1',
    });
  });

  it('accepts uuid() default on a named Uuid type field (e.g. id Uuid @id @onCreate(uuid())), preserving native uuid storage type', () => {
    const result = interpretPostgresSchema(
      `types {
  Uuid = Uuid
}

model Profile {
  id Uuid @id @onCreate(uuid())
  name String
}`,
      {
        controlMutationDefaults: builtinControlMutationDefaults,
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.execution).toMatchObject({
      mutations: {
        defaults: [
          {
            ref: { namespace: 'public', entry: 'Profile', field: 'id' },
            onCreate: { kind: 'generator', id: 'uuidv4' },
          },
        ],
      },
    });

    const storage = sqlStorageFromSuccessfulSqlInterpretation(result.value);
    const profileTable = storage.namespaces['public']?.entries.table?.['Profile'];
    expect(profileTable?.columns['id']).toMatchObject({
      codecId: 'pg/uuid@1',
    });
  });

  it('rejects non-uuid generators on Uuid columns with PSL_GENERATOR_NOT_APPLICABLE', () => {
    const result = interpretPostgresSchema(
      `types {
  UuidNativeId = Uuid
}

model UuidNativeBad {
  id UuidNativeId @id @onCreate(nanoid())
}`,
      {
        controlMutationDefaults: builtinControlMutationDefaults,
      },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics.map(({ code, message }) => ({ code, message }))).toEqual([
      {
        code: 'PSL_GENERATOR_NOT_APPLICABLE',
        message:
          'Field "UuidNativeBad.id": nanoid() does not apply to codec "pg/uuid@1". Functions that apply: uuid().',
      },
    ]);
  });

  it('reports invalid generator function arguments with the diagnostics of the function', () => {
    const result = interpretPostgresSchema(
      `model InvalidDefaults {
  id Int @id
  cuidValue String @onCreate(cuid())
  badUuid String @onCreate(uuid(5))
  badNanoid String @onCreate(nanoid(1))
}`,
      {
        controlMutationDefaults: builtinControlMutationDefaults,
      },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.failure.diagnostics).toEqual([
      {
        code: 'PSL_INVALID_ATTRIBUTE_SYNTAX',
        message: 'Generator function "cuid" is missing required argument "version"',
        sourceId: 'schema.prisma',
        span: {
          start: { line: 3, column: 30, offset: 66 },
          end: { line: 3, column: 36, offset: 72 },
        },
      },
      {
        code: 'PSL_INVALID_GENERATOR_ARGUMENT',
        message: 'uuid: version must be 4 or 7, got 5',
        sourceId: 'schema.prisma',
        span: {
          start: { line: 4, column: 33, offset: 106 },
          end: { line: 4, column: 34, offset: 107 },
        },
      },
      {
        code: 'PSL_INVALID_GENERATOR_ARGUMENT',
        message: 'nanoid: size must be between 2 and 255, got 1',
        sourceId: 'schema.prisma',
        span: {
          start: { line: 5, column: 37, offset: 146 },
          end: { line: 5, column: 38, offset: 147 },
        },
      },
    ]);
  });

  it('reports dbgenerated as removed and names the tagged literal that replaces it', () => {
    const result = interpretPostgresSchema(
      `model Removed {
  id Int @id
  token String @default(dbgenerated("gen_random_uuid()"))
  bare String @default(dbgenerated())
}`,
      {
        controlMutationDefaults: builtinControlMutationDefaults,
      },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;

    const message =
      'Default function "dbgenerated" was removed. Write the SQL as a tagged literal: @default(sql`<expression>`). Supported functions: autoincrement(), now().';
    expect(
      result.failure.diagnostics.map(({ code, message, span }) => ({
        code,
        message,
        line: span?.start.line,
      })),
    ).toEqual([
      { code: 'PSL_UNKNOWN_DEFAULT_FUNCTION', message, line: 3 },
      { code: 'PSL_UNKNOWN_DEFAULT_FUNCTION', message, line: 4 },
    ]);
  });

  it('keeps a generator on an optional field', () => {
    const result = interpretPostgresSchema(
      `model OptionalDefaults {
  id Int @id
  token String? @onCreate(nanoid())
}`,
      {
        controlMutationDefaults: builtinControlMutationDefaults,
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(
      unboundTables(sqlStorageFromSuccessfulSqlInterpretation(result.value))['OptionalDefaults']
        ?.columns['token'],
    ).toEqual({ many: false, dataType: 'pg/text', codecId: 'pg/text@1', nullable: true });
    expect(result.value.execution?.mutations.defaults).toEqual([
      {
        ref: { namespace: 'public', entry: 'OptionalDefaults', field: 'token' },
        onCreate: { kind: 'generator', id: 'nanoid' },
      },
    ]);
  });

  it('preserves raw sql defaults for timestamp columns', () => {
    const result = interpretPostgresSchema(
      `model Defaults {
  id Int @id
  touchedAt DateTime @default(sql\`clock_timestamp()\`)
}`,
      {
        controlMutationDefaults: builtinControlMutationDefaults,
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.storage).toMatchObject({
      namespaces: {
        public: {
          entries: {
            table: {
              Defaults: {
                columns: {
                  touchedAt: {
                    default: {
                      kind: 'function',
                      expression: 'clock_timestamp()',
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
  });

  it.each([
    ['uuid()', 'id'],
    ['uuid(7)', 'id'],
    ['cuid(2)', 'id'],
    ['ulid()', 'id'],
    ['nanoid()', 'id'],
    ['nanoid(16)', 'id'],
  ])('refuses @default(%s), naming the @onCreate form', (call) => {
    const result = interpretPostgresSchema(
      `model Event {
  id String @id @default(${call})
}`,
      { controlMutationDefaults: builtinControlMutationDefaults },
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics.map(({ code, message }) => ({ code, message }))).toEqual([
      {
        code: 'PSL_GENERATOR_IN_DEFAULT',
        message: `Field "Event.id": ${call} is a value the client generates, and @default sets a database default only. Write @onCreate(${call}) instead.`,
      },
    ]);
  });
});
