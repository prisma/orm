import type { Contract } from '@internal/contract/types';
import { INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
import type { AuthoringTypeConstructorDescriptor } from '@internal/framework-components/authoring';
import { collectScalarTypeConstructors } from '@internal/framework-components/authoring';
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
import { postgresScalarAuthoringTypes } from '@internal/target-postgres/control';
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
  const scalarTypeDescriptors: ReadonlyMap<string, { codecId: string }> =
    collectScalarTypeConstructors(postgresScalarAuthoringTypes);
  const scalarTypeConstructors: Record<string, AuthoringTypeConstructorDescriptor> =
    Object.fromEntries(
      [...scalarTypeDescriptors].map(([name, output]) => [
        name,
        { kind: 'typeConstructor' as const, output },
      ]),
    );
  const bound = bindPslSchema(psl, {
    sourceId: 'extension-lifecycle.integration.test.psl',
    context: {
      composedExtensions: [],
      defaultNamespaceId: 'public',
      composedExtensionContracts: new Map(),
      authoringContributions: {
        ...assembled,
        type: { ...scalarTypeConstructors, ...assembled.type },
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
    return Object.fromEntries(schema.extensions.map((node) => [node.name, node.schemaName]));
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
