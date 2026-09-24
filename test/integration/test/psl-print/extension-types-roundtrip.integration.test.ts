import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import postgresAdapter from '@internal/adapter-postgres/control';
import type { Contract } from '@internal/contract/types';
import postgresDriver from '@internal/driver-postgres/control';
import pgvector from '@internal/extension-pgvector/control';
import sql from '@internal/family-sql/control';
import { createControlStack } from '@internal/framework-components/control';
import { printPsl } from '@internal/psl-printer';
import type { SqlStorage } from '@internal/sql-contract/types';
import { prismaContract } from '@internal/sql-contract-psl/provider';
import { PG_INT_CODEC_ID, PG_TEXT_CODEC_ID } from '@internal/target-postgres/codec-ids';
import postgres from '@internal/target-postgres/control';
import postgresPackRef from '@internal/target-postgres/pack';
import { PostgresContractSerializer } from '@internal/target-postgres/runtime';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import { blindCast } from '@internal/utils/casts';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';

const stack = createControlStack({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  driver: postgresDriver,
  extensions: [pgvector],
});

async function read(text: string): Promise<Contract<SqlStorage>> {
  const path = join(mkdtempSync(join(tmpdir(), 'psl-print-extension-')), 'contract.prisma');
  writeFileSync(path, text);
  const result = await prismaContract(path, {
    target: postgresPackRef,
    createNamespace: postgresCreateNamespace,
    enumInferenceCodecs: { text: PG_TEXT_CODEC_ID, int: PG_INT_CODEC_ID },
  }).source.load({
    composedExtensions: stack.extensions.map((extension) => extension.id),
    composedExtensionContracts: stack.extensionContracts,
    authoringContributions: stack.authoringContributions,
    codecLookup: stack.codecLookup,
    dataTypeLookup: stack.dataTypeLookup,
    controlMutationDefaults: stack.controlMutationDefaults,
    resolvedInputs: [path],
    capabilities: stack.capabilities,
  });
  if (!result.ok) {
    throw new Error(`the PSL did not load: ${JSON.stringify(result.failure.diagnostics)}\n${text}`);
  }
  return blindCast<Contract<SqlStorage>, 'the Postgres PSL source yields a SQL contract'>(
    result.value,
  );
}

function serialize(contract: Contract<SqlStorage>): unknown {
  const { capabilities: _, ...authored } = JSON.parse(
    JSON.stringify(new PostgresContractSerializer().serializeContract(contract)),
  );
  return authored;
}

describe('a printed contract with an extension-contributed column type', () => {
  it('writes the extension type and reads back as the same contract', async () => {
    const authored = await read(`// use prisma-8
types {
  Embedding = pgvector.Vector(3)
}

model Document {
  id        Int              @id
  embedding pgvector.Vector(3)
  named     Embedding
}
`);
    const ast = postgres.printPslContract?.(authored, {
      authoringTypes: stack.authoringContributions.type,
    });
    if (ast === undefined) throw new Error('the Postgres target has no printPslContract hook');
    const text = printPsl(ast, {
      pslBlockDescriptors: stack.authoringContributions.pslBlockDescriptors,
      codecLookup: stack.codecLookup,
    });

    expect(text).toContain('embedding pgvector.Vector(3)');
    const printed = await read(text);
    expect(serialize(printed)).toEqual(serialize(authored));
    expect(printed.storage.storageHash).toBe(authored.storage.storageHash);
  });
});
