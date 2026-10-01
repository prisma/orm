/**
 * Op-lowering coverage for the Postgres migration IR call classes:
 *
 * - `renderOps` lowers each variant via its pure factory and pins the
 *   id/operationClass/target.details shape exposed to runners.
 * - `RawSqlCall` is returned verbatim by `renderOps`.
 * - `DataTransformCall` always throws MIGRATION.UNFILLED_PLACEHOLDER from `renderOps` because
 *   the planner can only emit unfilled stubs.
 * - `TypeScriptRenderablePostgresMigration` routes `operations` through
 *   `renderOps` and `renderTypeScript()` through `renderCallsToTypeScript`.
 * - `AddNotNullColumnWithTempDefaultCall` pins the exact `ADD COLUMN` SQL
 *   for a codec-typed, parameterized column resolved via `codecHooks`
 *   (type token + temp-default backfill via `resolveIdentityValue`).
 *
 * Construction-side checks live in op-factory-call.construction.test.ts;
 * TypeScript rendering of individual calls and the `renderCallsToTypeScript`
 * aggregator are covered in op-factory-call.rendering.test.ts.
 */

import type { CodecControlHooks } from '@internal/family-sql/control';
import { APP_SPACE_ID } from '@internal/framework-components/control';
import { keepInternalSpecifiers } from '@internal/framework-components/emission';
import type { StorageColumn } from '@internal/sql-contract/types';
import { col, fn } from '@internal/sql-relational-core/contract-free';
import { createPostgresBuiltinCodecLookup } from '@internal/target-postgres/codecs';
import {
  AddColumnCall,
  AddForeignKeyCall,
  AddNotNullColumnWithTempDefaultCall,
  AddPrimaryKeyCall,
  AddUniqueCall,
  AlterColumnTypeCall,
  CreateExtensionCall,
  CreateIndexCall,
  CreateSchemaCall,
  CreateTableCall,
  DataTransformCall,
  DropColumnCall,
  DropConstraintCall,
  DropDefaultCall,
  DropIndexCall,
  DropNotNullCall,
  DropTableCall,
  RawSqlCall,
  SetDefaultCall,
  SetNotNullCall,
} from '@internal/target-postgres/op-factory-call';
import { resolveIdentityValue } from '@internal/target-postgres/planner-identity-values';
import { TypeScriptRenderablePostgresMigration } from '@internal/target-postgres/planner-produced-postgres-migration';
import { renderOps } from '@internal/target-postgres/render-ops';
import { ifDefined } from '@internal/utils/defined';
import { describe, expect, it } from 'vitest';
import { PostgresControlAdapter } from '../../src/core/control-adapter';

const SNAPSHOTS_IMPORT_PATH = '../../snapshots';
const META = {
  from: 'a'.repeat(64),
  to: 'b'.repeat(64),
} as const;
const testAdapter = new PostgresControlAdapter(createPostgresBuiltinCodecLookup());

