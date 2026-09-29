/**
 * The emitted contract is the database's signature.
 *
 * First half: a database created "by another tool" carries an expression index, a
 * partial index, a unique expression index, and two RLS policies (one
 * PERMISSIVE, one RESTRICTIVE) on an RLS-enabled table. `db sign` against the
 * base contract is refused and suggests changing either side; then
 * `contract infer` → emit → `db verify` reports ZERO issues →
 * `db update --dry-run` plans ZERO operations.
 *
 * Second half: from that signed contract, one index and one policy transition
 * from `map:` to the wire spelling (bodies verbatim) → the widening plan
 * contains EXACTLY two ops, both renames (byte-asserted) → apply → verify
 * clean under the wire names.
 */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { withClient } from '@repo/test-utils';
import stripAnsi from 'strip-ansi';
import { afterAll, describe, expect, it } from 'vitest';
import { computeIndexContentHash } from '../utils/cli-commands';
import { fixtureAppDir } from '../utils/cli-test-helpers';
import {
  engineDocument,
  getLatestMigrationDir,
  type JourneyContext,
  latestMigrationDirName,
  parseJsonOutput,
  planMigrationAndSelfEmit,
  runContractEmit,
  runContractInfer,
  runDbSign,
  runDbUpdate,
  runDbVerify,
  runMigrate,
  setupJourney,
  timeouts,
  useDevDatabase,
} from '../utils/journey-test-helpers';

const FOREIGN_TOOL_SCHEMA = `
  CREATE ROLE tenant_app_user;
  CREATE TABLE documents (
    id int4 PRIMARY KEY,
    tenant_id int4 NOT NULL,
    email text NOT NULL,
    archived_at timestamptz
  );
  CREATE INDEX documents_email_lower_idx ON documents (lower(email));
  CREATE INDEX documents_active_idx ON documents (tenant_id) WHERE (archived_at IS NULL);
  CREATE UNIQUE INDEX documents_email_ci_key ON documents (lower(email));
  CREATE INDEX documents_email_idx ON documents (email);
  CREATE INDEX email_lookup ON documents (tenant_id, email);
  ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
  CREATE POLICY "Tenant members can read" ON documents
    AS PERMISSIVE FOR SELECT TO tenant_app_user
    USING (tenant_id = 1);
  CREATE POLICY "Deny cross tenant writes" ON documents
    AS RESTRICTIVE FOR UPDATE TO tenant_app_user
    USING (tenant_id = 1) WITH CHECK (tenant_id = 1);
`;

const WIRE_INDEX_NAME = `documents_email_lower_${computeIndexContentHash({
  expression: 'lower(email)',
  unique: false,
})}`;

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

