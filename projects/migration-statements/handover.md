# Handover — "Destructive changes need stated intent" (migration statements)

Written 2026-11-23 by the agent session named hammurabi-19, for an agent starting in a fresh session and a fresh worktree. Read this first, then the files it points to. The session's full transcript is at `/Users/wmadden/.claude/projects/-Users-wmadden-Projects-prisma-orm--claude-worktrees-migration-statements-handover-5072cc/5ce55234-e1fa-4645-8cbb-e041aa684f6e.jsonl`; read it when you need the detail behind a statement here. The auto-memory note `project-migration-statements.md` holds the project's longer history.

This file and `handover-notes/` are working material. Delete them in the pull request that finishes the next piece of work.

## What the project is for

`prisma migration plan` and `prisma db update` must never destroy or move a user's data on a guess. When a change would lose data, the command stops and the user says what they intend with a statement: `--rename old:new`, `--delete X`, `--convert X`, `--backfill X` or `--allow X`, on the command line or at a prompt in a terminal. The Linear project is "Destructive changes need stated intent" (plan issue TML-3474). The project folder is `projects/migration-statements/`: `spec.md` (purpose, requirements, Definition of Done), `plan.md`, `design-notes.md` (principles), `deferred.md` (about 90 recorded problems and decisions left for later), `storage-naming.md`, and one folder per slice under `slices/`.

## Where it stands

The table in `plan.md` is out of date. The true state on `main`:

| Piece | State |
| --- | --- |
| `--rename` for models and fields, PostgreSQL and SQLite | Merged, prisma/orm#30638 |
| Data loss refused until answered; `--delete`, `--allow`; the prompt | Merged, prisma/orm#30648 |
| `--convert` and `--backfill`, PostgreSQL and SQLite | Merged, prisma/orm#30695 |
| Renames and deletes on MongoDB | Merged, prisma/orm#30691 |
| MongoDB contracts written in TypeScript get the PSL validator | Merged, prisma/orm#30733 and #30773 |
| Remaining SQL renames and deletes (enum values, namespaces, moves, value object fields, variants) | Merged, prisma/orm#30823, #30849, #30869, #30929 |
| `--convert`, `--backfill` and value object renames on MongoDB | Merged, prisma/orm#30970 and #31061 |
| A changed `@@map`, `@map` or enum stored value is a rename with no question, PostgreSQL and SQLite (ADR 324) | Merged, prisma/orm#31088 |
| The same on MongoDB (TML-3840) | **Not started. This is the next work.** |
| The first line of the consent error in plain words (TML-3900) | Merged 2026-11-23: prisma/prisma-cli#397, #398, #399 (engine 0.10.4) and prisma/orm#31179 |
| Close-out | Not started |

Nothing of this project is open or unmerged. Branch `tml-3840-mongo-stored-name-renames` on the `bot` remote holds only this handover, on top of `main`.

## What happened in the last session, and what Will decided