describe('renderOps', () => {
  it('lowers each variant via its pure factory, pinning id/operationClass/target.details', async () => {
    const liftedOp = {
      id: 'custom.op.1',
      label: 'Custom raw op',
      operationClass: 'additive' as const,
      target: { id: 'postgres' as const },
      precheck: [],
      execute: [{ description: 'run', sql: 'SELECT 1' }],
      postcheck: [],
    };
    const calls = [
      new CreateTableCall('public', 'user', [col('id', 'text', { notNull: true })]),
      new DropTableCall('public', 'stale'),
      new AddColumnCall('public', 'user', col('email', 'text')),
      new DropColumnCall('public', 'user', 'legacy'),
      new AlterColumnTypeCall('public', 'user', 'age', {
        qualifiedTargetType: 'integer',
        formatTypeExpected: 'integer',
        rawTargetTypeForLabel: 'integer',
      }),
      new SetNotNullCall('public', 'user', 'email'),
      new DropNotNullCall('public', 'user', 'nickname'),
      new SetDefaultCall(
        'public',
        'user',
        col('created_at', 'timestamptz', { default: fn('now()') }),
      ),
      new DropDefaultCall('public', 'user', 'updated_at'),
      new AddPrimaryKeyCall('public', 'user', 'user_pkey', ['id']),
      new AddUniqueCall('public', 'user', 'user_email_key', ['email']),
      new AddForeignKeyCall('public', 'user', {
        name: 'user_org_fk',
        columns: ['org_id'],
        references: { schema: 'public', table: 'org', columns: ['id'] },
        onDelete: 'cascade',
        onUpdate: 'cascade',
      }),
      new DropConstraintCall('public', 'user', 'user_email_key'),
      new CreateIndexCall('public', 'user', 'user_email_idx', { columns: ['email'] }),
      new DropIndexCall('public', 'user', 'stale_idx'),
      new RawSqlCall(liftedOp),
      new CreateExtensionCall('citext'),
      new CreateSchemaCall('app'),
    ];

    const ops = await Promise.all(renderOps(calls, testAdapter));

    const schemaObject = (objectType: string, name: string, table?: string) => ({
      schema: 'public',
      objectType,
      name,
      ...ifDefined('table', table),
    });
    const expectations: Array<{
      id: string;
      operationClass: string;
      details: Record<string, unknown> | undefined;
    }> = [
      { id: 'table.user', operationClass: 'additive', details: schemaObject('table', 'user') },
      {
        id: 'dropTable.stale',
        operationClass: 'destructive',
        details: schemaObject('table', 'stale'),
      },
      {
        id: 'column.public.user.email',
        operationClass: 'additive',
        details: schemaObject('column', 'email', 'user'),
      },
      {
        id: 'dropColumn.user.legacy',
        operationClass: 'destructive',
        details: schemaObject('column', 'legacy', 'user'),
      },
      {
        id: 'alterType.user.age',
        operationClass: 'destructive',
        details: schemaObject('column', 'age', 'user'),
      },
      {
        id: 'alterNullability.setNotNull.user.email',
        operationClass: 'destructive',
        details: schemaObject('column', 'email', 'user'),
      },
      {
        id: 'alterNullability.dropNotNull.user.nickname',
        operationClass: 'widening',
        details: schemaObject('column', 'nickname', 'user'),
      },
      {
        id: 'setDefault.user.created_at',
        operationClass: 'additive',
        details: schemaObject('column', 'created_at', 'user'),
      },
      {
        id: 'dropDefault.user.updated_at',
        operationClass: 'destructive',
        details: schemaObject('column', 'updated_at', 'user'),
      },
      {
        id: 'primaryKey.user.user_pkey',
        operationClass: 'additive',
        details: schemaObject('primaryKey', 'user_pkey', 'user'),
      },
      {
        id: 'unique.user.user_email_key',
        operationClass: 'additive',
        details: schemaObject('unique', 'user_email_key', 'user'),
      },
      {
        id: 'foreignKey.user.user_org_fk',
        operationClass: 'additive',
        details: schemaObject('foreignKey', 'user_org_fk', 'user'),
      },
      {
        id: 'dropConstraint.user.user_email_key',
        operationClass: 'destructive',
        details: schemaObject('unique', 'user_email_key', 'user'),
      },
      {
        id: 'index.user.user_email_idx',
        operationClass: 'additive',
        details: schemaObject('index', 'user_email_idx', 'user'),
      },
      {
        id: 'dropIndex.user.stale_idx',
        operationClass: 'destructive',
        details: schemaObject('index', 'stale_idx', 'user'),
      },
      { id: 'custom.op.1', operationClass: 'additive', details: undefined },
      { id: 'extension.citext', operationClass: 'additive', details: undefined },
      { id: 'schema.app', operationClass: 'additive', details: undefined },
    ];

    expect(ops).toHaveLength(expectations.length);
    for (const [i, expected] of expectations.entries()) {
      const op = ops[i];
      expect(op, `ops[${i}]`).toMatchObject({
        id: expected.id,
        operationClass: expected.operationClass,
        target: {
          id: 'postgres',
          ...ifDefined('details', expected.details),
        },
      });
    }
  });

  it('RawSqlCall returns its stored op verbatim', () => {
    const op = {
      id: 'raw.identity',
      label: 'raw identity',
      operationClass: 'widening' as const,
      target: {
        id: 'postgres' as const,
        details: { schema: 'x', objectType: 'table' as const, name: 't' },
      },
      precheck: [],
      execute: [{ description: 'do', sql: 'SELECT 1' }],
      postcheck: [],
      meta: { note: 'roundtrip' },
    };

    const [rendered] = renderOps([new RawSqlCall(op)]);

    expect(rendered).toBe(op);
  });

  it('throws MIGRATION.UNFILLED_PLACEHOLDER on DataTransformCall (always an unfilled stub at plan time)', () => {
    const call = new DataTransformCall('Backfill', 'check', 'run');

    expect(() => renderOps([call])).toThrow(/Unfilled migration placeholder/);
  });
});

