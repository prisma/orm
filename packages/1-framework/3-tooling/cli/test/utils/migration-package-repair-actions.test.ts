import { describe, expect, it } from 'vitest';
import { migrationPackageRepairActions } from '../../src/utils/next-actions';

describe('migrationPackageRepairActions', () => {
  it('advises running the migration.ts of an application migration', () => {
    expect(
      migrationPackageRepairActions({
        spaceId: 'app',
        packageDir: '/work/migrations/app/20260101T0000_init',
        cwd: '/work',
      }),
    ).toEqual([
      { kind: 'user-choice', label: 'Restore the migration package from version control' },
      {
        kind: 'run-command',
        label: 'Or write migration.json and ops.json again from its migration.ts',
        command: 'node "migrations/app/20260101T0000_init/migration.ts"',
      },
    ]);
  });

  it('advises writing an extension migration again from the installed extension, which ships no migration.ts', () => {
    expect(
      migrationPackageRepairActions({
        spaceId: 'pgvector',
        packageDir: '/work/migrations/pgvector/20260601T0000_install_vector_extension',
        cwd: '/work',
      }),
    ).toEqual([
      { kind: 'user-choice', label: 'Restore the migration package from version control' },
      {
        kind: 'run-command',
        label:
          'Or delete the folder migrations/pgvector/20260601T0000_install_vector_extension and write it again from the installed extension, when that version of the extension ships this migration',
        command: '{bin} contract emit',
      },
      {
        kind: 'user-choice',
        label: 'Or install a version of the extension that ships its migrations',
      },
    ]);
  });
});
