/**
 * The upgrade of a Prisma 7 project whose database was signed under `8.0.0-rc.18`, when the Prisma 7 reader stored every list with non-null elements and a waived element check. The project starts from the `contract.json` and `contract.d.ts` that release stored, with their hashes, and a database marker at those hashes. It then follows the path such a project takes to this release: the script of the app upgrade guide `skills/prisma-8/upgrading/app/upgrades/8.0.0-rc.18-to-8.0.0-rc.19/instructions.md`, the scripts of the pending `stored-files-format-version` and `contract-hash-inputs` guides, `prisma db sign --db "$DATABASE_URL"`, `prisma contract emit`, and the `db sign` the hash guide runs after that emit, since the emitted capability list, and so the profile hash, can differ from the one the script wrote. `db verify` then passes with no migration.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { withClient } from '@repo/test-utils';
import { join } from 'pathe';
import stripAnsi from 'strip-ansi';
import { describe, expect, it } from 'vitest';
import { runScript as runContractHashInputsScript } from '../upgrade-instructions/contract-hash-inputs/test-helpers';
import { appScript } from '../upgrade-instructions/remove-nocheck/test-helpers';
import { runScript as runFormatVersionScript } from '../upgrade-instructions/stored-files-format-version/test-helpers';
import { withTempDir, writeProjectManifest } from '../utils/cli-test-helpers';
import {
  type JourneyContext,
  runContractEmit,
  runDbSign,
  runDbVerify,
  timeouts,
  useDevDatabase,
} from '../utils/journey-test-helpers';

const PRISMA7_FIXTURES = join(__dirname, '../fixtures/prisma7-source');
const JOURNEY_FIXTURES = join(__dirname, '../fixtures/cli/cli-e2e-test-app/fixtures/cli-journeys');
const RC18_STORED = join(JOURNEY_FIXTURES, 'prisma7-rc18-stored');
const MIGRATION_SQL = readFileSync(join(PRISMA7_FIXTURES, 'supported/migration.sql'), 'utf-8');

interface StoredHashes {
  readonly storageHash: string;
  readonly profileHash: string;
}

function hashesOf(contractPath: string): StoredHashes {
  const contract = JSON.parse(readFileSync(contractPath, 'utf-8'));
  return { storageHash: contract.storage.storageHash, profileHash: contract.profileHash };
}

function setupProject(createTempDir: () => string, connectionString: string): JourneyContext {
  const testDir = createTempDir();
  writeProjectManifest(testDir);
  mkdirSync(join(testDir, 'migrations'), { recursive: true });
  copyFileSync(join(PRISMA7_FIXTURES, 'supported/schema.prisma'), join(testDir, 'schema.prisma'));
  const config = readFileSync(join(JOURNEY_FIXTURES, 'prisma.config.prisma7.ts'), 'utf-8').replace(
    /\{\{DB_URL\}\}/g,
    () => connectionString,
  );
  const configPath = join(testDir, 'prisma.config.ts');
  writeFileSync(configPath, config, 'utf-8');
  return { testDir, configPath, outputDir: testDir };
}

function output(run: { readonly stdout: string; readonly stderr: string }): string {
  return `${stripAnsi(run.stderr)}\n${stripAnsi(run.stdout)}`;
}

function markerHash(connectionString: string): Promise<unknown> {
  return withClient(connectionString, async (client) => {
    const result = await client.query(
      `SELECT core_hash FROM "prisma_contract"."marker" WHERE space = 'app'`,
    );
    return result.rows[0]?.['core_hash'];
  });
}

function hashChange(stdout: string, from: string): string | undefined {
  return new RegExp(`^ {2}${from} -> ([0-9a-f]{64})$`, 'm').exec(stdout)?.[1];
}

withTempDir(({ createTempDir }) => {
  describe('Journey: upgrading a Prisma 7 project signed under rc.18 past the removal of noCheck', () => {
    const db = useDevDatabase({
      onReady: (cs) => withClient(cs, (client) => client.query(MIGRATION_SQL)),
    });

    it(
      'the upgrade scripts, db sign, contract emit and a second db sign leave a database that verifies with no migration',
      async () => {
        const ctx = setupProject(createTempDir, db.connectionString);
        const contractPath = join(ctx.testDir, 'contract.json');
        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, `contract emit\n${output(emit)}`).toBe(0);
        const currentHash = hashesOf(contractPath).storageHash;
        const sign = await runDbSign(ctx);
        expect(sign.exitCode, `db sign\n${output(sign)}`).toBe(0);

        copyFileSync(join(RC18_STORED, 'contract.json'), contractPath);
        copyFileSync(join(RC18_STORED, 'contract.d.ts'), join(ctx.testDir, 'contract.d.ts'));
        const rc18 = hashesOf(contractPath);
        expect(rc18.storageHash).not.toBe(currentHash);
        await withClient(db.connectionString, (client) =>
          client.query(
            `UPDATE "prisma_contract"."marker" SET core_hash = $1, profile_hash = $2 WHERE space = 'app'`,
            [rc18.storageHash, rc18.profileHash],
          ),
        );
        const refused = await runDbVerify(ctx);
        expect(refused.exitCode, `db verify before the upgrade\n${output(refused)}`).not.toBe(0);
        expect(output(refused)).toContain('[CONTRACT.FORMAT_VERSION_MISSING]');

        const removeNoCheck = spawnSync(process.execPath, [appScript], {
          cwd: ctx.testDir,
          encoding: 'utf8',
        });
        expect({ status: removeNoCheck.status, stderr: removeNoCheck.stderr }).toEqual({
          status: 0,
          stderr: '',
        });
        const rc19Hash = hashChange(removeNoCheck.stdout, rc18.storageHash);
        expect(rc19Hash, removeNoCheck.stdout).toMatch(/^[0-9a-f]{64}$/);

        const formatVersion = runFormatVersionScript(ctx.testDir);
        expect({ status: formatVersion.status, stderr: formatVersion.stderr }).toEqual({
          status: 0,
          stderr: '',
        });

        const hashInputs = runContractHashInputsScript(ctx.testDir);
        expect({ status: hashInputs.status, stderr: hashInputs.stderr }).toEqual({
          status: 0,
          stderr: '',
        });
        expect(hashChange(hashInputs.stdout, String(rc19Hash)), hashInputs.stdout).toBe(
          currentHash,
        );

        const signAfterScripts = await runDbSign(ctx, ['--db', db.connectionString]);
        expect(signAfterScripts.exitCode, `db sign\n${output(signAfterScripts)}`).toBe(0);
        expect(await markerHash(db.connectionString)).toBe(currentHash);

        const reemit = await runContractEmit(ctx);
        expect(reemit.exitCode, `contract emit\n${output(reemit)}`).toBe(0);
        expect(hashesOf(contractPath).storageHash).toBe(currentHash);

        const signEmitted = await runDbSign(ctx, ['--db', db.connectionString]);
        expect(signEmitted.exitCode, `db sign after contract emit\n${output(signEmitted)}`).toBe(0);
        expect(await markerHash(db.connectionString)).toBe(currentHash);

        const verify = await runDbVerify(ctx);
        expect(verify.exitCode, `db verify\n${output(verify)}`).toBe(0);
      },
      timeouts.spinUpPpgDev,
    );
  });
});
