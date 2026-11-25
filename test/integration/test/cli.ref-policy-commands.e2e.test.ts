/**
 * A ref's policies declared with `migration ref policy set`, then applied to a PostgreSQL database
 * by a deploy given consent: the command changes only the ref file, so the database takes on the
 * policies only when `db migrate --to <ref> --permit-policy-change` applies them.
 */

import { timeouts, withDevDatabase } from '@repo/test-utils';
import stripAnsi from 'strip-ansi';
import { describe, expect, it } from 'vitest';
import { withTempDir } from './utils/cli-test-helpers';
import {
  appMarker,
  errorOf,
  planTo,
  readPolicyRef,
  setupPolicyProject,
} from './utils/database-policies-journey';
import {
  parseJsonOutput,
  runMigrate,
  runMigrationStatus,
  runRef,
} from './utils/journey-test-helpers';

const DECLARED = {
  change: ['migrate'],
  dataProtection: { dataLoss: 'data-loss-forbidden' },
};

withTempDir(({ createTempDir }) => {
  describe('migration ref policy set, then a deploy that applies it (PostgreSQL)', () => {
    it(
      'declares stricter policies without touching the database, which takes them on only in a deploy given consent',
      async () => {
        await withDevDatabase(async ({ connectionString }) => {
          const project = setupPolicyProject('postgres', createTempDir(), connectionString);
          const base = await planTo(project, 'base', 'initial');
          const migrated = await runMigrate(project.ctx);
          expect(migrated.exitCode, `db migrate: ${migrated.stdout}\n${migrated.stderr}`).toBe(0);
          const pointed = await runRef(project.ctx, ['set', 'production', base]);
          expect(pointed.exitCode, `ref set: ${pointed.stdout}\n${pointed.stderr}`).toBe(0);

          const declared = await runRef(project.ctx, [
            'policy',
            'set',
            'production',
            '--change',
            'migrate',
            '--data-loss',
            'forbidden',
            '--json',
          ]);

          expect(declared.exitCode, `policy set: ${declared.stdout}\n${declared.stderr}`).toBe(0);
          expect(parseJsonOutput(declared)).toMatchObject({
            changes: [
              { setting: 'change', effect: 'tightens' },
              { setting: 'dataProtection.dataLoss', effect: 'tightens' },
            ],
          });
          expect(await readPolicyRef(project, 'production')).toEqual({
            hash: base,
            invariants: [],
            policies: DECLARED,
          });
          expect((await appMarker(project))?.meta).toEqual({});

          const refused = await runMigrate(project.ctx, ['--to', 'production', '--json']);

          expect(errorOf(refused)).toMatchObject({
            code: 'MIGRATION.POLICY_MISMATCH',
            nextActions: [
              {
                kind: 'user-choice',
                label: "Have whoever owns the database apply the ref's policies in a deploy.",
              },
            ],
          });
          expect((await appMarker(project))?.meta).toEqual({});

          const applied = await runMigrate(project.ctx, [
            '--to',
            'production',
            '--permit-policy-change',
          ]);

          expect(applied.exitCode, `db migrate: ${applied.stdout}\n${applied.stderr}`).toBe(0);
          expect((await appMarker(project))?.meta).toEqual({
            policies: {
              change: ['migrate'],
              dataProtection: {
                dataLoss: 'data-loss-forbidden',
                accessWidening: 'access-widening-with-consent',
              },
            },
          });

          const status = await runMigrationStatus(project.ctx, ['--to', 'production', '--json']);
          const human = await runMigrationStatus(project.ctx, ['--to', 'production']);

          expect(status.exitCode, `status: ${status.stdout}\n${status.stderr}`).toBe(0);
          expect(parseJsonOutput(status)).toMatchObject({ policyDifferences: [] });
          expect(stripAnsi(`${human.stdout}\n${human.stderr}`)).not.toContain('policies differ');
        });
      },
      timeouts.spinUpPpgDev,
    );
  });
});
