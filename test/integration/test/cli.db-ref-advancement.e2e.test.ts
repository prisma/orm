import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { contractSnapshotDir } from '@internal/migration-tools/contract-snapshot-store';
import { timeouts, withDevDatabase } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { withTempDir } from './utils/cli-test-helpers';
import { runDbInit, runDbInitAllowFailure, setupDbInitFixture } from './utils/db-init-test-helpers';
import { runDbUpdate, setupDbUpdateFixture } from './utils/db-update-test-helpers';

const fixtureSubdir = 'db-init';

function appRefsDir(testDir: string): string {
  return join(testDir, 'migrations/app/refs');
}

function refPointerPath(refsDir: string, name: string): string {
  return join(refsDir, `${name}.json`);
}

function migrationsDirFromRefsDir(refsDir: string): string {
  return dirname(dirname(refsDir));
}

function refPointerHash(refsDir: string, name: string): string | undefined {
  const pointerPath = refPointerPath(refsDir, name);
  if (!existsSync(pointerPath)) return undefined;
  return (JSON.parse(readFileSync(pointerPath, 'utf-8')) as { hash: string }).hash;
}

// A ref now consists of just its pointer file; the contract bytes resolve
// through the content-addressed store keyed by the pointer's hash.
function refFilesExist(refsDir: string, name: string): boolean {
  const hash = refPointerHash(refsDir, name);
  if (hash === undefined) return false;
  const storeDir = contractSnapshotDir(migrationsDirFromRefsDir(refsDir), hash);
  return existsSync(join(storeDir, 'contract.json')) && existsSync(join(storeDir, 'contract.d.ts'));
}

function refFilesAbsent(refsDir: string, name: string): boolean {
  return !existsSync(refPointerPath(refsDir, name));
}

function noRefFilesUnder(refsDir: string): boolean {
  if (!existsSync(refsDir)) {
    return true;
  }
  const entries = readdirSync(refsDir, { recursive: true });
  return !entries.some((entry) => String(entry).endsWith('.json'));
}

