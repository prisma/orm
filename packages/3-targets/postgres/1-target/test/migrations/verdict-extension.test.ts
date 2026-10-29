import type { ControlPolicy } from '@internal/contract/types';
import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import { verifySqlSchemaByDiff } from '@internal/family-sql/diff';
import type { SqlStorage as SqlStorageType } from '@internal/sql-contract/types';
import { SqlStorage, StorageTable } from '@internal/sql-contract/types';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { contractToPostgresDatabaseSchemaNode } from '../../src/core/migrations/contract-to-postgres-database-schema-node';
import { diffPostgresSchema } from '../../src/core/migrations/diff-database-schema';
import { type PostgresContract, PostgresSchema } from '../../src/core/postgres-schema';
import { PostgresDatabaseSchemaNode } from '../../src/core/schema-ir/postgres-database-schema-node';
import { PostgresExtensionSchemaNode } from '../../src/core/schema-ir/postgres-extension-schema-node';
import { PostgresNamespaceSchemaNode } from '../../src/core/schema-ir/postgres-namespace-schema-node';
import { PostgresTableSchemaNode } from '../../src/core/schema-ir/postgres-table-schema-node';
import {
  PostgresSchemaNodeKind,
  postgresDiffSubjectEntityKind,
  postgresDiffSubjectGranularity,
} from '../../src/core/schema-ir/schema-node-kinds';
import {
  introspectedColumn,
  postgresTypeComponents,
  postgresTypeLookups,
} from '../postgres-type-lookups';

function makeContract(
  options: {
    readonly defaultControlPolicy?: ControlPolicy;
    readonly postgisControl?: ControlPolicy;
  } = {},
): PostgresContract {
  const publicSchema = new PostgresSchema({
    id: 'public',
    entries: {
      table: {
        orders: new StorageTable({
          columns: { id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false } },
          primaryKey: { columns: ['id'] },
          foreignKeys: [],
          uniques: [],
          indexes: [],
        }),
      },
      extension: { pg_trgm: { kind: 'extension', name: 'pg_trgm' } },
    },
  });
  const extensionsSchema = new PostgresSchema({
    id: 'extensions',
    entries: {
      table: {},
      extension: {
        postgis: {
          kind: 'extension',
          name: 'postgis',
          ...(options.postgisControl === undefined ? {} : { control: options.postgisControl }),
        },
      },
    },
  });
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('extension-verdict-test'),
    ...(options.defaultControlPolicy === undefined
      ? {}
      : { defaultControlPolicy: options.defaultControlPolicy }),
    storage: new SqlStorage({
      storageHash: coreHash('extension-verdict-test'),
      namespaces: { public: publicSchema, extensions: extensionsSchema },
    }),
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensions: {},
    meta: {},
  };
}

function actualTree(installed: Readonly<Record<string, string>>) {
  return new PostgresDatabaseSchemaNode({
    namespaces: {
      public: new PostgresNamespaceSchemaNode({
        schemaName: 'public',
        tables: {
          orders: new PostgresTableSchemaNode({
            name: 'orders',
            columns: { id: introspectedColumn({ name: 'id', typeText: 'int4', nullable: false }) },
            primaryKey: { columns: ['id'] },
            foreignKeys: [],
            uniques: [],
            indexes: [],
            policies: [],
            rlsEnabled: false,
          }),
        },
      }),
    },
    roles: [],
    extensions: Object.entries(installed).map(
      ([name, schemaName]) =>
        new PostgresExtensionSchemaNode({ name, schemaName, control: undefined }),
    ),
    existingSchemas: ['public', 'extensions'],
    pgVersion: 'unknown',
  });
}

const DECLARED = { pg_trgm: 'public', postgis: 'extensions' } as const;

function verify(
  contract: Contract<SqlStorageType>,
  actual: PostgresDatabaseSchemaNode,
  strict: boolean,
) {
  return verifySqlSchemaByDiff({
    contract,
    schema: actual,
    strict,
    frameworkComponents: postgresTypeComponents,
    diffSchema: diffPostgresSchema,
    granularityOf: postgresDiffSubjectGranularity,
  });
}

