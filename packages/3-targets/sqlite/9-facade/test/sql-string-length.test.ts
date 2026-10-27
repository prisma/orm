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

function emit(schema: string) {
  const bound = bindPslSchema(schema, {
    sourceId: 'sql-string-length.psl',
    context: contractSourceContextFromControlStack(stack),
  });
  return withSeedDiagnostics(
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
}

describe('sql.String on SQLite, whose length is a value of sqlite/real', () => {
  it('gives a whole-number length as a number, in PSL', () => {
    const result = emit('model Label {\n  id   Int @id\n  name sql.String(50)\n}\n');
    if (!result.ok) throw new Error(JSON.stringify(result.failure.diagnostics));
    const { storage } = JSON.parse(JSON.stringify(result.value));
    const [namespace] = Object.values<{ entries: { table: Record<string, { columns: object }> } }>(
      storage.namespaces,
    );
    expect(namespace?.entries.table['Label']?.columns).toMatchObject({
      name: {
        codecId: 'sql/varchar@1',
        typeParams: { length: 50 },
      },
    });
  });

  it('gives the same parameters from the TypeScript builder', () => {
    const contract = defineContract({}, ({ field, model, type, gen }) => {
      const name = type.sql.String(50);
      expectTypeOf(name.typeParams).toEqualTypeOf<{ readonly length: 50 }>();
      return {
        models: {
          Label: model('Label', {
            fields: {
              id: field.column(type.sql.Char(36)).id().onCreate(gen.uuid()),
              name: field.column(name),
            },
          }),
        },
      };
    });
    const [namespace] = Object.values(contract.storage.namespaces);
    expect(namespace?.entries.table?.['Label']?.columns['name']).toMatchObject({
      codecId: 'sql/varchar@1',
      typeParams: { length: 50 },
    });
  });

  it('refuses a length with a fraction through the length’s schema, at the argument', () => {
    const schema = 'model Label {\n  id   Int @id\n  name sql.String(2.5)\n}\n';
    const result = emit(schema);
    expect(result.ok ? [] : result.failure.diagnostics).toEqual([
      expect.objectContaining({
        code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
        message: expect.stringContaining('length must be an integer'),
        span: expect.objectContaining({
          start: expect.objectContaining({ offset: schema.indexOf('2.5') }),
        }),
      }),
    ]);
  });

  it('accepts the largest length SQLite allows, which a double holds exactly', () => {
    const result = emit('model Label {\n  id   Int @id\n  name sql.String(2147483647)\n}\n');
    if (!result.ok) throw new Error(JSON.stringify(result.failure.diagnostics));
    const { storage } = JSON.parse(JSON.stringify(result.value));
    const [namespace] = Object.values<{ entries: { table: Record<string, { columns: object }> } }>(
      storage.namespaces,
    );
    expect(namespace?.entries.table['Label']?.columns).toMatchObject({
      name: { typeParams: { length: 2147483647 } },
    });
  });

  it('refuses a length above SQLite’s maximum through the length’s schema, at the argument', () => {
    const schema = 'model Label {\n  id   Int @id\n  name sql.String(2147483648)\n}\n';
    const result = emit(schema);
    expect(result.ok ? [] : result.failure.diagnostics).toEqual([
      expect.objectContaining({
        code: 'PSL_INVALID_ATTRIBUTE_ARGUMENT',
        message: expect.stringContaining('length must be at most 2147483647'),
        span: expect.objectContaining({
          start: expect.objectContaining({ offset: schema.indexOf('2147483648') }),
        }),
      }),
    ]);
  });

  it('accepts a whole number written with a zero fraction, which reads as sqlite/real', () => {
    const result = emit('model Label {\n  id   Int @id\n  name sql.String(2.0)\n}\n');
    if (!result.ok) throw new Error(JSON.stringify(result.failure.diagnostics));
    const { storage } = JSON.parse(JSON.stringify(result.value));
    const [namespace] = Object.values<{ entries: { table: Record<string, { columns: object }> } }>(
      storage.namespaces,
    );
    expect(namespace?.entries.table['Label']?.columns).toMatchObject({
      name: { typeParams: { length: 2 } },
    });
  });
});
