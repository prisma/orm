/**
 * The data-loss journeys every target runs: `db update` refuses, asks or proceeds under the three
 * `dataLoss` levels; `db migrate` refuses a recorded migration that drops a field under
 * `data-loss-forbidden`, with and without a ref, and `--permit-policy-change` loosens or tightens
 * that; `migration plan --to <ref>` refuses a plan the ref forbids.
 */

import type { DataLossLevel } from '@internal/framework-components/control';
import { expect, it } from 'vitest';
import type { WithPolicyProject } from './database-policies-enforcement';
import {
  appMarker,
  errorOf,
  ledgerLength,
  type PolicyProject,
  planTo,
  readPolicyRef,
  schemaOf,
  writeContract,
  writePolicyRef,
} from './database-policies-journey';
import {
  getLatestMigrationDir,
  getMigrationDirs,
  parseJsonOutput,
  runContractEmit,
  runDbUpdate,
  runMigrate,
  runMigrationPlan,
} from './journey-test-helpers';

const DELETE_NAME = ['--delete', 'User.name'] as const;

function recordedWith(dataLoss: DataLossLevel) {
  return {
    change: ['migrate', 'reconcile'],
    dataProtection: { dataLoss, accessWidening: 'access-widening-with-consent' },
  };
}

/** Records `dataLoss` in the marker of a database at `hash`, through a ref and `--permit-policy-change`. */
async function recordDataLoss(
  project: PolicyProject,
  hash: string,
  dataLoss: DataLossLevel,
): Promise<void> {
  await writePolicyRef(project, 'production', hash, { dataProtection: { dataLoss } });
  const recorded = await runMigrate(project.ctx, ['--to', 'production', '--permit-policy-change']);
  expect(recorded.exitCode, `record ${dataLoss}: ${recorded.stdout}\n${recorded.stderr}`).toBe(0);
  expect((await appMarker(project))?.meta).toEqual({ policies: recordedWith(dataLoss) });
}

/** A database migrated to the next contract, whose `name` field a later change drops, recording `dataLoss` when given. */
async function atNext(
  project: PolicyProject,
  dataLoss: DataLossLevel | undefined,
): Promise<{ readonly base: string; readonly next: string }> {
  const base = await planTo(project, 'base', 'initial');
  const next = await planTo(project, 'next', 'add-name');
  const migrated = await runMigrate(project.ctx);
  expect(migrated.exitCode, `db migrate: ${migrated.stdout}\n${migrated.stderr}`).toBe(0);
  if (dataLoss !== undefined) await recordDataLoss(project, next, dataLoss);
  return { base, next };
}

/** Emits the renamed contract, which drops `name` and adds `nickname`. */
async function emitRenamed(project: PolicyProject): Promise<void> {
  writeContract(project, 'renamed');
  const emitted = await runContractEmit(project.ctx);
  expect(emitted.exitCode, `emit: ${emitted.stdout}\n${emitted.stderr}`).toBe(0);
}

/** What the database holds, which a refused run must leave as it was. */
async function stateOf(project: PolicyProject) {
  const marker = await appMarker(project);
  return {
    storageHash: marker?.storageHash,
    meta: marker?.meta,
    ledger: await ledgerLength(project),
    schema: await schemaOf(project),
  };
}

const REFUSED_LOSS = {
  code: 'MIGRATION.DATA_PROTECTION_FORBIDS',
  summary: "This database's data protection policy forbids data loss",
};