function extensionIssues(contract: Contract<SqlStorageType>, actual: PostgresDatabaseSchemaNode) {
  return diffPostgresSchema({
    contract,
    schema: actual,
    frameworkComponents: postgresTypeComponents,
  })
    .issues.filter(
      (issue) => (issue.expected ?? issue.actual)?.nodeKind === PostgresSchemaNodeKind.extension,
    )
    .map((issue) => ({
      path: issue.path,
      expected: issue.expected,
      actual: issue.actual,
    }));
}

describe('the expected tree lists each declared extension with its namespace schema', () => {
  it('puts every extension on the database root', () => {
    const tree = contractToPostgresDatabaseSchemaNode(
      makeContract({ postgisControl: 'external' }),
      {
        annotationNamespace: 'pg',
        dataTypeLookup: postgresTypeLookups.dataTypeLookup,
        codecLookup: postgresTypeLookups.codecLookup,
      },
    );
    expect(tree.extensions).toEqual([
      new PostgresExtensionSchemaNode({
        name: 'pg_trgm',
        schemaName: 'public',
        control: undefined,
      }),
      new PostgresExtensionSchemaNode({
        name: 'postgis',
        schemaName: 'extensions',
        control: 'external',
      }),
    ]);
  });
});

describe('the differ reports extension drift', () => {
  const contract = makeContract();

  it('reports a declared extension the database lacks', () => {
    expect(extensionIssues(contract, actualTree({ pg_trgm: 'public' }))).toEqual([
      {
        path: ['database', 'postgis'],
        expected: new PostgresExtensionSchemaNode({
          name: 'postgis',
          schemaName: 'extensions',
          control: undefined,
        }),
        actual: undefined,
      },
    ]);
  });

  it('reports an extension installed in another schema as one mismatch', () => {
    expect(extensionIssues(contract, actualTree({ pg_trgm: 'public', postgis: 'public' }))).toEqual(
      [
        {
          path: ['database', 'postgis'],
          expected: new PostgresExtensionSchemaNode({
            name: 'postgis',
            schemaName: 'extensions',
            control: undefined,
          }),
          actual: new PostgresExtensionSchemaNode({
            name: 'postgis',
            schemaName: 'public',
            control: undefined,
          }),
        },
      ],
    );
  });

  it('never reports an extension the contract does not declare', () => {
    expect(
      extensionIssues(
        contract,
        actualTree({ ...DECLARED, plpgsql: 'pg_catalog', pgcrypto: 'public' }),
      ),
    ).toEqual([]);
  });
});

describe('db verify grades extensions', () => {
  it('fails on a missing extension in both modes', () => {
    const actual = actualTree({ pg_trgm: 'public' });
    expect(verify(makeContract(), actual, false).ok).toBe(false);
    expect(verify(makeContract(), actual, true).ok).toBe(false);
  });

  it('fails on an extension installed in another schema', () => {
    const actual = actualTree({ pg_trgm: 'public', postgis: 'public' });
    expect(verify(makeContract(), actual, false).ok).toBe(false);
  });

  it('passes in strict mode with extensions the contract does not declare', () => {
    const actual = actualTree({ ...DECLARED, plpgsql: 'pg_catalog', pg_stat_statements: 'public' });
    expect(verify(makeContract(), actual, true).ok).toBe(true);
  });

  it('checks an external extension: missing fails, present passes', () => {
    const contract = makeContract({ postgisControl: 'external' });
    expect(verify(contract, actualTree({ pg_trgm: 'public' }), false).ok).toBe(false);
    expect(verify(contract, actualTree(DECLARED), true).ok).toBe(true);
  });

  it('checks extensions under a contract whose default policy is external', () => {
    const contract = makeContract({ defaultControlPolicy: 'external' });
    expect(verify(contract, actualTree({ pg_trgm: 'public' }), false).ok).toBe(false);
  });
});

describe('extension diff subjects', () => {
  it('are whole entities filed under the extension entries key', () => {
    expect(postgresDiffSubjectGranularity(PostgresSchemaNodeKind.extension)).toBe('entity');
    expect(postgresDiffSubjectEntityKind(PostgresSchemaNodeKind.extension)).toBe('extension');
  });
});
