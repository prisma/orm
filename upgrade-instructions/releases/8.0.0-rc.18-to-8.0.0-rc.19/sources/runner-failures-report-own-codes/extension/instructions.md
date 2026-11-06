---
changes:
  - id: control-client-apply-takes-invocation
    summary: |
      `dbInit`, `dbUpdate` and `migrate` on a control client take a required `invocation` option: `{ cwd, configPath, dbGiven }`, where the commands an error's advice prints are run from, the `--config` they repeat, and whether they repeat `--db`. Pass `{ cwd: process.cwd(), configPath: undefined, dbGiven: false }` when nothing is run from a terminal. Their failures are now `CliStructuredError`s, so `DbInitFailure`, `DbUpdateFailure` and `MigrateFailure` are gone from `control-api`.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      matches:
        - '\.(?:dbInit|dbUpdate|migrate)\(\s*\{'
        - '\b(?:DbInitFailure|DbUpdateFailure|MigrateFailure)(?:Code)?\b'
  - id: runner-failures-report-own-codes
    summary: |
      A failed migration apply reports the runner's own code, such as `MIGRATION.SCHEMA_VERIFY_FAILED`, `MIGRATION.PRECHECK_FAILED`, `MIGRATION.POSTCHECK_FAILED` or `MIGRATION.EXECUTION_FAILED`, instead of `MIGRATION.RUNNER_FAILED` with `meta.runnerErrorCode`. `MIGRATION.RUNNER_FAILED` no longer exists. The facts move into typed `meta` keys: a failed schema check lists its issues in `meta.schemaIssues` (was `meta.issues`), and a failed check is `meta.failedCheck` (`operationId`, `phase`, `description`; was `operationId`, `phase`, `stepDescription`).
    detection:
      glob: "**/*"
      matches:
        - 'RUNNER_FAILED|runnerErrorCode'
---

# Migration apply failures report the runner's own code

## The control client's apply operations take the invocation

`dbInit`, `dbUpdate` and `migrate` write advice that names commands to run, and that advice needs to know where it will be run from. Pass it as `invocation`:

```ts
// Before
await control.dbUpdate({ contract, mode: 'apply', migrationsDir: 'migrations' });

// After
await control.dbUpdate({
  contract,
  mode: 'apply',
  migrationsDir: 'migrations',
  invocation: { cwd: process.cwd(), configPath: undefined, dbGiven: false },
});
```

Add the same `invocation` to every `dbInit`, `dbUpdate` and `migrate` call. Set `configPath` to the config path your tool passes to `prisma`, and `dbGiven` to `true` when it passes `--db`.

A failure of these three operations is a `CliStructuredError`. Replace any use of `DbInitFailure`, `DbUpdateFailure`, `MigrateFailure` or their code types with `CliStructuredError`, and branch on `failure.code`, a dotted code such as `MIGRATION.PLANNING_FAILED`, instead of `'PLANNING_FAILED'`, `'RUNNER_FAILED'` or `'MIGRATION_PATH_NOT_FOUND'`.

The failure's fields change too:

| Before | After |
| --- | --- |
| `failure.summary` | `failure.message` |
| `failure.code === 'PLANNING_FAILED'`, `failure.conflicts` | `failure.code === 'MIGRATION.PLANNING_FAILED'`, `failure.meta.conflicts` |
| `failure.warnings` on a failed `dbInit` or `dbUpdate`, and `value.warnings` on a successful one | the `onPlannerWarnings(warnings)` option, called once per run when planning raised warnings, whether the apply then succeeds or fails |
| `failure.schemaIssues`, `failure.rowsWithoutValue`, `failure.failedTypeChange`, `failure.failedPrecheck` | the runner's facts in `failure.meta`: `schemaIssues`, `rowsWithoutValue`, `failedTypeChange`, `failedCheck`. A field in them is a subject object, not text such as `"User.age"` |
| `failure.failedMigration`, `failure.databaseStorageHash` | removed; the advice in `failure.fix` names the migration directory and the `--from` hash |

In `--json` output, `db init` and `db update` print the planner's warnings of a failed apply as `warn` messages before the error, instead of in the error's `meta.plannerWarnings`.

## Match the runner's code, not `MIGRATION.RUNNER_FAILED`

Code that reads `prisma db migrate`, `db init` or `db update` output with `--json`, or a control client's failure, and matches `MIGRATION.RUNNER_FAILED` or `meta.runnerErrorCode`, now matches the code itself:

```ts
// Before
if (error.code === 'MIGRATION.RUNNER_FAILED' && error.meta.runnerErrorCode === 'MIGRATION.SCHEMA_VERIFY_FAILED') {
  report(error.meta.issues);
}

// After
if (error.code === 'MIGRATION.SCHEMA_VERIFY_FAILED') {
  report(error.meta.schemaIssues);
}
```

A check that matched `MIGRATION.RUNNER_FAILED` alone, meaning "the apply failed", matches every code the runner reports: `MIGRATION.SCHEMA_VERIFY_FAILED`, `MIGRATION.PRECHECK_FAILED`, `MIGRATION.POSTCHECK_FAILED`, `MIGRATION.EXECUTION_FAILED`, `MIGRATION.POLICY_VIOLATION`, `MIGRATION.MARKER_ORIGIN_MISMATCH`, `MIGRATION.MARKER_CAS_FAILURE`, `MIGRATION.DESTINATION_CONTRACT_MISMATCH`, `MIGRATION.FOREIGN_KEY_VIOLATION` and, on MongoDB, `MIGRATION.DATA_TRANSFORM_CHECK_NOT_READ_ONLY`. `db init` and `db update` also report an extension space they cannot plan as `MIGRATION.PATH_UNREACHABLE` or `MIGRATION.NO_INVARIANT_PATH`, with `meta.spaceId`.

Read the facts from these `meta` keys:

| Before | After |
| --- | --- |
| `meta.issues` | `meta.schemaIssues` |
| `meta.operationId`, `meta.phase`, `meta.stepDescription` of a failed check | `meta.failedCheck.operationId`, `meta.failedCheck.phase`, `meta.failedCheck.description` |
| `meta.runnerErrorCode` | `code` |

`meta.failingSpace` is unchanged. `MIGRATION.PATH_UNREACHABLE` for a database with no marker now has `'empty'`, the empty contract's hash, in `meta.fromHash`, where it had `'<empty>'`. A failure also carries `meta.failedTypeChange` and `meta.rowsWithoutValue` when the runner found them.
