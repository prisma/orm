/**
 * The database-policy journeys every target runs: a database whose change policy permits only
 * migrations refuses `db update` and `db sign`; ref writers keep the policies and invariants a ref
 * declares; and a database with no policies behaves as before.
 */

import { writeFileSync } from 'node:fs';
import { join } from 'pathe';
import { expect, it } from 'vitest';
import {
  appMarker,
  errorOf,
  latestMigrationTo,
  MIGRATE_ONLY_DECLARED,
  MIGRATE_ONLY_RECORDED,
  type PolicyProject,
  planTo,
  readPolicyRef,
  writeContract,
  writePolicyRef,
} from './database-policies-journey';
import {
  parseJsonOutput,
  planMigrationAndSelfEmit,
  runContractEmit,
  runDbSign,
  runDbUpdate,
  runMigrate,
  runRef,
} from './journey-test-helpers';

/** Runs `fn` with a project on a fresh database of the target, or skips the test when the target's server is not available. */
export type WithPolicyProject = (
  test: { skip(note?: string): void },
  fn: (project: PolicyProject) => Promise<void>,
) => Promise<void>;

const DOCS = 'https://docs.prisma.io/docs/orm/v8/reference/error-reference';

function forbidsMigrationsOnly(command: 'db update' | 'db sign', base: string) {
  const recovery = `Author a migration with \`prisma-test migration plan --from ${base}\`, then apply it with \`prisma-test db migrate\`.`;
  return {
    code: 'MIGRATION.CHANGE_POLICY_FORBIDS',
    severity: 'error',
    docsUrl: `${DOCS}/MIGRATION.CHANGE_POLICY_FORBIDS`,
    summary: "This database's change policy permits only migrations",
    why: `The marker records change: migrate, so ${command} ${command === 'db sign' ? 'may not sign it' : 'may not move it'}.`,
    nextActions: [{ kind: 'user-choice', label: recovery }],
    meta: { spaceId: 'app', command, change: ['migrate'] },
  };
}

/** Migrates to the base contract, then records `change: [migrate]` with a policy-only run. */
async function migrationsOnlyDatabase(project: PolicyProject): Promise<string> {
  const base = await planTo(project, 'base', 'initial');
  const migrated = await runMigrate(project.ctx);
  expect(migrated.exitCode, `db migrate: ${migrated.stdout}\n${migrated.stderr}`).toBe(0);
  await writePolicyRef(project, 'production', base, MIGRATE_ONLY_DECLARED);
  const recorded = await runMigrate(project.ctx, [
    '--to',
    'production',
    '--permit-policy-change',
    '--json',
  ]);
  expect(recorded.exitCode, `policy-only run: ${recorded.stdout}\n${recorded.stderr}`).toBe(0);
  expect((await appMarker(project))?.meta).toEqual({ policies: MIGRATE_ONLY_RECORDED });
  return base;
}

