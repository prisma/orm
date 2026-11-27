import { withClient } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import {
  runContractEmit,
  runDbInit,
  runMigrationStatus,
  setupJourney,
  timeouts,
  useDevDatabase,
} from '../utils/journey-test-helpers';

async function plantNullInvariants(connectionString: string) {
  await withClient(connectionString, async (client) => {
    await client.query('ALTER TABLE _prisma.marker ALTER COLUMN invariants DROP NOT NULL');
    await client.query(`UPDATE _prisma.marker SET invariants = NULL WHERE space = 'app'`);
  });
}

withTempDir(({ createTempDir }) => {
  describe('marker read typed errors — corrupt marker on migration status', () => {
    const db = useDevDatabase();

    it(
      'returns CONTRACT.MARKER_ROW_CORRUPT on migration status when marker is corrupt and migrations dir is empty',
      async () => {
        const ctx = setupJourney({ connectionString: db.connectionString, createTempDir });

        expect((await runContractEmit(ctx)).exitCode).toBe(0);
        expect((await runDbInit(ctx)).exitCode).toBe(0);
        await plantNullInvariants(db.connectionString);

        const statusFail = await runMigrationStatus(ctx, ['--json', '--no-color']);
        expect(statusFail.exitCode).not.toBe(0);

        const terminal = statusFail.json.at(-1);
        expect(terminal).toMatchObject({
          kind: 'result',
          envelope: {
            ok: false,
            error: {
              code: 'CONTRACT.MARKER_ROW_CORRUPT',
              summary: 'Marker row is corrupt or incompatible',
            },
          },
        });
      },
      timeouts.spinUpPpgDev,
    );
  });
});