// Both steps mutate the one live database and the second continues from the
// state the first left, so a retried step would replay against a database it
// has already changed. `retry: 0` overrides the suite-wide CI retry budget
// here: a flake must surface as itself rather than as a second, misleading
// failure from the replay.
describe('sign a database this toolchain has never seen, then transition to wire naming', {
  retry: 0,
}, () => {
  const db = useDevDatabase({
    onReady: (cs) => withClient(cs, (client) => client.query(FOREIGN_TOOL_SCHEMA)),
  });

  // The two its run sequentially and share the journey state: the second
  // continues from the database the first signed, so the journey dir lives
  // for the whole describe (withTempDir would delete it between its).
  const journeyDir = join(fixtureAppDir, `test-${Date.now()}-sign-the-database`);
  const createTempDir = () => {
    mkdirSync(journeyDir, { recursive: true });
    return journeyDir;
  };
  afterAll(() => {
    rmSync(journeyDir, { recursive: true, force: true });
  });

  let ctx: JourneyContext;
  let inferredPsl: string;

  it(
    'sign refused → infer → emit → verify zero issues → sign → dry-run zero ops',
    async () => {
      ctx = setupJourney({
        connectionString: db.connectionString,
        createTempDir,
        contractMode: 'psl',
      });

      const emitBase = await runContractEmit(ctx);
      expect(emitBase.exitCode, `2.0: emit base\n${stripAnsi(emitBase.stderr)}`).toBe(0);
      const refused = await runDbSign(ctx, ['--json']);
      expect(refused.exitCode, `2.0: db sign refused\n${stripAnsi(refused.stderr)}`).toBe(4);
      expect(refused.presented?.diagnostics[0]?.nextActions, '2.0: next actions').toEqual([
        {
          kind: 'run-command',
          label: 'Change the database to match the contract, then sign again',
          command: '{bin} db update',
        },
        {
          kind: 'user-choice',
          label:
            'Or change the contract source to describe the database as it is, re-run contract emit, then sign again',
        },
      ]);

      // Infer captures the full surface.
      const infer = await runContractInfer(ctx);
      expect(infer.exitCode, `2.1: contract infer\n${stripAnsi(infer.stderr)}`).toBe(0);
      inferredPsl = readFileSync(join(ctx.testDir, 'contract.prisma'), 'utf-8');
      expect(inferredPsl).toContain(
        '@@index(expression: "lower(email)", map: "documents_email_lower_idx")',
      );
      expect(inferredPsl).toContain(
        '@@index([tenantId], map: "documents_active_idx", where: "(archived_at IS NULL)")',
      );
      expect(inferredPsl).toContain(
        '@@index(expression: "lower(email)", map: "documents_email_ci_key", unique: true)',
      );
      // Fields-only indexes adopt exactly too — default-named and
      // custom-named (folded in from the deleted index-name-convergence
      // exact-mode adoption case).
      expect(inferredPsl, 'default-named index adopted exactly').toContain(
        '@@index([email], map: "documents_email_idx")',
      );
      expect(inferredPsl, 'custom-named index adopted exactly').toContain(
        '@@index([tenantId, email], map: "email_lookup")',
      );
      expect(inferredPsl).toContain('policy_select Tenant_members_can_read {');
      expect(inferredPsl).toContain('@@map("Tenant members can read")');
      expect(inferredPsl).toContain('policy_update Deny_cross_tenant_writes {');
      expect(inferredPsl).toContain('permissive = false');
      expect(inferredPsl).toContain('@@rls');

      // Emit → verify ZERO issues.
      const emit = await runContractEmit(ctx);
      expect(emit.exitCode, `2.2: contract emit\n${stripAnsi(emit.stderr)}`).toBe(0);
      const schemaVerify = await runDbVerify(ctx, ['--schema-only', '--json']);
      expect(schemaVerify.exitCode, `2.2: verify\n${stripAnsi(schemaVerify.stderr)}`).toBe(0);
      expect(engineDocument(schemaVerify), '2.2: zero issues').toMatchObject({
        ok: true,
        schema: { issues: [] },
      });

      // Sign; a dry-run update plans ZERO operations.
      const sign = await runDbSign(ctx);
      expect(sign.exitCode, `2.3: db sign\n${stripAnsi(sign.stderr)}`).toBe(0);
      const verify = await runDbVerify(ctx);
      expect(verify.exitCode, `2.3: db verify\n${stripAnsi(verify.stderr)}`).toBe(0);
      const dryRun = await runDbUpdate(ctx, ['--dry-run', '--json']);
      expect(dryRun.exitCode, `2.3: db update dry-run\n${stripAnsi(dryRun.stderr)}`).toBe(0);
      expect(parseJsonOutput(dryRun), '2.3: zero operations').toMatchObject({
        ok: true,
        plan: { operations: [] },
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'map:-to-wire index transition plans exactly one rename, applies, verifies clean',
    async () => {
      expect(ctx, 'the signing step must have completed').toBeDefined();

      // Baseline migration so migration plan diffs from the
      // adopted contract; a fresh migrate is a no-op against the live DB.
      const planBaseline = await planMigrationAndSelfEmit(ctx, ['--name', 'baseline']);
      expect(planBaseline.exitCode, `3.1: plan baseline\n${stripAnsi(planBaseline.stderr)}`).toBe(
        0,
      );
      const applyBaseline = await runMigrate(ctx, ['--json']);
      expect(
        applyBaseline.exitCode,
        `3.1: apply baseline\n${stripAnsi(applyBaseline.stderr)}`,
      ).toBe(0);
      expect(parseJsonOutput(applyBaseline), '3.1: baseline no-op').toMatchObject({
        migrationsApplied: 0,
      });

      // Transition ONE index to its wire spelling, body verbatim. (The
      // matching policy transition is owned by the rls-exact-name-adoption
      // journey.)
      const transitioned = inferredPsl.replace(
        '@@index(expression: "lower(email)", map: "documents_email_lower_idx")',
        '@@index(expression: "lower(email)", name: "documents_email_lower")',
      );
      expect(transitioned, '3.2: the map: spelling is gone').not.toContain(
        'map: "documents_email_lower_idx"',
      );
      writeFileSync(join(ctx.testDir, 'contract.prisma'), transitioned, 'utf-8');
      const emitWire = await runContractEmit(ctx);
      expect(emitWire.exitCode, `3.2: emit wire\n${stripAnsi(emitWire.stderr)}`).toBe(0);

      // The widening plan is EXACTLY the one rename.
      const plan = await planMigrationAndSelfEmit(ctx, [
        '--name',
        'adopt-wire-names',
        '--from',
        latestMigrationDirName(ctx),
      ]);
      expect(plan.exitCode, `3.3: migration plan\n${stripAnsi(plan.stderr)}`).toBe(0);
      const ops = readPlannedOps(ctx);
      expect(
        ops.map((op) => ({
          id: op.id,
          operationClass: op.operationClass,
          sql: op.execute[0]?.sql,
        })),
        '3.3: exactly one rename',
      ).toEqual([
        {
          id: 'index.public.documents.documents_email_lower_idx.rename',
          operationClass: 'widening',
          sql: `ALTER INDEX "public"."documents_email_lower_idx" RENAME TO "${WIRE_INDEX_NAME}"`,
        },
      ]);

      // Apply; verify clean under the wire names.
      const apply = await runMigrate(ctx);
      expect(apply.exitCode, `3.4: migrate\n${stripAnsi(apply.stderr)}`).toBe(0);
      const verifyWire = await runDbVerify(ctx);
      expect(verifyWire.exitCode, `3.4: verify clean\n${stripAnsi(verifyWire.stderr)}`).toBe(0);
    },
    timeouts.spinUpPpgDev,
  );
});
