---
changes:
  - id: consent-required-output-reworded
    summary: |
      When `migration plan` or `db update` stops because a plan would lose data or change access and nobody can answer, the `CLI.CONSENT_REQUIRED` error is worded differently. Its summary says what the change would do, its `why` says which operations of the plan do it, and each next action gives what a flag means followed by the flag. A flag that named nothing gets a next action that says to remove it. The code, the exit code and the fields of `meta` (`subject`, `verbs`, `unanswered`, `unmatched`, `confirm`) do not change. The detection matches sources and scripts that match the old summary or next-action text.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs,sh,bash,yml,yaml}"
      matches:
        - 'needs a statement'
        - 'need a statement'
        - 'Run the command again with --(delete|rename|allow|convert)'
  - id: one-allow-per-model
    summary: |
      `db update` asks once per model about the operations that change who can read or write its data, so one `--allow User` allows them all, such as disabling row-level security and dropping a policy on Postgres. A second `--allow User` in the same run fails with `CLI.CONSENT_UNUSED`, and `meta.unanswered` lists one entry per model. In the control API, one `allow` statement in `statements` answers every access change of its model, and a second fails with `CLI.CONSENT_UNUSED` too, before `answerQuestions` is called. A second `delete` statement of one subject through the control API now fails with `CLI.CONSENT_UNUSED` too, where it failed with `MIGRATION.STATEMENT_ANSWERS_NO_QUESTION`. `appliedStatements` has one `allow` entry per model, whose `operationIndexes` hold every operation allowed for it, whether a flag allowed them or the database's data protection policy allowed them without asking. The detection matches a flag or statement given twice for one model, with other flags between them or not, and code that checks for `MIGRATION.STATEMENT_ANSWERS_NO_QUESTION`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs,sh,bash,yml,yaml}"
      matches:
        - "--allow[ =](\\S+)\\s(?:.*\\s)?--allow[ =]\\1(\\s|$)"
        - "'--allow',\\s*'([^']+)',\\s*(?:[^\\]]*,\\s*)?'--allow',\\s*'\\1'"
        - 'STATEMENT_ANSWERS_NO_QUESTION'
  - id: rename-to-missing-name-reworded
    summary: |
      A `--rename` whose old name is gone from the contract and whose new name the contract does not have, in the same model, enum, value object or contract, still fails with `MIGRATION.STATEMENT_UNRESOLVED` and the same `meta` (`statement`, `verb`), but its text changed. The summary no longer says `Cannot resolve statement "--rename …"`; it says `The contract has no field "Shop.nope" to rename "Shop.legacy" to.` Its `why` lists the names the contract adds, or is absent when it adds none. Its next actions say to add the name and run `prisma contract emit` (with `--to <ref>`, to run again without `--to`), and give a `--rename` to each name the contract adds, to use in place of the one given. A `--rename` to a name the contract had before the change too gets the same code and `meta`, with the summary `The contract had field "Shop.id" before this change too, so one change cannot make it the new name of "Shop.legacy".` The detection matches code that reads the old summary.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs,sh,bash,yml,yaml}"
      matches:
        - 'Cannot resolve statement'
  - id: consent-unused-reworded
    summary: |
      The CLI's own `CLI.CONSENT_UNUSED` errors are worded differently, and have no `why`. A flag given twice says `--allow User is given twice, and one is enough.`, with the next action `Remove one --allow User.`, where it said `--allow User was given, but the question about User was already answered by --allow User.` and `Give one flag per question.`. A `--delete` of a namespace whose models other flags already answered says `--delete billing does nothing: the other --delete flags already cover everything in namespace "billing".`. On the command line, when a `--delete` of a namespace or a data protection policy settles the change, a flag that names nothing says `--delete Nope names nothing whose data this change deletes.`. Through the control API, a `delete` or `allow` statement that names nothing is refused with `MIGRATION.STATEMENT_ANSWERS_NO_QUESTION`. The code and `meta` (`unused`, `asked`) do not change. The detection matches code that reads the old texts; read `meta.unused` instead.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs,sh,bash,yml,yaml}"
      matches:
        - 'was already answered by'
        - 'Give one flag per question'
  - id: plan-question-parts
    summary: |
      A `PlanQuestion` that the control API hands to `answerQuestions` no longer has `question`, its prompt text. It carries the parts the text is built from (`headline`, `subjectInList`, `operations`, `notes`, `keepDataWays`, `answers`, `alsoGiveWhenDeleted`, `effect`), and `questionText(question)` from `@prisma/orm-toolchain/cli/control-api` builds the text, with `prisma` as the name of the CLI in the commands it names unless `questionText(question, { bin })` gives another. Each of `keepDataWays` is an object: `text`, and, when they apply, `forSubject`, `textNamingSubjects` and `atPrompt`, the way as the prompt gives it. `verbs`, `forms`, `subject` and `validate` are unchanged.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?=[\s\S]*\banswerQuestions\b)[\s\S]*\.question\b'
