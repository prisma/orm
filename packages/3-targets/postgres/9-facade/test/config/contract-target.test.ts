import type { ContractConfig } from '@internal/config/config-types';
import { typescriptContract } from '@internal/sql-contract-ts/config-types';
import { resolve } from 'pathe';
import { describe, expect, it } from 'vitest';
import { defineConfig } from '../../src/config/define-config';
import { createPostgresControlClient } from '../../src/exports/control';
import { contract as mysqlContract } from '../fixtures/mysql-target-contract';

async function emitThrough(contractOption: string | ContractConfig) {
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
    const contractPath = resolve(import.meta.dirname, '../fixtures', 'mysql-target-contract.ts');
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
