import type { DiffableNode, SchemaDiffIssue } from '@internal/framework-components/control';
import { EMPTY_CONTRACT_HASH } from '@internal/migration-tools/constants';
import { describe, expect, it } from 'vitest';
import { mapDbInitFailure } from '../../src/utils/db-init-failure';
import { mapDbUpdateFailure } from '../../src/utils/db-update-failure';
import { mapMigrateFailure } from '../../src/utils/migrate-failure';

const node: DiffableNode = {
  id: 'default',
  nodeKind: 'sql-column-default',
  isEqualTo: () => false,
  children: () => [],
};

const explained: SchemaDiffIssue = {
  path: ['database', 'public', 'Event', 'column:at', 'default'],
  expected: node,
  actual: node,
  explanation: {
    text: 'The database reads this default back as sql`(now())`.',
    cause: 'possibly-equivalent',
  },
};
const plain: SchemaDiffIssue = {
  path: ['database', 'public', 'Event', 'column:id'],
  expected: node,
};

const RUNNER_WHY = 'The resulting database schema does not satisfy the destination contract.';
const LISTED =
  'The schema check after apply found: mismatch: database/public/Event/column:at/default. The database reads this default back as sql`(now())`; missing: database/public/Event/column:id.';
const PROJECT = '/work/app';
const invocation = { cwd: PROJECT, configPath: undefined, dbGiven: false };
const FROM = 'b'.repeat(64);

function schemaCheckFailure(issues: unknown) {
  return {
    code: 'RUNNER_FAILED',
    summary: 'Database schema does not satisfy contract',
    why: RUNNER_WHY,
    meta: { runnerErrorCode: 'MIGRATION.SCHEMA_VERIFY_FAILED', issues },
  } as const;
}

describe('a failed schema check after apply', () => {
  describe('on db migrate', () => {
    it('lists the issues in its why, and says how to plan the failed migration again', () => {
      const error = mapMigrateFailure(
        {
          ...schemaCheckFailure([explained, plain]),
          failedMigration: {
            directory: `${PROJECT}/migrations/app/20261015T1200_initial`,
            from: FROM,
          },
        },
        invocation,
      );
      expect({ why: error.why, fix: error.fix, issues: error.meta?.['issues'] }).toEqual({
        why: LISTED,
        fix: `The failed apply changed nothing. Change the contract source to resolve the issues listed, re-run \`{bin} contract emit\`, delete \`migrations/app/20261015T1200_initial\` (copy any code you wrote in its migration.ts first), plan it again with \`{bin} migration plan --from ${FROM} --name initial\`, put any code you copied into the migration.ts it writes, run that migration.ts with the \`node\` command \`migration plan\` prints, and run \`{bin} db migrate\`.`,
        issues: [explained, plain],
      });
    });

    it('plans the first migration again without --from, which does not take the empty contract', () => {
      expect(
        mapMigrateFailure(
          {
            ...schemaCheckFailure([explained]),
            failedMigration: {
              directory: `${PROJECT}/migrations/app/20261015T1200_initial`,
              from: EMPTY_CONTRACT_HASH,
            },
          },
          invocation,
        ).fix,
      ).toContain('plan it again with `{bin} migration plan --name initial`,');
    });

    it('says to carry written code over when the runner names no migration', () => {
      expect(mapMigrateFailure(schemaCheckFailure([explained]), invocation).fix).toBe(
        "The failed apply changed nothing. Change the contract source to resolve the issues listed, re-run `{bin} contract emit`, delete the failed migration's directory (copy any code you wrote in its migration.ts first), plan it again with `{bin} migration plan`, put any code you copied into the migration.ts it writes, run that migration.ts with the `node` command `migration plan` prints, and run `{bin} db migrate`.",
      );
    });

    it('keeps the runner why for an issue the CLI cannot read', () => {
      expect(
        mapMigrateFailure(schemaCheckFailure([explained, { path: ['x'] }]), invocation).why,
      ).toBe(RUNNER_WHY);
    });
  });

  describe('on db update', () => {
    it('lists the issues in its why, and says to change the contract', () => {
      const error = mapDbUpdateFailure(
        { ...schemaCheckFailure([explained, plain]), conflicts: undefined },
        invocation,
      );
      expect({ why: error.why, fix: error.fix }).toEqual({
        why: LISTED,
        fix: 'Change the contract source to resolve the issues listed, re-run `{bin} contract emit`, then re-run `{bin} db update`.',
      });
    });

    it('keeps the runner why and its advice when there are no issues', () => {
      const error = mapDbUpdateFailure(
        { ...schemaCheckFailure([]), conflicts: undefined },
        invocation,
      );
      expect({ why: error.why, fix: error.fix }).toEqual({
        why: RUNNER_WHY,
        fix: 'Inspect the reported conflict, reconcile schema drift if needed, then re-run `{bin} db update`',
      });
    });
  });

  describe('on db init', () => {
    it('lists the issues in its why, and says to change the contract', () => {
      const error = mapDbInitFailure(
        { ...schemaCheckFailure([explained, plain]), conflicts: undefined },
        invocation,
      );
      expect({ why: error.why, fix: error.fix }).toEqual({
        why: LISTED,
        fix: 'Change the contract source to resolve the issues listed, re-run `{bin} contract emit`, then re-run `{bin} db init`.',
      });
    });

    it('keeps the runner why when there are no issues', () => {
      expect(
        mapDbInitFailure({ ...schemaCheckFailure([]), conflicts: undefined }, invocation).why,
      ).toBe(RUNNER_WHY);
    });
  });
});
