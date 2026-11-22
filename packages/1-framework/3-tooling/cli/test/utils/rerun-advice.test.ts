import {
  migrationRunnerFailure,
  type SchemaDiffIssue,
} from '@internal/framework-components/control';
import { describe, expect, it } from 'vitest';
import type { MigrationPlanArguments } from '../../src/control-api/operations/plan-arguments';
import type { RunnerFailureFacts } from '../../src/control-api/types';
import {
  errorMigrationHasUnfilledPlaceholders,
  errorStatementNeedsMigrationFile,
} from '../../src/utils/cli-errors';
import { dbUpdateRunnerFailureError } from '../../src/utils/db-update-failure';
import { dbUpdateKeepDataEditAdvice } from '../../src/utils/keep-data-edit-advice';
import { migrateRunnerFailureError } from '../../src/utils/migrate-failure';
import { planningRefusedError } from '../../src/utils/planning-refused-error';
import type { CliInvocation } from '../../src/utils/printed-command';
import { originOf, reference, toEmitted } from './plan-origins';
import { onDisk } from './runner-failure-errors';

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
    facts: {
      rowsWithoutValue: [
        { field: 'User.age', reason: 'backfillMissedRows', rows: 2, discriminator: false },
      ],
    },
    failed: FAILED,
    reruns: [true],
  },
  {
    kind: 'rows that hold NULL',
    facts: {
      rowsWithoutValue: [
        { field: 'User.age', reason: 'nullValues', rows: 2, discriminator: false },
      ],
    },
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
    entry.failed === undefined ? undefined : onDisk(entry.failed),
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

const UPDATE_CASES: readonly (AdviceCase & { readonly planFrom?: string })[] = [
  {
    kind: 'blocking objects',
    meta: { blockingObjects: [{ kind: 'view', name: 'v' }] },
    facts: {},
    reruns: [true],
  },
  {
    kind: 'a cast that failed on a value',
    facts: { failedTypeChange: { field: 'User.age', by: 'cast', reason: 'value' } },
    planFrom: FROM,
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
    migrationPlan: toEmitted(originOf(entry.planFrom)),
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

describe('the db migrate that applies what a failed db update --to advises to plan', () => {
  const REFUSED = adviceAfterDbUpdate({ from: reference(FROM), to: reference('production') });

  it.each(REFUSED)('keeps the flags the user gave db update: %s', (_, adviceOf) => {
    const commands = commandsIn(adviceOf(GIVEN), 'db migrate');
    expect(commands.length).toBeGreaterThan(0);
    expect(new Set(commands)).toEqual(
      new Set(['{bin} db migrate --to production --permit-policy-change']),
    );
  });

  it.each(REFUSED)('applies to the plan target when the run gave no flags: %s', (_, adviceOf) => {
    expect(new Set(commandsIn(adviceOf(PROJECT), 'db migrate'))).toEqual(
      new Set(['{bin} db migrate --to production']),
    );
  });
});

describe('advice after a failed db update --to when migrations on disk already lead there', () => {
  it.each(
    adviceAfterDbUpdate({
      from: reference(FROM),
      to: reference('production'),
      migrationsToTarget: { kind: 'on-disk' },
    }),
  )('plans no second path, and applies them with the flags given: %s', (_, adviceOf) => {
    const advice = adviceOf(GIVEN);
    expect(advice).not.toContain('{bin} migration plan');
    expect(advice).toContain(
      'Migrations on disk already lead from the database to `production`, so a migration planned now would be a second path between the same two contracts, and `db migrate` applies only one of them.',
    );
    expect(new Set(commandsIn(advice, 'db migrate'))).toEqual(
      new Set(['{bin} db migrate --to production --permit-policy-change']),
    );
  });
});

describe('advice after a failed db update --to a ref whose invariant no migration on disk provides', () => {
  it.each(
    adviceAfterDbUpdate({
      from: reference(FROM),
      to: reference('production'),
      migrationsToTarget: { kind: 'plan-needed', missingInvariants: ['seeded'] },
    }),
  )('plans a migration that provides it: %s', (_, adviceOf) => {
    const advice = adviceOf(GIVEN);
    expect(advice).toContain(`{bin} migration plan --from ${FROM} --to production`);
    expect(advice).toContain('add to it a `dataTransform` with `invariantId` "seeded"');
    expect(new Set(commandsIn(advice, 'db migrate'))).toEqual(
      new Set(['{bin} db migrate --to production --permit-policy-change']),
    );
  });

  it.each(
    adviceAfterDbUpdate({
      from: reference(FROM),
      to: reference('production'),
      migrationsToTarget: {
        kind: 'at-target-missing-invariants',
        missingInvariants: ['seeded'],
        newMigration: { from: FROM, emitFirst: false },
      },
    }),
  )(
    'when the database is already at the ref, writes that migration with migration new: %s',
    (_, adviceOf) => {
      const advice = adviceOf(GIVEN);
      expect(advice).not.toContain('{bin} migration plan');
      expect(advice).toContain(
        `Write a migration from that contract to itself with \`{bin} migration new --from ${FROM}\`, add to its migration.ts a \`dataTransform\` with \`invariantId\` "seeded"`,
      );
      expect(new Set(commandsIn(advice, 'db migrate'))).toEqual(
        new Set(['{bin} db migrate --to production --permit-policy-change']),
      );
    },
  );
});

/** Every piece of advice after a failed db update that prints a `migration plan` to `TO_PRODUCTION`. */
function adviceAfterDbUpdate(
  plan: MigrationPlanArguments,
): readonly (readonly [string, (invocation: CliInvocation) => string])[] {
  return [
    ...(
      [
        [
          'a cast that failed',
          { failedTypeChange: { field: 'User.age', by: 'cast', reason: 'value' } },
        ],
        [
          'rows without a value for a new field',
          {
            rowsWithoutValue: [
              { field: 'User.age', reason: 'newField', rows: 2, discriminator: false },
            ],
          },
        ],
        [
          'rows that hold a removed enum value',
          {
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
        ],
        [
          'rows failing a check that replaces another',
          { rowsFailingCheck: { check: 'c', replacedCheck: 'b' } },
        ],
      ] as const satisfies readonly (readonly [string, RunnerFailureFacts])[]
    ).map(
      ([kind, facts]) =>
        [
          kind,
          (invocation: CliInvocation) =>
            dbUpdateRunnerFailureError(failure(), facts, {
              migrationPlan: plan,
              invocation,
            }).fix ?? '',
        ] as const,
    ),
    [
      'keeping the data of an enum member',
      (invocation) => {
        const edited = {
          subject: { kind: 'enumValue', namespaceId: 'app', enum: 'Status', member: 'OLD' },
          text: 'Status.OLD',
          edits: [{ remove: 'a', replaceWith: 'b' }],
        } as never;
        return dbUpdateKeepDataEditAdvice(invocation, plan)(edited, [edited]).ways.join(' ');
      },
    ],
    [
      'a statement that needs a migration file',
      (invocation) => {
        const { why, fix } = errorStatementNeedsMigrationFile(
          [{ verb: 'backfill', text: 'User.age' }],
          [{ verb: 'backfill', text: 'User.age' }],
          invocation,
          plan,
        ).toEnvelope();
        return `${why ?? ''} ${fix ?? ''}`;
      },
    ],
    [
      'rewrites the planner asks to write by hand',
      (invocation) => {
        const rewrite = {
          kind: 'rename',
          entity: 'enumValue',
          from: { namespaceId: 'app', enum: 'Status', member: 'OLD' },
          to: { namespaceId: 'app', enum: 'Status', member: 'NEW' },
        } as never;
        return (
          planningRefusedError(
            [{ kind: 'statementRefused', summary: 's', why: 'w', leaveOut: [rewrite] } as never],
            {
              invocation,
              migrationPlan: plan,
              statements: [
                { verb: 'rename', text: 'Status.OLD:Status.NEW' },
                { verb: 'backfill', text: 'User.age' },
              ],
              resolved: [rewrite, { kind: 'backfill' } as never],
            },
          ).toEnvelope().nextActions ?? []
        )
          .map(({ label }) => label)
          .join(' ');
      },
    ],
  ];
}
