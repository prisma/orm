import type { Contract } from '@internal/contract/types';
import { INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
import { createDataTypeLookup } from '@internal/framework-components/codec';
import { EMPTY_GENERATOR_FUNCTIONS } from '@internal/framework-components/components';
import {
  APP_SPACE_ID,
  assembleAuthoringContributions,
  type MigrationOperationPolicy,
} from '@internal/framework-components/control';
import { withSeedDiagnostics } from '@internal/psl-parser/interpret';
import { bindPslSchema } from '@internal/psl-parser/test';
import type { SqlStorage } from '@internal/sql-contract/types';
import { interpretPslDocumentToSqlContract } from '@internal/sql-contract-psl';
import {
  describeUnsupportedSqlAttribute,
  sqlAttributeSpecs,
} from '@internal/sql-contract-psl/attribute-specs';
import { sqlContextInput } from '@internal/sql-contract-psl/test';
import type { SqlSchemaIRNode } from '@internal/sql-schema-ir/types';
import { createPostgresBuiltinCodecLookup } from '@internal/target-postgres/codecs';
import { postgresDataTypes } from '@internal/target-postgres/data-types';
import {
  PostgresDatabaseSchemaNode,
  postgresCreateNamespace,
} from '@internal/target-postgres/types';
import { ifDefined } from '@internal/utils/defined';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  controlAdapter,
  createDriver,
  createTestDatabase,
  emptySchema,
  familyInstance,
  formatRunnerFailure,
  frameworkComponents,
  type PostgresControlDriver,
  postgresTargetDescriptor,
  synthEdges,
  testTimeout,
} from './fixtures/runner-fixtures';

const IN_EXTENSIONS_SCHEMA = `
namespace extensions {
  extension vector {}
}

model Doc {
  id Int @id
}
`;

const IN_PUBLIC = `
extension vector {}

model Doc {
  id Int @id
}
`;

const WITHOUT_EXTENSION = `
model Doc {
  id Int @id
}
`;

const ALLOW_DESTRUCTIVE: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening', 'destructive'],
};

function contractFromPsl(psl: string): Contract<SqlStorage> {
  const assembled = assembleAuthoringContributions([postgresTargetDescriptor]);
  const bound = bindPslSchema(psl, {
    sourceId: 'extension-lifecycle.integration.test.psl',
    context: {
      composedExtensions: [],
      defaultNamespaceId: 'public',
      composedExtensionContracts: new Map(),
      authoringContributions: {
        ...assembled,
        attributeSpecs: sqlAttributeSpecs,
      },
      pslDiagnostics: { describeUnsupportedAttribute: describeUnsupportedSqlAttribute },
      codecLookup: createPostgresBuiltinCodecLookup(),
      controlMutationDefaults: { defaultFunctionRegistry: new Map(), generatorDescriptors: [] },
      generatorFunctions: EMPTY_GENERATOR_FUNCTIONS,
      dataTypes: {
        entries: assembled.dataTypes,
        lookup: createDataTypeLookup(postgresDataTypes),
        dataTypeOfCodec: () => undefined,
      },
      resolvedInputs: [],
      capabilities: {},
    },
  });
  const result = withSeedDiagnostics(
    interpretPslDocumentToSqlContract({
      documents: bound.documents,
      sources: bound.sources,
      symbolTable: bound.symbolTable,
      binder: bound.binder,
      ...sqlContextInput(bound.context),
      target: {
        kind: 'target' as const,
        familyId: 'sql' as const,
        targetId: 'postgres' as const,
        id: 'postgres',
        version: postgresTargetDescriptor.version,
        capabilities: {},
        defaultNamespaceId: 'public',
        ...ifDefined('authoring', postgresTargetDescriptor.authoring),
      },
      createNamespace: postgresCreateNamespace,
    }),
    bound.seedDiagnostics,
  );
  if (!result.ok) throw new Error(`PSL interpretation failed: ${JSON.stringify(result)}`);
  return result.value as Contract<SqlStorage>;
}