export function definePolicyDataLossJourneys(
  withProject: WithPolicyProject,
  timeout: number,
): void {
  it(
    'db update under data-loss-forbidden refuses the loss, with --delete and in a dry run, and runs a --rename',
    async (test) => {
      await withProject(test, async (project) => {
        await atNext(project, 'data-loss-forbidden');
        await emitRenamed(project);
        const before = await stateOf(project);

        const plain = await runDbUpdate(project.ctx, ['--no-interactive', '--json']);
        const deleted = await runDbUpdate(project.ctx, [...DELETE_NAME, '--json']);
        const dryRun = await runDbUpdate(project.ctx, ['--dry-run', '--json']);

        for (const refused of [plain, deleted, dryRun]) {
          expect(errorOf(refused)).toMatchObject({
            ...REFUSED_LOSS,
            meta: {
              command: 'db update',
              settings: [{ setting: 'dataLoss', level: 'data-loss-forbidden' }],
              operations: [{ setting: 'dataLoss', spaceId: 'app', subject: 'User.name' }],
            },
          });
        }
        expect(await stateOf(project)).toEqual(before);

        const renamed = await runDbUpdate(project.ctx, [
          '--rename',
          'User.name:User.nickname',
          '--json',
        ]);
        expect(renamed.exitCode, `db update --rename: ${renamed.stdout}\n${renamed.stderr}`).toBe(
          0,
        );
      });
    },
    timeout,
  );

  it(
    'db update under data-loss-with-consent asks, so a run nobody can answer is refused, and --delete applies it',
    async (test) => {
      await withProject(test, async (project) => {
        await atNext(project, undefined);
        await emitRenamed(project);

        const unanswered = await runDbUpdate(project.ctx, ['--no-interactive', '--json']);
        const deleted = await runDbUpdate(project.ctx, [...DELETE_NAME, '--json']);

        expect(errorOf(unanswered)).toMatchObject({ code: 'CLI.CONSENT_REQUIRED' });
        expect(deleted.exitCode, `db update --delete: ${deleted.stdout}\n${deleted.stderr}`).toBe(
          0,
        );
      });
    },
    timeout,
  );

  it(
    'db update under data-loss-permitted applies the loss without asking',
    async (test) => {
      await withProject(test, async (project) => {
        await atNext(project, 'data-loss-permitted');
        await emitRenamed(project);

        const applied = await runDbUpdate(project.ctx, ['--no-interactive', '--json']);

        expect(applied.exitCode, `db update: ${applied.stdout}\n${applied.stderr}`).toBe(0);
        expect(parseJsonOutput(applied)).toMatchObject({ mode: 'apply' });
      });
    },
    timeout,
  );

  it(
    'db migrate under data-loss-forbidden refuses a migration that drops a field, with and without a ref, and changes nothing',
    async (test) => {
      await withProject(test, async (project) => {
        await atNext(project, 'data-loss-forbidden');
        const renamed = await planTo(project, 'renamed', 'drop-name', [...DELETE_NAME]);
        const migration = getLatestMigrationDir(project.ctx);
        await writePolicyRef(project, 'release', renamed, {});
        const refBefore = await readPolicyRef(project, 'release');
        const before = await stateOf(project);

        const withoutRef = await runMigrate(project.ctx, ['--json']);
        const withRef = await runMigrate(project.ctx, ['--to', 'release', '--json']);

        for (const refused of [withoutRef, withRef]) {
          expect(errorOf(refused)).toMatchObject({
            ...REFUSED_LOSS,
            why: expect.stringMatching(/^The marker records dataLoss: data-loss-forbidden\. /),
            meta: {
              command: 'db migrate',
              operations: [
                {
                  setting: 'dataLoss',
                  spaceId: 'app',
                  migration,
                  label: expect.stringContaining('name'),
                },
              ],
            },
          });
        }
        expect({
          state: await stateOf(project),
          ref: await readPolicyRef(project, 'release'),
        }).toEqual({ state: before, ref: refBefore });
      });
    },
    timeout,
  );

  it(
    'db migrate --permit-policy-change loosens data-loss-forbidden, applies the lossy migration and records the policy',
    async (test) => {
      await withProject(test, async (project) => {
        await atNext(project, 'data-loss-forbidden');
        const renamed = await planTo(project, 'renamed', 'drop-name', [...DELETE_NAME]);
        await writePolicyRef(project, 'production', renamed, {
          dataProtection: { dataLoss: 'data-loss-with-consent' },
        });

        const applied = await runMigrate(project.ctx, [
          '--to',
          'production',
          '--permit-policy-change',
          '--json',
        ]);

        expect(applied.exitCode, `db migrate: ${applied.stdout}\n${applied.stderr}`).toBe(0);
        const marker = await appMarker(project);
        expect({ storageHash: marker?.storageHash, meta: marker?.meta }).toEqual({
          storageHash: renamed,
          meta: { policies: recordedWith('data-loss-with-consent') },
        });
      });
    },
    timeout,
  );

  it(
    'db migrate --permit-policy-change that tightens to data-loss-forbidden with a lossy migration pending is refused, and records nothing',
    async (test) => {
      await withProject(test, async (project) => {
        await atNext(project, undefined);
        const renamed = await planTo(project, 'renamed', 'drop-name', [...DELETE_NAME]);
        await writePolicyRef(project, 'production', renamed, {
          dataProtection: { dataLoss: 'data-loss-forbidden' },
        });
        const before = await stateOf(project);

        const refused = await runMigrate(project.ctx, [
          '--to',
          'production',
          '--permit-policy-change',
          '--json',
        ]);

        expect(errorOf(refused)).toMatchObject({
          code: 'MIGRATION.DATA_PROTECTION_FORBIDS',
          summary: 'production declares a data protection policy that forbids data loss',
          meta: { operations: [{ setting: 'dataLoss', spaceId: 'app' }] },
        });
        expect(await stateOf(project)).toEqual(before);
      });
    },
    timeout,
  );

  it(
    'migration plan --to <ref> refuses a lossy plan the ref forbids and writes nothing, and writes it when the ref declares nothing',
    async (test) => {
      await withProject(test, async (project) => {
        const base = await planTo(project, 'base', 'initial');
        await planTo(project, 'next', 'add-name');
        const from = getLatestMigrationDir(project.ctx) ?? '';
        await writePolicyRef(project, 'production', base, {
          dataProtection: { dataLoss: 'data-loss-forbidden' },
        });
        await writePolicyRef(project, 'staging', base, {});
        const dirsBefore = getMigrationDirs(project.ctx);

        const refused = await runMigrationPlan(project.ctx, [
          '--from',
          from,
          '--to',
          'production',
          ...DELETE_NAME,
          '--json',
        ]);
        const dirsAfterRefusal = getMigrationDirs(project.ctx);
        const planned = await runMigrationPlan(project.ctx, [
          '--from',
          from,
          '--to',
          'staging',
          ...DELETE_NAME,
          '--json',
        ]);

        expect(errorOf(refused)).toMatchObject({
          code: 'MIGRATION.DATA_PROTECTION_FORBIDS',
          summary: 'production declares a data protection policy that forbids data loss',
          meta: {
            command: 'migration plan',
            operations: [{ setting: 'dataLoss', spaceId: 'app', subject: 'User.name' }],
          },
        });
        expect(planned.exitCode, `migration plan: ${planned.stdout}\n${planned.stderr}`).toBe(0);
        expect({
          afterRefusal: dirsAfterRefusal,
          afterPlan: getMigrationDirs(project.ctx).length,
        }).toEqual({ afterRefusal: dirsBefore, afterPlan: dirsBefore.length + 1 });
      });
    },
    timeout,
  );
}
