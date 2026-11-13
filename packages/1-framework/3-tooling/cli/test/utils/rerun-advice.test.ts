import {
  migrationRunnerFailure,
  type SchemaDiffIssue,
} from '@internal/framework-components/control';
import { describe, expect, it } from 'vitest';
import type { RunnerFailureFacts } from '../../src/control-api/types';
import { errorMigrationHasUnfilledPlaceholders } from '../../src/utils/cli-errors';
import { dbUpdateRunnerFailureError } from '../../src/utils/db-update-failure';
import { migrateRunnerFailureError } from '../../src/utils/migrate-failure';
import type { CliInvocation } from '../../src/utils/printed-command';

const PROJECT = { cwd: '/work/app', configPath: undefined, dbGiven: false };
const GIVEN = { ...PROJECT, rerunArgs: ['--to', 'production', '--permit-policy-change'] };
const FROM = 'a'.repeat(64);
const FAILED = { directory: '/work/app/migrations/app/20260101T0000_change', from: FROM };
const SCHEMA_ISSUE: SchemaDiffIssue = { path: ['user', 'age'] };

function failure(meta: Record<string, unknown> = {}) {
  return migrationRunnerFailure('MIGRATION.EXECUTION_FAILED', 'Operation failed', {
    meta: { databaseUnchanged: true, ...meta },
  });
}

function commandsIn(text: string | undefined, command: string): readonly string[] {
  return [...(text ?? '').matchAll(new RegExp(`\\{bin\\} ${command}[^\`]*`, 'g'))].map(
    ([match]) => match,
  );
}

interface AdviceCase {
  readonly kind: string;
  readonly meta?: Record<string, unknown>;
  readonly facts: RunnerFailureFacts;
  readonly failed?: typeof FAILED;
  /** For each `db migrate` the advice prints, whether it repeats the run. */
  readonly reruns: readonly boolean[];
}

const MIGRATE_CASES: readonly AdviceCase[] = [
  {
    kind: 'blocking objects',
    meta: { blockingObjects: [{ kind: 'view', name: 'v' }] },
    facts: {},
    reruns: [true],
  },
  {
    kind: 'a conversion that failed',
    facts: { failedTypeChange: { field: 'User.age', by: 'conversion', reason: 'value' } },
    failed: FAILED,
    reruns: [true],
  },
  {
    kind: 'a cast that failed, with the failed migration',
    facts: { failedTypeChange: { field: 'User.age', by: 'cast', reason: 'value' } },
    failed: FAILED,
    reruns: [true, true, true],
  },
  {
    kind: 'a cast that failed, without the failed migration',
    facts: { failedTypeChange: { field: 'User.age', by: 'cast', reason: 'value' } },
    reruns: [true, true],
  },
  {
    kind: 'a backfill that missed rows',
    facts: { rowsWithoutValue: [{ field: 'User.age', reason: 'backfillMissedRows', rows: 2 }] },
    failed: FAILED,
    reruns: [true],
  },
  {
    kind: 'rows that hold NULL',
    facts: { rowsWithoutValue: [{ field: 'User.age', reason: 'nullValues', rows: 2 }] },
    failed: FAILED,
    reruns: [true, true, false],
  },
  {
    kind: 'rows that hold a removed enum value',
    facts: {
      rowsHoldingValue: [
        {
          enumValue: 'Status.OLD',
          enumName: 'Status',
          value: 'old',
          rows: 1,
          keepDataEdit: { remove: 'a', replaceWith: 'b' },
        },
      ],
    },
    failed: FAILED,
    reruns: [false, true],
  },
  { kind: 'rows failing a new check', facts: { rowsFailingCheck: { check: 'c' } }, reruns: [true] },
  {
    kind: 'rows failing a check that replaces another',
    facts: { rowsFailingCheck: { check: 'c', replacedCheck: 'b' } },
    failed: FAILED,
    reruns: [true],
  },
  {
    kind: 'a schema check',
    meta: { schemaIssues: [SCHEMA_ISSUE] },
    facts: {},
    failed: FAILED,
    reruns: [false, true],
  },
  {
    kind: 'a failed precheck',
    facts: {
      failedPrecheck: { operationId: 'op', description: 'check', planStartsFromMarker: true },
    },
    reruns: [true],
  },
  { kind: 'any other failure', facts: {}, reruns: [true] },
];