withTempDir(({ createTempDir }) => {
  describe('db init ref advancement (e2e)', () => {
    it(
      'advances the implicit db ref on the default database',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const { testSetup, configPath } = await setupDbInitFixture(
            connectionString,
            createTempDir,
            fixtureSubdir,
          );
          const refsDir = appRefsDir(testSetup.testDir);

          await runDbInit(testSetup, ['--config', configPath, '--no-color']);

          expect(refFilesExist(refsDir, 'db')).toBe(true);
          expect(refFilesAbsent(refsDir, 'staging')).toBe(true);
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'advances an explicit ref on the default database without touching db',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const { testSetup, configPath } = await setupDbInitFixture(
            connectionString,
            createTempDir,
            fixtureSubdir,
          );
          const refsDir = appRefsDir(testSetup.testDir);

          await runDbInit(testSetup, [
            '--config',
            configPath,
            '--advance-ref',
            'staging',
            '--no-color',
          ]);

          expect(refFilesExist(refsDir, 'staging')).toBe(true);
          expect(refFilesAbsent(refsDir, 'db')).toBe(true);
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'does not advance any ref when --db is provided without --advance-ref',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const { testSetup, configPath } = await setupDbInitFixture(
            connectionString,
            createTempDir,
            fixtureSubdir,
          );
          const refsDir = appRefsDir(testSetup.testDir);

          await runDbInit(testSetup, [
            '--config',
            configPath,
            '--db',
            connectionString,
            '--no-color',
          ]);

          expect(noRefFilesUnder(refsDir)).toBe(true);
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'advances an explicit ref when --db is provided',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const { testSetup, configPath } = await setupDbInitFixture(
            connectionString,
            createTempDir,
            fixtureSubdir,
          );
          const refsDir = appRefsDir(testSetup.testDir);

          await runDbInit(testSetup, [
            '--config',
            configPath,
            '--db',
            connectionString,
            '--advance-ref',
            'staging',
            '--no-color',
          ]);

          expect(refFilesExist(refsDir, 'staging')).toBe(true);
          expect(refFilesAbsent(refsDir, 'db')).toBe(true);
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'reports plannedAdvanceRef on dry-run without writing ref files',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const { testSetup, configPath } = await setupDbInitFixture(
            connectionString,
            createTempDir,
            fixtureSubdir,
          );
          const refsDir = appRefsDir(testSetup.testDir);
          const run = await runDbInit(testSetup, [
            '--config',
            configPath,
            '--dry-run',
            '--json',
            '--no-color',
          ]);

          const parsed = run.document as Record<string, unknown>;
          expect(parsed['plannedAdvanceRef']).toEqual(
            expect.objectContaining({ name: 'db', hash: expect.any(String) }),
          );
          expect(parsed['advancedRef']).toBeNull();
          expect(noRefFilesUnder(refsDir)).toBe(true);
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'includes advancedRef in JSON apply output',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const { testSetup, configPath } = await setupDbInitFixture(
            connectionString,
            createTempDir,
            fixtureSubdir,
          );
          const run = await runDbInit(testSetup, ['--config', configPath, '--json', '--no-color']);

          const parsed = run.document as Record<string, unknown>;
          expect(parsed['advancedRef']).toEqual(
            expect.objectContaining({ name: 'db', hash: expect.any(String) }),
          );
          expect(parsed['plannedAdvanceRef']).toBeNull();
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'writes a slashed ref name',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const { testSetup, configPath } = await setupDbInitFixture(
            connectionString,
            createTempDir,
            fixtureSubdir,
          );
          const refsDir = appRefsDir(testSetup.testDir);
          const refName = 'refs/staging/v1';

          await runDbInit(testSetup, [
            '--config',
            configPath,
            '--advance-ref',
            refName,
            '--no-color',
          ]);

          expect(refFilesExist(refsDir, refName)).toBe(true);
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'surfaces MIGRATION.INVALID_REF_NAME for an invalid ref name',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const { testSetup, configPath } = await setupDbInitFixture(
            connectionString,
            createTempDir,
            fixtureSubdir,
          );
          const run = await runDbInitAllowFailure(testSetup, [
            '--config',
            configPath,
            '--advance-ref',
            'bad ref name',
            '--json',
            '--no-color',
          ]);

          expect(run.exitCode).not.toBe(0);
          const parsed = run.document as Record<string, unknown>;
          expect(parsed['code']).toBe('MIGRATION.INVALID_REF_NAME');
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'does not write refs when apply fails before success',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const { testSetup, configPath } = await setupDbInitFixture(
            connectionString,
            createTempDir,
            fixtureSubdir,
            'CREATE SEQUENCE "user"',
          );
          const refsDir = appRefsDir(testSetup.testDir);

          const run = await runDbInitAllowFailure(testSetup, [
            '--config',
            configPath,
            '--advance-ref',
            'staging',
            '--json',
            '--no-color',
          ]);

          expect(run.exitCode).not.toBe(0);
          expect(run.document).toMatchObject({ code: 'MIGRATION.PRECHECK_FAILED' });
          expect(noRefFilesUnder(refsDir)).toBe(true);
        });
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('db update ref advancement (e2e)', () => {
    it(
      'advances the implicit db ref on the default database',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const { testSetup, configPath } = await setupDbUpdateFixture(
            connectionString,
            createTempDir,
            fixtureSubdir,
          );
          const refsDir = appRefsDir(testSetup.testDir);

          await runDbInit(testSetup, ['--config', configPath, '--no-color']);
          await runDbUpdate(testSetup, ['--config', configPath, '--no-color']);

          expect(refFilesExist(refsDir, 'db')).toBe(true);
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'advances an explicit ref on the default database without touching db',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const { testSetup, configPath } = await setupDbUpdateFixture(
            connectionString,
            createTempDir,
            fixtureSubdir,
          );
          const refsDir = appRefsDir(testSetup.testDir);

          await runDbInit(testSetup, [
            '--config',
            configPath,
            '--db',
            connectionString,
            '--no-color',
          ]);
          await runDbUpdate(testSetup, [
            '--config',
            configPath,
            '--advance-ref',
            'staging',
            '--no-color',
          ]);

          expect(refFilesExist(refsDir, 'staging')).toBe(true);
          expect(refFilesAbsent(refsDir, 'db')).toBe(true);
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'does not advance any ref when --db is provided without --advance-ref',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const { testSetup, configPath } = await setupDbUpdateFixture(
            connectionString,
            createTempDir,
            fixtureSubdir,
          );
          const refsDir = appRefsDir(testSetup.testDir);

          await runDbInit(testSetup, [
            '--config',
            configPath,
            '--db',
            connectionString,
            '--no-color',
          ]);
          await runDbUpdate(testSetup, [
            '--config',
            configPath,
            '--db',
            connectionString,
            '--no-color',
          ]);

          expect(noRefFilesUnder(refsDir)).toBe(true);
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'advances an explicit ref when --db is provided',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const { testSetup, configPath } = await setupDbUpdateFixture(
            connectionString,
            createTempDir,
            fixtureSubdir,
          );
          const refsDir = appRefsDir(testSetup.testDir);

          await runDbInit(testSetup, [
            '--config',
            configPath,
            '--db',
            connectionString,
            '--no-color',
          ]);
          await runDbUpdate(testSetup, [
            '--config',
            configPath,
            '--db',
            connectionString,
            '--advance-ref',
            'staging',
            '--no-color',
          ]);

          expect(refFilesExist(refsDir, 'staging')).toBe(true);
          expect(refFilesAbsent(refsDir, 'db')).toBe(true);
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'reports plannedAdvanceRef on dry-run without writing ref files',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const { testSetup, configPath } = await setupDbUpdateFixture(
            connectionString,
            createTempDir,
            fixtureSubdir,
          );
          const refsDir = appRefsDir(testSetup.testDir);
          await runDbInit(testSetup, [
            '--config',
            configPath,
            '--db',
            connectionString,
            '--no-color',
          ]);
          const run = await runDbUpdate(testSetup, ['--config', configPath, '--dry-run', '--json']);

          const parsed = run.document as Record<string, unknown>;
          expect(parsed['plannedAdvanceRef']).toEqual(
            expect.objectContaining({ name: 'db', hash: expect.any(String) }),
          );
          expect(parsed['advancedRef']).toBeNull();
          expect(noRefFilesUnder(refsDir)).toBe(true);
        });
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'includes advancedRef in JSON apply output',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const { testSetup, configPath } = await setupDbUpdateFixture(
            connectionString,
            createTempDir,
            fixtureSubdir,
          );
          await runDbInit(testSetup, [
            '--config',
            configPath,
            '--db',
            connectionString,
            '--no-color',
          ]);
          const run = await runDbUpdate(testSetup, ['--config', configPath, '--json']);

          const parsed = run.document as Record<string, unknown>;
          expect(parsed['advancedRef']).toEqual(
            expect.objectContaining({ name: 'db', hash: expect.any(String) }),
          );
          expect(parsed['plannedAdvanceRef']).toBeNull();
        });
      },
      timeouts.spinUpPpgDev,
    );
  });
});
