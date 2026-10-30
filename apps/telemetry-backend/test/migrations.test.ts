import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createDevDatabase, timeouts } from '@repo/test-utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const run = promisify(execFile);
const appDir = fileURLToPath(new URL('..', import.meta.url));

describe('production migrate script', () => {
  let database: Awaited<ReturnType<typeof createDevDatabase>>;

  beforeAll(async () => {
    database = await createDevDatabase();
  }, timeouts.spinUpPpgDev);

  afterAll(async () => {
    if (database) await database.close();
  }, timeouts.spinUpPpgDev);

  it('brings an empty database to the contract', async () => {
    const env = { ...process.env, DATABASE_URL: database.connectionString };
    await run('pnpm', ['run', 'migrate'], { cwd: appDir, env });
    await expect(
      run('pnpm', ['exec', 'prisma', 'db', 'verify'], { cwd: appDir, env }),
    ).resolves.toBeDefined();
  }, 120_000);
});
