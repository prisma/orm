import {
  migrationRunnerFailure,
  type SchemaDiffIssue,
} from '@internal/framework-components/control';
import { describe, expect, it } from 'vitest';
import type { RunnerFailureFacts } from '../../src/control-api/types';
import { migrateRunnerFailureError } from '../../src/utils/migrate-failure';

const PROJECT = { cwd: '/work/app', configPath: undefined, dbGiven: false };
const REASON =
  'No ref names contract sha256:abc, and with no migrations `migration plan` starts only from `@empty` or a ref';

const failedMigration = {
  directory: '/work/app/migrations/app/20261012T1041_lossy',
  replanFrom: { kind: 'none', reason: REASON },
} as const;

function adviceOf(facts: RunnerFailureFacts, schemaIssues?: readonly SchemaDiffIssue[]) {
  const failure = migrationRunnerFailure('MIGRATION.EXECUTION_FAILED', 'The apply failed', {
    meta: { databaseUnchanged: true, ...(schemaIssues === undefined ? {} : { schemaIssues }) },
  });
  return (
    migrateRunnerFailureError(failure, facts, failedMigration, PROJECT).nextActions ?? []
  ).map(({ label }) => label);
}

describe('the advice for a failed migration no plan can replace once it is deleted', () => {
  it.each<{ readonly name: string; readonly facts: RunnerFailureFacts }>([
    {
      name: 'a cast that met a value it cannot cast',
      facts: { failedTypeChange: { field: 'User.age', by: 'cast', reason: 'value' } },
    },
    {
      name: 'rows holding an enum value the migration removes',
      facts: {
        rowsHoldingValue: [
          { enumValue: 'Status.ARCHIVED', enumName: 'Status', value: 'archived', rows: 2 },
        ],
      },
    },
    {
      name: 'rows without a value for a new required field',
      facts: {
        rowsWithoutValue: [
          { field: 'User.email', reason: 'newField', rows: 3, discriminator: false },
        ],
      },
    },
  ])('keeps the migration for $name, and says why it cannot be planned again', ({ facts }) => {
    const labels = adviceOf(facts);

    expect(labels.join('\n')).not.toMatch(/[Dd]elete `migrations\/app\/20261012T1041_lossy`/);
    expect(labels).toContainEqual(
      `Keep \`migrations/app/20261012T1041_lossy\`: no migration plan can replace it once it is deleted. ${REASON}`,
    );
  });

  it('keeps the migration when the schema check fails, and names the edit to its operations', () => {
    const labels = adviceOf({}, [
      { kind: 'missing_table', table: 'user', message: 'Table "user" is missing' } as never,
    ]);

    expect(labels.join('\n')).not.toMatch(/delete `migrations\/app\/20261012T1041_lossy`/);
    expect(labels).toContainEqual(
      expect.stringContaining('change its operations to resolve the issues listed'),
    );
  });
});
