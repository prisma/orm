import { existsSync, rmSync, writeFileSync } from 'node:fs';
import postgresAdapter from '@internal/adapter-postgres/control';
import { enrichContract } from '@internal/cli/control-api';
import postgresDriver from '@internal/driver-postgres/control';
import pgvector from '@internal/extension-pgvector/control';
import sql from '@internal/family-sql/control';
import { createControlStack } from '@internal/framework-components/control';
import { sqlContractCanonicalizationHooks } from '@internal/sql-contract/canonicalization-hooks';
import { sqlEmission } from '@internal/sql-contract-emitter';
import { prismaContract } from '@internal/sql-contract-psl/provider';
import postgres from '@internal/target-postgres/control';
import postgresPackRef from '@internal/target-postgres/pack';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { emit } from '../utils/emit';
import { createIntegrationTestDir } from './utils/cli-test-helpers';

describe('the record an emitted contract keeps of an extension', () => {
  const originalCwd = process.cwd();
  const stack = createControlStack({
    family: sql,
    target: postgres,
    adapter: postgresAdapter,
    driver: postgresDriver,
    extensions: [pgvector],
  });
  let testDir: string;

  beforeEach(() => {
    testDir = createIntegrationTestDir();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  });

  async function emitWithPgvector() {
    const schemaPath = join(testDir, 'schema.prisma');
    writeFileSync(
      schemaPath,
      '// use prisma-8\n\nmodel Document {\n  id Int @id\n  embedding pgvector.Vector(3)\n}\n',
      'utf-8',
    );
    process.chdir(testDir);
    const loaded = await prismaContract('./schema.prisma', {
      target: postgresPackRef,
      createNamespace: postgresCreateNamespace,
    }).source.load({
      composedExtensions: [pgvector.id],
      defaultNamespaceId: stack.target.defaultNamespaceId,
      composedExtensionContracts: new Map(),
      authoringContributions: stack.authoringContributions,
      codecLookup: stack.codecLookup,
      dataTypes: stack.dataTypes,
      controlMutationDefaults: stack.controlMutationDefaults,
      generatorFunctions: stack.generatorFunctions,
      resolvedInputs: [schemaPath],
      capabilities: stack.capabilities,
    });
    if (!loaded.ok) throw new Error(JSON.stringify(loaded.failure, null, 2));
    return emit(
      enrichContract(loaded.value, [postgres, postgresAdapter, pgvector]),
      stack,
      sqlEmission,
      sqlContractCanonicalizationHooks,
    );
  }

  it('names no module the extension types are imported from', async () => {
    const emitted = await emitWithPgvector();
    const contract = JSON.parse(emitted.contractJson) as {
      extensions: Record<string, Record<string, unknown>>;
    };

    expect(contract.extensions['pgvector']).toEqual({
      capabilities: pgvector.capabilities,
      familyId: 'sql',
      id: 'pgvector',
      kind: 'extension',
      targetId: 'postgres',
      version: pgvector.version,
    });
    expect(emitted.contractDts).not.toContain('readonly package:');
  });

  it('still imports the extension types in the generated contract types', async () => {
    const emitted = await emitWithPgvector();
    const extensionImports = emitted.contractDts.match(
      /import type \{[^}]*\} from '@internal\/extension-pgvector\/[^']+';/g,
    );

    expect(extensionImports).toEqual([
      [
        'import type {',
        '  CodecTypes as PgVectorTypes,',
        '  ParameterizedOutputTypesForTypeParams as PgVectorParameterizedOutputTypes,',
        "} from '@internal/extension-pgvector/codec-types';",
      ].join('\n'),
      "import type { QueryOperationTypes as PgVectorQueryOperationTypes } from '@internal/extension-pgvector/operation-types';",
    ]);
  });
});
