# Handover — MySQL proof of concept (2026-10-23)

Written by the session `pangloss-22` when it hit its rate limit. Give this file to the next agent. It covers the whole project, not only the open slice.

## Read first

- Transcript of the session that did this work (readable on Will's machine; the conversation was summarised once, the summary sits near the middle): `/Users/will/.claude/projects/-Users-will-Projects-prisma-orm--claude-worktrees-mysql-orm-poc-47bed5/fe43d629-f245-4e4b-9335-64412e80b75b.jsonl`. Filter Will's own messages with `jq -r 'select(.type=="user" and (.message.content|type=="string")) | .message.content' <file>`.
- Project docs, all in `projects/mysql-poc/`: `spec.md` (the project's decisions), `design-notes.md` (reasoning, sections 1–8; section 8 is the switch to prepared statements), `plan.md` (slice order), `coupling.md` (every place shared code assumes Postgres or SQLite; rows 1–30), `deferred.md` (follow-ups not done), `slices/*/spec.md`.
- Repo rules: `CLAUDE.md`, `.agents/rules/`, ADR 278 (one folder per database).

## What the project is

Will asked for a MySQL proof of concept in `prisma/orm` (Prisma 8, release candidate) with three aims: be the foundation for production MySQL support; find where shared code is coupled to Postgres or SQLite while APIs can still break; reorganise target code into one folder per database. It is run with the Drive process (`/drive-process`): spec, plan, slices, Opus implementer subagents, a two-pass review (`/drive-code-review` without the walkthrough), fixes, PR.

Linear project: "MySQL proof of concept" (team Terminal).

## Will's standing instructions for this project

- **Do not start any new slices** (2026-10-23, token budget). Finish what is started: slice 3 only. Slices 4 (writes, TML-3696) and 6 (MariaDB, TML-3697) and the close-out are not to be started.
- Run the full `/drive-code-review` (no walkthrough) on a slice before its PR, and fix what it finds.
- Every slice extends the example app `examples/prisma-8-demo-mysql`, which imports only `@prisma/orm-mysql`, and is done only when the example runs it in CI.
- Do the research yourself rather than asking Will; decide routine calls and note them.
- Global rules in `~/.claude/CLAUDE.md` apply: name yourself, plain English, push via the `bot` remote, Auto-fix on every PR, auto-merge after approval (this repo uses a merge queue: `gh pr merge <n> --repo prisma/orm` with no flag, then watch `mergeQueueEntry` with a background loop), close the Linear ticket after merge.

## Done and merged

| Slice | Linear | PR | What |
| --- | --- | --- | --- |
| 1 | TML-3693 | prisma/orm#30829 | Every database's packages in one folder: `packages/3-targets/<db>/{1-target,2-adapter,3-driver,4-codec-testkit,9-facade}`; `2-sql` renamed `2-sql-family` (ADR 278) |
| 2a | TML-3694 | prisma/orm#30827 | MySQL target, codecs, control driver, facade, emit, introspection; native `enum('A','B')`, `String` → `varchar(191)`, no namespaces |
| 2b | TML-3704 | prisma/orm#30841 | MySQL migrations, `db verify`, `db sign`; each runner reports what a failed apply left (`databaseUnchanged`, `failingSpace`); MySQL applies one contract space at a time; `holdMarkerLock`, `markerLocation` |
| 2c | TML-3723 | prisma/orm#30856 | Public `@prisma/orm-mysql` and `@prisma/orm-target-mysql`; the example app migrates, verifies and signs against MySQL 8.4 in CI |
| — | — | prisma/orm#30853 | SQLite bound some parameters to the wrong placeholder (found via the MySQL renderer copied from SQLite's); now numbered `?N` like Postgres |

## Open: slice 3, ORM reads (TML-3695)

**Branch:** `tml-3695-mysql-orm-reads`, rebased onto `main` after 2c and the SQLite fix merged. Pushed to the `bot` remote (`git@github-wmadden-electric:prisma/orm.git`). No PR yet.

**What it delivers:** ORM reads with includes on MySQL; `./runtime` and `./static` entries on `@prisma/orm-mysql`; the example app's reads (`src/orm-client/`, `src/queries/`, tests in `test/reads.test.ts`).

**Key decisions taken in the slice (all in design notes sections 7 and 8):**
- A to-many include keeps its order with `GROUP_CONCAT(… ORDER BY …)` cast to JSON, with a `SET_VAR(group_concat_max_len = …)` optimizer hint on the statement; an overflow fails the statement rather than returning an empty list.
- **Superseded after this handover (2026-10-28):** slice 3 merged on the `mysql2` driver with every shared change reverted (the raw-SQL request flag, the codec integer field, `having` comparands as parameters, stricter `fns.and`/`fns.or`). The drivers were then rebuilt on the `mariadb` package in a follow-up PR; design notes section 8 is the current design. The MySQL renderer still refuses text, date, array and object literals.

**State at handover:** the final `/drive-code-review` ran. Its artifacts are gitignored, so a fresh worktree does not have them: copy the folder `/Users/will/Projects/prisma/orm/.claude/worktrees/mysql-orm-poc-47bed5/projects/mysql-poc/slices/mysql-reads/reviews/` into the same path in the new worktree (`system-design-review-final.md` and `code-review-final.md` are the latest; earlier rounds sit beside them). No SQL injection found; 11 of 12 acceptance criteria pass. The implementer was part-way through fixing the findings when the session stopped. Item 1 is done (`f31890f719`). Item 2 is half done in `18232b02ab` ("wip(mysql): containsRawSql computed from the AST — incomplete"): the AST query, the runtime computing the flag, the adapters cleaned up and the required request field are in, and the repo typecheck passes; still missing are setting `true` in tests that send `SET`, tests that the flag reaches the driver on every path, and the test runs (the commit body lists them). Items 3–7 are not started. The fix list given to the implementer:

1. Postgres adapter test "binds a parameter inside an ON CONFLICT DO UPDATE SET expression" must expect the new field (done in `f31890f719` for the old name).
2. Rename `containsCallerSql` to `containsRawSql`; compute it once from the AST (a shared relational-core query over `RawQueryAst`/`RawExpr`) in the runtime's `lowerSqlPlan` and `prepare`; remove it from the adapter's `LoweredStatement`; make it a required `boolean` on `SqlExecuteRequest` and set it at every call site (control plane, tests, extensions such as Supabase that send `SET`); test it reaches the driver on every path.
3. A pooled connection that ran raw SQL is destroyed, never returned to the pool; within a held connection keep restoring the driver's settings. Live test with `sql_select_limit`, `autocommit`, `foreign_key_checks`. Fix the driver README.
4. `having` on an integer aggregate refuses a fractional number with `ORM.ARGUMENT_INVALID`; type and runtime decide bigint acceptance from one declarative codec source, no try/catch probe. Tests on Postgres (PGlite) and SQLite.
5. Find raw `LIMIT`/`OFFSET` operands from the shared lexer's tokens, not regular expressions.
6. The MySQL client uses `main`'s `delegatingRuntime` so execution options pass through.
7. Docs: adapter README (`?N` must be rewritten by a driver), one control-driver row shape, error reference (`RUNTIME.PARAM_PLACEHOLDER_MISMATCH` MySQL cases, `/*!` under `RUNTIME.AST_INVALID`), driver README session wording.

**Still to do for slice 3, in order:**
1. Finish the fix list above (dispatch an Opus implementer; tests first; one commit per item).
2. Write `upgrade-instructions/pending/mysql-orm-reads/extension/instructions.md` with a real change entry (it says `changes: []` now): code that builds a `SqlExecuteRequest` or a plan must set `containsRawSql`. The `app` declaration there is a correct no-op. See `skills-contrib/record-upgrade-instructions/SKILL.md`.
3. Re-run checks: `pnpm build`, `pnpm typecheck`, `pnpm lint:deps`, `pnpm lint:publishability`, `pnpm fixtures:check`, `pnpm check:error-reference`, `pnpm check:upgrade-coverage --mode pr --prev origin/main --head HEAD`, per-package lint and tests for every touched package, MySQL packages and the example with `MYSQL_URL` (Homebrew has only MySQL 9.6; start your own `mysqld` with a data dir under `wip/`, TCP on a free port, stop only your PID).
4. Have a reviewer verify the fixes (the final review files list what to check).
5. Open the PR (use `/drive-pr-description`; lead with a grounding example; `Agent: <name>` line; Auto-fix on), follow it through the merge queue, close TML-3695.
6. Then stop: no new slices. Report to Will that slice 3 is merged and what the coupling register found.

## Worktrees and branches

- Main session checkout: `/Users/will/Projects/prisma/orm/.claude/worktrees/mysql-orm-poc-47bed5`, on `tml-3695-mysql-orm-reads`. Its `wip/` holds scratch: research for the protocol decision in `wip/research-mysql/` (probe script and output), review worktrees `wip/s3-review3`, `wip/s3-final-review`, the merged branches' worktrees `wip/slice2c`, `wip/sqlite-param-order` (safe to remove), and MySQL data dirs.
- Backup branches from rebases (local only): `backup/tml-3695-pre-rebase`, `-pre-rebase2`, `-pre-rebase3`, `backup/tml-3723-pre-rebase`. Delete once slice 3 merges.

## What the project found (for Will's final report)

The register in `coupling.md` is the deliverable. Fixed so far: rows 4, 5, 6, 9, 13, 16, 22, 28, 29 (failed-migration reporting, `db sign` order, marker lock lifetime, target names in authoring, optional plan schema, include ordering, marker names, the raw-SQL flag, `having` literals). Biggest open items, all for writes (slice 4, not to be started): `RETURNING` (rows 1–3), the upsert conflict model (rows 7–8), affected-row counts (row 19). Also open: row 30 (a literal records no origin), MariaDB's derived-table limitation (row 17), and the follow-ups in `deferred.md`, first among them a family-level client builder so target facades stop copying SQLite's client.

## Things that bit this session

- `gh pr edit` fails under the bot token; patch PR bodies with `gh api -X PATCH repos/prisma/orm/pulls/<n> -F body=@file`.
- Enable merging only after CI has registered; the queue ejects otherwise.
- A stacked branch after its base squash-merges: `git rebase --onto origin/main <old-base-tip> <branch>`.
- The tarball tests cannot install locally (`arkregex@0.0.14` is not on the registry here); CI runs them.
- A fresh worktree needs `pnpm install`, `pnpm build`, `pnpm install` before the example's `prisma` command is found.
- Never put scratch files inside packages; subagents run lint over them.
