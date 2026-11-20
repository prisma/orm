/**
 * Namespace statements on Postgres, at their edges: N7 adds a table no contract declares to namespace `billing` before the contract removes it: it is its own question, answered by its storage name. N8 refuses to rename `public` through both commands, then follows the refusal's advice and moves `User` to `app`, so the contract no longer declares `public`; N9 does the same move through `db update`. Each then plans nothing more.
 *
 * The contracts, data and checks are those of `namespace-statements.e2e.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import { withTempDir } from '../utils/cli-test-helpers';
import {
  engineError,
  runDbUpdate,
  runMigrationPlan,
  sql,
  timeouts,
  useDevDatabase,
} from '../utils/journey-test-helpers';
import {
  emitContract,
  expectSettled,
  expectUserMovedOutOfPublic,
  MOVE_USER,
  planReEmitAndMigrate,
  schemas,
  startAt,
} from '../utils/namespace-statement-journeys';

withTempDir(({ createTempDir }) => {
  describe('N7: a removed namespace with a table no contract declares', () => {
    const db = useDevDatabase();

    it(
      'asks about that table by its storage name, which --delete billing does not answer',
      async () => {
        const { ctx } = await startAt(db, createTempDir, 'db update', 'N7');
        await sql(db.connectionString, 'CREATE TABLE "billing"."audit_log" (id int PRIMARY KEY)');
        await emitContract(ctx, 'contract-namespace-statements-removed', 'N7.03');

        const refused = await runDbUpdate(ctx, [
          '--delete',
          'billing',
          '--no-interactive',
          '--json',
        ]);
        expect(engineError(refused)?.code, 'N7.04: the table is still in question').toBe(
          'CLI.CONSENT_REQUIRED',
        );
        expect(engineError(refused), 'N7.04: the flag that answers').toEqual({
          code: 'CLI.CONSENT_REQUIRED',
          severity: 'error',
          summary:
            'This change would delete the data in "billing.audit_log", which no model of the contract before this change stores.',
          why: 'The operation of the plan that does this: Drop table "audit_log".',
          nextActions: [
            { kind: 'user-choice', label: 'If the data can go: --delete billing.audit_log' },
          ],
          meta: {
            subject: 'billing.audit_log',
            verbs: ['delete'],
            unanswered: [{ subject: 'billing.audit_log', verbs: ['delete'] }],
          },
          docsUrl:
            'https://docs.prisma.io/docs/orm/v8/reference/error-reference/CLI.CONSENT_REQUIRED',
        });

        const update = await runDbUpdate(ctx, [
          '--delete',
          'billing',
          '--delete',
          'billing.audit_log',
          '--no-interactive',
          '--json',
        ]);
        expect(update.exitCode, `N7.05: db update: ${JSON.stringify(engineError(update))}`).toBe(0);
        expect(await schemas(db.connectionString), 'N7.06: the schema is gone').toEqual([]);
        await expectSettled(ctx, 'db update', undefined, 'N7.07');
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('N8: public cannot be renamed', () => {
    const db = useDevDatabase();

    it(
      'refuses --rename public:app through both commands, and says to move the models',
      async () => {
        const { ctx, origin } = await startAt(db, createTempDir, 'migrate', 'N8');
        await emitContract(ctx, 'contract-namespace-statements-public-renamed', 'N8.03');
        const summary =
          'Cannot rename namespace "public" to "app": "public" is the default schema of every Postgres database';
        const fix =
          'Prisma owns schema "public", and Postgres puts it on every search path, so a migration does not rename it. Move each model to the new namespace with --rename <Model>:app.<Model> instead.';

        for (const result of [
          await runMigrationPlan(ctx, ['--from', origin ?? '', '--rename', 'public:app', '--json']),
          await runDbUpdate(ctx, ['--rename', 'public:app', '--no-interactive', '--json']),
        ]) {
          expect(result.exitCode, 'N8.04: refused').not.toBe(0);
          const error = engineError(result);
          expect(error?.code).toBe('MIGRATION.PLANNING_FAILED');
          expect(error?.why).toBe(summary);
          expect(error?.nextActions?.map(({ label }) => label)).toEqual([fix]);
        }

        const moved = await planReEmitAndMigrate(ctx, origin ?? '', MOVE_USER, 'N8.05');
        expect(moved.operations.map(({ label }) => label)).toEqual([
          'Create schema "app"',
          'Move table "User" to schema "app"',
        ]);
        await expectUserMovedOutOfPublic(db.connectionString, 'N8.06');
        await expectSettled(ctx, 'migrate', moved.dirName, 'N8.07');
      },
      timeouts.spinUpPpgDev,
    );
  });

  describe('N9: move the last model out of public with db update', () => {
    const db = useDevDatabase();

    it(
      'follows the advice of the public refusal, and a further run plans nothing',
      async () => {
        const { ctx } = await startAt(db, createTempDir, 'db update', 'N9');
        await emitContract(ctx, 'contract-namespace-statements-public-renamed', 'N9.03');

        const update = await runDbUpdate(ctx, [...MOVE_USER, '--no-interactive', '--json']);
        expect(update.exitCode, `N9.04: db update: ${JSON.stringify(engineError(update))}`).toBe(0);

        await expectUserMovedOutOfPublic(db.connectionString, 'N9.05');
        await expectSettled(ctx, 'db update', undefined, 'N9.06');
      },
      timeouts.spinUpPpgDev,
    );
  });
});
