/**
 * Renaming a model with a rename hint keeps its table's rows (Postgres).
 *
 * The seeded `Profile` table has rows, a default-named primary key, a unique constraint, a foreign
 * key to `Account`, a foreign key from `Post`, a secondary index, a named check, and row-level
 * security with a policy. The schema change renames the model to `Member` and adds
 * `@@hint(was: "Profile")`.
 *
 * Journey H1 plans the change with `migration plan`: the plan reports the hint it consumed, every
 * operation is widening, and `migration.ts` holds only the `renameTable` call. After `migrate` the
 * rows and every object are present under the new table, a follow-up plan is empty, and
 * `db verify --schema-only` is clean.
 *
 * Journey H2 applies the same change to a fresh database with `db update`, which asks for no
 * consent, reaches the same state, and plans nothing on a second run.
 *
 * Journey H3 keeps the hint in the schema after the rename is applied: the next plan is empty and
 * prints no `Hints applied` block.
 *
 * Journey H4 names, as the old table, a table that still exists beside the new one:
 * `migration plan` fails with `MIGRATION.HINT_CONTRADICTED` and writes nothing.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { contractSnapshotDir } from '@prisma/orm-postgres/migration-tools/contract-snapshot-store';
import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import {
  engineError,
  getMigrationDirs,
  type JourneyContext,
  latestMigrationDirName,
  parseJsonOutput,
  planMigrationAndSelfEmit,
  pslContractFixtures,
  runContractEmit,
  runDbUpdate,
  runDbVerify,
  runMigrate,
  runMigrationPlan,
  selfEmitMigration,
  setupJourney,
  sql,
  swapPslContract,
  timeouts,
  useDevDatabase,
} from '../utils/journey-test-helpers';

const HINT_TEXT =
  'rename hint on table "Member" (was "Profile"): renamed and recorded in this migration; you can remove the hint.';

const RENAME_CALL = "...this.renameTable({ schema: 'public', table: 'Profile', to: 'Member' })";

interface PlanDocument {
  readonly noOp: boolean;
  readonly to: string;
  readonly operations: readonly { readonly label: string; readonly operationClass: string }[];
  readonly consumedHints?: readonly { readonly text: string }[];
}

interface UpdateDocument {
  readonly plan: {
    readonly operations: readonly { readonly label: string; readonly operationClass: string }[];
  };
}

async function seedProfile(
  ctx: JourneyContext,
  connectionString: string,
  label: string,
  apply: 'migrate' | 'db update',
  variant: 'contract-hint-rename-from' | 'contract-hint-rename-both' = 'contract-hint-rename-from',
): Promise<void> {
  await sql(connectionString, 'CREATE ROLE app_user');
  swapPslContract(ctx, variant);
  const emit = await runContractEmit(ctx);
  expect(emit.exitCode, `${label}.01: emit Profile: ${emit.stderr}`).toBe(0);
  if (apply === 'migrate') {
    const initial = await planMigrationAndSelfEmit(ctx, ['--name', 'initial']);
    expect(initial.exitCode, `${label}.02: plan initial: ${initial.stderr}`).toBe(0);
    const applyInitial = await runMigrate(ctx);
    expect(applyInitial.exitCode, `${label}.03: migrate initial: ${applyInitial.stderr}`).toBe(0);
  } else {
    const create = await runDbUpdate(ctx, ['--json']);
    expect(create.exitCode, `${label}.02: db update creates Profile: ${create.stderr}`).toBe(0);
  }
  await sql(
    connectionString,
    `INSERT INTO "public"."Account" (id) VALUES (1);
     INSERT INTO "public"."Profile" (id, email, handle, tenant_id, "accountId")
     VALUES (1, 'alice@example.com', 'alice', 1, 1), (2, 'bob@example.com', 'bob', 1, 1);
     INSERT INTO "public"."Post" (id, "profileId") VALUES (10, 1)`,
  );
}

async function emitHinted(ctx: JourneyContext, label: string): Promise<void> {
  swapPslContract(ctx, 'contract-hint-rename-to');
  const emit = await runContractEmit(ctx);
  expect(emit.exitCode, `${label}: emit Member with the hint: ${emit.stderr}`).toBe(0);
}

function emittedContract(ctx: JourneyContext): {
  readonly storage: { readonly storageHash: string };
  readonly hints?: unknown;
} {
  return JSON.parse(readFileSync(join(ctx.testDir, 'contract.json'), 'utf-8'));
}

/**
 * Emits the hinted schema with its `@@hint` line removed, and returns that contract's storage hash.
 */
