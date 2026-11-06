import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import {
  type MigrationOperationPolicy,
  storageNameOfOperation,
} from '@internal/family-sql/control';
import type { ExecuteRequestLowerer } from '@internal/family-sql/control-adapter';
import { verifySqlSchemaByDiff } from '@internal/family-sql/diff';
import { APP_SPACE_ID, type SchemaOwnership } from '@internal/framework-components/control';
import { SqlStorage } from '@internal/sql-contract/types';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { contractToPostgresDatabaseSchemaNode } from '../../src/core/migrations/contract-to-postgres-database-schema-node';
import { diffPostgresSchema } from '../../src/core/migrations/diff-database-schema';
import { createPostgresMigrationPlanner } from '../../src/core/migrations/planner';
import { type PostgresContract, PostgresSchema } from '../../src/core/postgres-schema';
import { PostgresDatabaseSchemaNode } from '../../src/core/schema-ir/postgres-database-schema-node';
import { PostgresExtensionSchemaNode } from '../../src/core/schema-ir/postgres-extension-schema-node';
import { postgresDiffSubjectGranularity } from '../../src/core/schema-ir/schema-node-kinds';
import { postgresTypeComponents, postgresTypeLookups } from '../postgres-type-lookups';

const UNBOUND = '__unbound__';

const lowerer: ExecuteRequestLowerer = {
  lower: () => ({ sql: 'check', params: [] }),
  renderColumnDefault: async () => '',
  lowerToExecuteRequest: async () => ({ sql: 'check', params: [] }),
};

const ALL_CLASSES: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening', 'destructive', 'data'],
};

function contractDeclaring(extensions: Readonly<Record<string, string>>): PostgresContract {
  const namespaceIds = new Set(['public', ...Object.values(extensions)]);
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('extension-search-path'),
    storage: new SqlStorage({
      storageHash: coreHash('b'.repeat(64)),
      namespaces: Object.fromEntries(
        [...namespaceIds].map((id) => [
          id,
          new PostgresSchema({
            id,
            entries: {
              table: {},
              extension: Object.fromEntries(
                Object.entries(extensions)
                  .filter(([, namespaceId]) => namespaceId === id)
                  .map(([name]) => [name, { kind: 'extension', name }]),
              ),
            },
          }),
        ]),
      ),
    }),
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensions: {},
    meta: {},
  };
}

function liveDatabase(
  installed: Readonly<Record<string, string>>,
  searchPath: readonly string[],
): PostgresDatabaseSchemaNode {
  return new PostgresDatabaseSchemaNode({
    namespaces: {},
    roles: [],
    extensions: Object.entries(installed).map(
      ([name, schemaName]) =>
        new PostgresExtensionSchemaNode({
          name,
          location: { kind: 'installed', schemaName, searchPath },
          control: undefined,
        }),
    ),
    existingSchemas: ['public', 'extensions'],
    pgVersion: 'unknown',
  });
}

const SUPABASE_SEARCH_PATH = ['pg_catalog', 'public', 'extensions'];
const DEFAULT_SEARCH_PATH = ['pg_catalog', 'public'];

function verify(contract: Contract<SqlStorage>, schema: PostgresDatabaseSchemaNode) {
  return verifySqlSchemaByDiff({
    contract,
    schema,
    strict: false,
    frameworkComponents: postgresTypeComponents,
    diffSchema: diffPostgresSchema,
    granularityOf: postgresDiffSubjectGranularity,
  });
}

function plan(input: {
  readonly contract: Contract<SqlStorage>;
  readonly schema: PostgresDatabaseSchemaNode;
  readonly fromContract?: Contract<SqlStorage>;
  readonly ownership?: SchemaOwnership;
}) {
  return createPostgresMigrationPlanner(lowerer).plan({
    contract: input.contract,
    schema: input.schema,
    policy: ALL_CLASSES,
    fromContract: input.fromContract ?? null,
    origin: null,
    statements: [],
    frameworkComponents: postgresTypeComponents,
    spaceId: APP_SPACE_ID,
    snapshotsImportPath: '../../snapshots',
    ...(input.ownership === undefined ? {} : { ownership: input.ownership }),
  });
}

/** A composition in which an extension pack declares `vector` in the unbound namespace. */
const PGVECTOR_COMPOSED: SchemaOwnership = {
  declaresEntity: (coordinate) =>
    coordinate.namespaceId === UNBOUND &&
    coordinate.entityKind === 'extension' &&
    coordinate.entityName === 'vector',
  namespaceDeclaringSpaces: (namespaceId) => (namespaceId === UNBOUND ? ['pgvector'] : []),
};

async function plannedOperations(input: Parameters<typeof plan>[0]) {
  const result = plan(input);
  if (result.kind !== 'success') throw new Error(JSON.stringify(result));
  const operations = await Promise.all(result.plan.operations);
  return {
    operations: operations.map((op) => ({
      id: op.id,
      target: op.target,
      execute: op.execute.map((step) => step.sql),
    })),
    typeScript: result.plan.renderTypeScript((specifier) => specifier),
  };
}

