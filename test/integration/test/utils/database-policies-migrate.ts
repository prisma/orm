/**
 * The database-policy journeys of `db migrate --to <ref>` and `migration status --to <ref>`: a
 * ref whose policies differ is refused before any migration runs, applied with
 * `--permit-policy-change`, recorded by a policy-only run, and reported by `migration status`.
 */

import stripAnsi from 'strip-ansi';
import { expect, it } from 'vitest';
import type { WithPolicyProject } from './database-policies-enforcement';
import {
  appMarker,
  errorOf,
  ledgerLength,
  MIGRATE_ONLY_DECLARED,
  MIGRATE_ONLY_RECORDED,
  type PolicyProject,
  planTo,
  writePolicyRef,
} from './database-policies-journey';
import { parseJsonOutput, runMigrate, runMigrationStatus } from './journey-test-helpers';

const CHANGE_DIFFERENCE = {
  setting: 'change',
  declared: ['migrate'],
  inForce: ['migrate', 'reconcile'],
};

/** A database migrated to the base contract, a planned migration to the next, and ref `production` at the next declaring `change: [migrate]`. */
async function pendingRefWithPolicies(project: PolicyProject) {
  const base = await planTo(project, 'base', 'initial');
  const migrated = await runMigrate(project.ctx);
  expect(migrated.exitCode, `db migrate: ${migrated.stdout}\n${migrated.stderr}`).toBe(0);
  const next = await planTo(project, 'next', 'add-name');
  await writePolicyRef(project, 'production', next, MIGRATE_ONLY_DECLARED);
  return { base, next };
}

interface MigrateJson {
  readonly migrationsApplied: number;
  readonly markerHash: string;
  readonly summary: string;
  readonly policiesUpdated?: readonly unknown[];
}

export function definePolicyMigrateJourneys(withProject: WithPolicyProject, timeout: number): void {
  it(
    'refuses a ref whose policies differ, before any migration runs',
    async (test) => {
      await withProject(test, async (project) => {
        const { base } = await pendingRefWithPolicies(project);
        const ledgerBefore = await ledgerLength(project);

        const refused = await runMigrate(project.ctx, ['--to', 'production', '--json']);

        expect(errorOf(refused)).toEqual({
          code: 'MIGRATION.POLICY_MISMATCH',
          severity: 'error',
          docsUrl:
            'https://docs.prisma.io/docs/orm/v8/reference/error-reference/MIGRATION.POLICY_MISMATCH',
          summary: "The ref's policies differ from the database's",
          why: 'production declares change: migrate; the database has change: migrate, reconcile.',
          nextActions: [
            {
              kind: 'user-choice',
              label:
                "Make the ref match the database, or have whoever owns the database apply the ref's policies.",
            },
          ],
          meta: { spaceId: 'app', refName: 'production', differences: [CHANGE_DIFFERENCE] },
        });
        const marker = await appMarker(project);
        expect({
          storageHash: marker?.storageHash,
          meta: marker?.meta,
          ledger: await ledgerLength(project),
        }).toEqual({ storageHash: base, meta: {}, ledger: ledgerBefore });
      });
    },
    timeout,
  );

  it(
    'with --permit-policy-change, applies the migrations and records the policies',
    async (test) => {
      await withProject(test, async (project) => {
        const { next } = await pendingRefWithPolicies(project);

        const applied = await runMigrate(project.ctx, [
          '--to',
          'production',
          '--permit-policy-change',
          '--json',
        ]);

        expect(applied.exitCode, `db migrate: ${applied.stdout}\n${applied.stderr}`).toBe(0);
        const document = parseJsonOutput<MigrateJson>(applied);
        expect(document).toMatchObject({
          migrationsApplied: 1,
          markerHash: next,
          policiesUpdated: [CHANGE_DIFFERENCE],
        });
        expect(document.summary).toMatch(
          /^Applied 1 migration\(s\) \(\d+ operation\(s\)\) across 1 contract space\(s\); policies updated: change: migrate$/,
        );
        const marker = await appMarker(project);
        expect({ storageHash: marker?.storageHash, meta: marker?.meta }).toEqual({
          storageHash: next,
          meta: { policies: MIGRATE_ONLY_RECORDED },
        });
      });
    },
    timeout,
  );

  it(
    'records the policies with no migration to run, and writes no ledger entry',
    async (test) => {
      await withProject(test, async (project) => {
        const base = await planTo(project, 'base', 'initial');
        const migrated = await runMigrate(project.ctx);
        expect(migrated.exitCode, `db migrate: ${migrated.stdout}\n${migrated.stderr}`).toBe(0);
        await writePolicyRef(project, 'production', base, MIGRATE_ONLY_DECLARED);
        const ledgerBefore = await ledgerLength(project);

        const recorded = await runMigrate(project.ctx, [
          '--to',
          'production',
          '--permit-policy-change',
          '--json',
        ]);

        expect(recorded.exitCode, `db migrate: ${recorded.stdout}\n${recorded.stderr}`).toBe(0);
        expect(parseJsonOutput<MigrateJson>(recorded)).toMatchObject({
          migrationsApplied: 0,
          summary: 'Policies updated: change: migrate',
          policiesUpdated: [CHANGE_DIFFERENCE],
        });
        expect({
          meta: (await appMarker(project))?.meta,
          ledger: await ledgerLength(project),
        }).toEqual({ meta: { policies: MIGRATE_ONLY_RECORDED }, ledger: ledgerBefore });
      });
    },
    timeout,
  );

  it(
    'migration status --to <ref> lists the policy settings that differ',
    async (test) => {
      await withProject(test, async (project) => {
        await pendingRefWithPolicies(project);

        const human = await runMigrationStatus(project.ctx, ['--to', 'production']);
        const json = await runMigrationStatus(project.ctx, ['--to', 'production', '--json']);

        expect(human.exitCode).toBe(0);
        const output = stripAnsi(`${human.stdout}\n${human.stderr}`);
        expect(output).toContain('differences:');
        expect(output).toContain('change: ref declares migrate, database has migrate, reconcile');
        expect(output).toContain('; policies differ from production');
        expect(parseJsonOutput(json)).toMatchObject({
          policyDifferences: [CHANGE_DIFFERENCE],
        });
      });
    },
    timeout,
  );
}
