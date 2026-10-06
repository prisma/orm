import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import { verifySqlSchemaByDiff } from '@internal/family-sql/diff';
import { SqlStorage, StorageTable } from '@internal/sql-contract/types';
import { parseNaming } from '@internal/sql-schema-ir/naming';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { diffPostgresSchema } from '../../src/core/migrations/diff-database-schema';
import { PostgresSchema } from '../../src/core/postgres-schema';
import { PostgresDatabaseSchemaNode } from '../../src/core/schema-ir/postgres-database-schema-node';
import { PostgresNamespaceSchemaNode } from '../../src/core/schema-ir/postgres-namespace-schema-node';
import { PostgresPolicySchemaNode } from '../../src/core/schema-ir/postgres-policy-schema-node';
import { PostgresTableSchemaNode } from '../../src/core/schema-ir/postgres-table-schema-node';
import { postgresDiffSubjectGranularity } from '../../src/core/schema-ir/schema-node-kinds';
import { postgresTypeComponents } from '../postgres-type-lookups';

/**
 * Table-less contract namespaces (e.g. an enums-only schema) are invisible
 * to the relational verdict: a table-less
 * namespace contributes nothing to the expected tree and does not claim its
 * DDL schema for RELATIONAL ownership, so neither the schema's absence nor
 * its live relational contents can flip the verdict. RLS governance is the
 * exception: the legacy policy diff owned every contract schema regardless
 * of tables, so a live policy inside a table-less owned schema fails in
 * both modes — structural extras check the full owned set. Pinned here as
 * legacy-vs-differ verdict parity over Postgres TREES (the flat parity
 * suite cannot see namespaces).
 */

function makeContract(): Contract<SqlStorage> {
  const publicSchema = new PostgresSchema({
    id: 'public',
    entries: {
      table: {
        profiles: new StorageTable({
          columns: {
            id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
          },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        }),
      },
    },
  });
  const enumsOnlySchema = new PostgresSchema({ id: 'enums', entries: { table: {} } });
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('table-less-ns-parity'),
    storage: new SqlStorage({
      storageHash: coreHash('table-less-ns-parity'),
      namespaces: { public: publicSchema, enums: enumsOnlySchema },
    }),
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensions: {},
    meta: {},
  };
}

function profilesTable(options?: { readonly idNullable?: boolean }): PostgresTableSchemaNode {
  return new PostgresTableSchemaNode({
    name: 'profiles',
    columns: {
      id: {
        name: 'id',
        nativeType: 'int4',
        nullable: options?.idNullable ?? false,
        resolvedNativeType: 'int4',
      },
    },
    primaryKey: { columns: ['id'] },
    foreignKeys: [],
    uniques: [],
    indexes: [],
    policies: [],
    rlsEnabled: false,
  });
}

function publicNamespace(options?: { readonly idNullable?: boolean }): PostgresNamespaceSchemaNode {
  return new PostgresNamespaceSchemaNode({
    schemaName: 'public',
    tables: { profiles: profilesTable(options) },
  });
}

function enumsNamespaceWithStrayTable(
  policy?: PostgresPolicySchemaNode,
): PostgresNamespaceSchemaNode {
  return new PostgresNamespaceSchemaNode({
    schemaName: 'enums',
    tables: {
      audit_log: new PostgresTableSchemaNode({
        name: 'audit_log',
        columns: {
          id: {
            name: 'id',
            nativeType: 'int4',
            nullable: false,
            resolvedNativeType: 'int4',
          },
        },
        foreignKeys: [],
        uniques: [],
        indexes: [],
        policies: policy === undefined ? [] : [policy],
        rlsEnabled: false,
      }),
    },
  });
}

function rootOf(
  namespaces: Readonly<Record<string, PostgresNamespaceSchemaNode>>,
): PostgresDatabaseSchemaNode {
  return new PostgresDatabaseSchemaNode({
    namespaces,
    roles: [],
    existingSchemas: Object.keys(namespaces),
    pgVersion: 'unknown',
  });
}

function assertVerdict(
  contract: Contract<SqlStorage>,
  actual: PostgresDatabaseSchemaNode,
  expectedOk: boolean,
): void {
  for (const strict of [true, false]) {
    const result = verifySqlSchemaByDiff({
      contract,
      schema: actual,
      strict,
      frameworkComponents: postgresTypeComponents,
      diffSchema: diffPostgresSchema,
      granularityOf: postgresDiffSubjectGranularity,
    });
    expect({ strict, ok: result.ok }).toEqual({ strict, ok: expectedOk });
  }
}

describe('verdict: table-less contract namespaces (Postgres tree)', () => {
  it('DDL schema of an enums-only namespace absent from the DB verifies clean', () => {
    assertVerdict(makeContract(), rootOf({ public: publicNamespace() }), true);
  });

  it('DDL schema of an enums-only namespace holding live tables verifies clean', () => {
    const actual = rootOf({
      public: publicNamespace(),
      enums: enumsNamespaceWithStrayTable(),
    });
    assertVerdict(makeContract(), actual, true);
  });

  it('a live RLS policy on a stray table in the enums-only owned schema fails both pipelines', () => {
    const strayPolicy = new PostgresPolicySchemaNode({
      naming: parseNaming('sneaky_read_a1b2c3d4', 'sneaky_read'),
      tableName: 'audit_log',
      namespaceId: 'enums',
      operation: 'select',
      roles: ['authenticated'],
      using: 'true',
      permissive: true,
      withCheck: undefined,
      dependsOn: undefined,
    });
    const actual = rootOf({
      public: publicNamespace(),
      enums: enumsNamespaceWithStrayTable(strayPolicy),
    });
    assertVerdict(makeContract(), actual, false);
  });

  it('drift inside the table-bearing namespace still fails both pipelines', () => {
    assertVerdict(makeContract(), rootOf({ public: publicNamespace({ idNullable: true }) }), false);
  });
});
