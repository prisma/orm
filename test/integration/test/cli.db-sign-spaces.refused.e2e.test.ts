import { existsSync, readdirSync } from 'node:fs';
import { withDevDatabase } from '@repo/test-utils';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';
import { TEST_SPACE_ID } from './contract-space-fixture/constants';
import testContractSpaceExtension from './contract-space-fixture/control';
import { runOnEngine, setupTestDirectoryFromFixtures, withTempDir } from './utils/cli-test-helpers';
import {
  dbRefPath,
  JOURNEY_TIMEOUT,
  postgresMarkerTableExists,
  prepareProject,
  signedSpaces,
} from './utils/db-sign-spaces-helpers';

/**
 * A `db sign` that signs no space writes nothing: the app space fails verification and the test extension's space lacks the invariant its head ref requires.
 */
withTempDir(({ createTempDir }) => {
  describe('db sign when no space can be signed', () => {
    it(
      'writes no marker, no ref and no snapshot, and exits 4',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const project = setupTestDirectoryFromFixtures(
            createTempDir,
            'db-sign-spaces',
            'prisma.config.with-db.ts',
            { '{{DB_URL}}': connectionString },
          );
          const { appHash, extHash } = await prepareProject(project, testContractSpaceExtension);
          const snapshotsDir = join(project.testDir, 'migrations', 'snapshots');
          const snapshotsBefore = readdirSync(snapshotsDir).sort();

          const sign = await runOnEngine(project, ['db', 'sign', '--json']);

          expect(sign.exitCode, `db sign: ${sign.stderr}`).toBe(4);
          expect(signedSpaces(sign)).toEqual([
            { space: 'app', status: 'failed', storageHash: appHash, previous: undefined },
            {
              space: TEST_SPACE_ID,
              status: 'missing-invariants',
              storageHash: extHash,
              previous: undefined,
            },
          ]);
          expect(await postgresMarkerTableExists(connectionString)).toBe(false);
          expect([
            existsSync(dbRefPath(project, 'app')),
            existsSync(dbRefPath(project, TEST_SPACE_ID)),
          ]).toEqual([false, false]);
          expect(readdirSync(snapshotsDir).sort()).toEqual(snapshotsBefore);
        });
      },
      JOURNEY_TIMEOUT,
    );
  });
});
