import { type ColumnDefault, type Contract, coreHash, profileHash } from '@internal/contract/types';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { SqlStorage, type StorageTable } from '@internal/sql-contract/types';
import { SqlSchemaIR, SqlTableIR } from '@internal/sql-schema-ir/types';
import { ifDefined } from '@internal/utils/defined';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { parseSqliteDefault } from '../src/core/default-normalizer';
import { columnSpecFromNode, ddlColumnFromNode } from '../src/core/migrations/column-ddl-rendering';
import { buildSqlitePlanDiff } from '../src/core/migrations/diff-database-schema';
import { sqliteCreateNamespace } from '../src/core/sqlite-unbound-database';

function liveSchema(rawDefault: string): SqlSchemaIR {
  return new SqlSchemaIR({
    tables: {
      event: new SqlTableIR({
        name: 'event',
        columns: {
          at: {
            name: 'at',
            nativeType: 'text',
            nullable: false,
            default: rawDefault,
            resolvedNativeType: 'text',
            ...ifDefined('resolvedDefault', parseSqliteDefault(rawDefault, 'text')),
          },
        },
        foreignKeys: [],
        uniques: [],
        indexes: [],
      }),
    },
  });
}

function contractWithDefault(columnDefault: ColumnDefault): Contract<SqlStorage> {
  const event: StorageTable = {
    columns: {
      at: { nativeType: 'text', nullable: false, codecId: 'sqlite/text@1', default: columnDefault },
    },
    foreignKeys: [],
    uniques: [],
    indexes: [],
  };
  return {
    target: 'sqlite',
    targetFamily: 'sql',
    profileHash: profileHash('test'),
    storage: new SqlStorage({
      storageHash: coreHash('c'.repeat(64)),
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: sqliteCreateNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: { table: { event } },
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

describe('buildSqlitePlanDiff derives the expected default like verify does', () => {
  it('sees no change for sql`CURRENT_TIMESTAMP` against a live column that stores CURRENT_TIMESTAMP', () => {
    const diff = buildSqlitePlanDiff({
      contract: contractWithDefault({ kind: 'function', expression: 'CURRENT_TIMESTAMP' }),
      actualSchema: liveSchema('CURRENT_TIMESTAMP'),
      frameworkComponents: [],
    });
    expect(diff.issues).toEqual([]);
  });

  it("sees no change for a literal-shaped body sql`'x'` against the literal the database stores", () => {
    const diff = buildSqlitePlanDiff({
      contract: contractWithDefault({ kind: 'function', expression: "'x'" }),
      actualSchema: liveSchema("'x'"),
      frameworkComponents: [],
    });
    expect(diff.issues).toEqual([]);
  });

  it.each([
    ['CURRENT_TIMESTAMP', 'DEFAULT (CURRENT_TIMESTAMP)'],
    ["'x'", "DEFAULT ('x')"],
    ['now()', "DEFAULT (datetime('now'))"],
  ])('renders the authored expression %s in DDL, never the resolved default', (expression, ddl) => {
    const diff = buildSqlitePlanDiff({
      contract: contractWithDefault({ kind: 'function', expression }),
      actualSchema: new SqlSchemaIR({ tables: {} }),
      frameworkComponents: [],
    });
    const column = diff.expected.tables['event']?.columns['at'];
    if (column === undefined) throw new Error('expected column derived');
    expect(columnSpecFromNode(column, false).defaultSql).toBe(ddl);
    expect(ddlColumnFromNode(column, false).default?.kind).toBe('function');
  });
});
