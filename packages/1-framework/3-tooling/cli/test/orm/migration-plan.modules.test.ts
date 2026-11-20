import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { contractSnapshotDir } from '@internal/migration-tools/contract-snapshot-store';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HASH_TO, harness, plannableProject, plannedDirs } from './fixtures/migration-plan-project';
import {
  contractWithoutTypesModule,
  OFFLINE_MIGRATION_MODULE,
  removeOfflineProjects,
  resetRenderContractDtsMock,
} from './fixtures/offline-project';

beforeEach(resetRenderContractDtsMock);
afterEach(removeOfflineProjects);

describe('migration plan and the module migration files import from', () => {
  it('writes a migration file that imports from the module the config names', async () => {
    const project = await plannableProject();

    const run = await harness(project).run(['migration', 'plan', '--name', 'add-users'], {
      cwd: project.dir,
    });
    const dir = join(project.appMigrationsDir, (await plannedDirs(project)).at(-1) ?? '');

    expect(run.exitCode).toBe(0);
    expect(await readFile(join(dir, 'migration.ts'), 'utf-8')).toBe(
      `// planned migration importing ${OFFLINE_MIGRATION_MODULE}\n`,
    );
  });

  it('refuses before writing anything when the config names no contract types module', async () => {
    const project = await plannableProject();
    const before = await plannedDirs(project);

    const run = await harness(project, {
      overrides: { contract: contractWithoutTypesModule(project) },
    }).run(['migration', 'plan', '--name', 'add-users', '--json'], { cwd: project.dir });

    expect(run.exitCode).toBe(2);
    expect(run.json.at(-1)).toMatchObject({
      kind: 'result',
      envelope: {
        ok: false,
        error: {
          code: 'CONFIG.CONTRACT_TYPES_MODULE_MISSING',
          why: expect.stringContaining('contract.typesModule'),
        },
      },
    });
    expect(await plannedDirs(project)).toEqual(before);
    expect(existsSync(contractSnapshotDir(project.migrationsDir, HASH_TO))).toBe(false);
  });

  it('refuses before writing anything when the config names no migration module', async () => {
    const project = await plannableProject();
    const before = await plannedDirs(project);

    const run = await harness(project, { overrides: { migrations: {} } }).run(
      ['migration', 'plan', '--name', 'add-users', '--json'],
      { cwd: project.dir },
    );

    expect(run.exitCode).toBe(2);
    expect(run.json.at(-1)).toMatchObject({
      kind: 'result',
      envelope: {
        ok: false,
        error: {
          code: 'CONFIG.MIGRATION_MODULE_MISSING',
          why: expect.stringContaining('migrations.module'),
        },
      },
    });
    expect(await plannedDirs(project)).toEqual(before);
    expect(existsSync(contractSnapshotDir(project.migrationsDir, HASH_TO))).toBe(false);
  });
});