describe('Postgres extensions against a live database', { concurrent: false }, () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let driver: PostgresControlDriver;

  beforeAll(async () => {
    database = await createTestDatabase();
    driver = await createDriver(database.connectionString);
  }, testTimeout);

  afterAll(async () => {
    await driver?.close();
    await database?.close();
  }, testTimeout);

  async function introspect(): Promise<PostgresDatabaseSchemaNode> {
    const schema = await familyInstance.introspect({ driver });
    PostgresDatabaseSchemaNode.assert(schema);
    return schema;
  }

  async function installed(): Promise<Readonly<Record<string, string>>> {
    const schema = await introspect();
    return Object.fromEntries(
      schema.extensions.flatMap((node) =>
        node.location.kind === 'installed' ? [[node.name, node.location.schemaName]] : [],
      ),
    );
  }

  async function plan(input: {
    readonly contract: Contract<SqlStorage>;
    readonly schema: SqlSchemaIRNode;
    readonly policy: MigrationOperationPolicy;
    readonly fromContract?: Contract<SqlStorage>;
  }) {
    const result = postgresTargetDescriptor.createPlanner(controlAdapter).plan({
      contract: input.contract,
      schema: input.schema,
      policy: input.policy,
      fromContract: input.fromContract ?? null,
      origin: null,
      statements: [],
      frameworkComponents,
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });
    if (result.kind !== 'success') throw new Error(`Planner failed: ${JSON.stringify(result)}`);
    return result.plan;
  }

  async function apply(
    planned: Awaited<ReturnType<typeof plan>>,
    contract: Contract<SqlStorage>,
    policy: MigrationOperationPolicy,
  ): Promise<readonly string[]> {
    const result = await postgresTargetDescriptor.createRunner(familyInstance).execute({
      driver,
      perSpaceOptions: [
        {
          space: APP_SPACE_ID,
          plan: planned,
          migrationEdges: synthEdges(planned),
          driver,
          destinationContract: contract,
          policy,
          frameworkComponents,
        },
      ],
    });
    if (!result.ok) throw new Error(`Runner failed:\n${formatRunnerFailure(result.failure)}`);
    return (await Promise.all(planned.operations)).map((op) => op.id);
  }

  it('reads every installed extension with its schema', { timeout: testTimeout }, async () => {
    expect(await installed()).toMatchObject({ plpgsql: 'pg_catalog' });
  });

  it('creates the schema and the extension in it, then verifies clean', {
    timeout: testTimeout,
  }, async () => {
    const contract = contractFromPsl(IN_EXTENSIONS_SCHEMA);
    const planned = await plan({ contract, schema: emptySchema, policy: INIT_ADDITIVE_POLICY });
    expect(await apply(planned, contract, INIT_ADDITIVE_POLICY)).toEqual([
      'schema.extensions',
      'extension.vector',
      'table.Doc',
    ]);
    expect(await installed()).toMatchObject({ vector: 'extensions' });

    const verified = familyInstance.verifySchema({
      contract,
      schema: await familyInstance.introspect({ driver, contract }),
      strict: true,
      frameworkComponents,
    });
    expect(verified.ok).toBe(true);

    const replanned = await plan({
      contract,
      schema: await introspect(),
      policy: ALLOW_DESTRUCTIVE,
    });
    expect(await Promise.all(replanned.operations)).toEqual([]);
  });

  it('moves the extension to the namespace the contract now declares', {
    timeout: testTimeout,
  }, async () => {
    const contract = contractFromPsl(IN_PUBLIC);
    const planned = await plan({ contract, schema: await introspect(), policy: ALLOW_DESTRUCTIVE });
    expect(await apply(planned, contract, ALLOW_DESTRUCTIVE)).toEqual([
      'setExtensionSchema.vector',
    ]);
    expect(await installed()).toMatchObject({ vector: 'public' });
  });

  it('drops the extension the contract no longer declares', { timeout: testTimeout }, async () => {
    const contract = contractFromPsl(WITHOUT_EXTENSION);
    const planned = await plan({
      contract,
      schema: await introspect(),
      policy: ALLOW_DESTRUCTIVE,
      fromContract: contractFromPsl(IN_PUBLIC),
    });
    expect(await apply(planned, contract, ALLOW_DESTRUCTIVE)).toEqual(['dropExtension.vector']);
    expect(Object.keys(await installed())).not.toContain('vector');
  });
});

const UNBOUND_VECTOR = `
namespace unbound {
  extension vector {}
}

model Doc {
  id Int @id
}
`;

const UNBOUND_PLPGSQL = `
namespace unbound {
  extension plpgsql {}
}

model Doc {
  id Int @id
}
`;

