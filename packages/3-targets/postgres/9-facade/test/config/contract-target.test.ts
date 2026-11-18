import { resolve } from 'pathe';
import { describe, expect, it } from 'vitest';
import { defineConfig } from '../../src/config/define-config';
import { createPostgresControlClient } from '../../src/exports/control';

describe('a TypeScript contract built for another target', () => {
  it("is refused at emit by PostgreSQL's defineConfig, naming both targets", async () => {
    const contractPath = resolve(import.meta.dirname, '../fixtures', 'mysql-target-contract.ts');
    const { contract } = defineConfig({ contract: contractPath });
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
      expect(result.ok ? 'emitted' : result.failure).toMatchObject({
        code: 'CONTRACT_SOURCE_INVALID',
        summary: `The TypeScript contract "${contractPath}" was built for target "mysql", but this defineConfig is for target "postgres".`,
        meta: {
          code: 'CONTRACT.TARGET_MISMATCH',
          contract: contractPath,
          expected: 'postgres',
          actual: 'mysql',
        },
      });
    } finally {
      await client.close();
    }
  });
});
