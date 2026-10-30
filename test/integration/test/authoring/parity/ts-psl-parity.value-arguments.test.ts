import {
  int4Column,
  numericColumn,
  rawColumn as postgresRawColumn,
  varcharColumn,
} from '@internal/adapter-postgres/column-types';
import postgresAdapter from '@internal/adapter-postgres/control';
import { rawColumn as sqliteRawColumn } from '@internal/adapter-sqlite/column-types';
import sqliteAdapter from '@internal/adapter-sqlite/control';
import pgvectorControl from '@internal/extension-pgvector/control';
import pgvectorPack from '@internal/extension-pgvector/pack';
import postgisControl from '@internal/extension-postgis/control';
import postgisPack from '@internal/extension-postgis/pack';
import sqlFamilyControl from '@internal/family-sql/control';
import { createControlStack } from '@internal/framework-components/control';
import { defineContract as definePostgresContract } from '@internal/postgres/contract-builder';
import { withSeedDiagnostics } from '@internal/psl-parser/interpret';
import { bindPslSchema, contractSourceContextFromControlStack } from '@internal/psl-parser/test';
import { sql } from '@internal/sql-contract/sql-expression';
import { interpretPslDocumentToSqlContract } from '@internal/sql-contract-psl';
import { sqlContextInput } from '@internal/sql-contract-psl/test';
import { defineContract as defineSqliteContract } from '@internal/sqlite/contract-builder';
import postgresControl from '@internal/target-postgres/control';
import postgresPack from '@internal/target-postgres/pack';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import sqliteControl from '@internal/target-sqlite/control';
import sqlitePack from '@internal/target-sqlite/pack';
import { sqliteCreateNamespace } from '@internal/target-sqlite/types';
import { describe, expect, it } from 'vitest';

const postgresStack = createControlStack({
  family: sqlFamilyControl,
  target: postgresControl,
  adapter: postgresAdapter,
});

const postgresExtensionsStack = createControlStack({
  family: sqlFamilyControl,
  target: postgresControl,
  adapter: postgresAdapter,
  extensions: [pgvectorControl, postgisControl],
});

const sqliteStack = createControlStack({
  family: sqlFamilyControl,
  target: sqliteControl,
  adapter: sqliteAdapter,
});

function interpretPostgres(schema: string) {
  const bound = bindPslSchema(schema, {
    sourceId: 'value-arguments.prisma',
    context: contractSourceContextFromControlStack(postgresStack),
  });
  return withSeedDiagnostics(
    interpretPslDocumentToSqlContract({
      documents: bound.documents,
      sources: bound.sources,
      symbolTable: bound.symbolTable,
      binder: bound.binder,
      ...sqlContextInput(bound.context),
      target: postgresPack,
      createNamespace: postgresCreateNamespace,
    }),
    bound.seedDiagnostics,
  );
}

function interpretPostgresWithExtensions(schema: string) {
  const bound = bindPslSchema(schema, {
    sourceId: 'value-arguments.prisma',
    context: contractSourceContextFromControlStack(postgresExtensionsStack),
  });
  return withSeedDiagnostics(
    interpretPslDocumentToSqlContract({
      documents: bound.documents,
      sources: bound.sources,
      symbolTable: bound.symbolTable,
      binder: bound.binder,
      ...sqlContextInput(bound.context),
      target: postgresPack,
      composedExtensionPackRefs: [pgvectorPack, postgisPack],
      createNamespace: postgresCreateNamespace,
    }),
    bound.seedDiagnostics,
  );
}

function interpretSqlite(schema: string) {
  const bound = bindPslSchema(schema, {
    sourceId: 'value-arguments.prisma',
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

function thrownMessage(build: () => unknown): string | undefined {
  try {
    build();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return undefined;
}

describe('type-constructor value arguments give the same contract from PSL and TypeScript', () => {
  it('on Postgres: sql.String and Raw through TypeScript helpers that read value arguments, and VarChar and Numeric, which TypeScript writes with fixed column helpers', () => {
    const tsContract = definePostgresContract({}, ({ field, model, type }) => ({
      models: {
        Account: model('Account', {
          fields: {
            id: field.column(int4Column).id(),
            name: field.column(varcharColumn(255)),
            price: field.column(numericColumn(10, 2)),
            label: field.column(type.sql.String(50)),
            kind: field.column(type.Raw(sql`"MyType"[]`)).optional(),
            shape: field.column(postgresRawColumn(sql`"MyType"[]`)).optional(),
          },
        }),
      },
    }));

    const interpreted = interpretPostgres(`model Account {
  id    Int @id
  name  VarChar(255)
  price Numeric(10, 2)
  label sql.String(50)
  kind  Raw(sql\`"MyType"[]\`)?
  shape Raw(sql\`"MyType"[]\`)?
}
`);

    if (!interpreted.ok) throw new Error(JSON.stringify(interpreted.failure.diagnostics));
    expect(interpreted.value).toEqual(tsContract);
  });

  it('on Postgres with extensions: pgvector.Vector and postgis.Geometry, through TypeScript helpers that read value arguments', () => {
    const tsContract = definePostgresContract(
      { extensions: { pgvector: pgvectorPack, postgis: postgisPack } },
      ({ field, model, type }) => ({
        models: {
          Place: model('Place', {
            fields: {
              id: field.column(int4Column).id(),
              embedding: field.column(type.pgvector.Vector(1536)),
              location: field.column(type.postgis.Geometry(4326)),
            },
          }),
        },
      }),
    );

    const interpreted = interpretPostgresWithExtensions(`model Place {
  id        Int @id
  embedding pgvector.Vector(1536)
  location  postgis.Geometry(4326)
}
`);

    if (!interpreted.ok) throw new Error(JSON.stringify(interpreted.failure.diagnostics));
    expect(interpreted.value).toEqual(tsContract);
  });

  it('on SQLite: sql.String and Raw', () => {
    const tsContract = defineSqliteContract({}, ({ field, model, type }) => ({
      models: {
        Account: model('Account', {
          fields: {
            id: field.column({ codecId: 'sqlite/integer@1' }).id(),
            label: field.column(type.sql.String(50)),
            kind: field.column(type.Raw(sql`"MyType"[]`)).optional(),
            shape: field.column(sqliteRawColumn(sql`"MyType"[]`)).optional(),
          },
        }),
      },
    }));

    const interpreted = interpretSqlite(`model Account {
  id    Int @id
  label sql.String(50)
  kind  Raw(sql\`"MyType"[]\`)?
  shape Raw(sql\`"MyType"[]\`)?
}
`);

    if (!interpreted.ok) throw new Error(JSON.stringify(interpreted.failure.diagnostics));
    expect(interpreted.value).toEqual(tsContract);
  });
});

describe('a value its argument’s data type cannot hold is refused with the same message', () => {
  it('on Postgres, from PSL VarChar(3000000000) and TypeScript type.sql.String(3000000000)', () => {
    const interpreted = interpretPostgres(`model Account {
  id   Int @id
  name VarChar(3000000000)
}
`);
    const pslMessages = interpreted.ok
      ? []
      : interpreted.failure.diagnostics.map(({ message }) => message);
    const tsMessage = thrownMessage(() =>
      definePostgresContract({}, ({ field, model, type }) => ({
        models: {
          Account: model('Account', {
            fields: {
              id: field.column(int4Column).id(),
              name: field.column(type.sql.String(3000000000)),
            },
          }),
        },
      })),
    );

    expect(pslMessages).toHaveLength(1);
    expect(tsMessage).toBe(`Argument "length" of sql.String: ${pslMessages[0]}`);
  });
});
