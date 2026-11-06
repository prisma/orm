# Handover — MySQL proof of concept (2026-10-30)

Written by `babayaga-71` when it hit its rate limit. Give this file to the next agent. It covers the whole project, not only the open slice. It replaces the handover of 2026-10-23.

## Read first

- **This session's transcript** (readable on Will's machine; it was summarised once, near the start): `/Users/will/.claude/projects/-Users-will-Projects-prisma-orm--claude-worktrees-mysql-poc-handover-0df1b0/8a87e94d-b65f-489f-8c2e-d8a8b518fd42.jsonl`. List Will's own messages with `jq -r 'select(.type=="user" and (.message.content|type=="string")) | .message.content' <file> | grep -v '^<'`.
- **The previous session's transcript:** `/Users/will/.claude/projects/-Users-will-Projects-prisma-orm--claude-worktrees-mysql-orm-poc-47bed5/fe43d629-f245-4e4b-9335-64412e80b75b.jsonl`.
- **Project docs** in `projects/mysql-poc/`:
  - `spec.md`: the project's decisions and non-goals.
  - `design-notes.md`: the reasoning. Section 8 is the MySQL driver as built.
  - `plan.md`: slice order.
  - `coupling.md`: every place shared code assumes Postgres or SQLite. This register is the project's deliverable.
  - `deferred.md`: follow-ups not done.
  - `slices/*/spec.md`: one spec per slice.
- **Gitignored reviews**, which a fresh worktree does not have. Copy them from this worktree, `/Users/will/Projects/prisma/orm/.claude/worktrees/mysql-poc-handover-0df1b0/`:
  - `projects/mysql-poc/slices/mysql-writes/reviews/`: four design reviews for slice 4. Read all of them before implementing.
  - `projects/mysql-poc/slices/mysql-driver-protocol/reviews/`: the protocol slice's code reviews.
  - Research and probe scripts in `wip/`: `slice4-research.md`, `slice4-probes/`, `slice4-mine/`, `slice4-design-probes/`. The research has been wrong before; verify anything you use from it.

## What the project is

Will asked for a MySQL proof of concept in `prisma/orm` (Prisma 8, release candidate). It has three aims:
- Be the foundation for production MySQL and MariaDB support. What is built is built properly.
- **Find every place the framework and SQL family cannot serve a database like MySQL, and fix it.** Will (2026-10-30): "THIS IS THE ENTIRE REASON WE ARE DOING THIS PROJECT". The answers come from reading the code and probing a real server, never from assumptions.
- Reorganise target code into one folder per database (done).

It runs on the Drive process (`/drive-process`): spec, plan, slices, Opus implementer subagents, `/drive-code-review` (architect and principal-engineer passes, no walkthrough), fixes, then a PR. Linear project: "MySQL proof of concept" (team Terminal).

## Will's standing instructions (all still in force)

- **Research before talking to Will.** Read the implementation, design docs, ADRs (in full, including Alternatives), subsystem docs and glossary, and understand the problem *before* engaging Will. Verify every claim about how code behaves in the code, with a file and line. Do not relay a subagent's or a project note's claim unverified. This session was corrected for exactly this twice.
- **Raise to Will** any change to `packages/1-framework` or `packages/2-sql-family`, and any real ambiguity. Do not ask him implementation details.
- **Copy the Postgres target's patterns.** No new designs where Postgres already solved the problem. A MySQL difference must be one MySQL forces, with evidence.
- **Be skeptical of new fields, flags, options and capabilities on shared types.** Each one starts as "reject" until the ADRs show no existing concept covers it.
- **Run an architect and principal-engineer design review before implementing a design**, not only a code review after.
- **Our code never writes a value into SQL; the driver library may.** The MySQL driver uses `mariadb`'s own `query(sql, values)` substitution, one round trip per statement. Nothing is prepared.
- **A driver satisfies the driver interface.** Rows come back as the server's text, bytes or null. Configure the library; never widen codecs to library types.
- **Every slice extends the example app** `examples/prisma-8-demo-mysql`, which imports only `@prisma/orm-mysql`. A slice is done only when the example runs it in CI.
- **Global rules in `~/.claude/CLAUDE.md`:**
  - Name yourself, and write plain English.
  - Commit with two sign-offs. Push via the `bot` remote (`git@github-wmadden-electric:prisma/orm.git`), never `origin`.
  - Turn on Auto-fix on every PR, and auto-merge after approval.
  - This repo has a merge queue. Watch a queued PR with a background loop over the GraphQL `mergeQueueEntry`; `gh pr view` has no such field.
  - Close the Linear ticket after merge.
- **Subagents use model `opus`.**

## Done and merged

| Work | Linear | PR |
| --- | --- | --- |
| One folder per database | TML-3693 | prisma/orm#30829 |
| MySQL target, control driver, emit, introspection | TML-3694 | prisma/orm#30836 |
| MySQL migrations, `db verify`, `db sign` | TML-3704 | prisma/orm#30841 |
| Public packages; the example migrates in CI | TML-3723 | prisma/orm#30856 |
| ORM reads with includes (on `mysql2`) | TML-3695 (closed) | prisma/orm#30863 |
| Drivers on `mariadb`, copying the Postgres driver's patterns | — | prisma/orm#30893 |
| One round trip per statement, library substitutes values; driver README "Environment requirements"; ADR 155 rewritten: a driver takes SQL and parameters separately and delivers them however it chooses | — | prisma/orm#30918 |

