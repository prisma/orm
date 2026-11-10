import {
  type MigrationRunnerFailureMeta,
  migrationRunnerFailure,
} from '@internal/framework-components/control';
import { describe, expect, it } from 'vitest';
import { runFailure } from './run-migration-harness';

const failed = (meta: MigrationRunnerFailureMeta) =>
  migrationRunnerFailure(
    'MIGRATION.EXECUTION_FAILED',
    'Operation table.Post failed during execution: create table "Post"',
    { why: 'Table already exists. The operations that ran before the failure stay applied.', meta },
  );

describe('runMigration, a failed apply', () => {
  it('returns the runner failure unchanged when the apply changed the database', async () => {
    const runnerFailure = failed({ failingSpace: 'app', databaseUnchanged: false });

    const failure = await runFailure(runnerFailure);

    expect({
      same: failure === runnerFailure,
      message: failure?.message,
      why: failure?.why,
    }).toEqual({
      same: true,
      message: 'Operation table.Post failed during execution: create table "Post"',
      why: 'Table already exists. The operations that ran before the failure stay applied.',
    });
  });

  it('returns the runner failure unchanged when the apply changed nothing', async () => {
    const runnerFailure = failed({ failingSpace: 'app', databaseUnchanged: true });

    expect(await runFailure(runnerFailure)).toBe(runnerFailure);
  });
});
