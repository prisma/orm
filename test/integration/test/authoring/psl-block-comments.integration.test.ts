import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import postgresAdapter from '@internal/adapter-postgres/control';
import { enrichContract } from '@internal/cli/control-api';
import sql from '@internal/family-sql/control';
import { createControlStack } from '@internal/framework-components/control';
import { sqlContractCanonicalizationHooks } from '@internal/sql-contract/canonicalization-hooks';
import { sqlEmission } from '@internal/sql-contract-emitter';
import { prisma7Contract } from '@internal/sql-contract-prisma7/provider';
import { prismaContract } from '@internal/sql-contract-psl/provider';
import postgres from '@internal/target-postgres/control';
import postgresPackRef from '@internal/target-postgres/pack';
import { prisma7PostgresBinding } from '@internal/target-postgres/prisma7-binding';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { emit } from '../../utils/emit';

const stack = createControlStack({ family: sql, target: postgres, adapter: postgresAdapter });

async function load(schema: string) {
  const schemaPath = join(mkdtempSync(join(tmpdir(), 'psl-block-comments-')), 'schema.prisma');
  writeFileSync(schemaPath, schema, 'utf-8');
  return prismaContract(schemaPath, {
    target: postgresPackRef,
    createNamespace: postgresCreateNamespace,
  }).source.load({
    composedExtensions: [],
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
}

async function loadPrisma7(schema: string) {
  const schemaPath = join(
    mkdtempSync(join(tmpdir(), 'psl-block-comments-prisma7-')),
    'schema.prisma',
  );
  writeFileSync(schemaPath, schema, 'utf-8');
  return prisma7Contract(schemaPath, { binding: prisma7PostgresBinding }).source.load({
    composedExtensions: [],
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
}

describe('PSL block comments', () => {
  it('emits a schema with /* */ comments', async () => {
    const result = await load(`// use prisma-8

/* A comment that belongs to no declaration. */

/**
 * A documented enum.
 */
enum Kind {
  @@type("pg/text@1")
  A /* first */
  B
}

model Event {
  /* the key */
  id   Int  @id @default(autoincrement())
  kind Kind /* trailing */
}
`);
    if (!result.ok) throw new Error(JSON.stringify(result.failure.diagnostics));

    await expect(
      emit(
        enrichContract(result.value, [postgres, postgresAdapter]),
        stack,
        sqlEmission,
        sqlContractCanonicalizationHooks,
      ),
    ).resolves.not.toThrow();
  });

  it('emits the same schema through prisma7Schema()', async () => {
    const result = await loadPrisma7(`/* A comment that belongs to no declaration. */

datasource db {
  provider = "postgresql"
}

/**
 * A documented enum.
 */
enum Kind {
  A /* first */
  B
}

model Event {
  /* the key */
  id   Int  @id @default(autoincrement())
  kind Kind /* trailing */
}
`);
    if (!result.ok) throw new Error(JSON.stringify(result.failure.diagnostics));

    await expect(
      emit(
        enrichContract(result.value, [postgres, postgresAdapter]),
        stack,
        sqlEmission,
        sqlContractCanonicalizationHooks,
      ),
    ).resolves.not.toThrow();
  });
});
