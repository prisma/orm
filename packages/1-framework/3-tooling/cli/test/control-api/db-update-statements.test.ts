import { writeFileSync } from 'node:fs';
import { asNamespaceId } from '@internal/contract/types';
import { contractSnapshotDir } from '@internal/migration-tools/contract-snapshot-store';
import { MigrationToolsError } from '@internal/migration-tools/errors';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';
import {
  DESTINATION_HASH,
  destination,
  markerAt,
  migrationsDirWithSnapshot,
  ORIGIN_HASH,
  origin,
  recordingMigrations,
  update,
} from './db-update-statement-fixtures';

describe('executeDbUpdate with statements', () => {
  it('plans from the snapshot of the marker hash and hands the planner the resolved statements', async () => {
    const { migrations, calls } = recordingMigrations();
    const result = await update({
      migrationsDir: await migrationsDirWithSnapshot(origin),
      marker: markerAt(ORIGIN_HASH),
      renames: ['Profile:User'],
      migrations,
    });

    expect(calls).toEqual([
      {
        fromContract: origin,
        origin: null,
        statements: [
          {
            kind: 'rename',
            entity: 'model',
            from: { namespaceId: 'app', model: 'Profile' },
            to: { namespaceId: 'app', model: 'User' },
          },
        ],
      },
    ]);
    expect(result.ok && result.value.appliedStatements).toEqual([
      expect.objectContaining({
        description: 'rename model "Profile" to "User"',
        operationIndexes: [0],
      }),
    ]);
  });

  it('hands the runner a plan with no origin, as without statements', async () => {
    const { migrations, execute } = recordingMigrations();
    await update({
      migrationsDir: await migrationsDirWithSnapshot(origin),
      marker: markerAt(ORIGIN_HASH),
      renames: ['Profile:User'],
      mode: 'apply',
      migrations,
    });
    const [runnerOptions] = execute.mock.calls[0] ?? [];
    expect(runnerOptions.perSpaceOptions[0].plan.origin).toBeNull();
  });

  it('refuses statements when the snapshot of the marker hash cannot be read, naming why', async () => {
    const { migrations, calls } = recordingMigrations();
    await expect(
      update({
        migrationsDir: await migrationsDirWithSnapshot(origin),
        marker: markerAt(ORIGIN_HASH),
        renames: ['Profile:User'],
        unreadableOrigin: true,
        migrations,
      }),
    ).rejects.toMatchObject({
      code: 'MIGRATION.STATEMENT_ORIGIN_UNKNOWN',
      why: expect.stringContaining('unknown contract format'),
    });
    expect(calls).toEqual([]);
  });

  it('says the snapshot cannot be read when its contract.json is not JSON, rather than that it is missing', async () => {
    const { migrations, calls } = recordingMigrations();
    const migrationsDir = await migrationsDirWithSnapshot(origin);
    writeFileSync(
      join(contractSnapshotDir(migrationsDir, ORIGIN_HASH), 'contract.json'),
      '{ not json',
    );
    const refusal = await update({
      migrationsDir,
      marker: markerAt(ORIGIN_HASH),
      renames: ['Profile:User'],
      migrations,
    }).catch((error: unknown) => error);
    expect(refusal).toMatchObject({
      code: 'MIGRATION.STATEMENT_ORIGIN_UNKNOWN',
      why: expect.stringMatching(
        /^The contract snapshot for hash "a+" in .* could not be read: Failed to parse/,
      ),
      fix: expect.stringContaining('Restore migrations/snapshots/ from version control'),
      meta: { unreadable: expect.stringContaining('Failed to parse') },
    });
    expect(calls).toEqual([]);
  });

  it('says the snapshot cannot be read when its content does not match its hash', async () => {
    const { migrations } = recordingMigrations();
    const migrationsDir = await migrationsDirWithSnapshot(origin);
    const refusal = await update({
      migrationsDir,
      marker: markerAt(ORIGIN_HASH),
      renames: ['Profile:User'],
      migrations,
      verifySnapshotContent: {
        assertSnapshotContentMatches: (_json, storageHash, jsonPath) => {
          throw new MigrationToolsError(
            'MIGRATION.CONTRACT_SNAPSHOT_CONTENT_MISMATCH',
            'Contract snapshot content does not match its hash',
            {
              why: `The contract snapshot at "${jsonPath}" is addressed by storage hash ${storageHash}, but its content recomputes to ${'c'.repeat(64)}.`,
              fix: 'Restore migrations/snapshots/ from version control.',
            },
          );
        },
      },
    }).catch((error: unknown) => error);
    expect(refusal).toMatchObject({
      code: 'MIGRATION.STATEMENT_ORIGIN_UNKNOWN',
      why: expect.stringContaining('could not be read: The contract snapshot at'),
      meta: { unreadable: expect.stringContaining('its content recomputes to') },
    });
  });

  it('reports the applied statements on an apply', async () => {
    const { migrations } = recordingMigrations();
    const result = await update({
      migrationsDir: await migrationsDirWithSnapshot(origin),
      marker: markerAt(ORIGIN_HASH),
      renames: ['Profile:User'],
      mode: 'apply',
      migrations,
    });
    expect(result.ok && result.value.mode).toBe('apply');
    expect(result.ok && result.value.appliedStatements).toHaveLength(1);
  });

  it('gives the destructive pre-plan the statements, so a rename is not refused as a drop', async () => {
    const { migrations, calls } = recordingMigrations('destructive');
    const result = await update({
      migrationsDir: await migrationsDirWithSnapshot(origin),
      marker: markerAt(ORIGIN_HASH),
      renames: ['Profile:User'],
      mode: 'apply',
      migrations,
    });
    expect(result.ok).toBe(true);
    expect(calls.every((call) => call.statements.length === 1)).toBe(true);
  });

  it('refuses statements when the snapshot store has no contract for the marker hash', async () => {
    const { migrations, calls } = recordingMigrations();
    const migrationsDir = await migrationsDirWithSnapshot(undefined);
    await expect(
      update({
        migrationsDir,
        marker: markerAt(ORIGIN_HASH),
        renames: ['Profile:User'],
        migrations,
      }),
    ).rejects.toMatchObject({
      code: 'MIGRATION.STATEMENT_ORIGIN_UNKNOWN',
      meta: { hash: ORIGIN_HASH, snapshotDirectory: join(migrationsDir, 'snapshots', ORIGIN_HASH) },
      fix: expect.stringContaining('--advance-ref <name>'),
    });
    expect(calls).toEqual([]);
  });

  it('refuses statements when the database has no marker', async () => {
    const { migrations } = recordingMigrations();
    await expect(
      update({
        migrationsDir: await migrationsDirWithSnapshot(undefined),
        marker: undefined,
        renames: ['Profile:User'],
        migrations,
      }),
    ).rejects.toMatchObject({
      code: 'MIGRATION.STATEMENT_ORIGIN_UNKNOWN',
      meta: { hash: null },
      why: expect.stringContaining('no earlier contract'),
      fix: expect.not.stringContaining('--advance-ref'),
    });
  });

  it('refuses the same statements once the database is at the destination', async () => {
    const { migrations } = recordingMigrations();
    await expect(
      update({
        migrationsDir: await migrationsDirWithSnapshot(destination),
        marker: markerAt(DESTINATION_HASH),
        renames: ['Profile:User'],
        migrations,
      }),
    ).rejects.toMatchObject({ code: 'MIGRATION.STATEMENT_UNRESOLVED' });
  });

  it('names a dry run subject as the question would, through the renamed model', async () => {
    const { migrations } = recordingMigrations('additive', [
      {
        operationIndex: 0,
        subject: {
          kind: 'field',
          namespaceId: asNamespaceId('app'),
          model: 'Profile',
          field: 'nickname',
        },
        loss: 'drop',
        label: 'Drop column nickname',
      },
    ]);

    const result = await update({
      migrationsDir: await migrationsDirWithSnapshot(origin),
      marker: markerAt(ORIGIN_HASH),
      renames: ['Profile:User'],
      migrations,
    });

    expect(result.ok && result.value.dataLoss).toEqual([
      {
        operationIndex: 0,
        subject: { kind: 'field', namespaceId: 'app', model: 'Profile', field: 'nickname' },
        loss: 'drop',
        label: 'Drop column nickname',
        text: 'User.nickname',
      },
    ]);
  });

  it('lists a delete a dry run is given among its applied statements, as migration plan does', async () => {
    const { migrations } = recordingMigrations('additive', [
      {
        operationIndex: 0,
        subject: {
          kind: 'field',
          namespaceId: asNamespaceId('app'),
          model: 'Profile',
          field: 'nickname',
        },
        loss: 'drop',
        label: 'Drop column nickname',
      },
    ]);

    const result = await update({
      migrationsDir: await migrationsDirWithSnapshot(origin),
      marker: markerAt(ORIGIN_HASH),
      renames: ['Profile:User'],
      fieldStatements: [{ verb: 'delete', text: 'User.nickname' }],
      migrations,
    });

    expect(
      result.ok &&
        result.value.appliedStatements.map(({ verb, operationIndexes }) => ({
          verb,
          operationIndexes,
        })),
    ).toEqual([
      { verb: 'rename', operationIndexes: [0] },
      { verb: 'delete', operationIndexes: [0] },
    ]);
  });

  it('reads no snapshot without statements, and plans from no origin contract', async () => {
    const withSnapshot = recordingMigrations();
    const result = await update({
      migrationsDir: await migrationsDirWithSnapshot(origin),
      marker: markerAt(ORIGIN_HASH),
      renames: [],
      unreadableOrigin: true,
      migrations: withSnapshot.migrations,
    });
    expect(result.ok).toBe(true);
    expect(withSnapshot.calls).toEqual([{ fromContract: null, origin: null, statements: [] }]);

    const without = recordingMigrations();
    const withoutSnapshot = await update({
      migrationsDir: await migrationsDirWithSnapshot(undefined),
      marker: markerAt(ORIGIN_HASH),
      renames: [],
      migrations: without.migrations,
    });
    expect(without.calls).toEqual([{ fromContract: null, origin: null, statements: [] }]);
    expect(withoutSnapshot.ok && withoutSnapshot.value.appliedStatements).toEqual([]);
  });
});
