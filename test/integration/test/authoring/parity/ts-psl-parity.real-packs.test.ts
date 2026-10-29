import postgresAdapter from '@internal/adapter-postgres/control';
import sqliteAdapter from '@internal/adapter-sqlite/control';
import pgvectorControl from '@internal/extension-pgvector/control';
import pgvectorPack from '@internal/extension-pgvector/pack';
import sqlFamilyControl from '@internal/family-sql/control';
import {
  type AuthoringTypeNamespace,
  isAuthoringTypeConstructorDescriptor,
} from '@internal/framework-components/authoring';
import { createControlStack } from '@internal/framework-components/control';
import {
  defineContract,
  field,
  model,
  nativeEnum,
  now,
  pg,
} from '@internal/postgres/contract-builder';
import { withSeedDiagnostics } from '@internal/psl-parser/interpret';
import { bindPslSchema, contractSourceContextFromControlStack } from '@internal/psl-parser/test';
import { interpretPslDocumentToSqlContract } from '@internal/sql-contract-psl';
import { sqlContextInput } from '@internal/sql-contract-psl/test';
import { defineContract as defineSqliteContract } from '@internal/sqlite/contract-builder';
import postgresControl, {
  postgresScalarAndNativeTypeConstructors,
} from '@internal/target-postgres/control';
import postgresPack from '@internal/target-postgres/pack';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import sqliteControl, {
  sqliteCreateNamespace,
  sqliteScalarTypeConstructors,
} from '@internal/target-sqlite/control';
import sqlitePack from '@internal/target-sqlite/pack';
import { describe, expect, it } from 'vitest';

const int4Column = {
  codecId: 'pg/int4@1',
} as const;

const stack = createControlStack({
  family: sqlFamilyControl,
  target: postgresControl,
  adapter: postgresAdapter,
  extensions: [pgvectorControl],
});

const sqliteStack = createControlStack({
  family: sqlFamilyControl,
  target: sqliteControl,
  adapter: sqliteAdapter,
});

function interpretWithSqlitePacks(schema: string) {
  const bound = bindPslSchema(schema, {
    sourceId: 'real-packs-parity.sqlite.prisma',
    context: contractSourceContextFromControlStack(sqliteStack),
  });
  return withSeedDiagnostics(
    interpretPslDocumentToSqlContract({
      documents: bound.documents,
      sources: bound.sources,
      symbolTable: bound.symbolTable,
      binder: bound.binder,
      ...sqlContextInput(bound.context),
      target: sqlitePack,
      createNamespace: sqliteCreateNamespace,
    }),
    bound.seedDiagnostics,
  );
}

const SAMPLE_ARGUMENTS: Readonly<Record<string, number>> = { length: 10, precision: 3, scale: 2 };

/** Every PSL type constructor of a namespace, called with no arguments and, when it takes any, with a sample value for each. */
function constructorCalls(
  constructors: AuthoringTypeNamespace,
): readonly { readonly column: string; readonly name: string; readonly args: readonly number[] }[] {
  return Object.entries(constructors).flatMap(([name, descriptor]) => {
    if (!isAuthoringTypeConstructorDescriptor(descriptor)) return [];
    const declared = descriptor.args ?? [];
    const sampled = declared.map((arg) => {
      const value = arg.name === undefined ? undefined : SAMPLE_ARGUMENTS[arg.name];
      if (value === undefined) throw new Error(`No sample argument for ${name}(${arg.name})`);
      return value;
    });
    return [
      { column: `${name.toLowerCase()}_bare`, name, args: [] },
      ...(sampled.length === 0
        ? []
        : [{ column: `${name.toLowerCase()}_args`, name, args: sampled }]),
    ];
  });
}

function pslFieldType(call: { readonly name: string; readonly args: readonly number[] }): string {
  return call.args.length === 0 ? call.name : `${call.name}(${call.args.join(', ')})`;
}

type TypeHelper = (...args: readonly number[]) => { readonly codecId: string };

function typeHelperOf(type: unknown, name: string): TypeHelper {
  const helper = (type as Record<string, unknown>)[name];
  if (typeof helper !== 'function') throw new Error(`type.${name} is missing`);
  return helper as TypeHelper;
}

function interpretWithRealPacks(schema: string) {
  const bound = bindPslSchema(schema, {
    sourceId: 'real-packs-parity.prisma',
    context: contractSourceContextFromControlStack(stack),
  });
  return withSeedDiagnostics(
    interpretPslDocumentToSqlContract({
      documents: bound.documents,
      sources: bound.sources,
      symbolTable: bound.symbolTable,
      binder: bound.binder,
      ...sqlContextInput(bound.context),
      target: postgresPack,
      composedExtensionPackRefs: [pgvectorPack],
      createNamespace: postgresCreateNamespace,
    }),
    bound.seedDiagnostics,
  );
}

