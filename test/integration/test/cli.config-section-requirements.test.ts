/**
 * Every command must declare the config sections it reads, so a malformed
 * section surfaces as a config error instead of leaking into execution as a
 * downstream failure (an unreadable contract, a bad migrations path).
 */
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { timeouts } from '@repo/test-utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDir, runOnEngine } from './utils/cli-test-helpers';

// The fixture cannot import @prisma/cli-engine, so it stamps the engine
// envelope marker the same way defineConfig does.
function markedConfig(brokenSection: string): string {
  return `
const descriptorBase = { familyId: 'sql', targetId: 'postgres', version: '0.0.1', manifest: {} };
const config = {
  family: { ...descriptorBase, kind: 'family', id: 'sql', emission: {}, create: () => ({}) },
  target: { ...descriptorBase, kind: 'target', id: 'postgres', create: () => ({}) },
  adapter: { ...descriptorBase, kind: 'adapter', id: 'postgres', create: () => ({}) },
  driver: { ...descriptorBase, kind: 'driver', id: 'postgres', create: () => ({}) },
${brokenSection}
};
export default { $prismaConfig: 1, orm: config };
`;
}

let testDir: string;
let brokenContractConfig: string;
let brokenMigrationsConfig: string;

beforeAll(() => {
  testDir = createTestDir();
  brokenContractConfig = join(testDir, 'broken-contract.config.ts');
  brokenMigrationsConfig = join(testDir, 'broken-migrations.config.ts');
  writeFileSync(brokenContractConfig, markedConfig('  contract: { source: {} },'));
  writeFileSync(brokenMigrationsConfig, markedConfig("  migrations: 'not-an-object',"));
});

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true });
});

const readsContract: ReadonlyArray<[string, readonly string[]]> = [
  ['migration status', ['migration', 'status']],
  ['migration list', ['migration', 'list']],
  ['migration graph', ['migration', 'graph']],
  ['migration check', ['migration', 'check']],
  ['db migrate', ['db', 'migrate', '--to', 'HEAD']],
  ['db init', ['db', 'init']],
  ['db update', ['db', 'update']],
  ['db sign', ['db', 'sign']],
  ['db verify', ['db', 'verify']],
];

const readsMigrations: ReadonlyArray<[string, readonly string[]]> = [
  ['migration log', ['migration', 'log']],
  ['db init', ['db', 'init']],
  ['db update', ['db', 'update']],
  ['db sign', ['db', 'sign']],
  ['db verify', ['db', 'verify']],
];

describe('commands declare the config sections they read', () => {
  it.each(readsContract)(
    '%s reports a malformed contract section as a config error',
    async (_name, argv) => {
      const run = await runOnEngine({ testDir, configPath: brokenContractConfig }, [
        ...argv,
        '--json',
      ]);

      expect(run.exitCode).toBe(2);
      expect(run.json.at(-1)).toMatchObject({
        kind: 'result',
        envelope: {
          ok: false,
          diagnostics: expect.arrayContaining([
            expect.objectContaining({
              code: 'CONFIG.VALIDATION_FAILED',
              meta: expect.objectContaining({ section: 'contract' }),
            }),
          ]),
        },
      });
    },
    timeouts.typeScriptCompilation,
  );

  it.each(readsMigrations)(
    '%s reports a malformed migrations section as a config error',
    async (_name, argv) => {
      const run = await runOnEngine({ testDir, configPath: brokenMigrationsConfig }, [
        ...argv,
        '--json',
      ]);

      expect(run.exitCode).toBe(2);
      expect(run.json.at(-1)).toMatchObject({
        kind: 'result',
        envelope: {
          ok: false,
          diagnostics: expect.arrayContaining([
            expect.objectContaining({
              code: 'CONFIG.VALIDATION_FAILED',
              meta: expect.objectContaining({ section: 'migrations' }),
            }),
          ]),
        },
      });
    },
    timeouts.typeScriptCompilation,
  );
});
