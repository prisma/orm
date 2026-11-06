/**
 * A failed schema check after apply: the run failure carries the runner's typed issues, and names the last migration as the one to plan again.
 */
import {
  type DiffableNode,
  type MigrationRunnerFailureMeta,
  migrationRunnerFailure,
  type SchemaDiffIssue,
} from '@internal/framework-components/control';
import { describe, expect, it } from 'vitest';
import { failureOf } from './run-migration-harness';

const node: DiffableNode = {
  id: 'default',
  nodeKind: 'sql-column-default',
  isEqualTo: () => false,
  children: () => [],
};
const issue: SchemaDiffIssue = { path: ['public', 'event', 'id'], expected: node };

const schemaCheckFailed = (meta: MigrationRunnerFailureMeta) =>
  migrationRunnerFailure(
    'MIGRATION.SCHEMA_VERIFY_FAILED',
    'Database schema does not satisfy contract',
    { meta: { failingSpace: 'app', ...meta } },
  );

describe('runMigration, a failed schema check after apply', () => {
  it('names the last migration to plan again', async () => {
    const failure = await failureOf(schemaCheckFailed({ schemaIssues: [issue] }), null);
    expect(failure?.failedMigration?.spaceId).toBe('app');
  });

  it('names no migration when the issue list is empty', async () => {
    const failure = await failureOf(schemaCheckFailed({ schemaIssues: [] }), null);
    expect(failure?.failedMigration).toBeUndefined();
  });

  it('names no migration when the runner reports no issues', async () => {
    const failure = await failureOf(schemaCheckFailed({}), null);
    expect(failure?.failedMigration).toBeUndefined();
  });
});
