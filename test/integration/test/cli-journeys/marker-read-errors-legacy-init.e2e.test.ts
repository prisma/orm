import { withClient } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import {
  parseJsonOutput,
  runContractEmit,
  runDbInit,
  setupJourney,
  timeouts,
  useDevDatabase,
} from '../utils/journey-test-helpers';

async function plantLegacyMarker(connectionString: string) {
  await withClient(connectionString, async (client) => {
    await client.query('DROP TABLE IF EXISTS prisma_contract.marker CASCADE');
    await client.query(`
      CREATE TABLE prisma_contract.marker (
        core_hash text NOT NULL,
        profile_hash text NOT NULL,
        contract_json jsonb,
        canonical_version int,
        updated_at timestamptz NOT NULL,
        app_tag text,
        meta jsonb NOT NULL DEFAULT '{}',
        invariants text[] NOT NULL DEFAULT '{}'
      )
    `);
    await client.query(`
      INSERT INTO prisma_contract.marker (core_hash, profile_hash, updated_at)
      VALUES ('legacy', 'legacy', NOW())
    `);
  });
}

withTempDir(({ createTempDir }) => {
  describe('marker read typed errors — legacy marker on db init', () => {
    const db = useDevDatabase();

    it(
      'returns MIGRATION.RUNNER_FAILED when legacy marker table lacks space column on db init',
      async () => {
        const ctx = setupJourney({ connectionString: db.connectionString, createTempDir });

        expect((await runContractEmit(ctx)).exitCode).toBe(0);
        expect((await runDbInit(ctx)).exitCode).toBe(0);
        await plantLegacyMarker(db.connectionString);

        const initFail = await runDbInit(ctx, ['--json', '--no-color']);
        expect(initFail.exitCode).not.toBe(0);

        const error = parseJsonOutput<{
          code: string;
          nextActions: readonly { kind: string; label: string; command?: string }[];
        }>(initFail);
        expect(error.code).toBe('MIGRATION.RUNNER_FAILED');
        expect(error.nextActions).toContainEqual(
          expect.objectContaining({
            kind: 'run-command',
            label: 'Reinitialise the marker table from a clean baseline',
            command: 'prisma-test db init',
          }),
        );
      },
      timeouts.spinUpPpgDev,
    );
  });
});
