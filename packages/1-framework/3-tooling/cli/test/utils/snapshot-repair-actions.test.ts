import { APP_UPGRADE_GUIDES_URL } from '@internal/utils/upgrade-guides';
import { describe, expect, it } from 'vitest';
import { snapshotRepairActions, snapshotRewrite } from '../../src/utils/next-actions';

const HEAD = 'a'.repeat(64);
const OLDER = 'b'.repeat(64);

function place(spaceId: string, hash: string) {
  return { spaceId, hash, headHash: HEAD, migrationsDir: '/work/migrations', cwd: '/work' };
}

describe('snapshotRewrite', () => {
  it('names db migrate for the application snapshot at the emitted contract', () => {
    expect(snapshotRewrite(place('app', HEAD))).toEqual({
      snapshotDirectory: `migrations/snapshots/${HEAD}`,
      command: '{bin} db migrate --advance-ref db',
      source: 'contract.json',
    });
  });

  it('names contract emit for the snapshot at the head of an extension', () => {
    expect(snapshotRewrite(place('pgvector', HEAD))).toEqual({
      snapshotDirectory: `migrations/snapshots/${HEAD}`,
      command: '{bin} contract emit',
      source: 'the installed extension',
    });
  });

  it('names nothing for a snapshot no command writes again', () => {
    expect(snapshotRewrite(place('app', OLDER))).toBeUndefined();
    expect(snapshotRewrite(place('pgvector', OLDER))).toBeUndefined();
  });
});

describe('snapshotRepairActions', () => {
  it('for the application snapshot at the emitted contract: upgrade, delete and write again, or restore an edited file', () => {
    expect(snapshotRepairActions(place('app', HEAD))).toEqual([
      {
        kind: 'open-url',
        label: 'If an earlier release wrote the snapshot, follow the app upgrade instructions',
        url: APP_UPGRADE_GUIDES_URL,
      },
      {
        kind: 'run-command',
        label: `Or delete migrations/snapshots/${HEAD} and write it again from contract.json`,
        command: '{bin} db migrate --advance-ref db',
      },
      {
        kind: 'user-choice',
        label: 'If the file was edited by hand, restore it from version control',
      },
    ]);
  });

  it('for an older application snapshot a ref names: upgrade, move the ref, or restore an edited file', () => {
    expect(snapshotRepairActions(place('app', OLDER), { refNames: ['production'] })).toEqual([
      expect.objectContaining({ kind: 'open-url' }),
      {
        kind: 'run-command',
        label: 'Or point the ref "production" at a migration whose snapshot this release reads',
        command: '{bin} migration ref set production <hash>',
      },
      {
        kind: 'user-choice',
        label: 'If the file was edited by hand, restore it from version control',
      },
    ]);
  });

  it('for the head snapshot of an extension: write it again from the installed extension, never the app upgrade instructions', () => {
    expect(snapshotRepairActions(place('pgvector', HEAD))).toEqual([
      {
        kind: 'run-command',
        label: `Delete migrations/snapshots/${HEAD} and write it again from the installed extension`,
        command: '{bin} contract emit',
      },
      {
        kind: 'user-choice',
        label: 'If the file was edited by hand, restore it from version control',
      },
    ]);
  });
});
