import mysqlAdapter from '@internal/adapter-mysql/control';
import type { ContractSourceDiagnostic } from '@internal/config/config-types';
import mysqlDriver from '@internal/driver-mysql/control';
import sql from '@internal/family-sql/control';
import { createControlStack } from '@internal/framework-components/control';
import { withSeedDiagnostics } from '@internal/psl-parser/interpret';
import { bindPslSchema, contractSourceContextFromControlStack } from '@internal/psl-parser/test';
import { interpretPslDocumentToSqlContract } from '@internal/sql-contract-psl';
import { sqlContextInput } from '@internal/sql-contract-psl/test';
import mysql from '@internal/target-mysql/control';
import mysqlPackRef from '@internal/target-mysql/pack';
import { mysqlCreateNamespace } from '@internal/target-mysql/types';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { defineContract } from '../src/exports/contract-builder';

const stack = createControlStack({
  family: sql,
  target: mysql,
  adapter: mysqlAdapter,
  driver: mysqlDriver,
});

function emit(schema: string) {
  const bound = bindPslSchema(schema, {
    sourceId: 'sql-varchar.psl',
    context: contractSourceContextFromControlStack(stack),
  });
  const warnings: ContractSourceDiagnostic[] = [];
  const result = withSeedDiagnostics(
    interpretPslDocumentToSqlContract({
      documents: bound.documents,
      sources: bound.sources,
      symbolTable: bound.symbolTable,
      binder: bound.binder,
      ...sqlContextInput(bound.context),
      target: mysqlPackRef,
      createNamespace: mysqlCreateNamespace,
      reportWarning: (diagnostic) => {
        warnings.push(diagnostic);
      },
    }),
    bound.seedDiagnostics,
  );
  if (!result.ok) throw new Error(JSON.stringify(result.failure.diagnostics));
  return { contract: JSON.parse(JSON.stringify(result.value)), warnings };
}

const model = (type: string) => `model Label {\n  id   Int @id\n  name ${type}\n}\n`;
const aliased = (type: string) => `types {\n  Name = ${type}\n}\n\n${model('Name')}`;

const deprecationWarning = {
  code: 'PSL_DEPRECATED_SCALAR_NAME',
  message: 'Scalar type "sql.String" is deprecated and will be removed; use "sql.Varchar".',
  severity: 'warning',
};

describe('sql.Varchar on MySQL', () => {
  it('is a varchar column of the written length', () => {
    const { contract, warnings } = emit(model('sql.Varchar(50)'));
    expect(warnings).toEqual([]);
    const [namespace] = Object.values<{ entries: { table: Record<string, { columns: object }> } }>(
      contract.storage.namespaces,
    );
    expect(namespace?.entries.table['Label']?.columns).toMatchObject({
      name: { codecId: 'sql/varchar@1', typeParams: { length: 50 } },
    });
  });

  it('is what the deprecated sql.String gives, which warns naming sql.Varchar', () => {
    const deprecated = emit(model('sql.String(50)'));
    expect(deprecated.warnings).toEqual([expect.objectContaining(deprecationWarning)]);
    expect(deprecated.contract).toEqual(emit(model('sql.Varchar(50)')).contract);
  });

  it('warns at a types {} alias that names sql.String', () => {
    const deprecated = emit(aliased('sql.String(10)'));
    expect(deprecated.warnings).toEqual([expect.objectContaining(deprecationWarning)]);
    expect(deprecated.contract).toEqual(emit(aliased('sql.Varchar(10)')).contract);
  });

  it('gives the type and contract the deprecated sql.String gives, from the TypeScript builder', () => {
    const throughString = defineContract({}, ({ field, model, type }) => {
      expectTypeOf(type.sql.String(50)).toEqualTypeOf(type.sql.Varchar(50));
      return {
        models: {
          Label: model('Label', {
            fields: { id: field.column(type.Int()).id(), name: field.column(type.sql.String(50)) },
          }),
        },
      };
    });
    const throughVarchar = defineContract({}, ({ field, model, type }) => ({
      models: {
        Label: model('Label', {
          fields: { id: field.column(type.Int()).id(), name: field.column(type.sql.Varchar(50)) },
        }),
      },
    }));
    expect(throughString).toEqual(throughVarchar);
  });
});
