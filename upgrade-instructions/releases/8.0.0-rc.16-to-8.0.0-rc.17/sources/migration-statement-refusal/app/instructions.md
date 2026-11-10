---
changes:
  - id: destructive-means-data-loss
    summary: |
      An operation is `destructive` only when it can lose rows or values. Postgres `setNotNull` and the type changes that keep every value (`int2` to `int4` to `int8`, `float4` to `float8`), a SQLite table rebuild that only changes nullability, and MongoDB `dropIndex`, `setValidation`, `collMod` and the planner's validator and change-stream image changes are now `widening`. Running an existing `migration.ts` again writes `widening` for these operations in `ops.json`, and a new `migrationHash`.
    detection:
      glob: "**/migration.ts"
      matches:
        - '\bsetNotNull\('
        - '(?<![\w$.])(?:dropIndex|setValidation|collMod)\('
  - id: migration-plan-refuses-data-loss
    summary: |
      `prisma migration plan` refuses every plan that would lose data, not only an auto-baseline, until each operation that would is answered: `--delete <subject>` lets the data go, `--rename <subject>:<new name>` keeps it. Where nobody can answer it fails with `CLI.CONSENT_REQUIRED`, whose `nextActions` name the flags. `--confirm` answers none of these questions.
    detection:
      glob: "**/*.{sh,bash,zsh,yml,yaml,json,toml,mjs,cjs,js,ts,mts,cts}"
      matches:
        - '(?<![\w-])migration\s+plan(?![\w-])'
  - id: db-update-confirm-no-longer-consents
    summary: |
      `prisma db update --confirm <database>` no longer consents to data loss. An apply asks about each operation that would lose data, answered by `--delete <Model|Model.field>` or `--rename`, and about each that would widen who can read or write a model's rows, answered by `--allow <Model>`. Without them it fails with `CLI.CONSENT_REQUIRED` where nobody can answer.
    detection:
      glob: "**/*.{sh,bash,zsh,yml,yaml,json,toml,mjs,cjs,js,ts,mts,cts}"
      matches:
        - 'db\s+update(?:[^\n\\]|\\\r?\n|\\.)*(?<![\w-])--confirm(?![\w-])'
  - id: db-update-reads-origin-snapshot
    summary: |
      `prisma db update` reads the snapshot of the contract the database is at on every run, to name what an operation would lose. Nothing to change.
  - id: control-api-answer-questions
    summary: |
      In `@prisma/orm-toolchain/cli/control-api`, `executeMigrationPlanCommand` and `executeDbUpdate`, and the control client's `dbUpdate`, require an `answerQuestions` callback; `consent` and `carryEmittedExtensionDirs` are gone. `delete` and `allow` statements in `statements` answer questions without asking, and one that answers none fails with `MIGRATION.STATEMENT_ANSWERS_NO_QUESTION`. `acceptDataLoss: true` no longer answers access-widening questions; `acceptAccessWidening: true` does.
    detection:
      glob: "**/*.{ts,mts,cts,js,mjs,cjs}"
      matches:
        - '(?<![\w$])(?:executeMigrationPlanCommand|executeDbUpdate)\s*\('
        - '\.dbUpdate\s*\('
        - '(?<![\w$])carryEmittedExtensionDirs(?![\w$])'
  - id: applied-statement-report-verb
    summary: |
      `AppliedStatementReport` from `@prisma/orm-toolchain/cli/control-api` is a union discriminated by `verb` (`rename`, `delete` or `allow`), and `StatementVerb` is `'rename' | 'delete' | 'allow'`. Narrow on `verb === 'rename'` before reading a rename's `statement`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '(?<![\w$])(?:AppliedStatementReport|StatementVerb)(?![\w$])'
  - id: consent-errors-removed
    summary: |
      `ERROR_CODE_DESTRUCTIVE_CHANGES`, `errorDestructiveChanges`, `ERROR_CODE_CONSENT_PLAN_MISMATCH` and `errorConsentPlanMismatch` are removed from `@prisma/orm-framework/errors/execution`; `DbUpdateFailureCode` loses `'DESTRUCTIVE_CHANGES'` and `'CONSENT_PLAN_MISMATCH'`, and `DbUpdateFailure` loses `destructiveChanges` and `consentPlanMismatch`. The codes `MIGRATION.DESTRUCTIVE_CHANGES`, `MIGRATION.CONSENT_PLAN_MISMATCH`, `CLI.CONSENT_TOKEN_UNRESOLVED` and `CLI.CONSENT_OPERATIONS_MISSING` are no longer raised.
    detection:
      glob: "**/*.{ts,mts,cts,js,mjs,cjs,sh,bash,zsh,yml,yaml,json}"
      matches:
        - '(?<![\w$])(?:ERROR_CODE_DESTRUCTIVE_CHANGES|errorDestructiveChanges|ERROR_CODE_CONSENT_PLAN_MISMATCH|errorConsentPlanMismatch|destructiveChanges|consentPlanMismatch)(?![\w$])'
        - '(?<![\w])(?:DESTRUCTIVE_CHANGES|CONSENT_PLAN_MISMATCH|CONSENT_TOKEN_UNRESOLVED|CONSENT_OPERATIONS_MISSING)(?![\w])'
