/**
 * Schema Drift Scenarios (Journeys M + N)
 *
 * M — Manual DDL with unchanged marker: after initialization, a DBA drops a
 *     column via manual DDL. db verify catches that the live schema no longer
 *     matches the contract. db verify --marker-only still performs marker-only
 *     verification and therefore passes if the marker row is unchanged.
 *     Recovery via db update succeeds when the planner can use a temporary
 *     default to re-add a dropped NOT NULL column on a non-empty table.
 *
 * N — Extra column drift: a DBA adds a column via manual DDL. Tolerant
 *     db verify passes (extras OK), strict db verify fails. Recovery
 *     by expanding the contract to include a new column, then db update.
 */

import { withClient } from '@repo/test-utils';
import stripAnsi from 'strip-ansi';
import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import {
  engineDiagnosticCodes,
  type JourneyContext,
  parseJsonOutput,
  runContractEmit,
  runDbInit,
  runDbSchema,
  runDbUpdate,
  runDbVerify,
  setupJourney,
  swapContract,
  timeouts,
  useDevDatabase,
} from '../utils/journey-test-helpers';

withTempDir(({ createTempDir }) => {
  // -------------------------------------------------------------------------
  // Journey M: Manual DDL With Unchanged Marker
  // -------------------------------------------------------------------------
  describe('Journey M: Manual DDL With Unchanged Marker', () => {
    const db = useDevDatabase();

    it(
      'init → insert row → manual DDL drop → verify fails → verify --marker-only passes → verify --schema-only fails → update recovers',
      async () => {
        const ctx: JourneyContext = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
        });

        // Precondition: init with base contract
        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, 'M.pre: emit').toBe(0);
        const init = await runDbInit(ctx);
        expect(init.exitCode, 'M.pre: init').toBe(0);

        await withClient(db.connectionString, async (client) => {
          await client.query(`INSERT INTO "user" ("id", "email") VALUES (1, 'alice@example.com')`);
          await client.query('ALTER TABLE "user" DROP COLUMN email');
        });

        // M.01: db verify (fails — schema verification detects the missing column)
        const verify = await runDbVerify(ctx);
        expect(verify.exitCode, 'M.01: db verify detects drift').toBe(4);
        expect(engineDiagnosticCodes(verify), 'M.01: drift rides as a finding').toContain(
          'CONTRACT.SCHEMA_VERIFICATION_FAILED',
        );

        // M.02: db verify --marker-only (passes — marker hash still matches)
        const markerOnlyVerify = await runDbVerify(ctx, ['--marker-only']);
        expect(markerOnlyVerify.exitCode, 'M.02: db verify --marker-only').toBe(0);

        // M.03: db verify --schema-only (fails — missing email column)
        const schemaVerify = await runDbVerify(ctx, ['--schema-only']);
        expect(schemaVerify.exitCode, 'M.03: db verify --schema-only fails').toBe(4);
        expect(engineDiagnosticCodes(schemaVerify)).toContain(
          'CONTRACT.SCHEMA_VERIFICATION_FAILED',
        );

        // M.04: db schema (shows schema without email)
        const schema = await runDbSchema(ctx);
        expect(schema.exitCode, 'M.04: db schema').toBe(0);

        // M.05: db update recovers by re-adding the NOT NULL column with a temporary default,
        // then dropping that default so future inserts must provide an explicit value.
        const update = await runDbUpdate(ctx);
        expect(update.exitCode, 'M.05: db update recovers dropped column drift').toBe(0);

        // M.06: db verify passes after reconciliation
        const verifyAfter = await runDbVerify(ctx);
        expect(verifyAfter.exitCode, 'M.06: db verify passes after db update').toBe(0);

        await withClient(db.connectionString, async (client) => {
          const restoredRows = await client.query<{ email: string }>(
            'SELECT email FROM "user" WHERE id = 1',
          );
          expect(restoredRows.rows).toEqual([{ email: '' }]);

          const defaultCheck = await client.query<{ column_default: string | null }>(`
            SELECT column_default
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'user'
              AND column_name = 'email'
          `);
          expect(defaultCheck.rows[0]!['column_default']).toBeNull();
        });
      },
      timeouts.spinUpPpgDev,
    );
  });

  // -------------------------------------------------------------------------
  // Journey N: Manual DDL Added Extra Column
  // -------------------------------------------------------------------------
  describe('Journey N: Extra Column Drift', () => {
    const db = useDevDatabase();

    it(
      'init → manual DDL add → verify/tolerant pass → strict fails → expand contract → update → verify',
      async () => {
        const ctx: JourneyContext = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
        });

        // Precondition: init with base contract
        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, 'N.pre: emit').toBe(0);
        const init = await runDbInit(ctx);
        expect(init.exitCode, 'N.pre: init').toBe(0);

        // Manual DDL: add age column
        await withClient(db.connectionString, async (client) => {
          await client.query('ALTER TABLE "user" ADD COLUMN age int4');
        });

        // N.01: db verify (passes — marker matches and tolerant schema verification allows extras)
        const verify = await runDbVerify(ctx);
        expect(verify.exitCode, 'N.01: db verify passes').toBe(0);

        // N.02: db verify --schema-only (passes — tolerant, extras OK)
        const tolerant = await runDbVerify(ctx, ['--schema-only']);
        expect(tolerant.exitCode, 'N.02: db verify --schema-only tolerant passes').toBe(0);

        // N.03: db verify --strict (fails — extra age column)
        const strict = await runDbVerify(ctx, ['--strict']);
        expect(strict.exitCode, 'N.03: db verify strict fails').toBe(4);
        expect(engineDiagnosticCodes(strict), 'N.03: the extra column is the finding').toEqual([
          'CONTRACT.SCHEMA_VERIFICATION_FAILED',
        ]);

        // N.04: db schema
        const schema = await runDbSchema(ctx);
        expect(schema.exitCode, 'N.04: db schema').toBe(0);
        expect(stripAnsi(schema.stderr), 'N.04: shows age column').toContain('age');

        // N.05: Evolve contract (adds 'name' column — 'age' remains as unmanaged extra)
        swapContract(ctx, 'contract-additive');
        const emitExpanded = await runContractEmit(ctx);
        expect(emitExpanded.exitCode, 'N.05: contract emit expanded').toBe(0);

        // N.06: db update --no-interactive rejects (drift from unmanaged 'age' column
        // makes the planner classify this as destructive)
        const update = await runDbUpdate(ctx, ['--json', '--no-interactive']);
        expect(update.exitCode, 'N.06: --no-interactive rejects destructive').toBe(2);
        expect(parseJsonOutput(update), 'N.06: the unmanaged column is the question').toMatchObject(
          {
            code: 'CLI.CONSENT_REQUIRED',
            meta: { unanswered: [{ subject: 'public.user.age', verbs: ['delete'] }] },
          },
        );

        // N.07: db update --delete names the storage no model stores, and applies
        const updateConfirmed = await runDbUpdate(ctx, ['--delete', 'public.user.age']);
        expect(updateConfirmed.exitCode, 'N.07: db update --delete applies').toBe(0);

        // N.08: db verify --schema-only tolerant (passes — all contract columns present; 'age' tolerated as extra)
        const tolerantAfter = await runDbVerify(ctx, ['--schema-only']);
        expect(tolerantAfter.exitCode, 'N.08: schema-only tolerant passes after update').toBe(0);
      },
      timeouts.spinUpPpgDev,
    );
  });
});
