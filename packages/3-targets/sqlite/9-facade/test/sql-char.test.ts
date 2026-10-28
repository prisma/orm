import sqliteAdapter from '@internal/adapter-sqlite/control';
import sqliteDriver from '@internal/driver-sqlite/control';
import sql from '@internal/family-sql/control';
import { createControlStack } from '@internal/framework-components/control';
import { withSeedDiagnostics } from '@internal/psl-parser/interpret';
import { bindPslSchema, contractSourceContextFromControlStack } from '@internal/psl-parser/test';
import { interpretPslDocumentToSqlContract } from '@internal/sql-contract-psl';
import { sqlContextInput } from '@internal/sql-contract-psl/test';
import sqlite, { sqliteCreateNamespace } from '@internal/target-sqlite/control';
import sqlitePackRef from '@internal/target-sqlite/pack';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { defineContract } from '../src/exports/contract-builder';

const stack = createControlStack({
  family: sql,
  target: sqlite,
  adapter: sqliteAdapter,
  driver: sqliteDriver,
});

function interpret(schema: string) {
  const bound = bindPslSchema(schema, {
    sourceId: 'sql-char.psl',
    context: contractSourceContextFromControlStack(stack),
  });
  const result = withSeedDiagnostics(
    interpretPslDocumentToSqlContract({
      documents: bound.documents,
      sources: bound.sources,
      symbolTable: bound.symbolTable,
      binder: bound.binder,
      ...sqlContextInput(bound.context),
      target: sqlitePackRef,
      createNamespace: sqliteCreateNamespace,
    }),
    bound.seedDiagnostics,
  );
  if (!result.ok) throw new Error(JSON.stringify(result.failure.diagnostics));
  return result.value;
}

const tokenSchema = 'model Token {\n  id   Int @id\n  code sql.Char(36)\n}\n';

describe('sql.Char on SQLite', () => {
  it('stores a sql/char@1 column of the sqlite/character data type, in PSL', () => {
    const { storage } = JSON.parse(JSON.stringify(interpret(tokenSchema)));
    expect(storage.namespaces.__unbound__.entries.table.Token.columns).toEqual({
      id: { codecId: 'sqlite/integer@1', dataType: 'sqlite/integer', many: false, nullable: false },
      code: {
        codecId: 'sql/char@1',
        dataType: 'sqlite/character',
        many: false,
        nullable: false,
        typeParams: { length: 36 },
      },
    });
  });

  it('stores the same column from the TypeScript builder', () => {
    const contract = defineContract({}, ({ field, model, type }) => {
      const code = type.sql.Char(36);
      expectTypeOf(code.typeParams).toEqualTypeOf<{ readonly length: 36 }>();
      return {
        models: {
          Token: model('Token', {
            fields: { id: field.column(type.Int()).id(), code: field.column(code) },
          }).sql({ table: 'Token' }),
        },
      };
    });
    expect(contract.storage).toEqual(interpret(tokenSchema).storage);
  });

  it('stores uuidv4 on create for sql.Char(36) @id @onCreate(uuid())', () => {
    const contract = interpret('model Token {\n  id sql.Char(36) @id @onCreate(uuid())\n}\n');
    expect(contract.execution?.mutations.defaults).toEqual([
      {
        ref: { namespace: '__unbound__', entry: 'Token', field: 'id' },
        onCreate: { kind: 'generator', id: 'uuidv4' },
      },
    ]);
  });
});
