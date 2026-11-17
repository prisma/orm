/**
 * Marker Drift Scenarios (Journeys K + L + P + P2)
 *
 * K — Missing marker: contract emitted but db init never run. db verify and
 *     db verify --schema-only both fail. Recovery via db init.
 *
 * L — Stale marker: database initialized, then contract changed without
 *     updating the DB. db verify fails (hash mismatch). Recovery via db update.
 *
 * P — Mixed-mode evolution: iterate through multiple contract versions using
 *     db update (no migration files). Verifies that the marker stays consistent
 *     across successive updates.
 *
 * P2 — Corrupt marker: marker row overwritten with garbage via raw SQL.
 *      db verify fails, but db verify --schema-only passes (schema intact).
 *      Recovery via db sign.
 */

import { withClient } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import {
  engineDiagnosticCodes,
  type JourneyContext,
  runContractEmit,
  runDbInit,
  runDbSchema,
  runDbSign,
  runDbUpdate,
  runDbVerify,
  setupJourney,
  swapContract,
  timeouts,
  useDevDatabase,
} from '../utils/journey-test-helpers';

withTempDir(({ createTempDir }) => {
  // -------------------------------------------------------------------------
  // Journey K: Missing Marker (Never Initialized)
  // -------------------------------------------------------------------------
  describe('Journey K: Missing Marker', () => {
    const db = useDevDatabase();

    it(
      'verify fails → verify --schema-only fails → schema empty → init recovers → verify passes',
      async () => {
        const ctx: JourneyContext = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
        });

        // Emit contract but don't init
        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, 'K.pre: emit').toBe(0);

        // K.01: db verify (fails — marker missing)
        const verifyFail = await runDbVerify(ctx);
        expect(verifyFail.exitCode, 'K.01: db verify reports a finding').toBe(4);
        expect(engineDiagnosticCodes(verifyFail)).toEqual(['CONTRACT.MARKER_MISSING']);

        // K.02: db verify --schema-only (fails — missing tables)
        const schemaVerifyFail = await runDbVerify(ctx, ['--schema-only']);
        expect(schemaVerifyFail.exitCode, 'K.02: db verify --schema-only reports a finding').toBe(
          4,
        );
        expect(engineDiagnosticCodes(schemaVerifyFail)).toContain(
          'CONTRACT.SCHEMA_VERIFICATION_FAILED',
        );

        // K.03: db schema (empty schema)
        const schema = await runDbSchema(ctx);
        expect(schema.exitCode, 'K.03: db schema').toBe(0);

        // K.04: db init (recovery)
        const init = await runDbInit(ctx);
        expect(init.exitCode, 'K.04: db init recovery').toBe(0);

        // K.05: db verify (passes)
        const verifyPass = await runDbVerify(ctx);
        expect(verifyPass.exitCode, 'K.05: db verify passes').toBe(0);
      },
      timeouts.spinUpPpgDev,
    );
  });

  // -------------------------------------------------------------------------
  // Journey L: Stale Marker (Contract Changed, DB Not Updated)
  // -------------------------------------------------------------------------
  describe('Journey L: Stale Marker', () => {
    const db = useDevDatabase();

    it(
      'init → swap contract → verify fails → verify --schema-only fails → db update recovers',
      async () => {
        const ctx: JourneyContext = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
        });

        // Precondition: init with base
        const emit0 = await runContractEmit(ctx);
        expect(emit0.exitCode, 'L.pre: emit').toBe(0);
        const init = await runDbInit(ctx);
        expect(init.exitCode, 'L.pre: init').toBe(0);

        // Swap to additive contract (different hash)
        swapContract(ctx, 'contract-additive');
        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, 'L.pre: emit v2').toBe(0);

        // L.01: db verify (fails — hash mismatch)
        const verifyFail = await runDbVerify(ctx);
        expect(verifyFail.exitCode, 'L.01: db verify reports a finding').toBe(4);
        expect(engineDiagnosticCodes(verifyFail)).toEqual(['CONTRACT.MARKER_MISMATCH']);

        // L.02: db verify --schema-only (fails — missing name column)
        const schemaVerifyFail = await runDbVerify(ctx, ['--schema-only']);
        expect(schemaVerifyFail.exitCode, 'L.02: db verify --schema-only reports a finding').toBe(
          4,
        );
        expect(engineDiagnosticCodes(schemaVerifyFail)).toContain(
          'CONTRACT.SCHEMA_VERIFICATION_FAILED',
        );

        // L.03: db update (recovery)
        const update = await runDbUpdate(ctx);
        expect(update.exitCode, 'L.03: db update recovery').toBe(0);

        // L.04: db verify (passes)
        const verifyPass = await runDbVerify(ctx);
        expect(verifyPass.exitCode, 'L.04: db verify passes').toBe(0);
      },
      timeouts.spinUpPpgDev,
    );
  });

  // -------------------------------------------------------------------------
  // Journey P: Mixed Mode (db update through multiple versions)
  // -------------------------------------------------------------------------
  describe('Journey P: Mixed Mode', () => {
    const db = useDevDatabase();

    it(
      'init → db update to v2 → db update to v3 → verify ok',
      async () => {
        const ctx: JourneyContext = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
        });

        // Precondition: init with base
        const emit0 = await runContractEmit(ctx);
        expect(emit0.exitCode, 'P.pre: emit base').toBe(0);
        const init = await runDbInit(ctx);
        expect(init.exitCode, 'P.pre: init').toBe(0);

        // Update to v2 via db update (no migrations)
        swapContract(ctx, 'contract-additive');
        const emitV2 = await runContractEmit(ctx);
        expect(emitV2.exitCode, 'P.pre: emit v2').toBe(0);
        const update = await runDbUpdate(ctx);
        expect(update.exitCode, 'P.pre: db update to v2').toBe(0);

        // P.01: db verify (passes after db update)
        const verifyV2 = await runDbVerify(ctx);
        expect(verifyV2.exitCode, 'P.01: db verify v2').toBe(0);

        // Now switch to v3 and use db update (since marker is from db update, not migration chain)
        swapContract(ctx, 'contract-v3');
        const emitV3 = await runContractEmit(ctx);
        expect(emitV3.exitCode, 'P.02.pre: emit v3').toBe(0);

        // db update to v3 (recovery via db update instead of migrate)
        const updateV3 = await runDbUpdate(ctx);
        expect(updateV3.exitCode, 'P.02: db update to v3').toBe(0);

        // P.03: db verify (passes)
        const verifyV3 = await runDbVerify(ctx);
        expect(verifyV3.exitCode, 'P.03: db verify v3').toBe(0);
      },
      timeouts.spinUpPpgDev,
    );
  });

  // -------------------------------------------------------------------------
  // Journey P2: Corrupt Marker
  // -------------------------------------------------------------------------
  describe('Journey P2: Corrupt Marker', () => {
    const db = useDevDatabase();

    it(
      'init → corrupt marker → verify fails → verify --schema-only passes → sign recovers → verify passes',
      async () => {
        const ctx: JourneyContext = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
        });

        // Precondition: init with base
        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, 'P2.pre: emit').toBe(0);
        const init = await runDbInit(ctx);
        expect(init.exitCode, 'P2.pre: init').toBe(0);

        // Corrupt the marker
        await withClient(db.connectionString, async (client) => {
          await client.query(
            `UPDATE prisma_contract.marker SET core_hash = 'corrupted-garbage' WHERE space = 'app'`,
          );
        });

        // P2.01: db verify (fails — corrupt marker)
        const verifyFail = await runDbVerify(ctx);
        expect(verifyFail.exitCode, 'P2.01: db verify reports a finding').toBe(4);
        expect(engineDiagnosticCodes(verifyFail)).toEqual(['CONTRACT.MARKER_MISMATCH']);

        // P2.02: db verify --schema-only (passes — schema is intact)
        const schemaVerify = await runDbVerify(ctx, ['--schema-only']);
        expect(schemaVerify.exitCode, 'P2.02: db verify --schema-only passes').toBe(0);

        // P2.03: db sign (recovery — overwrites corrupt marker)
        const sign = await runDbSign(ctx);
        expect(sign.exitCode, 'P2.03: db sign recovery').toBe(0);

        // P2.04: db verify (passes)
        const verifyPass = await runDbVerify(ctx);
        expect(verifyPass.exitCode, 'P2.04: db verify passes').toBe(0);
      },
      timeouts.spinUpPpgDev,
    );
  });
});
