import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import type { SqlDescribedContractSpace } from '@internal/family-sql/control';
import { printPsl } from '@internal/psl-printer';
import { SqlStorage } from '@internal/sql-contract/types';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { postgresAuthoringPslBlockDescriptors } from '../../src/core/authoring';
import { PostgresExtension } from '../../src/core/postgres-extension';
import { PostgresSchema } from '../../src/core/postgres-schema';
import { PostgresDatabaseSchemaNode } from '../../src/core/schema-ir/postgres-database-schema-node';
import { PostgresExtensionSchemaNode } from '../../src/core/schema-ir/postgres-extension-schema-node';
import { PostgresNamespaceSchemaNode } from '../../src/core/schema-ir/postgres-namespace-schema-node';
import { PostgresTableSchemaNode } from '../../src/core/schema-ir/postgres-table-schema-node';
import { inferBuildContext, inferFromFixtureTree } from './fixtures';

function databaseWith(installed: Readonly<Record<string, string>>): PostgresDatabaseSchemaNode {
  return new PostgresDatabaseSchemaNode({
    namespaces: {
      public: new PostgresNamespaceSchemaNode({
        schemaName: 'public',
        tables: {
          users: new PostgresTableSchemaNode({
            name: 'users',
            columns: { id: { name: 'id', typeText: 'int4', nullable: false } },
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
    existingSchemas: ['public'],
    pgVersion: 'unknown',
  });
}

function packDeclaring(extension: string): SqlDescribedContractSpace {
  const contract: Contract<SqlStorage> = {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('pack'),
    storage: new SqlStorage({
      storageHash: coreHash('pack'),
      namespaces: {
        public: new PostgresSchema({
          id: 'public',
          entries: { extension: { [extension]: new PostgresExtension({ name: extension }) } },
        }),
      },
    }),
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensions: {},
    meta: {},
  };
  return { spaceId: 'pack', contract };
}

async function inferred(
  installed: Readonly<Record<string, string>>,
  describedContracts?: readonly SqlDescribedContractSpace[],
): Promise<string> {
  return printPsl(
    await inferFromFixtureTree(databaseWith(installed), inferBuildContext, describedContracts),
    { pslBlockDescriptors: postgresAuthoringPslBlockDescriptors },
  );
}

describe('contract infer writes installed extensions', () => {
  it('writes an extension of the default schema at the top level, and skips plpgsql', async () => {
    expect(await inferred({ plpgsql: 'pg_catalog', pg_trgm: 'public' })).toBe(
      [
        '// use prisma-8',
        '',
        'model Users {',
        '  id Int @id',
        '',
        '  @@map("users")',
        '}',
        '',
        'extension pg_trgm {',
        '}',
        '',
      ].join('\n'),
    );
  });

  it('writes an extension of another schema in a namespace block for that schema', async () => {
    const printed = await inferred({ postgis: 'extensions' });
    expect(printed).toContain(
      ['namespace extensions {', '  extension postgis {', '  }', '}'].join('\n'),
    );
  });

  it('writes a hyphenated extension name as the block name', async () => {
    const printed = await inferred({ 'uuid-ossp': 'extensions' });
    expect(printed).toContain(
      ['namespace extensions {', '  extension uuid-ossp {', '  }', '}'].join('\n'),
    );
  });

  it('refuses an extension whose name PSL cannot write', async () => {
    await expect(inferred({ 'odd.name': 'public' })).rejects.toThrow(
      'contract infer: extension "odd.name" is installed, and its name cannot be written as a PSL block name. Declare it in a TypeScript contract with extension("odd.name").',
    );
  });

  it('skips an extension a composed pack declares', async () => {
    const printed = await inferred({ vector: 'public', pg_trgm: 'public' }, [
      packDeclaring('vector'),
    ]);
    expect(printed).toContain('extension pg_trgm {');
    expect(printed).not.toContain('extension vector');
  });
});
