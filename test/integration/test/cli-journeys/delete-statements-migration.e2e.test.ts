/**
 * Statements that consent to data loss and widened access (Postgres).
 *
 * A plan that would lose data asks what each such operation means: `--delete <subject>` lets the data go, `--rename <subject>:<new name>` keeps it. `db update` also asks, with `--allow <subject>`, before it widens who can read or write a model's rows. Where nobody can answer, the command fails with `CLI.CONSENT_REQUIRED`, whose next actions name the flags.
 *
 * Journey S1 renames `Profile` to `User` and its field `name` to `fullName`, and removes `Legacy`, through `migration plan`: refused without `--delete Legacy`, planned with it, and applied by `migrate` on tables with rows, a unique, a foreign key from `Post`, a secondary index and a check. Journey S2 does the same through `db update`, where `--confirm <database>` no longer consents, and the same statements fail on a second run. Journey S3 adds a required field with no refusal. Journey S4 drops a policy: refused without `--allow User`, applied with it, and listed under `accessWidening` by a dry run. Journey S5 drops a model with `db update --db <url>` and no snapshot, so the subject is its storage name.
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import {
  engineError,
  getMigrationDirs,
  type JourneyContext,
  latestMigrationDirName,
  parseJsonOutput,
  planMigrationAndSelfEmit,
  runContractEmit,
  runDbUpdate,
  runDbVerify,
  runMigrate,
  runMigrationPlan,
  setupJourney,
  sql,
  timeouts,
  useDevDatabase,
} from '../utils/journey-test-helpers';

const USERS = `  model User {
    id       Int    @id
    fullName String @unique
    handle   String
    tenantId Int    @map("tenant_id")
    posts    Post[]

    @@index([fullName, handle])
    @@check(name: "handle_present", expression: "(length(handle) > 0)")
    @@rls
  }

  model Post {
    id        Int  @id
    profileId Int
    profile   User @relation(fields: [profileId], references: [id])
  }
`;

const POLICY = (target: string) => `
  policy_select tenant_read {
    target = ${target}
    roles  = [app_user]
    using  = "(tenant_id = 1)"
  }
`;

const LEGACY = `
  model Legacy {
    id   Int    @id
    note String
  }
`;

const FROM_PSL = `// use prisma-8

namespace public {
  model Profile {
    id       Int    @id
    name     String @unique
    handle   String
    tenantId Int    @map("tenant_id")
    posts    Post[]

    @@index([name, handle])
    @@check(name: "handle_present", expression: "(length(handle) > 0)")
    @@rls
  }

  model Post {
    id        Int     @id
    profileId Int
    profile   Profile @relation(fields: [profileId], references: [id])
  }
${LEGACY}${POLICY('Profile')}}
`;

const TO_PSL = `// use prisma-8

namespace public {
${USERS}${POLICY('User')}}
`;

const TO_WITH_LEGACY_PSL = `// use prisma-8

namespace public {
${USERS}${LEGACY}${POLICY('User')}}
`;

const TO_REQUIRED_FIELD_PSL = TO_PSL.replace(
  '    handle   String\n',
  '    handle   String\n    nickname String\n',
);

const TO_NO_POLICY_PSL = `// use prisma-8

namespace public {
${USERS}}
`;

const RENAMES = ['--rename', 'Profile:User', '--rename', 'User.name:User.fullName'] as const;

interface AppliedStatementReport {
  readonly description: string;
}

async function createAppUserRole(connectionString: string): Promise<void> {
  await sql(
    connectionString,
    'DO $$ BEGIN CREATE ROLE app_user; EXCEPTION WHEN duplicate_object THEN NULL; END $$',
  );
}

async function seedRows(connectionString: string): Promise<void> {
  await sql(
    connectionString,
    `INSERT INTO "public"."Profile" (id, name, handle, tenant_id)
     VALUES (1, 'alice', 'al', 1), (2, 'bob', 'bo', 1);
     INSERT INTO "public"."Post" (id, "profileId") VALUES (10, 1);
     INSERT INTO "public"."Legacy" (id, note) VALUES (1, 'old')`,
  );
}

async function emitContract(ctx: JourneyContext, psl: string, label: string): Promise<void> {
  writeFileSync(join(ctx.testDir, 'contract.prisma'), psl, 'utf-8');
  const emit = await runContractEmit(ctx);
  expect(emit.exitCode, `${label}: emit: ${emit.stderr}`).toBe(0);
}

function nextActionsOf(result: Parameters<typeof engineError>[0]): string {
  return JSON.stringify(engineError(result)?.nextActions ?? []);
}

async function expectRenamedWithoutLegacy(
  ctx: JourneyContext,
  connectionString: string,
  label: string,
): Promise<void> {
  const rows = await sql(
    connectionString,
    `SELECT id, "fullName", handle FROM "public"."User" ORDER BY id`,
  );
  expect(rows.rows, `${label}: rows present under the new names`).toEqual([
    { id: 1, fullName: 'alice', handle: 'al' },
    { id: 2, fullName: 'bob', handle: 'bo' },
  ]);
  const live = await sql(
    connectionString,
    `SELECT
       to_regclass('"public"."Profile"') AS profile,
       to_regclass('"public"."Legacy"') AS legacy,
       (SELECT array_agg(conname::text || ':' || contype::text ORDER BY conname) FROM pg_constraint
         WHERE conrelid = '"public"."User"'::regclass) AS constraints,
       (SELECT array_agg(indexname::text ORDER BY indexname) FROM pg_indexes
         WHERE schemaname = 'public' AND tablename = 'User') AS indexes,
       (SELECT array_agg(confrelid::regclass::text) FROM pg_constraint
         WHERE conrelid = '"public"."Post"'::regclass AND contype = 'f') AS post_references`,
  );
  expect(
    live.rows[0],
    `${label}: old and deleted tables gone, objects under the new names`,
  ).toEqual({
    profile: null,
    legacy: null,
    constraints: [
      'User_fullName_key:u',
      'User_pkey:p',
      expect.stringMatching(/^handle_present(_[0-9a-f]+)?:c$/),
    ],
    indexes: ['User_fullName_handle_idx_46490beb', 'User_fullName_key', 'User_pkey'],
    post_references: ['"User"'],
  });
  const verify = await runDbVerify(ctx, ['--schema-only']);
  expect(verify.exitCode, `${label}: db verify --schema-only: ${verify.stderr}`).toBe(0);
}

function databaseName(connectionString: string): string {
  return decodeURIComponent(new URL(connectionString).pathname.slice(1));
}

withTempDir(({ createTempDir }) => {
  describe('Journey S1: rename and delete with migration plan', () => {
    const db = useDevDatabase();

    it(
      'refuses the plan until --delete names the dropped model, then migrates it',
      async () => {
        const ctx = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });
        await createAppUserRole(db.connectionString);
        await emitContract(ctx, FROM_PSL, 'S1.01');
        const initial = await planMigrationAndSelfEmit(ctx, ['--name', 'initial']);
        expect(initial.exitCode, `S1.02: plan initial: ${initial.stderr}`).toBe(0);
        const applyInitial = await runMigrate(ctx);
        expect(applyInitial.exitCode, `S1.03: migrate initial: ${applyInitial.stderr}`).toBe(0);
        await seedRows(db.connectionString);
        const origin = latestMigrationDirName(ctx);
        await emitContract(ctx, TO_PSL, 'S1.04');

        const refused = await runMigrationPlan(ctx, ['--from', origin, ...RENAMES, '--json']);
        expect(refused.exitCode, 'S1.05: the plan loses Legacy, so it is refused').toBe(2);
        expect(engineError(refused)?.code, 'S1.05: nobody to answer').toBe('CLI.CONSENT_REQUIRED');
        expect(nextActionsOf(refused), 'S1.05: names the flag that answers').toContain(
          '--delete Legacy',
        );
        expect(getMigrationDirs(ctx), 'S1.05: nothing written').toHaveLength(1);

        const plan = await runMigrationPlan(ctx, [
          '--name',
          'tidy-users',
          '--from',
          origin,
          ...RENAMES,
          '--delete',
          'Legacy',
          '--json',
        ]);
        expect(plan.exitCode, `S1.06: plan with --delete: ${plan.stderr}`).toBe(0);
        expect(
          parseJsonOutput<{ appliedStatements: readonly AppliedStatementReport[] }>(
            plan,
          ).appliedStatements.map((entry) => entry.description),
          'S1.06: the renames, then the delete',
        ).toEqual([
          'rename model "Profile" to "User"',
          'rename field "User.name" to "User.fullName"',
          'delete model "Legacy"',
        ]);

        const apply = await runMigrate(ctx);
        expect(apply.exitCode, `S1.07: migrate: ${apply.stderr}`).toBe(0);
        await expectRenamedWithoutLegacy(ctx, db.connectionString, 'S1.08');

        const planned = latestMigrationDirName(ctx);
        const fresh = await runMigrationPlan(ctx, ['--from', planned, '--json']);
        expect(fresh.exitCode, `S1.09: plan with no schema change: ${fresh.stderr}`).toBe(0);
        expect(parseJsonOutput<{ noOp: boolean }>(fresh).noOp, 'S1.09: plan is empty').toBe(true);
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('Journey S2: rename and delete with db update', () => {
    const db = useDevDatabase();

    it(
      'refuses --confirm, applies with --delete, and refuses the same statements on a second run',
      async () => {
        const ctx = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });
        await createAppUserRole(db.connectionString);
        await emitContract(ctx, FROM_PSL, 'S2.01');
        const create = await runDbUpdate(ctx, ['--json']);
        expect(create.exitCode, `S2.02: db update creates the tables: ${create.stderr}`).toBe(0);
        await seedRows(db.connectionString);
        await emitContract(ctx, TO_PSL, 'S2.03');

        const confirmed = await runDbUpdate(ctx, [
          ...RENAMES,
          '--no-interactive',
          '--confirm',
          databaseName(db.connectionString),
          '--json',
        ]);
        expect(confirmed.exitCode, 'S2.04: --confirm does not consent').toBe(2);
        expect(engineError(confirmed)?.code, 'S2.04: the question is unanswered').toBe(
          'CLI.CONSENT_REQUIRED',
        );
        expect(nextActionsOf(confirmed), 'S2.04: names the flag that answers').toContain(
          '--delete Legacy',
        );

        const update = await runDbUpdate(ctx, [...RENAMES, '--delete', 'Legacy', '--json']);
        expect(update.exitCode, `S2.05: db update with --delete: ${update.stderr}`).toBe(0);
        expect(
          parseJsonOutput<{ appliedStatements: readonly AppliedStatementReport[] }>(
            update,
          ).appliedStatements.map((entry) => entry.description),
          'S2.05: the renames, then the delete',
        ).toEqual([
          'rename model "Profile" to "User"',
          'rename field "User.name" to "User.fullName"',
          'delete model "Legacy"',
        ]);
        await expectRenamedWithoutLegacy(ctx, db.connectionString, 'S2.06');

        const again = await runDbUpdate(ctx, [...RENAMES, '--delete', 'Legacy', '--json']);
        expect(again.exitCode, 'S2.07: the same statements fail on a second run').not.toBe(0);
        expect(engineError(again)?.code, 'S2.07: the first statement no longer resolves').toBe(
          'MIGRATION.STATEMENT_UNRESOLVED',
        );
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('Journey S3: a required field', () => {
    const db = useDevDatabase();

    it(
      'adds a non-nullable field to a table with rows without asking',
      async () => {
        const ctx = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });
        await createAppUserRole(db.connectionString);
        await emitContract(ctx, TO_PSL, 'S3.01');
        const create = await runDbUpdate(ctx, ['--json']);
        expect(create.exitCode, `S3.02: db update creates User: ${create.stderr}`).toBe(0);
        await sql(
          db.connectionString,
          `INSERT INTO "public"."User" (id, "fullName", handle, tenant_id) VALUES (1, 'alice', 'al', 1)`,
        );
        await emitContract(ctx, TO_REQUIRED_FIELD_PSL, 'S3.03');

        const update = await runDbUpdate(ctx, ['--no-interactive', '--json']);
        expect(update.exitCode, `S3.04: db update adds the field: ${update.stderr}`).toBe(0);
        const rows = await sql(db.connectionString, `SELECT id, nickname FROM "public"."User"`);
        expect(rows.rows, 'S3.04: the existing row has the backfilled value').toEqual([
          { id: 1, nickname: '' },
        ]);
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('Journey S4: a policy drop widens access', () => {
    const db = useDevDatabase();

    it(
      'lists the widening on a dry run, refuses without --allow, and applies with it',
      async () => {
        const ctx = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });
        await createAppUserRole(db.connectionString);
        await emitContract(ctx, TO_PSL, 'S4.01');
        const create = await runDbUpdate(ctx, ['--json']);
        expect(create.exitCode, `S4.02: db update creates User: ${create.stderr}`).toBe(0);
        await emitContract(ctx, TO_NO_POLICY_PSL, 'S4.03');

        const dryRun = await runDbUpdate(ctx, ['--dry-run', '--json']);
        expect(dryRun.exitCode, `S4.04: dry run: ${dryRun.stderr}`).toBe(0);
        const listed = parseJsonOutput<{ accessWidening: readonly { text: string }[] }>(
          dryRun,
        ).accessWidening;
        expect(listed, 'S4.04: the dry run lists the widening as --allow takes it').toEqual([
          expect.objectContaining({
            subject: expect.objectContaining({ model: 'User' }),
            text: 'User',
          }),
        ]);

        const refused = await runDbUpdate(ctx, ['--no-interactive', '--json']);
        expect(refused.exitCode, 'S4.05: the apply is refused without --allow').toBe(2);
        expect(engineError(refused)?.code, 'S4.05: the question is unanswered').toBe(
          'CLI.CONSENT_REQUIRED',
        );
        expect(nextActionsOf(refused), 'S4.05: names the flag that answers').toContain(
          '--allow User',
        );
        const kept = await sql(
          db.connectionString,
          `SELECT count(*)::int AS policies FROM pg_policies WHERE tablename = 'User'`,
        );
        expect(kept.rows, 'S4.05: the policy is still there').toEqual([{ policies: 1 }]);

        const allowed = await runDbUpdate(ctx, [
          ...listed.flatMap(({ text }) => ['--allow', text]),
          '--json',
        ]);
        expect(allowed.exitCode, `S4.06: db update --allow User: ${allowed.stderr}`).toBe(0);
        const dropped = await sql(
          db.connectionString,
          `SELECT count(*)::int AS policies FROM pg_policies WHERE tablename = 'User'`,
        );
        expect(dropped.rows, 'S4.06: the policy is gone').toEqual([{ policies: 0 }]);
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('Journey S5: db update --db with no snapshot', () => {
    const db = useDevDatabase();

    it(
      'names the dropped table by its storage name, and deletes it by that name',
      async () => {
        const ctx = setupJourney({
          connectionString: db.connectionString,
          createTempDir,
          contractMode: 'psl',
        });
        await createAppUserRole(db.connectionString);
        await emitContract(ctx, TO_WITH_LEGACY_PSL, 'S5.01');
        const create = await runDbUpdate(ctx, ['--db', db.connectionString, '--json']);
        expect(create.exitCode, `S5.02: db update --db creates the tables: ${create.stderr}`).toBe(
          0,
        );
        await emitContract(ctx, TO_PSL, 'S5.03');

        const refused = await runDbUpdate(ctx, [
          '--db',
          db.connectionString,
          '--no-interactive',
          '--json',
        ]);
        expect(refused.exitCode, 'S5.04: the drop is refused').toBe(2);
        const refusal = engineError(refused);
        expect(refusal?.code, 'S5.04: the question is unanswered').toBe('CLI.CONSENT_REQUIRED');
        expect(refusal?.meta, 'S5.04: the subject is the storage name').toMatchObject({
          unanswered: [{ subject: 'public.Legacy', verbs: ['delete'] }],
        });
        expect(JSON.stringify(refusal), 'S5.04: the question says why').toContain(
          'named by its storage name because the origin contract is unknown',
        );

        const deleted = await runDbUpdate(ctx, [
          '--db',
          db.connectionString,
          '--delete',
          'public.Legacy',
          '--json',
        ]);
        expect(deleted.exitCode, `S5.05: --delete public.Legacy: ${deleted.stderr}`).toBe(0);
        const legacy = await sql(
          db.connectionString,
          `SELECT to_regclass('"public"."Legacy"') AS legacy`,
        );
        expect(legacy.rows, 'S5.05: the table is gone').toEqual([{ legacy: null }]);
      },
      timeouts.spinUpPpgDev,
    );
  });
});
