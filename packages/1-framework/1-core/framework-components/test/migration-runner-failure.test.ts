import { isStructuredError } from '@internal/utils/structured-error';
import { describe, expect, it } from 'vitest';
import {
  migrationRunnerFailure,
  withDatabaseUnchanged,
  withFailingSpace,
} from '../src/control/control-migration-types';

describe('migrationRunnerFailure', () => {
  it('builds a structured error with the summary as its message', () => {
    const failure = migrationRunnerFailure('MIGRATION.PRECHECK_FAILED', 'Operation op failed', {
      why: 'The check did not hold.',
      meta: { failedCheck: { operationId: 'op', phase: 'precheck', description: 'check' } },
    });

    expect(isStructuredError(failure)).toBe(true);
    expect(failure).toBeInstanceOf(Error);
    expect({
      code: failure.code,
      message: failure.message,
      why: failure.why,
      meta: failure.meta,
    }).toEqual({
      code: 'MIGRATION.PRECHECK_FAILED',
      message: 'Operation op failed',
      why: 'The check did not hold.',
      meta: { failedCheck: { operationId: 'op', phase: 'precheck', description: 'check' } },
    });
  });

  it('has empty meta when none is given', () => {
    const failure = migrationRunnerFailure('MIGRATION.MARKER_CAS_FAILURE', 'Marker changed');

    expect({ meta: failure.meta, hasWhy: 'why' in failure }).toEqual({ meta: {}, hasWhy: false });
  });
});

describe('withFailingSpace', () => {
  it('keeps the message, code, why and meta, and adds the space to meta', () => {
    const cause = new Error('driver error');
    const original = migrationRunnerFailure('MIGRATION.SCHEMA_VERIFY_FAILED', 'Schema differs', {
      why: 'The resulting schema does not satisfy the contract.',
      meta: { schemaIssues: [], sqlState: '42P01' },
      cause,
    });

    const failure = withFailingSpace(original, 'app');

    expect(isStructuredError(failure)).toBe(true);
    expect(failure).toBeInstanceOf(Error);
    expect({
      code: failure.code,
      message: failure.message,
      why: failure.why,
      meta: failure.meta,
      cause: failure.cause,
    }).toEqual({
      code: 'MIGRATION.SCHEMA_VERIFY_FAILED',
      message: 'Schema differs',
      why: 'The resulting schema does not satisfy the contract.',
      meta: { schemaIssues: [], sqlState: '42P01', failingSpace: 'app' },
      cause,
    });
    expect(failure.stack).toBe(original.stack);
  });

  it('leaves the original failure unchanged', () => {
    const original = migrationRunnerFailure('MIGRATION.EXECUTION_FAILED', 'Step failed');

    withFailingSpace(original, 'ext');

    expect(original.meta).toEqual({});
  });
});

describe('withDatabaseUnchanged', () => {
  it('keeps the failure, says in meta whether the database is unchanged, and ends the why with it', () => {
    const original = migrationRunnerFailure('MIGRATION.SCHEMA_VERIFY_FAILED', 'Schema differs', {
      why: 'The schema check after apply found: extra: rogue.',
      meta: { schemaIssues: [], failingSpace: 'app' },
    });
    const bare = migrationRunnerFailure('MIGRATION.POLICY_VIOLATION', 'Not allowed');
    const driverMessage = migrationRunnerFailure('MIGRATION.EXECUTION_FAILED', 'Copy failed', {
      why: 'UNIQUE constraint failed: _prisma_new_user.nickname',
    });

    expect(
      [
        withDatabaseUnchanged(original, true),
        withDatabaseUnchanged(original, false),
        withDatabaseUnchanged(bare, true),
        withDatabaseUnchanged(driverMessage, true),
      ].map(({ code, message, why, meta }) => ({ code, message, why, meta })),
    ).toEqual([
      {
        code: 'MIGRATION.SCHEMA_VERIFY_FAILED',
        message: 'Schema differs',
        why: 'The schema check after apply found: extra: rogue. The failed apply changed nothing.',
        meta: { schemaIssues: [], failingSpace: 'app', databaseUnchanged: true },
      },
      {
        code: 'MIGRATION.SCHEMA_VERIFY_FAILED',
        message: 'Schema differs',
        why: 'The schema check after apply found: extra: rogue. The operations that ran before the failure stay applied.',
        meta: { schemaIssues: [], failingSpace: 'app', databaseUnchanged: false },
      },
      {
        code: 'MIGRATION.POLICY_VIOLATION',
        message: 'Not allowed',
        why: 'The failed apply changed nothing.',
        meta: { databaseUnchanged: true },
      },
      {
        code: 'MIGRATION.EXECUTION_FAILED',
        message: 'Copy failed',
        why: 'UNIQUE constraint failed: _prisma_new_user.nickname. The failed apply changed nothing.',
        meta: { databaseUnchanged: true },
      },
    ]);
  });
});