Will complained on 2026-11-19 that this error was terrible user-facing output: `✖ [CLI.CONSENT_REQUIRED] "User" needs a statement, and the session is not interactive.` An earlier attempt answered that with a 6,700-line redesign he had never agreed to (prisma/orm#31147, closed), and a second attempt moved the data-loss sentence into the first line (prisma/prisma-cli#396, reverted). His words: "ALL I EVER WANTED WAS A MORE COMPREHENSIBLE FIRST LINE" and "Our errors have a consistent structure FOR A FUCKING REASON".

What is now on `main` and published:

- The first line is written by `@prisma/cli-engine` (repository prisma/prisma-cli, `packages/cli-engine/src/execution/prompts.ts`, function `consentMissing`). Both errors with the code `CLI.CONSENT_REQUIRED` open with `This command requires explicit consent, but it was not provided.` Under `--yes` they open with `This command requires explicit consent for which --yes is not sufficient.` (Will's own wording).
- The command's own sentence is in `why`, and the next-step lines give the flags. That structure is fixed: the first line says what failed, `why` gives the cause, next steps say what to do.
- The ORM pins engine 0.10.4 exactly in 33 `package.json` files. Engines 0.10.1 to 0.10.3 are superseded; nothing should pin them.
- The release across the engine, ORM, Composer and CLI is coordinated by another session (dali-19, session id `local_66917479-53fe-4e23-89a3-1e376701a4da`). It has been told the ORM is ready. Composer still needs its own move to engine 0.10.4. The CLI release pull request must pin the ORM and Composer releases together and remove the two `dev`-channel exceptions in prisma-cli `packages/cli/scripts/conformance.ts`. None of that is this project's work. Do not start a release unless Will asks.

## The next work: stored-name renames on MongoDB (TML-3840)

**Status: described to Will, not yet approved to build.** The last message to him ended "Shall I build it as described?" and he had not answered when the session ended. Ask him before building. Do not take silence, or an answer to another question, as a go.

What it builds. On MongoDB today, a user keeps `model User` and changes only `@@map("users")` to `@@map("app_users")`; the plan drops `users`, creates `app_users` and asks the user to allow the data loss. After this work the plan renames the collection and asks nothing, as PostgreSQL and SQLite already do. The same for a field's `@map` (`$rename` of the document key), a `@map` inside an embedded model (the stored key is renamed wherever the type is stored) and an enum member's stored value (replaced). It refuses the cases that would misread data, each with advice that works when followed, and `db update` copes with a collection already renamed by hand.

Where the design is. It is settled and was reviewed on 2026-11-18; do not redesign it.

- `projects/migration-statements/slices/stored-name-renames/spec.md`: the full design for both families. The MongoDB column of each table is the scope.
- `docs/architecture docs/adrs/ADR 324 - The same coordinate is the same object.md`: the decision. Its status line says MongoDB does not implement it yet; update it.
- `projects/migration-statements/storage-naming.md`: the discussion and Will's decision.
- `projects/migration-statements/slices/stored-name-renames/plan-pr1.md`: how the SQL half was split and which checks each step ran. Mirror it.
- `handover-notes/mongo-code-map.md`: a map of the MongoDB planner made for this work on 2026-11-23, with files and line numbers, what already exists, what is missing, and a proposed split into six steps.

Size. Roughly 1,500 to 2,000 lines of source in 12 to 15 files and 6,000 to 8,000 lines of tests, about two thirds of the SQL half (prisma/orm#31088). All four MongoDB operations exist already (`renameCollection`, `$rename`, `renameStoredKey`, `replaceStoredValue`); the work is in the planner. One pull request.

Things the code map found that matter:

- Models and fields on MongoDB have no list of renames that can carry "a statement or none"; about a dozen helpers read field renames straight from the statement list. This is the largest and riskiest step.
- There is no shared-collection check. `--rename` on a variant that gets its own `@@map` very likely renames the base's whole collection and takes the other models' documents with it. This was not confirmed by a test. The SQL half fixed the same defect.
- No change is needed in `packages/1-framework` outside its CLI package. If an implementer finds one, stop and tell Will.

Two things that ride along in that pull request:

1. **Delete the ORM test assertions that quote the engine's first line.** Will, 2026-11-23: "why do its tests match on CLI wording? that's fucking pointless". Twelve CLI journey files under `test/integration/test/cli-journeys/`, `packages/1-framework/3-tooling/cli/test/orm/plan-question-prompt.test.ts` and a few others assert `summary: 'This command requires explicit consent, …'`. The engine owns and tests that sentence. Remove those `summary` assertions and keep the ones on what the ORM supplies: `code`, `why`, the next actions and `meta.unanswered`. Find them with `grep -rn "requires explicit consent" test packages`.
2. **The additions from the intent audit.** `handover-notes/project-intent-audit.md` judges the project against its purpose: six ways a user's rows are still moved, stranded or left unreadable without the user saying so, nine refusals the user cannot act on, and the close-out gaps. Will said its additions "can go in the next slice". Read it, check each item against `main` (it was written on 2026-11-21), and bring Will a short proposal of which items go in before building them.

Also update `plan.md`'s table to the true state above.

## After that: close-out

Run it through `/drive-process` and read `drive/project`, `drive/retro` and the project's Definition of Done first. `plan.md` lists the steps: verify every Definition of Done item in `spec.md`, a final retro, the project ADR and amendments to ADR 001, ADR 028 and the Data Contract and Migration System subsystem docs, move long-lived docs into `docs/`, remove every reference to `projects/migration-statements/`, delete the folder. Before deleting `deferred.md`, triage its entries so the ones that matter are found later; a completed project's folder is never read again.

A restructured Migration System subsystem doc exists as commit `00e3fabf74` on branch `tml-3900-plan-stop-output` (on the `bot` and `origin` remotes; its pull request #31147 was closed). The restructure is useful for the close-out; the rest of that branch is the rejected redesign and must not be revived.

## Open questions recorded for Will, none blocking

The first three are entries in `deferred.md`, each stating both sides. The fourth is noted in the description of prisma/prisma-cli#398.

- The error suggests a rename target (`--rename Shop.legacy:Shop.rating`) while the spec says the command never guesses.
- A mistyped `--delete` subject is reported only after planning, against the spec's requirement that a bad statement is refused early.
- A rename and a backfill of the same value object field are rightly refused, with a misleading message.
- In the engine, a user who passes the wrong `--confirm` token is told consent "was not provided"; nothing names the token they passed.

Open Linear tickets in the project besides TML-3840: TML-3720, TML-3564, TML-3563, TML-3565. TML-3900 and the plan issue TML-3474 may need their status corrected.

## How Will wants this work done

These cost the last session real corrections. The reasons matter more than the rules.

- **Agree the design before building, and size the fix to the complaint.** A complaint about one sentence got a redesign nobody had agreed to. Find the exact thing that is wrong and which component owns it, say that in a few lines, and get a clear yes on what will be built.
- **When one part of a structured message is bad, rewrite that part in place.** Do not move content between the first line, `why` and the next steps, and do not drop one.
- **Do not load his machine with tests.** He runs many sessions on one laptop. On 2026-11-23 a run of 28 integration test files in one command, plus a whole package's tests, got: "ARE YOU FUCKING RUNNING ALL THE TESTS ON MY MACHINE?" Run only the one or two test files whose assertions you changed, one at a time, and let CI do the rest. Put this in every implementer and reviewer brief. Never run `pnpm test:integration`, `pnpm test:e2e` or `pnpm test:all`.
- **A pull request is a draft only while you know of a change you still intend to push.** Waiting for CI or for a confirming review is not a reason to hold it back; he could not approve one that was finished and said: "MARK THE FUCKING PR READY FOR REVIEW".
- **If you know something is wrong, fix it; do not hand it to him as a question.** The second consent error kept its old first line and was reported as an open decision: "YOU KNEW THIS AND YOU DIDN'T FIX IT?"
- **Every pull request gets a `/drive-code-review` (no walkthrough) of the commit that merges**, by reviewers who were not there, and its findings are fixed or answered. Reviewers run on Opus at high effort, implementers on Opus at medium.
- **Reports to him are short, in plain English, and readable with no other context.** Describe work by what it does, never by a ticket number or review finding alone. One question per message, in the message text.
- **Follow every pull request to merge without being asked.** Approved means auto-merge on at once. Use a background command that waits for the merge or a failed check. `gh pr view --json` has no `mergeQueueEntry` field; use `gh api graphql` for the merge queue.

## Practical notes

- Commit as the bot with `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`. Push only through the `bot` remote. No AI attribution lines anywhere. Put `Agent: <your name>` in pull request descriptions.
- Run `node` and `pnpm` through `mise exec --` in prisma/orm. A shell hook rejects any command that contains the bare name of the other Node package manager, or a direct `biome` call, even inside quoted text; write such text with the file tools.
- `gh pr edit --body-file` fails on the bot's pull requests. Use `gh api -X PATCH repos/<owner>/<repo>/pulls/<n> -F body=@file`.
- Any change to the engine's text needs an engine pull request in prisma/prisma-cli, a version bump (`pnpm bump-cli-engine-version patch`), a publish to the package registry (automatic on merge), and then a new exact pin in the ORM. `@prisma/cli-engine` is excluded from the ORM's minimum release age, so a new version installs at once. Engine changes merge before the products move by keeping the two `dev`-channel exceptions in `packages/cli/scripts/conformance.ts` in step with the engine version (prisma-cli ADR 0004).
- Upgrade notes live in `upgrade-instructions/pending/<id>/{app,extension}/instructions.md`; check them with `mise exec -- pnpm check:upgrade-coverage --mode pr`.
- CI-only checks worth running locally because they are light: `pnpm lint:ratchets`, `pnpm lint:docs`, `pnpm check:error-reference`.