function migrateCommands(entry: AdviceCase, invocation: CliInvocation): readonly string[] {
  const error = migrateRunnerFailureError(
    failure(entry.meta),
    entry.facts,
    entry.failed,
    invocation,
  );
  return commandsIn(error.fix, 'db migrate');
}

describe('advice that repeats a failed db migrate', () => {
  it.each(MIGRATE_CASES)('repeats the flags the user gave: $kind', (entry) => {
    expect(migrateCommands(entry, GIVEN)).toEqual(
      entry.reruns.map((rerun) =>
        rerun ? '{bin} db migrate --to production --permit-policy-change' : '{bin} db migrate',
      ),
    );
  });

  it.each(MIGRATE_CASES)('prints neither flag when the user gave none: $kind', (entry) => {
    expect(migrateCommands(entry, PROJECT)).toEqual(entry.reruns.map(() => '{bin} db migrate'));
  });

  it('repeats the flags the user gave after filling placeholders', () => {
    const fix = (rerun: string) =>
      `Replace each placeholder(...) call in migrations/app/20260101T0000_change/migration.ts with the value or query it stands for. Then run node migrations/app/20260101T0000_change/migration.ts to write ops.json, and run ${rerun} again.`;
    expect(
      [GIVEN, PROJECT].map(
        (invocation) => errorMigrationHasUnfilledPlaceholders(FAILED.directory, invocation).fix,
      ),
    ).toEqual([
      fix('{bin} db migrate --to production --permit-policy-change'),
      fix('{bin} db migrate'),
    ]);
  });
});

const UPDATE_CASES: readonly (AdviceCase & { readonly databaseStorageHash?: string })[] = [
  {
    kind: 'blocking objects',
    meta: { blockingObjects: [{ kind: 'view', name: 'v' }] },
    facts: {},
    reruns: [true],
  },
  {
    kind: 'a cast that failed on a value',
    facts: { failedTypeChange: { field: 'User.age', by: 'cast', reason: 'value' } },
    databaseStorageHash: FROM,
    reruns: [true],
  },
  { kind: 'rows failing a new check', facts: { rowsFailingCheck: { check: 'c' } }, reruns: [true] },
  {
    kind: 'rows failing a check that replaces another, with no origin to plan from',
    facts: { rowsFailingCheck: { check: 'c', replacedCheck: 'b' } },
    reruns: [false, true],
  },
  {
    kind: 'rows that hold a removed enum value, with no origin to plan from',
    facts: {
      rowsHoldingValue: [{ enumValue: 'Status.OLD', enumName: 'Status', value: 'old', rows: 1 }],
    },
    reruns: [false, true],
  },
  { kind: 'any other failure', facts: {}, reruns: [true] },
];

function updateCommands(
  entry: (typeof UPDATE_CASES)[number],
  invocation: CliInvocation,
): readonly string[] {
  const error = dbUpdateRunnerFailureError(failure(entry.meta), entry.facts, {
    databaseStorageHash: entry.databaseStorageHash,
    invocation,
  });
  return commandsIn(error.fix, 'db update').map((command) =>
    command.replace(/ --(rename|delete) ('[^']*'|\S+)/g, ''),
  );
}

describe('advice that repeats a failed db update', () => {
  it.each(UPDATE_CASES)('repeats the flags the user gave: $kind', (entry) => {
    expect(updateCommands(entry, GIVEN)).toEqual(
      entry.reruns.map((rerun) =>
        rerun ? '{bin} db update --to production --permit-policy-change' : '{bin} db update',
      ),
    );
  });

  it.each(UPDATE_CASES)('prints neither flag when the user gave none: $kind', (entry) => {
    expect(updateCommands(entry, PROJECT)).toEqual(entry.reruns.map(() => '{bin} db update'));
  });
});
