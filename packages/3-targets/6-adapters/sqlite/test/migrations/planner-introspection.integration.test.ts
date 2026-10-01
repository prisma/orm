/**
 * Round-trip integration: planner-emitted DDL is executed against a real
 * (in-memory) SQLite database, then the adapter introspects it back to a
 * `SqlSchemaIR` and we compare against expectations. Exercises the
 * planner ↔ adapter wiring directly — the runner's own behaviour
 * (`BEGIN EXCLUSIVE`, marker / ledger writes, idempotency, FK integrity
 * check) lives in the `runner.*.test.ts` siblings.
 */

import { DatabaseSync } from 'node:sqlite';
import { asNamespaceId, type Contract, coreHash, profileHash } from '@internal/contract/types';
import type { SqlMigrationPlanOperation } from '@internal/family-sql/control';
import { APP_SPACE_ID } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { index } from '@internal/sql-contract/factories';
import { SqlStorage, type StorageColumn, type StorageTable } from '@internal/sql-contract/types';
import { PrimaryKey } from '@internal/sql-schema-ir/types';
import { createSqliteBuiltinCodecLookup } from '@internal/target-sqlite/codecs';
import { sqliteCreateNamespace } from '@internal/target-sqlite/control';
import { createSqliteMigrationPlanner } from '@internal/target-sqlite/planner';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { SqliteControlAdapter } from '../../src/core/control-adapter';

function createMemoryDriver() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  return {
    familyId: 'sql' as const,
    targetId: 'sqlite' as const,
    async query<Row = Record<string, unknown>>(sql: string, params?: readonly unknown[]) {
      const stmt = db.prepare(sql);
      const rows = stmt.all(...((params ?? []) as Array<string | number | null>)) as Row[];
      return { rows };
    },
    async close() {
      db.close();
    },
    db,
  };
}

function makeColumn(overrides: Partial<StorageColumn> = {}): StorageColumn {
  return {
    nativeType: 'text',
    nullable: true,
    codecId: 'sqlite/text@1',
    ...overrides,
  };
}

function makeTable(overrides: Partial<StorageTable> = {}): StorageTable {
  return {
    columns: {},
    foreignKeys: [],
    uniques: [],
    indexes: [],
    ...overrides,
  };
}

function makeContract(tables: Record<string, StorageTable>): Contract<SqlStorage> {
  return {
    target: 'sqlite',
    targetFamily: 'sql',
    profileHash: profileHash('test'),
    storage: new SqlStorage({
      storageHash: coreHash(`test-${Date.now()}`),
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: sqliteCreateNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: { table: tables },
        }),
      },
    }),
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensions: {},
    meta: {},
  };
}

const emptySchema = { tables: {} };

async function runPlannedSteps(
  driver: { query: (sql: string) => Promise<unknown> },
  ops: ReadonlyArray<{ execute: ReadonlyArray<{ sql: string }> }>,
): Promise<void> {
  for (const op of ops) {
    for (const step of op.execute) {
      await driver.query(step.sql);
    }
  }
}

