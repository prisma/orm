/**
 * `migration log` against a live ledger — the first end-to-end coverage this
 * command has ever had. Two migrations are applied, and the log must report
 * both edges, in the order they were applied, from what the database records
 * rather than from anything on disk.
 */

import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import {
  type JourneyContext,
  latestMigrationDirName,
  planMigrationAndSelfEmit,
  runContractEmit,
  runMigrate,
  runMigrationLog,
  setupJourney,
  swapContract,
  timeouts,
  useDevDatabase,
} from '../utils/journey-test-helpers';

interface LedgerRecordJson {
  readonly space: string;
  readonly name: string;
  readonly fromContract: string | null;
  readonly toContract: string;
  readonly operationCount: number;
}

withTempDir(({ createTempDir }) => {
  describe('journey: reading the applied migration ledger', () => {
    const db = useDevDatabase();

    it(
      'reports every applied edge, as a completed envelope and as a drawn table',
      async () => {
        const ctx: JourneyContext = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
        });

        expect((await runContractEmit(ctx)).exitCode, 'emit base').toBe(0);
        expect((await planMigrationAndSelfEmit(ctx, ['--name', 'initial'])).exitCode, 'plan').toBe(
          0,
        );
        expect((await runMigrate(ctx)).exitCode, 'apply initial').toBe(0);

        swapContract(ctx, 'contract-additive');
        expect((await runContractEmit(ctx)).exitCode, 'emit v2').toBe(0);
        expect(
          (
            await planMigrationAndSelfEmit(ctx, [
              '--name',
              'add-name-column',
              '--from',
              latestMigrationDirName(ctx),
            ])
          ).exitCode,
          'plan v2',
        ).toBe(0);
        expect((await runMigrate(ctx)).exitCode, 'apply v2').toBe(0);

        const log = await runMigrationLog(ctx, ['--json']);
        const document = log.presented?.data as {
          ok: boolean;
          summary: string;
          records: readonly LedgerRecordJson[];
        };

        expect(log.exitCode).toBe(0);
        expect(log.json.at(-1)).toMatchObject({
          kind: 'result',
          envelope: { ok: true, exitCode: 0 },
        });
        expect(document.ok).toBe(true);
        expect(document.summary).toBe('2 migration(s) applied');
        expect(document.records.map((record) => record.name)).toEqual([
          expect.stringContaining('initial'),
          expect.stringContaining('add_name_column'),
        ]);
        expect(document.records.every((record) => record.space === 'app')).toBe(true);
        // The ledger records the chain, so each edge starts where the last ended.
        expect(document.records[1]?.fromContract).toBe(document.records[0]?.toContract);

        // Human mode draws the table for the reader on stderr; stdout carries
        // the frame stream alone, in either mode.
        const human = await runMigrationLog(ctx);
        expect(human.stderr).toContain('initial');
        expect(human.stdout).toBe('');
        expect(human.presented?.presentation.human?.[0]).toMatchObject({ kind: 'fields' });
        expect(human.presented?.presentation.human?.[1]).toMatchObject({ kind: 'table' });
        expect(log.presented?.presentation.stdout).toEqual([]);
        for (const line of log.stdout.split('\n').filter((entry) => entry.length > 0)) {
          expect(() => JSON.parse(line)).not.toThrow();
        }
      },
      timeouts.spinUpPpgDev,
    );

    it(
      'errors with the dotted code when no database is configured',
      async () => {
        const ctx: JourneyContext = setupJourney({ createTempDir });

        const log = await runMigrationLog(ctx, ['--json']);
        const terminal = log.json.at(-1);
        const envelope =
          terminal !== undefined && terminal.kind === 'result' ? terminal.envelope : undefined;

        expect(log.exitCode).toBe(2);
        expect(envelope).toMatchObject({
          ok: false,
          error: { code: 'CONFIG.DB_CONNECTION_REQUIRED' },
        });
        expect(envelope?.nextActions.length).toBeGreaterThan(0);
        expect(envelope?.ok).toBe(false);
        expect(envelope).not.toHaveProperty('error.fix');
      },
      timeouts.typeScriptCompilation,
    );
  });
});