async function storageHashWithoutHint(ctx: JourneyContext, label: string): Promise<string> {
  const hinted = readFileSync(pslContractFixtures['contract-hint-rename-to'], 'utf-8');
  const unhinted = hinted.replace('    @@hint(was: "Profile")\n', '');
  expect(unhinted, `${label}: the schema without the hint differs only by that line`).not.toBe(
    hinted,
  );
  writeFileSync(join(ctx.testDir, 'contract.prisma'), unhinted, 'utf-8');
  const emit = await runContractEmit(ctx);
  expect(emit.exitCode, `${label}: emit Member without the hint: ${emit.stderr}`).toBe(0);
  expect(emittedContract(ctx).hints, `${label}: no hints without the hint`).toBeUndefined();
  return emittedContract(ctx).storage.storageHash;
}

function packageFiles(ctx: JourneyContext, dirName: string) {
  const dir = join(ctx.testDir, 'migrations', 'app', dirName);
  return {
    opsJson: readFileSync(join(dir, 'ops.json'), 'utf-8'),
    migrationJson: readFileSync(join(dir, 'migration.json'), 'utf-8'),
  };
}

function operationsBlock(ctx: JourneyContext, dirName: string): string {
  const source = readFileSync(
    join(ctx.testDir, 'migrations', 'app', dirName, 'migration.ts'),
    'utf-8',
  );
  const match = /get operations\(\)[^[]*\[([\s\S]*?)\];/.exec(source);
  if (match?.[1] === undefined) {
    throw new Error(`migration.ts has no operations array:\n${source}`);
  }
  return match[1].trim().replace(/,$/, '');
}

async function expectRenamed(
  ctx: JourneyContext,
  connectionString: string,
  label: string,
): Promise<void> {
  const rows = await sql(connectionString, `SELECT id, email FROM "public"."Member" ORDER BY id`);
  expect(rows.rows, `${label}: rows present under the new name`).toEqual([
    { id: 1, email: 'alice@example.com' },
    { id: 2, email: 'bob@example.com' },
  ]);
  const live = await sql(
    connectionString,
    `SELECT
       to_regclass('"public"."Profile"') AS old,
       (SELECT array_agg(conname::text ORDER BY conname) FROM pg_constraint
         WHERE conrelid = '"public"."Member"'::regclass) AS constraints,
       (SELECT array_agg(indexname::text ORDER BY indexname) FROM pg_indexes
         WHERE schemaname = 'public' AND tablename = 'Member') AS indexes,
       (SELECT array_agg(policyname::text) FROM pg_policies
         WHERE schemaname = 'public' AND tablename = 'Member') AS policies,
       (SELECT relrowsecurity FROM pg_class WHERE oid = '"public"."Member"'::regclass) AS rls,
       (SELECT array_agg(conname::text || '->' || confrelid::regclass::text) FROM pg_constraint
         WHERE conrelid = '"public"."Post"'::regclass AND contype = 'f') AS post_foreign_keys`,
  );
  expect(live.rows[0], `${label}: objects under their derived or explicit names`).toEqual({
    old: null,
    constraints: [
      'Member_accountId_fkey',
      'Member_email_key',
      'Member_pkey',
      expect.stringMatching(/^profile_tenant_positive_[0-9a-f]{8}$/),
    ],
    indexes: [
      'Member_accountId_idx_cbfb3085',
      'Member_email_key',
      'Member_handle_idx_b5b249e4',
      'Member_pkey',
    ],
    policies: [expect.stringMatching(/^tenant_read_[0-9a-f]{8}$/)],
    rls: true,
    post_foreign_keys: ['Post_profileId_fkey->"Member"'],
  });
  const verify = await runDbVerify(ctx, ['--schema-only']);
  expect(verify.exitCode, `${label}: db verify --schema-only: ${verify.stderr}`).toBe(0);
}

withTempDir(({ createTempDir }) => {
  describe('Journey H1: rename a model with a rename hint through migration plan', () => {
    const db = useDevDatabase();

    it(
      'plans only the hinted rename, reports the hint, keeps the rows and objects, and leaves nothing to plan',
      async () => {
        const ctx = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });
        await seedProfile(ctx, db.connectionString, 'H1', 'migrate');
        const unhintedHash = await storageHashWithoutHint(ctx, 'H1.04');
        await emitHinted(ctx, 'H1.04');
        expect(emittedContract(ctx).hints, 'H1.04: the emitted contract carries the hint').toEqual({
          namespaces: { public: { tables: { Member: { was: 'Profile' } } } },
        });
        expect(
          emittedContract(ctx).storage.storageHash,
          'H1.04: the hint leaves the storage hash unchanged',
        ).toBe(unhintedHash);

        const plan = await runMigrationPlan(ctx, [
          '--name',
          'rename-profile',
          '--from',
          latestMigrationDirName(ctx),
          '--json',
        ]);
        expect(plan.exitCode, `H1.05: plan the rename: ${plan.stderr}`).toBe(0);
        const planned = parseJsonOutput<PlanDocument>(plan);
        const plannedFiles = packageFiles(ctx, latestMigrationDirName(ctx));
        const reEmit = await selfEmitMigration(ctx, [
          '--dir',
          `migrations/app/${latestMigrationDirName(ctx)}`,
        ]);
        expect(reEmit.exitCode, `H1.05: re-run migration.ts: ${reEmit.stderr}`).toBe(0);
        expect(
          packageFiles(ctx, latestMigrationDirName(ctx)),
          'H1.05: re-running migration.ts writes the same ops.json and migration.json as the plan',
        ).toEqual(plannedFiles);
        expect(
          JSON.parse(plannedFiles.opsJson).map((op: { readonly label: string }) => op.label),
          'H1.05: the planned ops.json holds the rename',
        ).toContain(planned.operations[0]?.label);
        expect(planned.to, 'H1.05: the plan is toward the hinted contract').toBe(unhintedHash);
        const snapshot = JSON.parse(
          readFileSync(
            join(contractSnapshotDir(join(ctx.testDir, 'migrations'), planned.to), 'contract.json'),
            'utf-8',
          ),
        );
        expect(snapshot.storage.storageHash, 'H1.05: the snapshot is the plan destination').toBe(
          planned.to,
        );
        expect(snapshot, 'H1.05: the snapshot carries no hints').not.toHaveProperty('hints');
        expect(planned.consumedHints, 'H1.05: the plan reports the hint it used').toEqual([
          { hint: expect.objectContaining({ kind: 'renamed', from: 'Profile' }), text: HINT_TEXT },
        ]);
        expect(planned.operations[0]?.label, 'H1.05: the plan renames the table').toBe(
          'Rename table "Profile" to "Member"',
        );
        expect(
          planned.operations.map((op) => op.operationClass),
          'H1.05: every operation is widening',
        ).toEqual(planned.operations.map(() => 'widening'));
        expect(
          operationsBlock(ctx, latestMigrationDirName(ctx)),
          'H1.05: migration.ts holds only the renameTable call',
        ).toBe(RENAME_CALL);

        const apply = await runMigrate(ctx);
        expect(apply.exitCode, `H1.06: migrate: ${apply.stderr}`).toBe(0);
        await expectRenamed(ctx, db.connectionString, 'H1.07');

        const stored = await sql(
          db.connectionString,
          `SELECT contract_json FROM "prisma_contract"."contract" WHERE core_hash = $1`,
          [planned.to],
        );
        expect(stored.rows, 'H1.07: migrate stored the destination contract').toHaveLength(1);
        const storedJson = stored.rows[0]?.['contract_json'];
        const storedContract = typeof storedJson === 'string' ? JSON.parse(storedJson) : storedJson;
        expect(
          storedContract?.storage?.storageHash,
          'H1.07: the stored contract is the plan destination',
        ).toBe(planned.to);
        expect(storedContract, 'H1.07: the stored contract carries no hints').not.toHaveProperty(
          'hints',
        );

        const migrationCount = getMigrationDirs(ctx).length;
        const followUp = await runMigrationPlan(ctx, [
          '--from',
          latestMigrationDirName(ctx),
          '--json',
        ]);
        expect(followUp.exitCode, `H1.08: follow-up plan: ${followUp.stderr}`).toBe(0);
        expect(parseJsonOutput<PlanDocument>(followUp).noOp, 'H1.08: nothing to plan').toBe(true);
        expect(getMigrationDirs(ctx), 'H1.08: nothing written').toHaveLength(migrationCount);
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('Journey H2: rename a model with a rename hint through db update', () => {
    const db = useDevDatabase();

    it(
      'renames without asking for consent, reaches the same state, and plans nothing on a second run',
      async () => {
        const ctx = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });
        await seedProfile(ctx, db.connectionString, 'H2', 'db update');
        await emitHinted(ctx, 'H2.03');

        const update = await runDbUpdate(ctx, ['--json']);
        expect(update.exitCode, `H2.04: db update without --confirm: ${update.stderr}`).toBe(0);
        expect(engineError(update), 'H2.04: no consent refusal').toBeUndefined();
        const operations = parseJsonOutput<UpdateDocument>(update).plan.operations;
        expect(operations[0]?.label, 'H2.04: db update renames the table').toBe(
          'Rename table "Profile" to "Member"',
        );
        expect(
          operations.map((op) => op.operationClass),
          'H2.04: every operation is widening',
        ).toEqual(operations.map(() => 'widening'));
        await expectRenamed(ctx, db.connectionString, 'H2.05');

        const again = await runDbUpdate(ctx, ['--json']);
        expect(again.exitCode, `H2.06: second db update: ${again.stderr}`).toBe(0);
        expect(
          parseJsonOutput<UpdateDocument>(again).plan.operations,
          'H2.06: nothing to plan',
        ).toEqual([]);
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('Journey H3: a spent rename hint', () => {
    const db = useDevDatabase();

    it(
      'prints Hints applied for the rename, then plans nothing and prints no block while the hint stays',
      async () => {
        const ctx = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });
        await seedProfile(ctx, db.connectionString, 'H3', 'migrate');
        await emitHinted(ctx, 'H3.04');

        const plan = await planMigrationAndSelfEmit(ctx, [
          '--name',
          'rename-profile',
          '--from',
          latestMigrationDirName(ctx),
        ]);
        expect(plan.exitCode, `H3.05: plan the rename: ${plan.stderr}`).toBe(0);
        expect(plan.stderr, 'H3.05: the rename plan prints the block').toContain('Hints applied');
        expect(plan.stderr, 'H3.05: and the hint line').toContain(HINT_TEXT);
        const apply = await runMigrate(ctx);
        expect(apply.exitCode, `H3.06: migrate: ${apply.stderr}`).toBe(0);

        const contract = JSON.parse(readFileSync(join(ctx.testDir, 'contract.json'), 'utf-8'));
        expect(contract.hints, 'H3.07: the emitted contract still carries the hint').toEqual({
          namespaces: { public: { tables: { Member: { was: 'Profile' } } } },
        });
        const spent = await runMigrationPlan(ctx, ['--from', latestMigrationDirName(ctx)]);
        expect(spent.exitCode, `H3.07: plan with the spent hint: ${spent.stderr}`).toBe(0);
        expect(spent.stderr, 'H3.07: nothing to plan').toContain('No changes detected');
        expect(spent.stderr, 'H3.07: no Hints applied block').not.toContain('Hints applied');
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('Journey H4: a rename hint whose old table still exists', () => {
    const db = useDevDatabase();

    it(
      'fails migration plan with MIGRATION.HINT_CONTRADICTED and writes nothing',
      async () => {
        const ctx = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });
        await seedProfile(ctx, db.connectionString, 'H4', 'migrate', 'contract-hint-rename-both');
        await emitHinted(ctx, 'H4.04');

        const migrationCount = getMigrationDirs(ctx).length;
        const plan = await runMigrationPlan(ctx, [
          '--name',
          'rename-profile',
          '--from',
          latestMigrationDirName(ctx),
          '--json',
        ]);
        expect(plan.exitCode, 'H4.05: the plan is refused').not.toBe(0);
        const error = engineError(plan);
        expect(error?.code, 'H4.05: planning failed').toBe('MIGRATION.PLANNING_FAILED');
        expect(error?.why, 'H4.05: the hint is contradicted').toContain(
          'MIGRATION.HINT_CONTRADICTED',
        );
        expect(getMigrationDirs(ctx), 'H4.05: nothing written').toHaveLength(migrationCount);
      },
      timeouts.spinUpPpgDev,
    );
  });
});
