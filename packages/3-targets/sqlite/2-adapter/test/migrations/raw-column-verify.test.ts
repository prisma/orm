import { DatabaseSync } from 'node:sqlite';
import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import type { SqlMigrationPlanOperation } from '@internal/family-sql/control';
import { APP_SPACE_ID } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { SqlStorage, type StorageColumn } from '@internal/sql-contract/types';
import { sqliteCreateNamespace } from '@internal/target-sqlite/types';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { createTestSqliteControlAdapter } from '../helpers/test-control-adapter';
import {
  controlAdapter,
  emptySchema,
  familyInstance,
  frameworkComponents,
  sqliteTargetDescriptor,
} from './fixtures/runner-fixtures';

function createMemoryDriver() {
  const db = new DatabaseSync(':memory:');
  return {
    familyId: 'sql' as const,
    targetId: 'sqlite' as const,
    async query<Row = Record<string, unknown>>(sql: string, params?: readonly unknown[]) {
      const rows = db.prepare(sql).all(...((params ?? []) as Array<string | number | null>));
      return { rows: rows as Row[] };
    },
    async close() {
      db.close();
    },
  };
}

const raw = (sql: string): StorageColumn => ({
  many: false,
  dataType: 'sql/raw',
  codecId: 'sql/raw@1',
  typeParams: { sql },
  nullable: true,
});

function contractOf(columns: Record<string, StorageColumn>): Contract<SqlStorage> {
  return {
    target: 'sqlite',
    targetFamily: 'sql',
    profileHash: profileHash('raw-column-verify'),
    storage: new SqlStorage({
      storageHash: coreHash(JSON.stringify(columns)),
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: sqliteCreateNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: { item: { columns, uniques: [], indexes: [], foreignKeys: [] } },
          },
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

const introspector = createTestSqliteControlAdapter();

describe('a raw column on SQLite', () => {
  it('is created with its text as written, and verifies with no findings', async () => {
    const driver = createMemoryDriver();
    try {
      const contract = contractOf({ shape: raw('circle'), label: raw('character varying(10)') });
      const result = sqliteTargetDescriptor.createPlanner(controlAdapter).plan({
        contract,
        schema: emptySchema,
        policy: { allowedOperationClasses: ['additive'] },
        fromContract: null,
        origin: null,
        statements: [],
        frameworkComponents,
        spaceId: APP_SPACE_ID,
        snapshotsImportPath: '../../snapshots',
      });
      if (result.kind !== 'success') throw new Error('expected planner success');
      const operations = (await Promise.all(
        result.plan.operations,
      )) as SqlMigrationPlanOperation<unknown>[];
      for (const operation of operations) {
        for (const { sql } of operation.execute) await driver.query(sql);
      }

      const schema = await introspector.introspect(driver);
      const verified = familyInstance.verifySchema({
        contract,
        schema,
        strict: true,
        frameworkComponents,
      });

      expect({
        reported: Object.fromEntries(
          Object.entries(schema.tables['item']?.columns ?? {}).map(([name, column]) => [
            name,
            column.reportedType?.text,
          ]),
        ),
        issues: verified.schema.issues,
      }).toEqual({
        reported: { shape: 'circle', label: 'character varying(10)' },
        issues: [],
      });
    } finally {
      await driver.close();
    }
  });

  it('reports a type the database declares differently', async () => {
    const driver = createMemoryDriver();
    try {
      await driver.query('CREATE TABLE "item" ("shape" CIRCLE)');
      const schema = await introspector.introspect(driver);
      const verified = familyInstance.verifySchema({
        contract: contractOf({ shape: raw('circle') }),
        schema,
        strict: true,
        frameworkComponents,
      });

      expect(verified.schema.issues.map((issue) => issue.explanation)).toEqual([
        {
          text: 'The column type is "circle", but the database reports "CIRCLE". A type named by its catalog text is compared with the text the database reports, exactly.',
          cause: 'differs',
        },
      ]);
    } finally {
      await driver.close();
    }
  });
});
