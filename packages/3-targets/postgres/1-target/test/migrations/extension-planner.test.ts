import { type Contract, type ControlPolicy, coreHash, profileHash } from '@internal/contract/types';
import type { MigrationOperationPolicy } from '@internal/family-sql/control';
import type { ExecuteRequestLowerer } from '@internal/family-sql/control-adapter';
import { APP_SPACE_ID } from '@internal/framework-components/control';
import { SqlStorage, StorageTable } from '@internal/sql-contract/types';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { createPostgresMigrationPlanner } from '../../src/core/migrations/planner';
import { PostgresSchema } from '../../src/core/postgres-schema';
import { PostgresDatabaseSchemaNode } from '../../src/core/schema-ir/postgres-database-schema-node';
import { PostgresExtensionSchemaNode } from '../../src/core/schema-ir/postgres-extension-schema-node';
import { postgresTypeComponents } from '../postgres-type-lookups';

const lowerer: ExecuteRequestLowerer = {
  lower: () => ({ sql: 'check', params: [] }),
  renderColumnDefault: async () => '',
  lowerToExecuteRequest: async () => ({ sql: 'check', params: [] }),
};

const ALL_CLASSES: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening', 'destructive', 'data'],
};

function contractWith(
  extensions: Readonly<Record<string, string>>,
  options: { readonly control?: ControlPolicy; readonly withTable?: boolean } = {},
): Contract<SqlStorage> {
  const entriesFor = (namespaceId: string) =>
    Object.fromEntries(
      Object.entries(extensions)
        .filter(([, schema]) => schema === namespaceId)
        .map(([name]) => [
          name,
          {
            kind: 'extension',
            name,
            ...(options.control === undefined ? {} : { control: options.control }),
          },
        ]),
    );
  const namespaceIds = new Set(['public', ...Object.values(extensions)]);
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('extension-planner'),
    storage: new SqlStorage({
      storageHash: coreHash('a'.repeat(64)),
      namespaces: Object.fromEntries(
        [...namespaceIds].map((id) => [
          id,
          new PostgresSchema({
            id,
            entries: {
              table:
                id === 'public' && options.withTable === true
                  ? {
                      places: new StorageTable({
                        columns: {
                          id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
                        },
                        primaryKey: { columns: ['id'] },
                        foreignKeys: [],
                        uniques: [],
                        indexes: [],
                      }),
                    }
                  : {},
              extension: entriesFor(id),
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
  existingSchemas: readonly string[] = ['public'],
): PostgresDatabaseSchemaNode {
  return new PostgresDatabaseSchemaNode({
    namespaces: {},
    roles: [],
    extensions: Object.entries(installed).map(
      ([name, schemaName]) =>
        new PostgresExtensionSchemaNode({ name, schemaName, control: undefined }),
    ),
    existingSchemas,
    pgVersion: 'unknown',
  });
}

async function plannedOperations(input: {
  readonly contract: Contract<SqlStorage>;
  readonly schema: PostgresDatabaseSchemaNode;
  readonly fromContract?: Contract<SqlStorage>;
  readonly policy?: MigrationOperationPolicy;
}) {
  const result = createPostgresMigrationPlanner(lowerer).plan({
    contract: input.contract,
    schema: input.schema,
    policy: input.policy ?? ALL_CLASSES,
    fromContract: input.fromContract ?? null,
    origin: null,
    statements: [],
    frameworkComponents: postgresTypeComponents,
    spaceId: APP_SPACE_ID,
    snapshotsImportPath: '../../snapshots',
  });
  if (result.kind !== 'success') throw new Error(JSON.stringify(result));
  const operations = await Promise.all(result.plan.operations);
  return {
    operations: operations.map((op) => ({
      id: op.id,
      operationClass: op.operationClass,
      precheck: op.precheck.map((step) => step.sql),
      execute: op.execute.map((step) => step.sql),
      postcheck: op.postcheck.map((step) => step.sql),
    })),
    typeScript: result.plan.renderTypeScript((specifier) => specifier),
  };
}

describe('planning a missing extension', () => {
  it('creates it in the schema of its namespace, checked before and after', async () => {
    const { operations } = await plannedOperations({
      contract: contractWith({ pg_trgm: 'public' }),
      schema: liveDatabase({}),
    });
    expect(operations).toEqual([
      {
        id: 'extension.pg_trgm',
        operationClass: 'additive',
        precheck: ['check'],
        execute: ['CREATE EXTENSION IF NOT EXISTS "pg_trgm" WITH SCHEMA "public"'],
        postcheck: ['check'],
      },
    ]);
  });

  it('creates a missing schema first, then the extension, then the tables', async () => {
    const { operations } = await plannedOperations({
      contract: contractWith({ postgis: 'extensions' }, { withTable: true }),
      schema: liveDatabase({}),
    });
    expect(operations.map((op) => op.id)).toEqual([
      'schema.extensions',
      'extension.postgis',
      'table.places',
    ]);
  });

  it('writes this.createExtension into the migration file', async () => {
    const { typeScript } = await plannedOperations({
      contract: contractWith({ postgis: 'extensions' }),
      schema: liveDatabase({}, ['public', 'extensions']),
    });
    expect(typeScript).toContain(
      'this.createExtension({ schema: "extensions", extension: "postgis" })',
    );
  });

  it('plans nothing for an extension the contract leaves to someone else', async () => {
    const { operations } = await plannedOperations({
      contract: contractWith({ vector: 'public' }, { control: 'external' }),
      schema: liveDatabase({}),
    });
    expect(operations).toEqual([]);
  });

  it('plans nothing when the extension is installed', async () => {
    const { operations } = await plannedOperations({
      contract: contractWith({ pg_trgm: 'public' }),
      schema: liveDatabase({ pg_trgm: 'public' }),
    });
    expect(operations).toEqual([]);
  });
});

describe('planning an extension the contract no longer declares', () => {
  it('drops it without CASCADE as a destructive operation', async () => {
    const { operations, typeScript } = await plannedOperations({
      contract: contractWith({}),
      fromContract: contractWith({ pg_trgm: 'public' }),
      schema: liveDatabase({ pg_trgm: 'public' }),
    });
    expect(operations).toEqual([
      {
        id: 'dropExtension.pg_trgm',
        operationClass: 'destructive',
        precheck: ['check'],
        execute: ['DROP EXTENSION "pg_trgm"'],
        postcheck: ['check'],
      },
    ]);
    expect(typeScript).toContain('this.dropExtension({ schema: "public", extension: "pg_trgm" })');
  });

  it('never drops an extension no origin contract declared', async () => {
    const { operations } = await plannedOperations({
      contract: contractWith({}),
      schema: liveDatabase({ plpgsql: 'pg_catalog', pg_trgm: 'public' }),
    });
    expect(operations).toEqual([]);
  });
});

describe('planning an extension moved to another namespace', () => {
  it('moves it with ALTER EXTENSION … SET SCHEMA', async () => {
    const { operations, typeScript } = await plannedOperations({
      contract: contractWith({ postgis: 'extensions' }),
      fromContract: contractWith({ postgis: 'public' }),
      schema: liveDatabase({ postgis: 'public' }, ['public', 'extensions']),
    });
    expect(operations).toEqual([
      {
        id: 'setExtensionSchema.postgis',
        operationClass: 'widening',
        precheck: [],
        execute: ['ALTER EXTENSION "postgis" SET SCHEMA "extensions"'],
        postcheck: ['check'],
      },
    ]);
    expect(typeScript).toContain(
      'this.setExtensionSchema({ extension: "postgis", schema: "extensions" })',
    );
  });
});
