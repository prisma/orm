import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createPostgresControlClient } from '@prisma/orm-postgres/control';
import { withClient } from '@repo/test-utils';
import { join } from 'pathe';
import contractJson from '../src/prisma/contract.json' with { type: 'json' };

export async function resetTelemetrySchema(connectionString: string): Promise<void> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'telemetry-backend-schema-'));
  const migrationsDir = join(projectRoot, 'migrations');
  await mkdir(migrationsDir, { recursive: true });

  const client = createPostgresControlClient({ connection: connectionString });
  try {
    await withClient(connectionString, async (pg) => {
      await pg.query('drop schema if exists public cascade');
      await pg.query('drop schema if exists prisma_contract cascade');
      await pg.query('create schema public');
    });

    const result = await client.dbInit({
      invocation: { cwd: process.cwd(), configPath: undefined, dbGiven: false },
      contract: contractJson,
      mode: 'apply',
      migrationsDir,
    });

    if (!result.ok) {
      throw new Error(`Telemetry schema init failed: ${JSON.stringify(result.failure)}`);
    }
  } finally {
    await client.close();
    await rm(projectRoot, { recursive: true, force: true });
  }
}