---

# `destructive` means data loss, and statements consent to it

## `destructive-means-data-loss`

The planner and the migration factories now class an operation as `destructive` only when it can lose rows or values. An operation that fails rather than losing a value is `widening`: `SET NOT NULL` fails on a NULL, and a MongoDB validator applies only to later writes. `prisma migration show` marks fewer operations with ⚠, `prisma migration plan` and `prisma db update` print the data-loss warning less often, and `prisma db update` asks for consent less often.

A migration that is already applied needs nothing: `prisma db migrate` applies its `ops.json` as written, and the database ledger records the migration by its hash.

For each migration package that no database has applied yet and whose `migration.ts` calls `setNotNull` (Postgres), or `dropIndex`, `setValidation` or `collMod` without an `operationClass` (MongoDB), run its `migration.ts` again (`node migration.ts`) so that `ops.json` records the new class. This rewrites `ops.json` and the `migrationHash` in `migration.json`. Do not run it again for a package a database has applied: its new hash would no longer match the hash the database's ledger recorded for it.

## `migration-plan-refuses-data-loss`

`prisma migration plan` used to ask for consent only before an auto-baseline that would lose data. It now asks about every operation of every plan that would lose data: dropping a table, a column or a collection, or a type change that can change values. It asks one question per model, field or storage name, before it writes anything. A rename on the command line is planned from the start, so the drop it replaces is never asked about.

Detection lists every script and CI file that runs `migration plan`; it cannot tell which of them plan a drop. For each one that runs non-interactively, run it once against a contract change that drops something, or read the failure when it next happens. The failure is `CLI.CONSENT_REQUIRED`; its `meta.unanswered[]` names each subject and the verbs that answer it, and its `nextActions` give the flags, for example `--delete Legacy` or `--rename 'Legacy:<new name>'` (a value with characters a shell would read is single-quoted). Add the flags you mean to that run. A subject no model of the starting contract stores is named by its storage name and can only be deleted. `--rename` is offered only for a model or field the new contract no longer has, so a field whose type changes is answered with `--delete`, and on MongoDB, whose planner refuses renames in this release, only `--delete` is offered; the question then says how to keep the documents by renaming the collection in `mongosh` before a plan that drops it is applied, and that a migration written by `migration plan` still drops it. A field of a model the plan renames is named through the model's new name: `--rename Profile:User --delete User.nickname`. Do not keep a `--confirm <directory>` for this: it answers nothing.

## `db-update-confirm-no-longer-consents`

