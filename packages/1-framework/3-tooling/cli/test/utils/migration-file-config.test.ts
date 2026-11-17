import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { errorConfigFileNotFound } from '@internal/errors/control';
import { notOk, ok } from '@internal/utils/result';
import { join } from 'pathe';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { loadConfigMock, loadConfigForSectionsMock } = vi.hoisted(() => ({
  loadConfigMock: vi.fn(),
  loadConfigForSectionsMock: vi.fn(),
}));

vi.mock('@internal/config-loader', async () => {
  const actual =
    await vi.importActual<typeof import('@internal/config-loader')>('@internal/config-loader');
  return {
    ...actual,
    loadConfig: loadConfigMock,
    loadConfigForSections: loadConfigForSectionsMock,
  };
});

vi.resetModules();
const { loadMigrationFileConfig, ownsMigration } = await import(
  '../../src/utils/migration-file-config'
);
const { appMigrationsDirFor } = await import('../../src/orm/migration/paths');

afterAll(() => {
  vi.doUnmock('@internal/config-loader');
  vi.resetModules();
});

const SECTIONS = ['family', 'target'] as const;

let root: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'migration-file-config-')));
  loadConfigMock.mockReset();
  loadConfigForSectionsMock.mockReset();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function writeConfig(dir: string): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'prisma.config.ts');
  writeFileSync(path, '');
  return path;
}

function writeMigration(dir: string): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'migration.ts');
  writeFileSync(path, '');
  return path;
}

/** Each config path loads a config that keeps its migrations in the given directory. */
function configsKeepingMigrationsIn(dirs: Record<string, string>): void {
  loadConfigMock.mockImplementation(async (configPath: string) => {
    const dir = dirs[configPath];
    return dir === undefined
      ? notOk(errorConfigFileNotFound(configPath))
      : ok({ config: { configPath, migrations: { dir } }, diagnostics: [] });
  });
}

describe('loadMigrationFileConfig', () => {
  it('loads the config --config names, without checking that it owns the migration', async () => {
    loadConfigForSectionsMock.mockResolvedValue(ok({ named: true }));

    const loaded = await loadMigrationFileConfig({
      configPath: 'custom.config.ts',
      migrationFile: join(root, 'elsewhere/migration.ts'),
      cwd: root,
      sections: SECTIONS,
    });

    expect(loaded.assertOk()).toEqual({ named: true });
    expect(loadConfigForSectionsMock).toHaveBeenCalledWith('custom.config.ts', SECTIONS);
    expect(loadConfigMock).not.toHaveBeenCalled();
  });

  it('uses the nearest config above the migration when its migrations directory holds it', async () => {
    const config = writeConfig(root);
    const migrationFile = writeMigration(join(root, 'db/migrations/app/0001_initial'));
    configsKeepingMigrationsIn({ [config]: join(root, 'db/migrations') });

    const loaded = await loadMigrationFileConfig({
      configPath: undefined,
      migrationFile,
      cwd: join(root, 'db'),
      sections: SECTIONS,
    });

    expect(loaded.assertOk()).toMatchObject({ configPath: config });
  });

  it('falls back to the working directory config when the nearest does not own the migration', async () => {
    const outer = writeConfig(root);
    const project = writeConfig(join(root, 'app'));
    const migrationFile = writeMigration(join(root, 'shared-db/migrations/app/0001_initial'));
    configsKeepingMigrationsIn({
      [outer]: join(root, 'migrations'),
      [project]: join(root, 'shared-db/migrations'),
    });

    const loaded = await loadMigrationFileConfig({
      configPath: undefined,
      migrationFile,
      cwd: join(root, 'app'),
      sections: SECTIONS,
    });

    expect(loaded.assertOk()).toMatchObject({ configPath: project });
  });

  it('falls back to the working directory config when the nearest fails to load', async () => {
    const outer = writeConfig(root);
    const project = writeConfig(join(root, 'app'));
    const migrationFile = writeMigration(join(root, 'shared-db/migrations/app/0001_initial'));
    configsKeepingMigrationsIn({ [project]: join(root, 'shared-db/migrations') });

    const loaded = await loadMigrationFileConfig({
      configPath: undefined,
      migrationFile,
      cwd: join(root, 'app'),
      sections: SECTIONS,
    });

    expect(loaded.assertOk()).toMatchObject({ configPath: project });
    expect(loadConfigMock).toHaveBeenCalledWith(outer);
  });

  it('refuses, naming each config it checked, when none owns the migration', async () => {
    const outer = writeConfig(root);
    const migrationDir = join(root, 'inner/migrations/app/0001_initial');
    const migrationFile = writeMigration(migrationDir);
    configsKeepingMigrationsIn({ [outer]: join(root, 'migrations') });

    const loaded = await loadMigrationFileConfig({
      configPath: undefined,
      migrationFile,
      cwd: migrationDir,
      sections: SECTIONS,
    });

    expect(loaded.ok ? loaded.value : loaded.failure.toEnvelope()).toMatchObject({
      code: 'CLI.MIGRATION_CONFIG_NOT_FOUND',
      meta: { migrationDir, checked: [outer] },
    });
  });
});

describe('ownsMigration', () => {
  it.each([
    ['the default migrations directory', {}],
    [
      'a migrations directory outside the project',
      { migrations: { dir: '../shared-db/migrations' } },
    ],
  ])('owns a migration the CLI writes under %s', (_label, section) => {
    const configPath = join(root, 'app/prisma.config.ts');
    const config = { ...section, baseDir: join(root, 'app') };
    const written = join(appMigrationsDirFor(config), '0001_initial/migration.ts');

    expect(ownsMigration(config, configPath, written)).toBe(true);
    expect(ownsMigration(config, configPath, join(root, 'other/migration.ts'))).toBe(false);
  });
});
