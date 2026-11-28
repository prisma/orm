import { APP_UPGRADE_GUIDES_URL } from '@internal/utils/upgrade-guides';
import { describe, expect, it } from 'vitest';
import { snapshotRepairActions, snapshotRewrite } from '../../src/utils/next-actions';

const HEAD = 'a'.repeat(64);
const OLDER = 'b'.repeat(64);

function place(spaceId: string, hash: string, headReachedByMigration = true) {
  return {
    spaceId,
    hash,
    headHash: HEAD,
    headReachedByMigration,
    migrationsDir: '/work/migrations',
    cwd: '/work',
  };
}

const RESTORE = {
  kind: 'user-choice',
  label: 'If the file was edited by hand, restore it from version control',
};

describe('snapshotRewrite', () => {
  it('names db migrate, and says it applies pending migrations, when a migration ends at the emitted contract', () => {
    expect(snapshotRewrite(place('app', HEAD))).toEqual({
      snapshotDirectory: `migrations/snapshots/${HEAD}`,
      command: '{bin} db migrate --advance-ref db',
      effect:
        'applies any pending migrations to the configured database, then moves the db ref to contract.json and writes the snapshot again from it',
    });
  });

  it('names db sign, and says it records the contract in the database, when no migration ends at the emitted contract', () => {
    expect(snapshotRewrite(place('app', HEAD, false))).toEqual({
      snapshotDirectory: `migrations/snapshots/${HEAD}`,
      command: '{bin} db sign',
      effect:
        'checks that the configured database matches contract.json and records that in the database, then moves the db ref to contract.json and writes the snapshot again from it',
    });
  });

  it('names contract emit, and says it emits contract.json, for the snapshot at the head of an extension', () => {
    expect(snapshotRewrite(place('pgvector', HEAD, false))).toEqual({
      snapshotDirectory: `migrations/snapshots/${HEAD}`,
      command: '{bin} contract emit',
      effect:
        'emits contract.json from the contract source and writes the snapshot again from the installed extension',
    });
  });

  it('names nothing for a snapshot no command writes again', () => {
    expect(snapshotRewrite(place('app', OLDER))).toBeUndefined();
    expect(snapshotRewrite(place('pgvector', OLDER))).toBeUndefined();
  });
});

describe('snapshotRepairActions', () => {
  it('for the application snapshot at the emitted contract: restore, upgrade, or delete and write again', () => {
    expect(snapshotRepairActions(place('app', HEAD))).toEqual([
      RESTORE,
      {
        kind: 'open-url',
        label: 'If an earlier release wrote the snapshot, follow the app upgrade instructions',
        url: APP_UPGRADE_GUIDES_URL,
      },
      {
        kind: 'run-command',
        label: `Or delete migrations/snapshots/${HEAD} and run this command, which applies any pending migrations to the configured database, then moves the db ref to contract.json and writes the snapshot again from it`,
        command: '{bin} db migrate --advance-ref db',
      },
    ]);
  });

  it('for an older application snapshot refs name: restore, upgrade, or move each ref but the db ref', () => {
    expect(snapshotRepairActions(place('app', OLDER), { refNames: ['db', 'production'] })).toEqual([
      RESTORE,
      expect.objectContaining({ kind: 'open-url' }),
      {
        kind: 'run-command',
        label:
          'Or point the ref "production" at a migration whose snapshot this release reads. The ref then names a different contract, so whatever uses the ref, such as a deploy that migrates a database to it, changes with it',
        command: '{bin} migration ref set production <hash>',
      },
    ]);
  });

  it('for the head snapshot of an extension: restore, or write it again from the installed extension, never the app upgrade instructions', () => {
    expect(snapshotRepairActions(place('pgvector', HEAD))).toEqual([
      RESTORE,
      {
        kind: 'run-command',
        label: `Or delete migrations/snapshots/${HEAD} and run this command, which emits contract.json from the contract source and writes the snapshot again from the installed extension`,
        command: '{bin} contract emit',
      },
    ]);
  });
});
