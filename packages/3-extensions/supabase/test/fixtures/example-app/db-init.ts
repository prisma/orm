import postgresAdapter from '@internal/adapter-postgres/control';
import { createControlClient } from '@internal/cli/control-api';
import postgresDriver from '@internal/driver-postgres/control';
import sql from '@internal/family-sql/control';
import { emitContractSpaceArtifacts } from '@internal/migration-tools/spaces';
import postgres from '@internal/target-postgres/control';
import supabasePack from '../../../src/exports/pack';
import contractJson from './contract.json' with { type: 'json' };

const TEST_INVOCATION = { cwd: process.cwd(), configPath: undefined, dbGiven: false };

export async function runDbInit(connectionString: string, migrationsDir: string): Promise<void> {
  const space = supabasePack.contractSpace;
  if (!space) throw new Error('supabasePack must declare a contractSpace');

  await emitContractSpaceArtifacts(migrationsDir, 'supabase', {
    contract: space.contractJson,
    contractDts: '// supabase extension contract space\n',
    headRef: { hash: space.headRef.hash, invariants: [...space.headRef.invariants] },
  });

  const client = createControlClient({
    family: sql,
    target: postgres,
    adapter: postgresAdapter,
    driver: postgresDriver,
    extensions: [supabasePack],
  });

  try {
    await client.connect(connectionString);
    const result = await client.dbInit({
      invocation: TEST_INVOCATION,
      contract: contractJson,
      mode: 'apply',
      migrationsDir,
    });
    if (!result.ok) {
      throw new Error(`dbInit apply failed: ${result.failure.message}`);
    }
  } finally {
    await client.close();
  }
}