describe('TS and PSL authoring parity with real packs', () => {
  it('lowers alias constants to the output of PSL type aliases', () => {
    const tsContract = defineContract(
      {
        extensions: { pgvector: pgvectorPack },
      },
      ({ type, field, model }) => {
        const ShortName = field.column(type.sql.String(35));
        const Embedding1536 = field.column(type.pgvector.Vector(1536));

        return {
          models: {
            Document: model('Document', {
              fields: {
                id: field.column(int4Column).id({ name: 'document_pkey' }),
                shortName: ShortName.unique({ name: 'document_short_name_key' }),
                embedding: Embedding1536.optional(),
              },
            }).sql({
              table: 'Document',
            }),
          },
        };
      },
    );

    const interpreted = interpretWithRealPacks(`types {
  ShortName = sql.String(length: 35)
  Embedding1536 = pgvector.Vector(1536)
}

model Document {
  id Int @id(map: "document_pkey")
  shortName ShortName @unique(map: "document_short_name_key")
  embedding Embedding1536?
}
`);

    expect(interpreted.ok).toBe(true);
    if (!interpreted.ok) return;

    expect(interpreted.value).toEqual(tsContract);
  });

  it('lowers an alias constant with generators to the output of a PSL alias with attributes', () => {
    const tsContract = defineContract(
      { extensions: { pgvector: pgvectorPack } },
      ({ type, field, model, gen }) => {
        const UpdatedAt = field
          .column(type.TimestampString(3))
          .onCreate(gen.now())
          .onUpdate(gen.now());

        return {
          models: {
            Post: model('Post', {
              fields: {
                id: field.column(type.String()).id().onCreate(gen.uuid()),
                slug: field.column(type.VarChar(64)),
                updatedAt: UpdatedAt.default(now()),
              },
            }).sql({ table: 'Post' }),
          },
        };
      },
    );

    const interpreted = interpretWithRealPacks(`types {
  Slug      = VarChar(64)
  UpdatedAt = TimestampString(3) @onCreate(now()) @onUpdate(now())
}

model Post {
  id        String    @id @onCreate(uuid())
  slug      Slug
  updatedAt UpdatedAt @default(now())
}
`);

    expect(interpreted.ok).toBe(true);
    if (!interpreted.ok) return;

    expect(interpreted.value).toEqual(tsContract);
  });

  it('lowers inline field constructor expressions to the same output as direct TS column descriptors', () => {
    const tsContract = defineContract(
      {
        extensions: { pgvector: pgvectorPack },
      },
      ({ type, field, model }) => ({
        models: {
          Document: model('Document', {
            fields: {
              id: field.column(int4Column).id({ name: 'document_pkey' }),
              shortName: field.column(type.sql.String(35)).unique({
                name: 'document_short_name_key',
              }),
              embedding: field.column(type.pgvector.Vector(1536)).optional(),
            },
          }).sql({
            table: 'Document',
          }),
        },
      }),
    );

    const interpreted = interpretWithRealPacks(`model Document {
  id Int @id(map: "document_pkey")
  shortName sql.String(length: 35) @unique(map: "document_short_name_key")
  embedding pgvector.Vector(length: 1536)?
}
`);

    expect(interpreted.ok).toBe(true);
    if (!interpreted.ok) return;

    expect(interpreted.value).toEqual(tsContract);
  });

  it('lowers a native_enum + pg.enum column to the same output in the default schema', () => {
    const AalLevel = nativeEnum('AalLevel', 'aal1', 'aal2', 'aal3').map('aal_level');

    const tsContract = defineContract({
      extensions: { pgvector: pgvectorPack },
      models: {
        Session: model('Session', {
          fields: {
            id: field.column(int4Column).id(),
            aal: field.column(pg.enum(AalLevel)).optional(),
          },
        }).sql({ table: 'Session' }),
      },
    });

    const interpreted = interpretWithRealPacks(`namespace public {
  native_enum AalLevel {
    aal1 = "aal1"
    aal2 = "aal2"
    aal3 = "aal3"
    @@map("aal_level")
  }

  model Session {
    id Int @id
    aal pg.enum(AalLevel)?
  }
}
`);

    expect(interpreted.ok).toBe(true);
    if (!interpreted.ok) return;

    expect(interpreted.value).toEqual(tsContract);
  });

  it('lowers a native_enum + pg.enum column to the same output in a named schema (auth)', () => {
    const AalLevel = nativeEnum('AalLevel', 'aal1', 'aal2', 'aal3').map('aal_level');

    const tsContract = defineContract({
      extensions: { pgvector: pgvectorPack },
      namespaces: ['auth'],
      models: {
        Session: model('Session', {
          namespace: 'auth',
          fields: {
            id: field.column(int4Column).id(),
            aal: field.column(pg.enum(AalLevel)).optional(),
          },
        }).sql({ table: 'Session' }),
      },
    });

    const interpreted = interpretWithRealPacks(`namespace auth {
  native_enum AalLevel {
    aal1 = "aal1"
    aal2 = "aal2"
    aal3 = "aal3"
    @@map("aal_level")
  }

  model Session {
    id Int @id
    aal pg.enum(AalLevel)?
  }
}
`);

    expect(interpreted.ok).toBe(true);
    if (!interpreted.ok) return;

    expect(interpreted.value).toEqual(tsContract);
  });
});

