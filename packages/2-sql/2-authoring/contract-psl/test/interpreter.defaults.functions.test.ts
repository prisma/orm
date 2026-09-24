import { describe, expect, it } from 'vitest';
import { symbolTableInputFromParseArgs } from './fixtures';
import { sqlStorageFromSuccessfulSqlInterpretation } from './interpret-sql-contract-storage';
import {
  builtinControlMutationDefaults,
  interpretPslDocumentToSqlContract,
} from './interpreter-defaults-support';

describe('interpretPslDocumentToSqlContract default function lowering', () => {
  it('lowers supported default functions into execution and storage contract shapes', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `model Defaults {
  id Int @id
  idCuid2 String @default(cuid(2))
  idUuidV4 String @default(uuid())
  idUuidV7 String @default(uuid(7))
  idUlid String @default(ulid())
  idNanoidDefault String @default(nanoid())
  idNanoidSized String @default(nanoid(16))
  dbExpr String @default(sql\`gen_random_uuid()\`)
  createdAt DateTime @default(now())
}`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.execution).toMatchObject({
      mutations: {
        defaults: [
          {
            ref: { namespace: 'public', table: 'Defaults', column: 'idCuid2' },
            onCreate: { kind: 'generator', id: 'cuid2' },
          },
          {
            ref: { namespace: 'public', table: 'Defaults', column: 'idNanoidDefault' },
            onCreate: { kind: 'generator', id: 'nanoid' },
          },
          {
            ref: { namespace: 'public', table: 'Defaults', column: 'idNanoidSized' },
            onCreate: { kind: 'generator', id: 'nanoid', params: { size: 16 } },
          },
          {
            ref: { namespace: 'public', table: 'Defaults', column: 'idUlid' },
            onCreate: { kind: 'generator', id: 'ulid' },
          },
          {
            ref: { namespace: 'public', table: 'Defaults', column: 'idUuidV4' },
            onCreate: { kind: 'generator', id: 'uuidv4' },
          },
          {
            ref: { namespace: 'public', table: 'Defaults', column: 'idUuidV7' },
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
                    nativeType: 'text',
                  },
                  idNanoidDefault: {
                    codecId: 'pg/text@1',
                    nativeType: 'text',
                  },
                  idNanoidSized: {
                    codecId: 'pg/text@1',
                    nativeType: 'text',
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

  it('accepts uuid() and uuid(7) defaults on bare Uuid columns, preserving native uuid storage type', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `types {
  UuidNativeId = Uuid
}

model UuidNative {
  idV4 UuidNativeId @id @default(uuid())
  idV7 UuidNativeId @default(uuid(7))
}`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.execution).toMatchObject({
      mutations: {
        defaults: expect.arrayContaining([
          {
            ref: { namespace: 'public', table: 'UuidNative', column: 'idV4' },
            onCreate: { kind: 'generator', id: 'uuidv4' },
          },
          {
            ref: { namespace: 'public', table: 'UuidNative', column: 'idV7' },
            onCreate: { kind: 'generator', id: 'uuidv7' },
          },
        ]),
      },
    });

    const storage = sqlStorageFromSuccessfulSqlInterpretation(result.value);
    const uuidNativeTable = storage.namespaces['public']?.entries.table?.['UuidNative'];
    expect(uuidNativeTable?.columns['idV4']).toMatchObject({
      codecId: 'pg/uuid@1',
      nativeType: 'uuid',
    });
    expect(uuidNativeTable?.columns['idV7']).toMatchObject({
      codecId: 'pg/uuid@1',
      nativeType: 'uuid',
    });
  });

  it('accepts uuid() default on a named Uuid type field (e.g. id Uuid @id @default(uuid())), preserving native uuid storage type', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `types {
  Uuid = Uuid
}

model Profile {
  id Uuid @id @default(uuid())
  name String
}`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.execution).toMatchObject({
      mutations: {
        defaults: [
          {
            ref: { namespace: 'public', table: 'Profile', column: 'id' },
            onCreate: { kind: 'generator', id: 'uuidv4' },
          },
        ],
      },
    });

    const storage = sqlStorageFromSuccessfulSqlInterpretation(result.value);
    const profileTable = storage.namespaces['public']?.entries.table?.['Profile'];
    expect(profileTable?.columns['id']).toMatchObject({
      codecId: 'pg/uuid@1',
      nativeType: 'uuid',
    });
  });

  it('rejects non-uuid generators on bare Uuid columns with PSL_INVALID_DEFAULT_APPLICABILITY', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `types {
  UuidNativeId = Uuid
}

model UuidNativeBad {
  id UuidNativeId @id @default(nanoid())
}`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_INVALID_DEFAULT_APPLICABILITY',
          sourceId: 'schema.prisma',
          message: expect.stringContaining('nanoid'),
        }),
      ]),
    );
  });

  it('returns diagnostics for unsupported default functions and invalid arguments', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `model InvalidDefaults {
  id Int @id
  cuidValue String @default(cuid())
  badUuid String @default(uuid(5))
  badNanoid String @default(nanoid(1))
}`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_INVALID_ATTRIBUTE_SYNTAX',
          sourceId: 'schema.prisma',
        }),
      ]),
    );
  });

  it('reports dbgenerated as removed and names the tagged literal that replaces it', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `model Removed {
  id Int @id
  token String @default(dbgenerated("gen_random_uuid()"))
  bare String @default(dbgenerated())
}`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    const message =
      'Default function "dbgenerated" was removed. Write the SQL as a tagged literal: @default(sql`<expression>`). Supported functions: autoincrement(), cuid(2), nanoid(), nanoid(<2-255>), now(), ulid(), uuid(), uuid(4), uuid(7).';
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

  it('returns diagnostics for optional fields with execution defaults', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `model OptionalDefaults {
  id Int @id
  token String? @default(nanoid())
}`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.failure.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'PSL_INVALID_DEFAULT_FUNCTION_ARGUMENT',
          sourceId: 'schema.prisma',
          message: expect.stringContaining(
            'cannot be optional when using execution default "nanoid"',
          ),
        }),
      ]),
    );
  });

  it('preserves raw sql defaults for timestamp columns', () => {
    const document = symbolTableInputFromParseArgs({
      schema: `model Defaults {
  id Int @id
  touchedAt DateTime @default(sql\`clock_timestamp()\`)
}`,
      sourceId: 'schema.prisma',
    });

    const result = interpretPslDocumentToSqlContract({
      ...document,
      controlMutationDefaults: builtinControlMutationDefaults,
    });

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
});