describe('SQLite planner + introspection round-trip', () => {
  it('executes planned DDL and verifies via introspection', async () => {
    const driver = createMemoryDriver();
    try {
      const adapter = new SqliteControlAdapter(createSqliteBuiltinCodecLookup());
      const planner = createSqliteMigrationPlanner(adapter);

      const contract = makeContract({
        users: makeTable({
          columns: {
            id: makeColumn({
              nativeType: 'integer',
              nullable: false,
              default: { kind: 'function', expression: 'autoincrement()' },
            }),
            email: makeColumn({ nativeType: 'text', nullable: false }),
            active: makeColumn({
              nativeType: 'integer',
              codecId: 'sqlite/integer@1',
              nullable: false,
              default: { kind: 'literal', value: 1 },
            }),
          },
          primaryKey: { columns: ['id'] },
          indexes: [index('idx_users_email', ['email'])],
        }),
      });

      const result = planner.plan({
        contract,
        schema: emptySchema,
        policy: { allowedOperationClasses: ['additive'] },
        fromContract: null,
        frameworkComponents: [],
        spaceId: APP_SPACE_ID,
        snapshotsImportPath: '../../snapshots',
      });

      expect(result.kind).toBe('success');
      if (result.kind !== 'success') return;

      await runPlannedSteps(
        driver,
        (await Promise.all(result.plan.operations)) as SqlMigrationPlanOperation<unknown>[],
      );

      const schema = await adapter.introspect(driver);
      expect(schema.tables['users']).toBeDefined();
      expect(schema.tables['users']!.columns['id']).toBeDefined();
      expect(schema.tables['users']!.columns['email']).toBeDefined();
      expect(schema.tables['users']!.columns['active']).toBeDefined();
      expect(schema.tables['users']!.primaryKey).toEqual(new PrimaryKey({ columns: ['id'] }));

      const idx = schema.tables['users']!.indexes.find((i) => i.name === 'idx_users_email');
      expect(idx).toBeDefined();
      expect(idx!.columns).toEqual(['email']);

      await driver.query('INSERT INTO users (email, active) VALUES (?, ?)', [
        'test@example.com',
        1,
      ]);
      const rows = await driver.query<{ id: number; email: string; active: number }>(
        'SELECT * FROM users',
      );
      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0]!.id).toBe(1);
      expect(rows.rows[0]!.email).toBe('test@example.com');
    } finally {
      await driver.close();
    }
  });

  it('handles AUTOINCREMENT with INTEGER PRIMARY KEY', async () => {
    const driver = createMemoryDriver();
    try {
      const planner = createSqliteMigrationPlanner(
        new SqliteControlAdapter(createSqliteBuiltinCodecLookup()),
      );

      const contract = makeContract({
        items: makeTable({
          columns: {
            id: makeColumn({
              nativeType: 'integer',
              nullable: false,
              default: { kind: 'function', expression: 'autoincrement()' },
            }),
            value: makeColumn({ nativeType: 'text', nullable: true }),
          },
          primaryKey: { columns: ['id'] },
        }),
      });

      const result = planner.plan({
        contract,
        schema: emptySchema,
        policy: { allowedOperationClasses: ['additive'] },
        fromContract: null,
        frameworkComponents: [],
        spaceId: APP_SPACE_ID,
        snapshotsImportPath: '../../snapshots',
      });

      expect(result.kind).toBe('success');
      if (result.kind !== 'success') return;

      await runPlannedSteps(
        driver,
        (await Promise.all(result.plan.operations)) as SqlMigrationPlanOperation<unknown>[],
      );

      await driver.query('INSERT INTO items (value) VALUES (?)', ['first']);
      await driver.query('INSERT INTO items (value) VALUES (?)', ['second']);
      const rows = await driver.query<{ id: number; value: string }>(
        'SELECT * FROM items ORDER BY id',
      );
      expect(rows.rows).toHaveLength(2);
      expect(rows.rows[0]!.id).toBe(1);
      expect(rows.rows[1]!.id).toBe(2);
    } finally {
      await driver.close();
    }
  });

  it('handles foreign key constraints in CREATE TABLE', async () => {
    const driver = createMemoryDriver();
    try {
      const planner = createSqliteMigrationPlanner(
        new SqliteControlAdapter(createSqliteBuiltinCodecLookup()),
      );

      const contract = makeContract({
        authors: makeTable({
          columns: {
            id: makeColumn({ nativeType: 'integer', nullable: false }),
          },
          primaryKey: { columns: ['id'] },
        }),
        posts: makeTable({
          columns: {
            id: makeColumn({ nativeType: 'integer', nullable: false }),
            author_id: makeColumn({ nativeType: 'integer', nullable: false }),
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [
            {
              source: {
                namespaceId: asNamespaceId(UNBOUND_NAMESPACE_ID),
                tableName: 'posts',
                columns: ['author_id'],
              },
              target: {
                namespaceId: asNamespaceId(UNBOUND_NAMESPACE_ID),
                tableName: 'authors',
                columns: ['id'],
              },
              onDelete: 'cascade',
            },
          ],
        }),
      });

      const result = planner.plan({
        contract,
        schema: emptySchema,
        policy: { allowedOperationClasses: ['additive'] },
        fromContract: null,
        frameworkComponents: [],
        spaceId: APP_SPACE_ID,
        snapshotsImportPath: '../../snapshots',
      });

      expect(result.kind).toBe('success');
      if (result.kind !== 'success') return;

      await runPlannedSteps(
        driver,
        (await Promise.all(result.plan.operations)) as SqlMigrationPlanOperation<unknown>[],
      );

      await driver.query('INSERT INTO authors (id) VALUES (?)', [1]);
      await driver.query('INSERT INTO posts (id, author_id) VALUES (?, ?)', [1, 1]);

      await driver.query('DELETE FROM authors WHERE id = ?', [1]);
      const remaining = await driver.query('SELECT * FROM posts');
      expect(remaining.rows).toHaveLength(0);
    } finally {
      await driver.close();
    }
  });
});
