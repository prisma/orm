/**
 * Index name-identity journeys.
 *
 * Upgrade path: a database whose indexes carry pre-wire-name plain default
 * names (raw SQL fixture) is adopted exactly (infer → emit → sign), then
 * the contract switches to wire-name authoring (unnamed `@@index`, default
 * FK-backing index). The first widening plan contains ONLY
 * `ALTER INDEX … RENAME` ops (byte-asserted); applying it converges the live
 * names to the content-hash wire names and `db verify` is clean.
 *
 * Exact-mode adoption round-trip (today's supported adoption flow): a
 * database with fields-only indexes, some default-named by an old toolchain
 * and some custom-named, round-trips through `contract infer` → emit →
 * `db verify` with zero issues, and a `db update --dry-run` plans zero
 * operations.
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
  runContractInfer,
  runDbSign,
  runDbVerify,
  runMigrate,
  setupJourney,
  swapPslContract,
  timeouts,
  useDevDatabase,
} from '../utils/journey-test-helpers';

const PRE_SLICE_SCHEMA = `
  CREATE TABLE "user" (
    id int4 PRIMARY KEY,
    email text NOT NULL
  );
  CREATE INDEX "user_email_idx" ON "user" (email);
  CREATE TABLE "post" (
    id int4 PRIMARY KEY,
    "userId" int4 NOT NULL REFERENCES "user"(id)
  );
  CREATE INDEX "post_userId_idx" ON "post" ("userId");
`;

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
  describe('pre-wire-name default index names converge via renames only', () => {
    const db = useDevDatabase({
      onReady: (cs) => withClient(cs, (client) => client.query(PRE_SLICE_SCHEMA)),
    });

    it(
      'adopt exactly → switch to wire-name authoring → widening plan is renames-only → apply → verify clean',
      async () => {
        const ctx: JourneyContext = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });

        // adopt the live database exactly (infer emits map:-named indexes).
        const infer = await runContractInfer(ctx);
        expect(infer.exitCode, `contract infer\n${stripAnsi(infer.stderr)}`).toBe(0);
        const emit = await runContractEmit(ctx);
        expect(emit.exitCode, `contract emit\n${stripAnsi(emit.stderr)}`).toBe(0);
        const sign = await runDbSign(ctx);
        expect(sign.exitCode, `db sign\n${stripAnsi(sign.stderr)}`).toBe(0);

        // baseline migration (EMPTY → adopted contract); no-op on apply.
        const planBaseline = await planMigrationAndSelfEmit(ctx, ['--name', 'baseline']);
        expect(planBaseline.exitCode, 'plan baseline').toBe(0);
        const applyBaseline = await runMigrate(ctx, ['--json']);
        expect(applyBaseline.exitCode, 'apply baseline').toBe(0);
        expect(parseJsonOutput(applyBaseline), 'baseline no-op').toMatchObject({
          migrationsApplied: 0,
        });

        // switch to wire-name authoring — unnamed @@index + default
        // FK-backing index — and emit the re-based contract.
        swapPslContract(ctx, 'contract-index-upgrade');
        const emit2 = await runContractEmit(ctx);
        expect(emit2.exitCode, `contract emit wire\n${stripAnsi(emit2.stderr)}`).toBe(0);

        // the first widening plan is renames only, byte-asserted.
        const plan = await planMigrationAndSelfEmit(ctx, [
          '--name',
          'converge-index-names',
          '--from',
          latestMigrationDirName(ctx),
        ]);
        expect(plan.exitCode, `migration plan\n${stripAnsi(plan.stderr)}`).toBe(0);
        const ops = readPlannedOps(ctx);
        expect(
          ops.map((op) => ({
            id: op.id,
            operationClass: op.operationClass,
            sql: op.execute[0]?.sql,
          })),
          'renames only',
        ).toEqual([
          {
            id: 'index.public.post.post_userId_idx.rename',
            operationClass: 'widening',
            sql: 'ALTER INDEX "public"."post_userId_idx" RENAME TO "post_userId_idx_a489d58a"',
          },
          {
            id: 'index.public.user.user_email_idx.rename',
            operationClass: 'widening',
            sql: 'ALTER INDEX "public"."user_email_idx" RENAME TO "user_email_idx_46df9cad"',
          },
        ]);

        // apply the renames.
        const apply = await runMigrate(ctx, ['--json']);
        expect(apply.exitCode, `migrate\n${stripAnsi(apply.stderr)}`).toBe(0);
        expect(parseJsonOutput(apply), 'one migration applied').toMatchObject({
          migrationsApplied: 1,
        });

        // verify clean; the live catalog carries the wire names.
        const verify = await runDbVerify(ctx);
        expect(verify.exitCode, `db verify\n${stripAnsi(verify.stderr)}`).toBe(0);
        await withClient(db.connectionString, async (client) => {
          const rows = await client.query<{ indexname: string }>(
            `SELECT indexname FROM pg_indexes WHERE schemaname = 'public' ORDER BY indexname`,
          );
          const names = rows.rows.map((r) => r.indexname);
          expect(names).toContain('user_email_idx_46df9cad');
          expect(names).toContain('post_userId_idx_a489d58a');
          expect(names).not.toContain('user_email_idx');
          expect(names).not.toContain('post_userId_idx');
        });
      },
      timeouts.spinUpPpgDev,
    );
  });
});
