import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import mariadb from '@internal/target-mariadb/control';
import { resolve } from 'pathe';
import { defineConfig } from '../src/config/define-config';
import { createMariadbControlClient } from '../src/exports/control';

export interface EmittedContract {
  readonly contract: Contract<SqlStorage>;
  readonly contractJson: unknown;
  readonly contractDts: string;
}

/** Emits `test/fixtures/<name>.prisma` for MariaDB in memory, as `contract emit` does, and loads the contract as the CLI loads it. */
export async function emitFixture(name: string): Promise<EmittedContract> {
  const { contract } = defineConfig({
    contract: resolve(import.meta.dirname, 'fixtures', `${name}.prisma`),
  });
  if (contract === undefined) throw new Error('defineConfig set no contract');
  const client = createMariadbControlClient();
  try {
    const result = await client.emit({
      contractConfig: { source: contract.source, output: contract.output ?? 'contract.json' },
    });
    if (!result.ok) throw new Error(JSON.stringify(result.failure));
    const contractJson: unknown = JSON.parse(result.value.contractJson);
    return {
      contract: mariadb.contractSerializer.deserializeContract(contractJson),
      contractJson,
      contractDts: result.value.contractDts,
    };
  } finally {
    await client.close();
  }
}
