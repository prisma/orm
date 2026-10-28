import postgresAdapter from '@internal/adapter-postgres/control';
import sql from '@internal/family-sql/control';
import { createControlStack } from '@internal/framework-components/control';
import { withSeedDiagnostics } from '@internal/psl-parser/interpret';
import { bindPslSchema, contractSourceContextFromControlStack } from '@internal/psl-parser/test';
import { interpretPslDocumentToSqlContract } from '@internal/sql-contract-psl';
import { sqlContextInput } from '@internal/sql-contract-psl/test';
import postgres from '@internal/target-postgres/control';
import postgresPackRef from '@internal/target-postgres/pack';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { defineContract } from '../src/exports/contract-builder';

const stack = createControlStack({ family: sql, target: postgres, adapter: postgresAdapter });

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
      target: postgresPackRef,
      createNamespace: postgresCreateNamespace,
    }),
    bound.seedDiagnostics,
  );
  if (!result.ok) throw new Error(JSON.stringify(result.failure.diagnostics));
  return result.value;
}

describe('sql.Char on Postgres', () => {
  it('stores what Char stores, in PSL', () => {
    const throughSqlChar = interpret('model Token {\n  id sql.Char(36) @id @onCreate(uuid())\n}\n');
    expect(throughSqlChar).toEqual(
      interpret('model Token {\n  id Char(36) @id @onCreate(uuid())\n}\n'),
    );
    const { storage } = JSON.parse(JSON.stringify(throughSqlChar));
    expect(storage.namespaces.public.entries.table.Token.columns.id).toEqual({
      codecId: 'sql/char@1',
      dataType: 'pg/char',
      many: false,
      nullable: false,
      typeParams: { length: 36 },
    });
  });

  it('stores what Char stores, from the TypeScript builder', () => {
    const throughSqlChar = defineContract({}, ({ field, model, type }) => {
      const id = type.sql.Char(36);
      expectTypeOf(id.typeParams).toEqualTypeOf<{ readonly length: 36 }>();
      return {
        models: {
          Token: model('Token', { fields: { id: field.column(id).id() } }).sql({ table: 'Token' }),
        },
      };
    });
    const throughChar = defineContract({}, ({ field, model, type }) => ({
      models: {
        Token: model('Token', { fields: { id: field.column(type.Char(36)).id() } }).sql({
          table: 'Token',
        }),
      },
    }));
    expect(throughSqlChar).toEqual(throughChar);
  });
});