describe('type.* helpers and PSL type constructors', () => {
  it('give the same column for every Postgres constructor and the same arguments', () => {
    const calls = constructorCalls(postgresScalarAndNativeTypeConstructors);
    const tsContract = defineContract(
      { extensions: { pgvector: pgvectorPack } },
      ({ type, field, model }) => ({
        models: {
          Sample: model('Sample', {
            fields: {
              id: field.column(int4Column).id(),
              ...Object.fromEntries(
                calls.map((call) => [
                  call.column,
                  field.column(typeHelperOf(type, call.name)(...call.args)),
                ]),
              ),
            },
          }).sql({ table: 'Sample' }),
        },
      }),
    );

    const interpreted = interpretWithRealPacks(`model Sample {
  id Int @id
${calls.map((call) => `  ${call.column} ${pslFieldType(call)}`).join('\n')}
}
`);

    expect(interpreted.ok).toBe(true);
    if (!interpreted.ok) return;

    expect(interpreted.value).toEqual(tsContract);
  });

  it('give the same column for each convenience date and time type and the same arguments', () => {
    const tsContract = defineContract(
      { extensions: { pgvector: pgvectorPack } },
      ({ type, field, model }) => ({
        models: {
          Sample: model('Sample', {
            fields: {
              id: field.column(int4Column).id(),
              paid: field.column(type.DateTime()),
              settled: field.column(type.DateTime({ as: 'temporal' })),
              legacy: field.column(
                type.DateTime({ as: 'jsDate', storage: 'timestamp', precision: 6 }),
              ),
              text: field.column(type.DateTime({ as: 'string', storage: 'timestamp' })),
              ship: field.column(type.Date()),
              shipT: field.column(type.Date({ as: 'temporal' })),
              opens: field.column(type.Time({ precision: 0 })),
              local: field.column(type.Time({ as: 'string', storage: 'timetz' })),
              period: field.column(type.Duration({ precision: 3 })),
              parts: field.column(type.Duration({ as: 'parts' })),
            },
          }).sql({ table: 'Sample' }),
        },
      }),
    );

    const interpreted = interpretWithRealPacks(`model Sample {
  id      Int @id
  paid    DateTime
  settled DateTime(as: temporal)
  legacy  DateTime(jsDate, timestamp, 6)
  text    DateTime(as: string, storage: timestamp)
  ship    Date
  shipT   Date(temporal)
  opens   Time(precision: 0)
  local   Time(storage: timetz)
  period  Duration(precision: 3)
  parts   Duration(as: parts)
}
`);

    expect(interpreted.ok).toBe(true);
    if (!interpreted.ok) return;

    expect(interpreted.value).toEqual(tsContract);
  });

  it('give the same column for every SQLite constructor and the same arguments', () => {
    const calls = constructorCalls(sqliteScalarTypeConstructors);
    const tsContract = defineSqliteContract({}, ({ type, field, model }) => ({
      models: {
        Sample: model('Sample', {
          fields: {
            id: field.column(type.Int()).id(),
            ...Object.fromEntries(
              calls.map((call) => [
                call.column,
                field.column(typeHelperOf(type, call.name)(...call.args)),
              ]),
            ),
          },
        }).sql({ table: 'Sample' }),
      },
    }));

    const interpreted = interpretWithSqlitePacks(`model Sample {
  id Int @id
${calls.map((call) => `  ${call.column} ${pslFieldType(call)}`).join('\n')}
}
`);

    expect(interpreted.ok).toBe(true);
    if (!interpreted.ok) return;

    expect(interpreted.value).toEqual(tsContract);
  });
});
