import { mkdir, rm, writeFile } from 'node:fs/promises';
import type { AggregateMigrationEdgeRef, PerSpacePlan } from '@internal/migration-tools/aggregate';
import { contractSnapshotDir } from '@internal/migration-tools/contract-snapshot-store';
import { blindCast } from '@internal/utils/casts';
import { join } from 'pathe';
import { afterEach, describe, expect, it } from 'vitest';
import { unrecordedSnapshotsOnPath } from '../../src/control-api/operations/unrecorded-snapshots';
import { createTestProjectDir } from '../utils/test-project-dir';

const NOT_JSON = 'a1'.repeat(32);
const ABSENT = 'b2'.repeat(32);

const projectDirs: string[] = [];
afterEach(async () => {
  await Promise.all(projectDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function migrationsDirWithSnapshotNotJson(): Promise<string> {
  const projectDir = createTestProjectDir('unrecorded-snapshots');
  projectDirs.push(projectDir);
  const migrationsDir = join(projectDir, 'migrations');
  await mkdir(contractSnapshotDir(migrationsDir, NOT_JSON), { recursive: true });
  await writeFile(join(contractSnapshotDir(migrationsDir, NOT_JSON), 'contract.json'), '{ nope');
  return migrationsDir;
}

function edge(dirName: string, to: string, destinationContractJson?: unknown) {
  const ref: AggregateMigrationEdgeRef = {
    migrationHash: `sha256:${dirName}`,
    dirName,
    from: 'a'.repeat(64),
    to,
    operationCount: 1,
    ...(destinationContractJson === undefined ? {} : { destinationContractJson }),
  };
  return ref;
}

function planWith(...migrationEdges: AggregateMigrationEdgeRef[]): PerSpacePlan {
  return blindCast<PerSpacePlan, 'unrecordedSnapshotsOnPath reads only migrationEdges'>({
    migrationEdges,
  });
}

describe('unrecordedSnapshotsOnPath', () => {
  it('reports an edge without a contract whose snapshot is present but not JSON', async () => {
    const migrationsDir = await migrationsDirWithSnapshotNotJson();

    const found = await unrecordedSnapshotsOnPath(
      [{ spaceId: 'pgvector', entry: planWith(edge('20260101T0000_init', NOT_JSON)) }],
      migrationsDir,
      undefined,
    );

    expect(found).toEqual([
      {
        spaceId: 'pgvector',
        dirName: '20260101T0000_init',
        path: join(contractSnapshotDir(migrationsDir, NOT_JSON), 'contract.json'),
        reason: expect.stringContaining('Failed to parse'),
      },
    ]);
  });

  it('reports nothing for an edge that carries its contract, as a plan from a diff does, nor for an absent snapshot', async () => {
    const migrationsDir = await migrationsDirWithSnapshotNotJson();

    const found = await unrecordedSnapshotsOnPath(
      [
        {
          spaceId: 'app',
          entry: planWith(
            edge('db-update', NOT_JSON, { storage: {} }),
            edge('20260102T0000_next', ABSENT),
          ),
        },
      ],
      migrationsDir,
      undefined,
    );

    expect(found).toEqual([]);
  });
});