---

# The `CLI.CONSENT_REQUIRED` output when a plan stops to ask

A script or test that reads the text of this error needs to change. Before:

```text
✘ [CLI.CONSENT_REQUIRED] "Shop.legacy" needs a statement, and the session is not interactive.
  why: Drop column "legacy" from "Store Front" would lose the values of field "Shop.legacy".
→ Run the command again with --rename Shop.legacy:Shop.rating
→ Run the command again with --delete Shop.legacy
```

After:

```text
✘ [CLI.CONSENT_REQUIRED] Removing field "Shop.legacy" would delete its values.
  why: The operation of the plan that does this: Drop column "legacy" from "Store Front".
→ If the field was renamed to "rating", keep its values: --rename Shop.legacy:Shop.rating
→ If the values can go: --delete Shop.legacy
```

In every file the detection matches, stop reading the summary or the next-action labels to find out what was asked. Read `meta.unanswered` instead: one entry per open subject, each with the `subject` a flag names and the `verbs` that answer it, so `--<verb> <subject>` answers it, and `--rename` takes `<subject>:<new name>`. One entry changes: for a model that is a variant stored in its base's table whose base the change removes too, `verbs` is now `['delete']`, where it was `['rename', 'delete']`, because such a variant cannot be renamed on its own.

# One `--allow` per model

Before, `db update` asked about each operation that changes access on its own, so disabling row-level security and dropping a policy on `User` took `--allow User --allow User`. Now it asks once about `User`, and `--allow User` once allows both. Give the flag once:

```bash
# Before
prisma db update --allow User --allow User
# After
prisma db update --allow User
```

In the control API, pass one `{ verb: 'allow', text: 'User' }` in `statements`, not one per operation.

# The prompt text of a `PlanQuestion`

An `answerQuestions` callback that read `question.question` builds the text with `questionText`:

```ts
import { questionText } from '@prisma/orm-toolchain/cli/control-api';

answerQuestions: async (questions) => {
  for (const question of questions) console.log(questionText(question, { bin: 'prisma' }));
  return questions.map(({ subject, verbs }) => ({ verb: verbs[0] ?? 'delete', text: subject }));
},
```

# A `--rename` to a name the contract does not have

A script that matched `Cannot resolve statement` to find a `--rename` whose new name is missing reads the code and `meta` instead: `MIGRATION.STATEMENT_UNRESOLVED`, with `meta.statement` the rename's text. Before:

```text
✘ [MIGRATION.STATEMENT_UNRESOLVED] Cannot resolve statement "--rename Shop.legacy:Shop.nope"
```

After:

```text
✘ [MIGRATION.STATEMENT_UNRESOLVED] The contract has no field "Shop.nope" to rename "Shop.legacy" to.
  why: The contract adds field "Shop.rating".
→ If field "Shop.legacy" was renamed to "Shop.nope", add field "Shop.nope" to the contract, run `prisma contract emit`, and run this command again.
→ If field "Shop.legacy" was renamed to "Shop.rating", use --rename Shop.legacy:Shop.rating in place of --rename Shop.legacy:Shop.nope
```

# A repeated `delete` statement through the control API

Code that passed the same `delete` statement twice in `statements` and checked for `MIGRATION.STATEMENT_ANSWERS_NO_QUESTION` checks for `CLI.CONSENT_UNUSED` instead, or passes the statement once. The call fails before `answerQuestions` is called.
