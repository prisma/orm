import { createDataTypeLookup } from '@internal/framework-components/codec';
import type { MigrationPlanOperation } from '@internal/framework-components/control';
import { hasOperationPreview } from '@internal/framework-components/control';
import { describe, expect, it } from 'vitest';
import { extractSqlDdl, sqlOperationsToPreview } from '../src/core/operation-preview';
import sqlFamilyDescriptor from '../src/exports/control';

/**
 * Creates a SQL operation with `execute` steps (`SqlMigrationPlanOperation` shape).
 */
function sqlOperation(
  id: string,
  executeSteps: Array<{ description: string; sql: string }>,
): MigrationPlanOperation {
  return {
    id,
    label: `Operation ${id}`,
    operationClass: 'additive',
    execute: executeSteps,
    precheck: [],
    postcheck: [],
    target: { id: 'postgres' },
  } as unknown as MigrationPlanOperation;
}

describe('extractSqlDdl', () => {
  it('extracts CREATE statements from operations', () => {
    const ops = [
      sqlOperation('table.users', [
        { description: 'create users table', sql: 'CREATE TABLE "public"."users" (id uuid)' },
      ]),
    ];
    expect(extractSqlDdl(ops)).toEqual(['CREATE TABLE "public"."users" (id uuid)']);
  });

  it('extracts ALTER and DROP statements', () => {
    const ops = [
      sqlOperation('alter.col', [
        { description: 'alter column', sql: 'ALTER TABLE "public"."users" ADD COLUMN name text' },
      ]),
      sqlOperation('drop.table', [
        { description: 'drop table', sql: 'DROP TABLE "public"."legacy"' },
      ]),
    ];
    const result = extractSqlDdl(ops);
    expect(result).toHaveLength(2);
    expect(result[0]).toContain('ALTER TABLE');
    expect(result[1]).toContain('DROP TABLE');
  });

  it('skips non-DDL statements', () => {
    const ops = [
      sqlOperation('marker.write', [
        { description: 'write marker', sql: 'INSERT INTO _prisma_marker VALUES ($1)' },
      ]),
    ];
    expect(extractSqlDdl(ops)).toEqual([]);
  });

  it('skips operations without execute steps (base MigrationPlanOperation)', () => {
    const baseOp: MigrationPlanOperation = {
      id: 'base.op',
      label: 'Base operation',
      operationClass: 'additive',
    };
    expect(extractSqlDdl([baseOp])).toEqual([]);
  });

  it('returns empty array for empty operations list', () => {
    expect(extractSqlDdl([])).toEqual([]);
  });
});

describe('sqlOperationsToPreview', () => {
  it('wraps each DDL statement with language: "sql"', () => {
    const ops = [
      sqlOperation('table.users', [
        { description: 'create', sql: 'CREATE TABLE "users" (id int)' },
        { description: 'alter', sql: 'ALTER TABLE "users" ADD COLUMN name text' },
      ]),
    ];

    const preview = sqlOperationsToPreview(ops);
    expect(preview.statements).toEqual([
      { text: 'CREATE TABLE "users" (id int)', language: 'sql' },
      { text: 'ALTER TABLE "users" ADD COLUMN name text', language: 'sql' },
    ]);
  });

  it('returns an empty preview for an empty operations list', () => {
    expect(sqlOperationsToPreview([])).toEqual({ statements: [] });
  });
});

describe('SqlControlFamilyInstance OperationPreviewCapable', () => {
  function instantiate() {
    const stack = {
      family: sqlFamilyDescriptor,
      target: {
        targetId: 'postgres',
        familyId: 'sql',
        kind: 'target',
        types: {},
      },
      adapter: {
        targetId: 'postgres',
        familyId: 'sql',
        kind: 'adapter',
        types: {},
        // biome-ignore lint/suspicious/noExplicitAny: minimal stub for capability test
        create: () => ({ introspect: () => ({}), readMarker: () => null }) as any,
      },
      extensions: [],
      codecTypeImports: [],
      extensionIds: [],
      dataTypeLookup: createDataTypeLookup([]),
      declaredDataTypes: [],
      codecDescriptors: [],
      // biome-ignore lint/suspicious/noExplicitAny: minimal stub
    } as any;
    return sqlFamilyDescriptor.create(stack);
  }

  it('hasOperationPreview is true for the SQL family instance', () => {
    expect(hasOperationPreview(instantiate())).toBe(true);
  });

  it('toOperationPreview emits language: "sql" on each statement', () => {
    const instance = instantiate();
    const preview = instance.toOperationPreview([
      sqlOperation('t', [{ description: 'create', sql: 'CREATE TABLE "x" (id int)' }]),
    ]);
    expect(preview.statements).toEqual([{ text: 'CREATE TABLE "x" (id int)', language: 'sql' }]);
  });
});
