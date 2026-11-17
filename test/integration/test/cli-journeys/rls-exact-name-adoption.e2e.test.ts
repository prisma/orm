/**
 * A live policy with a human-readable exact name
 * is adopted via `@@map` (body text = the live reprint), verifies clean, and
 * replacing `@@map` with the plain wire-named head converges through EXACTLY
 * one `ALTER POLICY … RENAME` (content pairing) — no drop, no
 * create — after which verify is clean under the wire name.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { withClient } from '@repo/test-utils';
import stripAnsi from 'strip-ansi';
import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import {
  getLatestMigrationDir,
  type JourneyContext,
  latestMigrationDirName,
  parseJsonOutput,
  planMigrationAndSelfEmit,
  runContractEmit,
  runDbSign,
  runDbVerify,
  runMigrate,
  setupJourney,
  swapPslContract,
  timeouts,
  useDevDatabase,
} from '../utils/journey-test-helpers';

const EXACT_NAME = 'Tenant members can read';
const ADOPTED_SCHEMA = `
  CREATE ROLE app_user;
  CREATE TABLE "user" (
    id int4 PRIMARY KEY,
    tenant_id int4 NOT NULL
  );
  ALTER TABLE "user" ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "${EXACT_NAME}" ON "user"
    AS PERMISSIVE FOR SELECT TO app_user
    USING (tenant_id = 1);
`;

// Literal wire name, deliberately NOT recomputed via computeContentHash: the
// RLS hash tuple is a stability commitment (any tuple change re-suffixes every
// wire name), and a recomputed expectation would move together with a tuple
// regression instead of catching it.
const WIRE_NAME = 'tenant_read_f8d5e783';

interface PlannedOp {
  readonly id: string;
  readonly operationClass: string;
  readonly execute: readonly { readonly description: string; readonly sql: string }[];
}

function readPlannedOps(ctx: JourneyContext): readonly PlannedOp[] {
  const dir = getLatestMigrationDir(ctx);
  expect(dir, 'planned migration dir exists').toBeDefined();
  return JSON.parse(
    readFileSync(join(ctx.testDir, 'migrations/app', dir ?? '', 'ops.json'), 'utf-8'),
  );
}

withTempDir(({ createTempDir }) => {
  describe('exact-named policy adoption converges to wire naming via one rename', () => {
    const db = useDevDatabase({
      onReady: (cs) => withClient(cs, (client) => client.query(ADOPTED_SCHEMA)),
    });

    it(
      'adopt via @@map → verify clean → swap to wire-named head → renames-only plan → apply → verify clean',
      async () => {
        const ctx: JourneyContext = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });

        // adopt: take the live policy exactly via @@map; sign; verify clean.
        swapPslContract(ctx, 'contract-rls-adopted');
        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, `adopt: contract emit\n${stripAnsi(emit.stderr)}`).toBe(0);
        const sign = await runDbSign(ctx);
        expect(sign.exitCode, `adopt: db sign\n${stripAnsi(sign.stderr)}`).toBe(0);
        const verifyAdopted = await runDbVerify(ctx);
        expect(
          verifyAdopted.exitCode,
          `adopt: verify clean\n${stripAnsi(verifyAdopted.stderr)}`,
        ).toBe(0);

        // baseline: EMPTY → adopted contract; no-op on apply.
        const planBaseline = await planMigrationAndSelfEmit(ctx, ['--name', 'baseline']);
        expect(planBaseline.exitCode, `baseline: plan\n${stripAnsi(planBaseline.stderr)}`).toBe(0);
        const applyBaseline = await runMigrate(ctx, ['--json']);
        expect(applyBaseline.exitCode, `baseline: apply\n${stripAnsi(applyBaseline.stderr)}`).toBe(
          0,
        );
        expect(parseJsonOutput(applyBaseline), 'baseline: no-op').toMatchObject({
          migrationsApplied: 0,
        });

        // swap to wire naming: replace @@map with the plain wire-named head (body verbatim).
        swapPslContract(ctx, 'contract-rls-wire');
        const emitWire = await runContractEmit(ctx);
        expect(emitWire.exitCode, `swap to wire naming: emit\n${stripAnsi(emitWire.stderr)}`).toBe(
          0,
        );

        // plan rename: the widening plan is exactly one ALTER POLICY … RENAME.
        const plan = await planMigrationAndSelfEmit(ctx, [
          '--name',
          'adopt-wire-name',
          '--from',
          latestMigrationDirName(ctx),
        ]);
        expect(plan.exitCode, `plan rename: migration plan\n${stripAnsi(plan.stderr)}`).toBe(0);
        const ops = readPlannedOps(ctx);
        expect(
          ops.map((op) => ({
            id: op.id,
            operationClass: op.operationClass,
            sql: op.execute[0]?.sql,
          })),
          'plan rename: exactly one rename',
        ).toEqual([
          {
            id: `rlsPolicy.public.user.${EXACT_NAME}.rename`,
            operationClass: 'widening',
            sql: `ALTER POLICY "${EXACT_NAME}" ON "public"."user" RENAME TO "${WIRE_NAME}"`,
          },
        ]);

        // apply: run the rename and verify clean under the wire name.
        const apply = await runMigrate(ctx);
        expect(apply.exitCode, `apply: migrate\n${stripAnsi(apply.stderr)}`).toBe(0);
        const verifyWire = await runDbVerify(ctx);
        expect(verifyWire.exitCode, `apply: verify clean\n${stripAnsi(verifyWire.stderr)}`).toBe(0);
      },
      timeouts.spinUpPpgDev,
    );
  });
});
