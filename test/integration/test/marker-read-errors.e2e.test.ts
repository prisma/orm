import { withClient } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { withTempDir } from './utils/cli-test-helpers';
import {
  runContractEmit,
  runDbInit,
  runDbVerify,
  setupJourney,
  timeouts,
  useDevDatabase,
} from './utils/journey-test-helpers';

withTempDir(({ createTempDir }) => {
  describe('marker read typed errors (PostgreSQL)', () => {
    const db = useDevDatabase();

    it(
      'returns CONTRACT.MARKER_ROW_CORRUPT when marker row has invalid invariants',
      async () => {
        const ctx = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
        });

        const emit = await runContractEmit(ctx);
        expect(emit.exitCode).toBe(0);
        const init = await runDbInit(ctx);
        expect(init.exitCode).toBe(0);

        await withClient(db.connectionString, async (client) => {
          await client.query(
            'ALTER TABLE prisma_contract.marker ALTER COLUMN invariants DROP NOT NULL',
          );
          await client.query(
            `UPDATE prisma_contract.marker SET invariants = NULL WHERE space = 'app'`,
          );
        });

        // A corrupt marker row stops the verification from running at all, so
        // it errors at exit 2 rather than reporting a finding at exit 4.
        const verifyFail = await runDbVerify(ctx, ['--json', '--no-color']);
        expect(verifyFail.exitCode).toBe(2);

        const terminal = verifyFail.json.at(-1);
        const envelope =
          terminal !== undefined && terminal.kind === 'result' ? terminal.envelope : undefined;
        expect(envelope).toMatchObject({
          ok: false,
          error: {
            code: 'CONTRACT.MARKER_ROW_CORRUPT',
            summary: 'Marker row is corrupt or incompatible',
            why: expect.stringContaining('Invalid contract marker row'),
          },
        });
        expect(JSON.stringify(envelope)).toContain('prisma-test db sign --db <url>');
        expect(envelope).not.toHaveProperty('fix');
      },
      timeouts.spinUpPpgDev,
    );
  });
});
