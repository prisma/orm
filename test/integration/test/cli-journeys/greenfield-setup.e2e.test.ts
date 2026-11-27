/**
 * Greenfield Setup (Journey A)
 *
 * A developer starts a new project with an empty database and walks through
 * the full initialization lifecycle: emit a contract, dry-run the init to
 * preview planned operations, apply it for real, confirm idempotency on
 * re-run, then verify the marker and schema (tolerant and strict). Finishes
 * with schema inspection and JSON output variants of full and schema-only verify.
 */

import stripAnsi from 'strip-ansi';
import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import {
  engineDocument,
  type JourneyContext,
  runContractEmit,
  runDbInit,
  runDbSchema,
  runDbVerify,
  setupJourney,
  sql,
  timeouts,
  useDevDatabase,
} from '../utils/journey-test-helpers';

withTempDir(({ createTempDir }) => {
  describe('Journey A: Greenfield Setup', () => {
    const db = useDevDatabase();

    it(
      'emit → init → verify → schema inspection (full greenfield workflow)',
      async () => {
        const ctx: JourneyContext = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
        });

        // A.01: contract emit
        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, 'A.01: contract emit').toBe(0);

        // A.02: db init --dry-run
        const dryRun = await runDbInit(ctx, ['--dry-run']);
        expect(dryRun.exitCode, 'A.02: db init dry-run').toBe(0);
        expect(stripAnsi(dryRun.stderr), 'A.02: shows planned ops').toContain('Planned');
        expect(stripAnsi(dryRun.stderr), 'A.02: mentions dry run').toContain('dry run');
        // Verify database not modified
        const tablesAfterDryRun = await sql(
          db.connectionString,
          `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'user'`,
        );
        expect(tablesAfterDryRun.rows.length, 'A.02: no tables created').toBe(0);

        // A.03: db init
        const init = await runDbInit(ctx);
        expect(init.exitCode, 'A.03: db init').toBe(0);
        expect(stripAnsi(init.stderr), 'A.03: reports applied').toContain('Applied');
        // Verify table created
        const tablesAfterInit = await sql(
          db.connectionString,
          `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'user'`,
        );
        expect(tablesAfterInit.rows.length, 'A.03: user table created').toBe(1);
        // Verify marker created
        const marker = await sql(
          db.connectionString,
          "SELECT core_hash, profile_hash FROM _prisma.signatures WHERE space = 'app'",
        );
        expect(marker.rows.length, 'A.03: marker created').toBe(1);
        expect(marker.rows[0]?.['core_hash'], 'A.03: marker has core_hash').toBeDefined();

        // A.04: db init (idempotent)
        const initAgain = await runDbInit(ctx);
        expect(initAgain.exitCode, 'A.04: db init idempotent').toBe(0);
        expect(stripAnsi(initAgain.stderr), 'A.04: reports already matches').toContain('already');

        // A.05: db verify
        const verify = await runDbVerify(ctx);
        expect(verify.exitCode, 'A.05: db verify').toBe(0);

        // A.06: db verify --schema-only
        const schemaVerify = await runDbVerify(ctx, ['--schema-only']);
        expect(schemaVerify.exitCode, 'A.06: db verify --schema-only').toBe(0);

        // A.07: db verify --strict
        const schemaVerifyStrict = await runDbVerify(ctx, ['--strict']);
        expect(schemaVerifyStrict.exitCode, 'A.07: db verify strict').toBe(0);

        // A.08: db schema
        const schema = await runDbSchema(ctx);
        expect(schema.exitCode, 'A.08: db schema').toBe(0);
        expect(stripAnsi(schema.stderr), 'A.08: shows user table').toContain('user');

        // A.09: db verify --json
        const verifyJson = await runDbVerify(ctx, ['--json']);
        expect(verifyJson.exitCode, 'A.09: db verify json').toBe(0);
        expect(engineDocument(verifyJson), 'A.09: json ok').toMatchObject({
          ok: true,
          contract: { storageHash: expect.any(String) },
          marker: { storageHash: expect.any(String) },
        });

        // A.10: db verify --schema-only --json
        const schemaVerifyJson = await runDbVerify(ctx, ['--schema-only', '--json']);
        expect(schemaVerifyJson.exitCode, 'A.10: db verify schema-only json').toBe(0);
        expect(engineDocument(schemaVerifyJson), 'A.10: json ok').toMatchObject({ ok: true });
      },
      timeouts.spinUpPpgDev,
    );
  });
});
