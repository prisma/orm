import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrationPackageRepairActions } from '../../src/utils/next-actions';

const RESTORE = {
  kind: 'user-choice',
  label: 'Restore the migration package from version control',
};
const DIR_NAME = '20260101T0000_init';

describe('migrationPackageRepairActions', () => {
  let cwd: string;
  let packageDir: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), 'migration-package-repair-'));
    packageDir = join(cwd, 'migrations', 'app', DIR_NAME);
    await mkdir(packageDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  const appActions = () => migrationPackageRepairActions({ spaceId: 'app', packageDir, cwd });
  const replan = {
    kind: 'run-command',
    label: `Or, if no database has applied this migration, delete the folder migrations/app/${DIR_NAME} and the folders of the migrations that start where it ends, and plan again`,
    command: '{bin} migration plan',
  };

  it('advises running migration.ts when migration.json keeps its createdAt, so the migration keeps its hash', async () => {
    await writeFile(
      join(packageDir, 'migration.json'),
      JSON.stringify({ createdAt: '2026-01-01T00:00:00.000Z', zzz: 1 }),
    );
    expect(appActions()).toEqual([
      RESTORE,
      {
        kind: 'run-command',
        label: 'Or write migration.json and ops.json again from its migration.ts',
        command: `node "migrations/app/${DIR_NAME}/migration.ts"`,
      },
    ]);
  });

  it.each([
    ['is missing', undefined],
    ['is not JSON', '{ not json'],
    ['has no createdAt', '{"from":null}'],
  ])(
    'does not advise migration.ts when migration.json %s, which would change the migration hash',
    async (_, content) => {
      if (content !== undefined) await writeFile(join(packageDir, 'migration.json'), content);
      expect(appActions()).toEqual([RESTORE, replan]);
    },
  );

  it('advises writing an extension migration again from the installed extension, which ships no migration.ts', () => {
    expect(
      migrationPackageRepairActions({
        spaceId: 'pgvector',
        packageDir: '/work/migrations/pgvector/20260601T0000_install_vector_extension',
        cwd: '/work',
      }),
    ).toEqual([
      RESTORE,
      {
        kind: 'run-command',
        label:
          'Or delete the folder migrations/pgvector/20260601T0000_install_vector_extension and run this command, which emits contract.json from the contract source and writes the folder again from the installed extension when that version of the extension ships this migration',
        command: '{bin} contract emit',
      },
      {
        kind: 'user-choice',
        label: 'Or install a version of the extension that ships its migrations',
      },
    ]);
  });
});
