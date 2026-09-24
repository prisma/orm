import { type ColumnDefault, type Contract, coreHash, profileHash } from '@internal/contract/types';
import { SqlSchemaVerifierBase } from '@internal/family-sql/ir';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { SqlStorage, type StorageTable } from '@internal/sql-contract/types';
import { SqlSchemaIR, SqlTableIR } from '@internal/sql-schema-ir/types';
import { ifDefined } from '@internal/utils/defined';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { parseSqliteDefault } from '../src/core/default-normalizer';
import { diffSqliteSchema } from '../src/core/migrations/diff-database-schema';
import { SqliteSchemaVerifier } from '../src/core/sqlite-schema-verifier';
import { sqliteCreateNamespace } from '../src/core/sqlite-unbound-database';

describe('SqliteSchemaVerifier', () => {
  it('extends SqlSchemaVerifierBase', () => {
    const verifier = new SqliteSchemaVerifier();
    expect(verifier).toBeInstanceOf(SqlSchemaVerifierBase);
  });
});

describe('diffSqliteSchema resolves authored function defaults like introspected ones', () => {
  function actualSchema(rawDefault: string): SqlSchemaIR {
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
        at: {
          nativeType: 'text',
          nullable: false,
          codecId: 'sqlite/text@1',
          default: columnDefault,
        },
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

  it('reports nothing for sql`CURRENT_TIMESTAMP` against DEFAULT CURRENT_TIMESTAMP', () => {
    const result = diffSqliteSchema({
      contract: contractWithDefault({ kind: 'function', expression: 'CURRENT_TIMESTAMP' }),
      schema: actualSchema('CURRENT_TIMESTAMP'),
      frameworkComponents: [],
    });
    expect(result.issues).toEqual([]);
  });

  it('still reports a default that differs', () => {
    const result = diffSqliteSchema({
      contract: contractWithDefault({ kind: 'function', expression: 'CURRENT_TIMESTAMP' }),
      schema: actualSchema("'2020-01-01'"),
      frameworkComponents: [],
    });
    expect(result.issues).not.toEqual([]);
  });
});
