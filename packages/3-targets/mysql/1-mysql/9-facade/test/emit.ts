import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import mysql from '@internal/target-mysql/control';
import { resolve } from 'pathe';
import { defineConfig } from '../src/config/define-config';
import { createMysqlControlClient } from '../src/exports/control';

/** Emits `test/fixtures/<name>.prisma` for MySQL in memory, as `contract emit` does, and loads the contract as the CLI loads it. */
export async function emitFixture(name: string): Promise<Contract<SqlStorage>> {
  const { contract } = defineConfig({
    contract: resolve(import.meta.dirname, 'fixtures', `${name}.prisma`),
  });
  if (contract?.typesModule === undefined) {
    throw new Error('defineConfig set no contract types module');
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
    if (!result.ok) throw new Error(JSON.stringify(result.failure));
    return mysql.contractSerializer.deserializeContract(JSON.parse(result.value.contractJson));
  } finally {
    await client.close();
  }
}
