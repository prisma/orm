import { resolve } from 'pathe';
import { describe, expect, it } from 'vitest';
import { defineConfig } from '../../src/config/define-config';
import { createMysqlControlClient } from '../../src/exports/control';

describe('a TypeScript contract built for another target', () => {
  it("is refused at emit by MySQL's defineConfig, naming both targets and MySQL's import", async () => {
    const contractPath = resolve(import.meta.dirname, '../fixtures', 'postgres-target-contract.ts');
    const { contract } = defineConfig({ contract: contractPath });
    if (contract?.typesModule === undefined) {
      throw new Error('defineConfig set no contract or no contract types module');
    }
    const client = createMysqlControlClient();
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
        summary: `The TypeScript contract "${contractPath}" was built for target "postgres", but this defineConfig is for target "mysql". Import defineContract from @internal/mysql/contract-builder.`,
        meta: {
          code: 'CONTRACT.TARGET_MISMATCH',
          contract: contractPath,
          builtFor: 'postgres',
          configuredFor: 'mysql',
        },
      });
    } finally {
      await client.close();
    }
  });
});