/** The commands `text` prints in backticks, as a shell passes their words after the bin. */
function printedCommands(text: string): readonly (readonly string[])[] {
  return [...text.matchAll(/`prisma-test ([^`]+)`/g)].map((match) => (match[1] ?? '').split(/\s+/));
}

export function definePolicyEnforcementJourneys(
  withProject: WithPolicyProject,
  timeout: number,
): void {
  it(
    'refuses db update, its dry run and db sign on a database that changes only through migrations',
    async (test) => {
      await withProject(test, async (project) => {
        const base = await migrationsOnlyDatabase(project);
        writeContract(project, 'next');
        expect((await runContractEmit(project.ctx)).exitCode).toBe(0);

        const dryRun = await runDbUpdate(project.ctx, ['--dry-run', '--json']);
        const update = await runDbUpdate(project.ctx, ['--json']);
        const sign = await runDbSign(project.ctx, ['--json']);

        expect(errorOf(dryRun)).toEqual(forbidsMigrationsOnly('db update', base));
        expect(errorOf(update)).toEqual(forbidsMigrationsOnly('db update', base));
        expect(errorOf(sign)).toEqual(forbidsMigrationsOnly('db sign', base));
        expect((await appMarker(project))?.storageHash).toBe(base);

        const plan = await planMigrationAndSelfEmit(project.ctx, [
          '--from',
          base,
          '--name',
          'as-advised',
        ]);
        expect(plan.exitCode, `the advised migration plan: ${plan.stdout}\n${plan.stderr}`).toBe(0);
        const migrated = await runMigrate(project.ctx);
        expect(migrated.exitCode, `db migrate: ${migrated.stdout}\n${migrated.stderr}`).toBe(0);
      });
    },
    timeout,
  );

  it(
    'advises db migrate alone when the migrations on disk already lead to the contract db update and db sign were refused',
    async (test) => {
      await withProject(test, async (project) => {
        await migrationsOnlyDatabase(project);
        const next = await planTo(project, 'next', 'next');
        const recovery = (migrate: string) =>
          `The planned migrations already lead there: apply them with \`${migrate}\`.`;

        const update = errorOf(await runDbUpdate(project.ctx, ['--json']));
        const sign = errorOf(await runDbSign(project.ctx, ['--json']));

        expect(update['nextActions']).toEqual([
          { kind: 'user-choice', label: recovery(`prisma-test db migrate --to ${next}`) },
        ]);
        expect(sign['nextActions']).toEqual([
          { kind: 'user-choice', label: recovery('prisma-test db migrate') },
        ]);
        const migrated = await runMigrate(project.ctx);
        expect(migrated.exitCode, `db migrate: ${migrated.stdout}\n${migrated.stderr}`).toBe(0);
      });
    },
    timeout,
  );

  it(
    'advises, for db update --to a ref that permits only migrations, a plan to that ref and a db migrate that both run',
    async (test) => {
      await withProject(test, async (project) => {
        const base = await planTo(project, 'base', 'initial');
        const migrated = await runMigrate(project.ctx);
        expect(migrated.exitCode, `db migrate: ${migrated.stdout}\n${migrated.stderr}`).toBe(0);
        writeContract(project, 'unique');
        expect((await runContractEmit(project.ctx)).exitCode).toBe(0);
        const root = await planMigrationAndSelfEmit(project.ctx, [
          '--name',
          'another-root',
          '--from',
          '@empty',
        ]);
        expect(root.exitCode, `plan another root: ${root.stdout}\n${root.stderr}`).toBe(0);
        await writePolicyRef(
          project,
          'production',
          latestMigrationTo(project),
          MIGRATE_ONLY_DECLARED,
        );
        writeContract(project, 'next');
        expect((await runContractEmit(project.ctx)).exitCode).toBe(0);

        const refused = errorOf(
          await runDbUpdate(project.ctx, [
            '--to',
            'production',
            '--permit-policy-change',
            '--json',
          ]),
        );
        expect(refused['code'], JSON.stringify(refused)).toBe('MIGRATION.CHANGE_POLICY_FORBIDS');
        const [plan, apply] = printedCommands(JSON.stringify(refused['nextActions']));
        expect(plan).toEqual(['migration', 'plan', '--from', base, '--to', 'production']);
        expect(apply).toEqual(['db', 'migrate', '--to', 'production', '--permit-policy-change']);

        const planned = await planMigrationAndSelfEmit(project.ctx, [
          ...(plan ?? []).slice(2),
          '--name',
          'as-advised',
        ]);
        expect(planned.exitCode, `the advised plan: ${planned.stdout}\n${planned.stderr}`).toBe(0);
        const applied = await runMigrate(project.ctx, (apply ?? []).slice(2));
        expect(
          applied.exitCode,
          `the advised db migrate: ${applied.stdout}\n${applied.stderr}`,
        ).toBe(0);
      });
    },
    timeout,
  );

  it(
    'reports the schema failure of an application space it cannot sign, on a database with a marker',
    async (test) => {
      await withProject(test, async (project) => {
        const base = await planTo(project, 'base', 'initial');
        const migrated = await runMigrate(project.ctx);
        expect(migrated.exitCode, `db migrate: ${migrated.stdout}\n${migrated.stderr}`).toBe(0);
        writeContract(project, 'next');
        expect((await runContractEmit(project.ctx)).exitCode).toBe(0);

        const sign = await runDbSign(project.ctx, ['--json']);

        expect(parseJsonOutput(sign), `db sign: ${sign.stdout}\n${sign.stderr}`).toMatchObject({
          ok: false,
          spaces: [{ space: 'app', status: 'failed' }],
        });
        expect((await appMarker(project))?.storageHash).toBe(base);
      });
    },
    timeout,
  );

  it(
    'signs a database with no marker',
    async (test) => {
      await withProject(test, async (project) => {
        writeFileSync(join(project.ctx.testDir, 'contract.prisma'), '// use prisma-8\n', 'utf-8');
        expect((await runContractEmit(project.ctx)).exitCode).toBe(0);

        const sign = await runDbSign(project.ctx, ['--json']);

        expect(sign.exitCode, `db sign: ${sign.stdout}\n${sign.stderr}`).toBe(0);
        expect((await appMarker(project))?.meta).toEqual({});
      });
    },
    timeout,
  );

  it(
    'keeps the policies and invariants of a ref that db update and migration ref set move',
    async (test) => {
      await withProject(test, async (project) => {
        const base = await planTo(project, 'base', 'initial');
        const declared = { dataProtection: { dataLoss: 'data-loss-forbidden' as const } };
        await writePolicyRef(project, 'staging', base, declared, ['split-user-name']);

        const updated = await runDbUpdate(project.ctx, ['--advance-ref', 'staging']);
        expect(updated.exitCode, `db update: ${updated.stdout}\n${updated.stderr}`).toBe(0);
        const afterUpdate = await readPolicyRef(project, 'staging');
        const set = await runRef(project.ctx, ['set', 'staging', base]);
        expect(set.exitCode, `ref set: ${set.stdout}\n${set.stderr}`).toBe(0);

        const expected = { hash: base, invariants: ['split-user-name'], policies: declared };
        expect(afterUpdate).toEqual(expected);
        expect(await readPolicyRef(project, 'staging')).toEqual(expected);
      });
    },
    timeout,
  );

  it(
    'runs db migrate, db update and db sign as before on a database with no policies',
    async (test) => {
      await withProject(test, async (project) => {
        await planTo(project, 'base', 'initial');
        const migrated = await runMigrate(project.ctx, ['--json']);
        expect(migrated.exitCode, `db migrate: ${migrated.stdout}\n${migrated.stderr}`).toBe(0);
        expect(parseJsonOutput(migrated)).not.toHaveProperty('databasePoliciesUpdated');

        writeContract(project, 'next');
        expect((await runContractEmit(project.ctx)).exitCode).toBe(0);
        const updated = await runDbUpdate(project.ctx, ['--json']);
        expect(updated.exitCode, `db update: ${updated.stdout}\n${updated.stderr}`).toBe(0);
        const signed = await runDbSign(project.ctx);
        expect(signed.exitCode, `db sign: ${signed.stdout}\n${signed.stderr}`).toBe(0);

        expect((await appMarker(project))?.meta).toEqual({});
      });
    },
    timeout,
  );
}
