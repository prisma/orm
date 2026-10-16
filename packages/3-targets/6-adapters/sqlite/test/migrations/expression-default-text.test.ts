import { DatabaseSync } from 'node:sqlite';
import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { SqlStorage, type StorageColumn } from '@internal/sql-contract/types';
import { createSqliteBuiltinCodecLookup } from '@internal/target-sqlite/codecs';
import { sqliteCreateNamespace } from '@internal/target-sqlite/control';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { SqliteControlAdapter } from '../../src/core/control-adapter';
import { familyInstance, frameworkComponents } from './fixtures/runner-fixtures';

const text = (expression: string): StorageColumn => ({
  many: false,
  dataType: 'sqlite/text',
  codecId: 'sqlite/text@1',
  nullable: false,
  default: { kind: 'function', expression },
});

const contract: Contract<SqlStorage> = {
  target: 'sqlite',
  targetFamily: 'sql',
  profileHash: profileHash('test'),
  storage: new SqlStorage({
    storageHash: coreHash('expression-default-text'),
    namespaces: {
      [UNBOUND_NAMESPACE_ID]: sqliteCreateNamespace({
        id: UNBOUND_NAMESPACE_ID,
        entries: {
          table: {
            greeting: {
              columns: {
                same: text("'hello'"),
                cased: text("'Hello'"),
                spaced: text("'a b'"),
              },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
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

describe('verify on SQLite of an expression default against the literal the database holds', () => {
  it('reports a column whose literal differs only in case or in spaces inside the quotes', async () => {
    const db = new DatabaseSync(':memory:');
    const driver = {
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
    try {
      db.exec(
        `CREATE TABLE "greeting" ("same" TEXT NOT NULL DEFAULT 'hello', "cased" TEXT NOT NULL DEFAULT 'hello', "spaced" TEXT NOT NULL DEFAULT 'ab')`,
      );
      const schema = await new SqliteControlAdapter(createSqliteBuiltinCodecLookup()).introspect(
        driver,
        contract,
      );
      const result = familyInstance.verifySchema({
        contract,
        schema,
        strict: true,
        frameworkComponents,
      });
      expect(result.schema.issues.map((issue) => issue.path.join('/')).sort()).toEqual([
        'database/greeting/column:cased/default',
        'database/greeting/column:spaced/default',
      ]);
    } finally {
      await driver.close();
    }
  });
});
