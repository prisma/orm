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

const prisma8Commented = `// use prisma-8

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
`;

const prisma8Plain = `// use prisma-8

enum Kind {
  @@type("pg/text@1")
  A
  B
}

model Event {
  id   Int  @id @default(autoincrement())
  kind Kind
}
`;

const prisma7Commented = `/* A comment that belongs to no declaration. */

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
`;

const prisma7Plain = `datasource db {
  provider = "postgresql"
}

enum Kind {
  A
  B
}

model Event {
  id   Int  @id @default(autoincrement())
  kind Kind
}
`;

async function emitted(loaded: Awaited<ReturnType<typeof load>>) {
  if (!loaded.ok) throw new Error(JSON.stringify(loaded.failure.diagnostics));
  return emit(
    enrichContract(loaded.value, [postgres, postgresAdapter]),
    stack,
    sqlEmission,
    sqlContractCanonicalizationHooks,
  );
}

describe('PSL block comments', () => {
  it('emits the same contract as the schema without /* */ comments', async () => {
    const commented = await emitted(await load(prisma8Commented));
    const plain = await emitted(await load(prisma8Plain));
    expect(commented).toEqual(plain);
  });

  it('emits the same contract as the schema without /* */ comments through prisma7Schema()', async () => {
    const commented = await emitted(await loadPrisma7(prisma7Commented));
    const plain = await emitted(await loadPrisma7(prisma7Plain));
    expect(commented).toEqual(plain);
  });
});