describe('TypeScriptRenderablePostgresMigration', () => {
  it('identifies as postgres, derives destination from meta.to, and materializes operations via renderOps', async () => {
    const calls = [new DropTableCall('public', 'stale')];
    const migration = new TypeScriptRenderablePostgresMigration(
      calls,
      META,
      APP_SPACE_ID,
      SNAPSHOTS_IMPORT_PATH,
      testAdapter,
    );

    expect(migration.targetId).toBe('postgres');
    expect(migration.destination).toEqual({ storageHash: META.to });
    expect(migration.describe()).toEqual(META);

    const operations = await Promise.all(migration.operations);
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({ id: 'dropTable.stale' });
  });

  it('renders TypeScript source mirroring renderCallsToTypeScript output', () => {
    const calls = [new DropTableCall('public', 'stale')];
    const migration = new TypeScriptRenderablePostgresMigration(
      calls,
      META,
      APP_SPACE_ID,
      SNAPSHOTS_IMPORT_PATH,
    );

    const source = migration.renderTypeScript(keepInternalSpecifiers);
    expect(source).toContain(
      "import { Migration, MigrationCLI } from '@internal/postgres/migration';",
    );
    expect(source).toContain('this.dropTable({ schema: "public", table: "stale" })');
  });
});

describe('AddNotNullColumnWithTempDefaultCall', () => {
  it('renders the exact ADD COLUMN SQL for a parameterized codec type with its temp-default backfill', async () => {
    const codecHooks = new Map<string, CodecControlHooks>([
      [
        'pg/vector@1',
        {
          expandNativeType: ({ nativeType, typeParams }) =>
            `${nativeType}(${typeParams?.['length']})`,
          resolveIdentityValue: () => "'[0,0,0]'",
        },
      ],
    ]);
    const column: StorageColumn = {
      nativeType: 'vector',
      codecId: 'pg/vector@1',
      nullable: false,
      typeParams: { length: 3 },
    };

    const temporaryDefault = resolveIdentityValue(column, codecHooks, {});
    if (temporaryDefault === null) {
      throw new Error('expected the pg/vector@1 codec hook to resolve an identity value');
    }
    expect(temporaryDefault).toBe("'[0,0,0]'");

    const call = new AddNotNullColumnWithTempDefaultCall({
      schemaName: 'public',
      tableName: 'doc',
      columnName: 'embedding',
      column,
      codecHooks,
      storageTypes: {},
      temporaryDefault,
    });
    const op = await call.toOp(testAdapter);

    expect(op.execute[0]?.sql).toBe(
      `ALTER TABLE "public"."doc" ADD COLUMN "embedding" vector(3) DEFAULT ('[0,0,0]') NOT NULL`,
    );
  });
});