Filed, not started: **TML-3777**, a startup or deploy-time check that the database meets the driver's environment requirements. Will called it the ideal next step for the driver, but not required now.

## Open: slice 4, ORM writes (TML-3696)

**Branch:** `tml-3696-mysql-orm-writes`, from `main` after #30918, pushed to `bot`. No PR.

**Spec:** `projects/mysql-poc/slices/mysql-writes/spec.md`. Its decisions are settled with Will on 2026-10-30; do not reopen them:
1. **`insertId` on `SqlStatementStats`.** It is the generated value as decimal text, set only when exactly one row was inserted.
   - MySQL fills it from `mariadb`'s `insertId`. SQLite fills it only when `changes` is 1. Postgres leaves it out.
   - The ORM reads it only when it needs a key the caller did not supply, decodes it with the column's codec, and fails inside the transaction when it is absent.
   - No framework change. Both reviews rejected a family-typed framework result: an optional value still type-checks when dropped, and ADR 271 rejected generic client result types.
2. **New capability `sql.insertOnConflictTarget`**: a conflict clause applies only to the columns it names. Postgres and SQLite report it, MySQL does not.
   - Without it, upsert is allowed only when no other unique key can collide.
   - The ORM sends no conflict columns, and the MySQL renderer refuses named ones.
   - The upsert read-back fails and rolls back if it finds no row. That covers unique indexes missing from the contract.
3. **A row-returning `createAll` with generated keys is refused on MySQL**, decided from the contract.
4. **No row lock.** `updateAll` and `deleteAll` write with the caller's filter, as Postgres does. Pre-selected ids are used only for the read-back, as an `IN` list.
5. **`onConflict: 'skip'` is refused on MySQL.** Recorded in `deferred.md`.
6. **MySQL sessions run at READ COMMITTED**, a target session setting. Transaction isolation controls are on the roadmap.

Also from the reviews: when the `returning` capability is off, the ORM chooses its strategy per ADR 164 and reads written rows back by identity. ADR 164 already permits this.

**Committed so far** (oldest first, after the spec commits):
- `97bbf0ab43`: the first `lastInsertId`. `e97a83de57` reworked it into `insertId` as decimal text. Check that nothing of the first version is left.
- `a996fac826`: the `insertOnConflictTarget` capability in the Postgres and SQLite adapters. Check that the emitted fixtures and the capabilities reference were updated (`pnpm fixtures:check`).
- `2435d669f6`: a work-in-progress MySQL renderer for insert, update, delete and upsert. Unfinished.
- `d84bfb66a9`: READ COMMITTED session setting.
- `b959d9ef5a`: the renderer refuses an upsert that names conflict columns. The test update for this was in progress when the session stopped.

**Still to do:**
- Finish and test the renderer.
- The SQLite driver's `insertId`.
- The ORM fallback strategies, the upsert check and read-back, the `createAll` refusal and the skip refusal.
- Tests:
  - SQLite runs with `returning` off, using an emitted contract, not a patched one;
  - live MySQL tests, including concurrency;
  - a middleware that intercepts an insert.
- The example app writes.
- Update `coupling.md` rows 1, 2, 3, 7, 8, 18 and 19, `plan.md`, and the READMEs.
- Run `/drive-code-review`, fix, then open the PR.

Will has not yet said whether to open new PRs while others await review. Check `gh pr list --author wmadden-electric` first.

## After slice 4

- **Slice 6, MariaDB (TML-3697).**
  - It subclasses the MySQL target.
  - MariaDB has `RETURNING` on insert and delete but not update, so the `returning` capability will need splitting by statement kind.
  - MariaDB writes `VALUES(c)` where MySQL writes `AS new`.
  - The example app runs against MariaDB.
- **Close-out.** Report what `coupling.md` found, and migrate long-lived docs.
- **Approved but held:** one SQL-family method that locks the database marker, implemented as a transaction where possible. Errors originate in the adapter, with no table names in framework errors.

## Local MySQL for tests

Homebrew has MySQL 9.6 only. Start your own server with a data directory under `wip/`:

```bash
W=$PWD/wip; mkdir -p $W/logs; mysqld --initialize-insecure --datadir=$W/mysql-data
(mysqld --datadir=$W/mysql-data --port=3362 --bind-address=127.0.0.1 --socket=$W/my.sock --pid-file=$W/my.pid --mysqlx=OFF > $W/logs/mysqld.log 2>&1 &)
```

Then set `MYSQL_URL='mysql://root@127.0.0.1:3362/'`. Stop it with `kill $(cat wip/my.pid)`, never by name. CI runs MySQL 8.4 with `?allowPublicKeyRetrieval=true` in `MYSQL_URL`.
