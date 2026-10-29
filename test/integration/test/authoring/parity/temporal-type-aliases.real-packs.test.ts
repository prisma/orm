import postgresAdapter from '@internal/adapter-postgres/control';
import sqliteAdapter from '@internal/adapter-sqlite/control';
import sqlFamilyControl from '@internal/family-sql/control';
import { createControlStack } from '@internal/framework-components/control';
import { defineContract } from '@internal/postgres/contract-builder';
import { withSeedDiagnostics } from '@internal/psl-parser/interpret';
import { bindPslSchema, contractSourceContextFromControlStack } from '@internal/psl-parser/test';
import { interpretPslDocumentToSqlContract } from '@internal/sql-contract-psl';
import { sqlContextInput } from '@internal/sql-contract-psl/test';
import { defineContract as defineSqliteContract } from '@internal/sqlite/contract-builder';
import postgresControl from '@internal/target-postgres/control';
import postgresPack from '@internal/target-postgres/pack';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import sqliteControl, { sqliteCreateNamespace } from '@internal/target-sqlite/control';
import sqlitePack from '@internal/target-sqlite/pack';
import { describe, expect, it } from 'vitest';

const postgresStack = createControlStack({
  family: sqlFamilyControl,
  target: postgresControl,
  adapter: postgresAdapter,
});

const sqliteStack = createControlStack({
  family: sqlFamilyControl,
  target: sqliteControl,
  adapter: sqliteAdapter,
});

function interpretPostgres(schema: string) {
  const bound = bindPslSchema(schema, {
    sourceId: 'temporal-type-aliases.prisma',
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

function interpretSqlite(schema: string) {
  const bound = bindPslSchema(schema, {
    sourceId: 'temporal-type-aliases.sqlite.prisma',
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

function succeeded<T>(
  result: { readonly ok: true; readonly value: T } | { readonly ok: false },
): T {
  if (!result.ok) throw new Error(`expected the schema to interpret: ${JSON.stringify(result)}`);
  return result.value;
}

describe('the temporal type aliases with real packs', () => {
  it('store on Postgres exactly what DateTime with the matching generators stores', () => {
    const throughAliases = succeeded(
      interpretPostgres(`model Event {
  id        Int                @id
  createdAt temporal.CreatedAt
  updatedAt temporal.UpdatedAt
}
`),
    );
    const throughAttributes = succeeded(
      interpretPostgres(`model Event {
  id        Int      @id
  createdAt DateTime @onCreate(now())
  updatedAt DateTime @onCreate(now()) @onUpdate(now())
}
`),
    );
    expect(throughAliases).toEqual(throughAttributes);
    expect(throughAliases.execution?.mutations.defaults).toHaveLength(2);
  });

  it('store on SQLite exactly what the matching generator attributes store', () => {
    const throughAliases = succeeded(
      interpretSqlite(`model Event {
  id        Int                @id
  createdAt temporal.CreatedAt
  updatedAt temporal.UpdatedAt
}
`),
    );
    const throughAttributes = succeeded(
      interpretSqlite(`model Event {
  id        Int      @id
  createdAt DateTime @onCreate(now())
  updatedAt DateTime @onCreate(now()) @onUpdate(now())
}
`),
    );
    expect(throughAliases).toEqual(throughAttributes);
    expect(throughAliases.execution?.mutations.defaults).toHaveLength(2);
  });

  it('give the TypeScript builder on Postgres what DateTime with the matching generators gives it', () => {
    const throughAliases = defineContract({}, ({ type, field, model }) => ({
      models: {
        Event: model('Event', {
          fields: {
            id: field.column(type.Int()).id(),
            createdAt: field.column(type.temporal.CreatedAt()),
            updatedAt: field.column(type.temporal.UpdatedAt()),
          },
        }).sql({ table: 'Event' }),
      },
    }));
    const throughGenerators = defineContract({}, ({ type, field, model, gen }) => ({
      models: {
        Event: model('Event', {
          fields: {
            id: field.column(type.Int()).id(),
            createdAt: field.column(type.DateTime()).onCreate(gen.now()),
            updatedAt: field.column(type.DateTime()).onCreate(gen.now()).onUpdate(gen.now()),
          },
        }).sql({ table: 'Event' }),
      },
    }));
    expect(throughAliases).toEqual(throughGenerators);
    expect(throughAliases).toEqual(
      succeeded(
        interpretPostgres(`model Event {
  id        Int                @id
  createdAt temporal.CreatedAt
  updatedAt temporal.UpdatedAt
}
`),
      ),
    );
  });

  it('give the TypeScript builder on SQLite what they give PSL', () => {
    const throughAliases = defineSqliteContract({}, ({ type, field, model }) => ({
      models: {
        Event: model('Event', {
          fields: {
            id: field.column(type.Int()).id(),
            createdAt: field.column(type.temporal.CreatedAt()),
            updatedAt: field.column(type.temporal.UpdatedAt()),
          },
        }).sql({ table: 'Event' }),
      },
    }));
    expect(throughAliases).toEqual(
      succeeded(
        interpretSqlite(`model Event {
  id        Int                @id
  createdAt temporal.CreatedAt
  updatedAt temporal.UpdatedAt
}
`),
      ),
    );
  });
});
