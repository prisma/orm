import { defineConfig as mysqlDefineConfig } from '@internal/mysql/config';
import { createMysqlControlClient } from '@internal/mysql/control';
import { resolve } from 'pathe';
import { describe, expect, it } from 'vitest';
import { defineConfig } from '../src/config/define-config';
import { createMariadbControlClient } from '../src/exports/control';

const fixture = (fileName: string) => resolve(import.meta.dirname, 'fixtures', fileName);

async function emitFailure(
  client: ReturnType<typeof createMariadbControlClient>,
  contract: ReturnType<typeof defineConfig>['contract'],
): Promise<unknown> {
  if (contract?.typesModule === undefined) {
    throw new Error('defineConfig set no contract or no contract types module');
  }
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
  it("is refused by MariaDB's defineConfig when it was built with MySQL's defineContract, naming both targets and MariaDB's import", async () => {
    const contract = fixture('mysql-contract.ts');
    expect(
      await emitFailure(createMariadbControlClient(), defineConfig({ contract }).contract),
    ).toMatchObject({
      code: 'CONTRACT_SOURCE_INVALID',
      summary: `The TypeScript contract "${contract}" was built for target "mysql", but this defineConfig is for target "mariadb". Import defineContract from @prisma/orm-mariadb/contract-builder.`,
      why: "Its defineContract came from another target's contract-builder entry, so the contract carries that target's id and capabilities.",
      meta: {
        code: 'CONFIG.VALIDATION_FAILED',
        contract,
        builtFor: 'mysql',
        configuredFor: 'mariadb',
      },
    });
  });

  it("is refused by MySQL's defineConfig when it was built with MariaDB's defineContract, naming both targets and MySQL's import", async () => {
    const contract = fixture('example-contract.ts');
    expect(
      await emitFailure(createMysqlControlClient(), mysqlDefineConfig({ contract }).contract),
    ).toMatchObject({
      code: 'CONTRACT_SOURCE_INVALID',
      summary: `The TypeScript contract "${contract}" was built for target "mariadb", but this defineConfig is for target "mysql". Import defineContract from @prisma/orm-mysql/contract-builder.`,
      why: "Its defineContract came from another target's contract-builder entry, so the contract carries that target's id and capabilities.",
      meta: {
        code: 'CONFIG.VALIDATION_FAILED',
        contract,
        builtFor: 'mariadb',
        configuredFor: 'mysql',
      },
    });
  });
});