function offlineSchemaOf(contract: PostgresContract): PostgresDatabaseSchemaNode {
  return contractToPostgresDatabaseSchemaNode(contract, {
    annotationNamespace: 'pg',
    dataTypeLookup: postgresTypeLookups.dataTypeLookup,
    codecLookup: postgresTypeLookups.codecLookup,
  });
}

describe('the expected tree for an extension in the unbound namespace', () => {
  it('has no fixed schema', () => {
    expect(offlineSchemaOf(contractDeclaring({ vector: UNBOUND })).extensions).toEqual([
      new PostgresExtensionSchemaNode({
        name: 'vector',
        location: { kind: 'searchPath' },
        control: undefined,
      }),
    ]);
  });
});

describe('db verify checks an unbound extension against the search path', () => {
  const contract = contractDeclaring({ vector: UNBOUND });

  it('passes when the extension is in a schema on the search path', () => {
    expect(verify(contract, liveDatabase({ vector: 'extensions' }, SUPABASE_SEARCH_PATH)).ok).toBe(
      true,
    );
  });

  it('passes when the extension is in pg_catalog', () => {
    expect(
      verify(
        contractDeclaring({ plpgsql: UNBOUND }),
        liveDatabase({ plpgsql: 'pg_catalog' }, ['pg_catalog', 'public']),
      ).ok,
    ).toBe(true);
  });

  it('fails, naming the schema and the search path, when the schema is off the search path', () => {
    const result = verify(
      contract,
      liveDatabase({ vector: 'extensions' }, ['pg_catalog', 'public']),
    );
    expect(result.ok).toBe(false);
    expect(result.schema.issues.map((issue) => issue.explanation?.text)).toEqual([
      'extension "vector" is installed in schema "extensions", which is not on the search path (pg_catalog, public). Add schema "extensions" to the connection\'s search_path, or reinstall the extension in a schema on it.',
    ]);
  });

  it('fails when the extension is missing', () => {
    expect(verify(contract, liveDatabase({}, SUPABASE_SEARCH_PATH)).ok).toBe(false);
  });

  it('checks a bound extension against its schema only', () => {
    expect(
      verify(
        contractDeclaring({ vector: 'public' }),
        liveDatabase({ vector: 'extensions' }, SUPABASE_SEARCH_PATH),
      ).ok,
    ).toBe(false);
  });
});

