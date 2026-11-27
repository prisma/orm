import { rm, writeFile } from 'node:fs/promises';
import { executeContractEmit } from '@internal/cli/control-api';
import type { ContractConfig } from '@internal/config/config-types';
import { prismaContract } from '@internal/sql-contract-psl/provider';
import { typescriptContract } from '@internal/sql-contract-ts/config-types';
import { PG_INT_CODEC_ID, PG_TEXT_CODEC_ID } from '@internal/target-postgres/codec-ids';
import postgresPackRef from '@internal/target-postgres/pack';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import { join, resolve } from 'pathe';
import { describe, expect, it } from 'vitest';
import { defineConfig } from '../../src/config/define-config';
import { createPostgresControlClient } from '../../src/exports/control';
import { contract as mysqlContract } from '../fixtures/mysql-target-contract';
import { scratchDir } from '../support/scratch';

async function emitThrough(contractOption: `${string}.ts` | ContractConfig) {
  const { contract } = defineConfig({ contract: contractOption });
  if (contract?.typesModule === undefined) {
    throw new Error('defineConfig set no contract or no contract types module');
  }
  const client = createPostgresControlClient();
  try {
    const result = await client.emit({
      contractConfig: {
        source: contract.source,
        output: contract.output ?? 'contract.json',
        typesModule: contract.typesModule,
      },
    });
    return result.ok ? 'emitted' : result.failure;
  } finally {
    await client.close();
  }
}

describe('a TypeScript contract built for another target', () => {
  it("is refused at emit by PostgreSQL's defineConfig, naming both targets", async () => {
    const contractPath =
      `${resolve(import.meta.dirname, '../fixtures', 'mysql-target-contract')}.ts` as const;
    expect(await emitThrough(contractPath)).toMatchObject({
      code: 'CONTRACT_SOURCE_INVALID',
      summary: `The TypeScript contract "${contractPath}" was built for target "mysql", but the config is for target "postgres".`,
      meta: {
        code: 'CONTRACT.TARGET_MISMATCH',
        contract: contractPath,
        expected: 'postgres',
        actual: 'mysql',
      },
    });
  });

  it("is refused at emit by PostgreSQL's defineConfig when passed as a ready contract config", async () => {
    expect(await emitThrough(typescriptContract(mysqlContract))).toMatchObject({
      code: 'CONTRACT_SOURCE_INVALID',
      summary:
        'The TypeScript contract in the config was built for target "mysql", but the config is for target "postgres".',
      meta: { code: 'CONTRACT.TARGET_MISMATCH', expected: 'postgres', actual: 'mysql' },
    });
  });
});

describe('a Prisma schema source read for another target and given no capabilities', () => {
  it('is refused at emit with the target error alone, with no capabilities warning', async () => {
    const dir = await scratchDir('postgres-other-target-source-');
    try {
      const schemaPath = join(dir, 'contract.prisma');
      await writeFile(schemaPath, '// use prisma-8\nmodel User {\n  id Int @id\n}\n', 'utf-8');
      const config = defineConfig({
        contract: prismaContract(schemaPath, {
          target: { ...postgresPackRef, id: 'mysql', targetId: 'mysql' },
          createNamespace: postgresCreateNamespace,
          enumInferenceCodecs: { text: PG_TEXT_CODEC_ID, int: PG_INT_CODEC_ID },
        }),
      });

      const refused = await executeContractEmit({ config, cwd: dir, outputPath: dir }).catch(
        (error: unknown) => error,
      );

      expect(refused).toMatchObject({
        code: 'CONTRACT.TARGET_MISMATCH',
        meta: { contract: schemaPath, expected: 'postgres', actual: 'mysql' },
      });
      expect(refused).not.toHaveProperty('diagnostics');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