Detection finds `--confirm` on the same command line as `db update`, including a command continued over several lines with `\`. For each `prisma db update ... --confirm <database>`, replace `--confirm <database>` with one statement per operation it was there to allow:

- `--delete <Model>` or `--delete <Model.field>` for each model or field whose data the update may lose, or `--rename <Model>:<New>` / `--rename <Model.field>:<Model.newField>` if it was renamed.
- `--delete <storage name>` for data no model stores, such as a table or column added by hand; on Postgres the name is schema-qualified (`public.audit_log`).
- `--allow <Model>` before each operation that changes who can read or write that model's rows, such as dropping its row-level-security policy or disabling row-level security; each operation is its own question, so both on one model take `--allow User --allow User`.

To find the subjects, run the same command with `--no-interactive --json` and read `meta.unanswered[]`, or `--dry-run --json` and read `dataLoss` and `accessWidening`. A `--delete` or `--allow` that answers no question fails the run with `CLI.CONSENT_UNUSED`; on `--dry-run`, which asks nothing, it fails with `MIGRATION.STATEMENT_ANSWERS_NO_QUESTION`, so the exact command you will apply can be previewed with `--dry-run` first.

## `db-update-reads-origin-snapshot`

`prisma db update` now reads the snapshot of the contract the database's marker names on every run, not only when `--rename` is given, so it can name what an operation would lose by model and field. Without a snapshot (a database last updated with `--db <url>` and no `--advance-ref`), each subject is its storage name, and the question says so. The planned operations are the same either way.

## `control-api-answer-questions`

These come from `@prisma/orm-toolchain/cli/control-api`.

- `executeDbUpdate(options)` and the control client's `dbUpdate(options)` require `answerQuestions`, typed `AnswerPlanQuestions` (with `PlanQuestion`, `PlanAnswer` and `PlanQuestionVerb`, all exported from `@prisma/orm-toolchain/cli/control-api`). Before an apply it is called with every question no statement answered, at least once, with an empty list when nothing is in question, and also under `acceptDataLoss: true`. Return one `{ verb, text }` per question, in order, with a verb from `question.verbs` and `question.subject` as the text (or `<subject>:<new name>` for a rename); throw to refuse. A callback that returns too few answers, or an answer its question rejects, throws an `InternalError`. To keep a script that refuses every data loss, write `answerQuestions: async (questions) => { if (questions.length > 0) throw new Error('db update would lose data or widen access'); return []; }`.
- `acceptDataLoss: true` answers every data-loss question, and `acceptAccessWidening: true` every access-widening question. A caller that passed `acceptDataLoss: true` to apply whatever the plan holds passes both.
- `delete` and `allow` statements in `statements` (`{ verb: 'delete', text: 'Legacy' }`) answer their questions without asking. A `delete` answers every loss of its subject; an `allow` answers one operation, in order, so two access changes on one model take two `allow` statements. One that answers no question fails with `MIGRATION.STATEMENT_ANSWERS_NO_QUESTION`, in plan mode as in apply mode.
- `consent` is gone from `executeDbUpdate`'s and `dbUpdate`'s options: the plan-hash binding it carried no longer exists. Remove it.
- `executeMigrationPlanCommand(options)` requires `answerQuestions`, with the same contract, and loses `consent` and `carryEmittedExtensionDirs`. Remove both.
- `DbUpdateSuccess` gains `dataLoss` and `accessWidening`, the operations of the plan that lose data or widen access, by position, each an `AskedSubject` with the subject's `text` as the question writes it. `AskedSubject`, `MigrationSubject`, `MigrationOperationSubject` and `MigrationPlanSubjects` are exported from `@prisma/orm-toolchain/cli/control-api`.

## `applied-statement-report-verb`

`AppliedStatementReport` is now a union on `verb`. A `rename` entry keeps its `statement` as before; a `delete` or `allow` entry's `statement` is `{ kind: 'delete' | 'allow', subject }`, where `subject` is a model, a field, or `{ kind: 'storage', name }`. Code that reads `report.statement.from` or `.to` narrows on `report.verb === 'rename'` first. An exhaustive `switch` over `StatementVerb` gains `case 'delete':` and `case 'allow':`.

## `consent-errors-removed`

Remove imports of `ERROR_CODE_DESTRUCTIVE_CHANGES`, `errorDestructiveChanges`, `ERROR_CODE_CONSENT_PLAN_MISMATCH` and `errorConsentPlanMismatch` from `@prisma/orm-framework/errors/execution`; nothing raises those errors any more. Code that checks a `db update` failure for `code === 'DESTRUCTIVE_CHANGES'` or `'CONSENT_PLAN_MISMATCH'`, or reads `failure.destructiveChanges` or `failure.consentPlanMismatch`, handles `CLI.CONSENT_REQUIRED` from the CLI instead, or, through the control API, the refusal its own `answerQuestions` throws. A script that matches `MIGRATION.DESTRUCTIVE_CHANGES`, `MIGRATION.CONSENT_PLAN_MISMATCH`, `CLI.CONSENT_TOKEN_UNRESOLVED` or `CLI.CONSENT_OPERATIONS_MISSING` in CLI output matches `CLI.CONSENT_REQUIRED` instead.