describe('planning an unbound extension', () => {
  const contract = contractDeclaring({ vector: UNBOUND });

  it('creates a missing one with no WITH SCHEMA', async () => {
    const { operations, typeScript } = await plannedOperations({
      contract,
      schema: liveDatabase({}, DEFAULT_SEARCH_PATH),
    });
    expect(operations).toEqual([
      {
        id: 'extension.vector',
        target: {
          id: 'postgres',
          details: { objectType: 'dependency', name: 'vector' },
        },
        execute: ['CREATE EXTENSION IF NOT EXISTS "vector"'],
      },
    ]);
    expect(typeScript).toContain('this.createExtension({ extension: "vector" })');
    expect(JSON.stringify(operations)).not.toContain(UNBOUND);
    expect(typeScript).not.toContain(UNBOUND);
  });

  it('plans nothing offline when the origin installed it in public', async () => {
    const fromContract = contractDeclaring({ vector: 'public' });
    const { operations } = await plannedOperations({
      contract,
      fromContract,
      schema: offlineSchemaOf(fromContract),
    });
    expect(operations).toEqual([]);
  });

  it('plans nothing offline when the origin declared it in a named namespace', async () => {
    const fromContract = contractDeclaring({ vector: 'extensions' });
    const { operations } = await plannedOperations({
      contract,
      fromContract,
      schema: offlineSchemaOf(fromContract),
    });
    expect(operations).toEqual([]);
  });

  it('names an unbound create and drop by the extension name alone', async () => {
    const fromContract = contractDeclaring({ vector: UNBOUND });
    const dropped = plan({
      contract: contractDeclaring({}),
      fromContract,
      schema: offlineSchemaOf(fromContract),
    });
    const created = plan({ contract, schema: liveDatabase({}, DEFAULT_SEARCH_PATH) });
    if (dropped.kind !== 'success' || created.kind !== 'success') throw new Error('plan failed');
    const operations = await Promise.all([...created.plan.operations, ...dropped.plan.operations]);
    expect(operations.map((op) => op.target.details)).toEqual([
      { objectType: 'dependency', name: 'vector' },
      { objectType: 'dependency', name: 'vector' },
    ]);
    expect(operations.map(storageNameOfOperation)).toEqual(['vector', 'vector']);
  });

  it('plans nothing offline when the origin also declared it unbound', async () => {
    const { operations } = await plannedOperations({
      contract,
      fromContract: contract,
      schema: offlineSchemaOf(contract),
    });
    expect(operations).toEqual([]);
  });

  it('plans nothing when the live extension is on the search path', async () => {
    const { operations } = await plannedOperations({
      contract,
      schema: liveDatabase({ vector: 'extensions' }, SUPABASE_SEARCH_PATH),
    });
    expect(operations).toEqual([]);
  });

  it('refuses to move a live extension that is off the search path', () => {
    const result = plan({
      contract,
      schema: liveDatabase({ vector: 'extensions' }, ['pg_catalog', 'public']),
    });
    expect(result).toMatchObject({
      kind: 'failure',
      conflicts: [
        {
          kind: 'unsupportedOperation',
          summary:
            'Extension "vector" is installed in schema "extensions", which is not on the search path (pg_catalog, public). The contract declares it in the unbound namespace, so the planner does not move it.',
          why: 'Add schema "extensions" to the connection\'s search_path, or reinstall the extension in a schema on it.',
        },
      ],
    });
  });

  it('moves it from public offline when the destination names a namespace', async () => {
    const fromContract = contractDeclaring({ vector: UNBOUND });
    const { operations } = await plannedOperations({
      contract: contractDeclaring({ vector: 'extensions' }),
      fromContract,
      schema: offlineSchemaOf(fromContract),
    });
    expect(operations.map((op) => op.id)).toEqual([
      'schema.extensions',
      'setExtensionSchema.vector',
    ]);
    expect(operations[1]?.execute).toEqual(['ALTER EXTENSION "vector" SET SCHEMA "extensions"']);
  });

  it('moves it to public offline when the destination names public, since it may be in any schema on the search path', async () => {
    const fromContract = contractDeclaring({ vector: UNBOUND });
    const { operations, typeScript } = await plannedOperations({
      contract: contractDeclaring({ vector: 'public' }),
      fromContract,
      schema: offlineSchemaOf(fromContract),
    });
    expect(operations.map((op) => op.id)).toEqual(['setExtensionSchema.vector']);
    expect(operations[0]?.execute).toEqual(['ALTER EXTENSION "vector" SET SCHEMA "public"']);
    expect(typeScript).toContain(
      'this.setExtensionSchema({ extension: "vector", schema: "public" })',
    );
  });

  it('drops an unbound extension the destination no longer declares, naming no schema', async () => {
    const fromContract = contractDeclaring({ vector: UNBOUND });
    const { operations, typeScript } = await plannedOperations({
      contract: contractDeclaring({}),
      fromContract,
      schema: offlineSchemaOf(fromContract),
    });
    expect(operations.map((op) => op.execute)).toEqual([['DROP EXTENSION "vector"']]);
    expect(typeScript).toContain('this.dropExtension({ extension: "vector" })');
    expect(JSON.stringify(operations)).not.toContain(UNBOUND);
  });
});

describe('planning an application beside a pack that declares the extension', () => {
  it.each([
    ['a named namespace', 'extensions'],
    ['the default namespace', 'public'],
  ])('refuses an application that declares it in %s', (_, namespaceId) => {
    const result = plan({
      contract: contractDeclaring({ vector: namespaceId }),
      schema: liveDatabase({}, DEFAULT_SEARCH_PATH),
      ownership: PGVECTOR_COMPOSED,
    });
    expect(result).toMatchObject({
      kind: 'failure',
      conflicts: [
        {
          kind: 'unsupportedOperation',
          summary: `Extension "vector" is declared in namespace "${namespaceId}" by this contract, and an extension pack declares it in namespace "unbound".`,
          why: 'Remove this declaration from the contract; the pack installs the extension.',
        },
      ],
    });
  });

  it('plans no drop when the application stops declaring it', async () => {
    const { operations } = await plannedOperations({
      contract: contractDeclaring({}),
      fromContract: contractDeclaring({ vector: 'public' }),
      schema: liveDatabase({ vector: 'public' }, SUPABASE_SEARCH_PATH),
      ownership: PGVECTOR_COMPOSED,
    });
    expect(operations).toEqual([]);
  });

  it("never drops the pack's extension installed in another schema", async () => {
    const { operations } = await plannedOperations({
      contract: contractDeclaring({}),
      fromContract: contractDeclaring({ vector: 'extensions' }),
      schema: liveDatabase({ vector: 'extensions' }, SUPABASE_SEARCH_PATH),
      ownership: PGVECTOR_COMPOSED,
    });
    expect(operations).toEqual([]);
  });

  it('still drops an extension no space declares', async () => {
    const { operations } = await plannedOperations({
      contract: contractDeclaring({}),
      fromContract: contractDeclaring({ pg_trgm: 'public' }),
      schema: liveDatabase({ pg_trgm: 'public' }, SUPABASE_SEARCH_PATH),
      ownership: PGVECTOR_COMPOSED,
    });
    expect(operations.map((op) => op.id)).toEqual(['dropExtension.pg_trgm']);
  });
});