describe('Postgres extensions in the unbound namespace against a live database', {
  concurrent: false,
}, () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let driver: PostgresControlDriver;

  beforeAll(async () => {
    database = await createTestDatabase();
    driver = await createDriver(database.connectionString);
  }, testTimeout);

  afterAll(async () => {
    await driver?.close();
    await database?.close();
  }, testTimeout);

  async function vectorNode() {
    const schema = await familyInstance.introspect({ driver });
    PostgresDatabaseSchemaNode.assert(schema);
    return schema.extensions.find((node) => node.name === 'vector');
  }

  async function verify(contract: Contract<SqlStorage>) {
    return familyInstance.verifySchema({
      contract,
      schema: await familyInstance.introspect({ driver, contract }),
      strict: false,
      frameworkComponents,
    });
  }

  it('creates the extension with no schema, in the current schema, then verifies clean', {
    timeout: testTimeout,
  }, async () => {
    const contract = contractFromPsl(UNBOUND_VECTOR);
    const planned = postgresTargetDescriptor.createPlanner(controlAdapter).plan({
      contract,
      schema: emptySchema,
      policy: INIT_ADDITIVE_POLICY,
      fromContract: null,
      origin: null,
      statements: [],
      frameworkComponents,
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });
    if (planned.kind !== 'success') throw new Error(JSON.stringify(planned));
    const operations = await Promise.all(planned.plan.operations);
    expect(operations.find((op) => op.id === 'extension.vector')?.execute).toEqual([
      expect.objectContaining({ sql: 'CREATE EXTENSION IF NOT EXISTS "vector"' }),
    ]);
    const result = await postgresTargetDescriptor.createRunner(familyInstance).execute({
      driver,
      perSpaceOptions: [
        {
          space: APP_SPACE_ID,
          plan: planned.plan,
          migrationEdges: synthEdges(planned.plan),
          driver,
          destinationContract: contract,
          policy: INIT_ADDITIVE_POLICY,
          frameworkComponents,
        },
      ],
    });
    if (!result.ok) throw new Error(`Runner failed:\n${formatRunnerFailure(result.failure)}`);
    expect((await vectorNode())?.location).toMatchObject({
      kind: 'installed',
      schemaName: 'public',
    });
    expect((await verify(contract)).ok).toBe(true);
  });

  it('reads the search path the catalog reports for the connection', {
    timeout: testTimeout,
  }, async () => {
    await driver.query('CREATE SCHEMA IF NOT EXISTS extensions');
    await driver.query('SET search_path TO "$user", public, extensions');
    const catalog = await driver.query<{ search_path: string }>(
      'SELECT pg_catalog.current_schemas(true)::text AS search_path',
    );
    expect(catalog.rows[0]?.search_path).toBe('{pg_catalog,public,extensions}');
    expect((await vectorNode())?.location).toEqual({
      kind: 'installed',
      schemaName: 'public',
      searchPath: ['pg_catalog', 'public', 'extensions'],
    });
  });

  it('verifies an extension in a schema on the search path, and fails one off it', {
    timeout: testTimeout,
  }, async () => {
    const contract = contractFromPsl(UNBOUND_VECTOR);
    await driver.query('ALTER EXTENSION vector SET SCHEMA extensions');
    await driver.query('SET search_path TO "$user", public, extensions');
    expect((await verify(contract)).ok).toBe(true);

    await driver.query('SET search_path TO public');
    const failed = await verify(contract);
    expect(failed.ok).toBe(false);
    expect(failed.schema.issues.map((issue) => issue.explanation?.text)).toEqual([
      'extension "vector" is installed in schema "extensions", which is not on the search path (pg_catalog, public). Add schema "extensions" to the connection\'s search_path, or reinstall the extension in a schema on it.',
    ]);
  });

  it('verifies an extension in pg_catalog', { timeout: testTimeout }, async () => {
    await driver.query('SET search_path TO public');
    expect((await verify(contractFromPsl(UNBOUND_PLPGSQL))).ok).toBe(true);
  });

  it('skips the offline unbound-to-named move when the extension is already in the named schema', {
    timeout: testTimeout,
  }, async () => {
    const fromContract = contractFromPsl(UNBOUND_VECTOR);
    const contract = contractFromPsl(IN_EXTENSIONS_SCHEMA);
    const offlineSchema = postgresTargetDescriptor.migrations.contractToSchema(
      fromContract,
      frameworkComponents,
    ) as SqlSchemaIRNode;
    PostgresDatabaseSchemaNode.assert(offlineSchema);
    const planned = postgresTargetDescriptor.createPlanner(controlAdapter).plan({
      contract,
      schema: offlineSchema,
      policy: ALLOW_DESTRUCTIVE,
      fromContract,
      origin: null,
      statements: [],
      frameworkComponents,
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });
    if (planned.kind !== 'success') throw new Error(JSON.stringify(planned));
    const operations = await Promise.all(planned.plan.operations);
    expect(operations.find((op) => op.id === 'setExtensionSchema.vector')?.execute).toEqual([
      expect.objectContaining({ sql: 'ALTER EXTENSION "vector" SET SCHEMA "extensions"' }),
    ]);
    expect((await vectorNode())?.location).toMatchObject({
      kind: 'installed',
      schemaName: 'extensions',
    });

    const result = await postgresTargetDescriptor.createRunner(familyInstance).execute({
      driver,
      perSpaceOptions: [
        {
          space: APP_SPACE_ID,
          plan: planned.plan,
          migrationEdges: synthEdges(planned.plan),
          driver,
          destinationContract: contract,
          policy: ALLOW_DESTRUCTIVE,
          frameworkComponents,
        },
      ],
    });
    if (!result.ok) throw new Error(`Runner failed:\n${formatRunnerFailure(result.failure)}`);
    expect((await vectorNode())?.location).toMatchObject({
      kind: 'installed',
      schemaName: 'extensions',
    });
  });

  it('runs a move to the schema the extension is already in as a no-op in PostgreSQL', {
    timeout: testTimeout,
  }, async () => {
    const outcome = await driver.query('ALTER EXTENSION vector SET SCHEMA extensions').then(
      () => 'no-op',
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    );
    expect(outcome).toBe('no-op');
    expect((await vectorNode())?.location).toMatchObject({
      kind: 'installed',
      schemaName: 'extensions',
    });
  });

  async function applyOfflineMove(fromPsl: string, toPsl: string) {
    const fromContract = contractFromPsl(fromPsl);
    const contract = contractFromPsl(toPsl);
    const offlineSchema = postgresTargetDescriptor.migrations.contractToSchema(
      fromContract,
      frameworkComponents,
    ) as SqlSchemaIRNode;
    PostgresDatabaseSchemaNode.assert(offlineSchema);
    const planned = postgresTargetDescriptor.createPlanner(controlAdapter).plan({
      contract,
      schema: offlineSchema,
      policy: ALLOW_DESTRUCTIVE,
      fromContract,
      origin: null,
      statements: [],
      frameworkComponents,
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });
    if (planned.kind !== 'success') throw new Error(JSON.stringify(planned));
    const operations = await Promise.all(planned.plan.operations);
    const result = await postgresTargetDescriptor.createRunner(familyInstance).execute({
      driver,
      perSpaceOptions: [
        {
          space: APP_SPACE_ID,
          plan: planned.plan,
          migrationEdges: synthEdges(planned.plan),
          driver,
          destinationContract: contract,
          policy: ALLOW_DESTRUCTIVE,
          frameworkComponents,
        },
      ],
    });
    if (!result.ok) throw new Error(`Runner failed:\n${formatRunnerFailure(result.failure)}`);
    return {
      moves: operations
        .filter((op) => op.id === 'setExtensionSchema.vector')
        .flatMap((op) => op.execute.map((step) => step.sql)),
      operationsExecuted: result.value.perSpaceResults[0]?.value.operationsExecuted,
    };
  }

  it('moves the extension to public on an offline unbound-to-public change, and skips the move once it is there', {
    timeout: testTimeout,
  }, async () => {
    expect((await vectorNode())?.location).toMatchObject({ schemaName: 'extensions' });

    const moved = await applyOfflineMove(UNBOUND_VECTOR, IN_PUBLIC);
    expect(moved).toEqual({
      moves: ['ALTER EXTENSION "vector" SET SCHEMA "public"'],
      operationsExecuted: 1,
    });
    expect((await vectorNode())?.location).toMatchObject({ schemaName: 'public' });

    const skipped = await applyOfflineMove(UNBOUND_VECTOR, IN_PUBLIC);
    expect(skipped).toEqual({
      moves: ['ALTER EXTENSION "vector" SET SCHEMA "public"'],
      operationsExecuted: 0,
    });
    expect((await vectorNode())?.location).toMatchObject({ schemaName: 'public' });
  });
});
