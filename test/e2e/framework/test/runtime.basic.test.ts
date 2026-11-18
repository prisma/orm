import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { timeouts } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import type { Contract } from './fixtures/generated/contract.d';
import { emitAndVerifyContract, withTestRuntime } from './utils';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
describe('end-to-end basic queries', () => {
  const configPath = resolve(__dirname, 'fixtures/prisma.config.ts');
  const cliPath = createRequire(import.meta.url).resolve('@repo/prisma-bin/bin/prisma.mjs');
  const contractJsonPath = resolve(__dirname, 'fixtures/generated/contract.json');

  it(
    'emits contract and verifies it matches on-disk artifacts',
    async () => {
      await emitAndVerifyContract(cliPath, configPath, contractJsonPath);
    },
    timeouts.typeScriptCompilation,
  );

  it(
    'returns multiple rows with correct types',
    async () => {
      await withTestRuntime<Contract>(contractJsonPath, async ({ db, client, runtime }) => {
        await client.query('insert into "user" (email) values ($1), ($2), ($3)', [
          'ada@example.com',
          'tess@example.com',
          'mike@example.com',
        ]);

        const rows = await runtime.query(db.public.user.select('id', 'email').build());

        expect(rows.length).toBeGreaterThan(1);
        expect(rows[0]).toMatchObject({
          id: expect.any(Number),
          email: expect.any(String),
        });
      });
    },
    timeouts.spinUpPpgDev,
  );
});
