# Handover: make a pooled Prisma Postgres URL connect

Written 2026-11-20 by the agent session `charon-65`, for an agent starting in a fresh session and a fresh worktree. Nothing in this project is built yet. One decision is waiting on Will (section 5). Read sections 1 to 6 before you say anything to him.

Full transcript of the previous session, for context you cannot find here: `/Users/will/.claude/projects/-Users-will-Projects-prisma-getting-started-eval--claude-worktrees-investigate-recent-failures-bfa3c3/2706ac39-b5cc-42fe-9822-2e71255e0947.jsonl`. It is large; search it, do not read it whole.

## 1. The wider project

Will owns `prisma/getting-started-eval`, a nightly check that a new user can follow the Prisma 8 docs from an empty directory to a deployed app. The previous session investigated its failures and fixed them. All of that is merged:

- `prisma/getting-started-eval#36`: the PostgreSQL quickstart script follows the docs page's new database step.
- `prisma/getting-started-eval#37`: passwords in connection strings are hidden in result rows and transcripts.
- `prisma/composer#434`: Composer's ORM package pins moved to rc.24.

The nightlies also found one product problem in `prisma/orm`, which is this project: the Prisma CLI and runtime cannot connect with a pooled Prisma Postgres URL. That is the only open work.

Small leftovers in `getting-started-eval`, not started: the CI run image was to return to Node 22.18.0 after 2026-11-20 (check whether alchemy still refuses Node 22 before 22.22.3 first); Dependabot pull requests #33, #34 and #35 wait for Will's approval.

## 2. The problem, with measurements

With a pooled URL (`pooled.db.prisma.io`), `postgres({ url })`, `postgresServerless().connect({ url })` and the CLI all fail with "Failed to connect to upstream database. Please contact Prisma support if the problem persists."

The PostgreSQL target declares two session settings, `DateStyle=ISO` and `lc_monetary=C` (`packages/3-targets/postgres/1-target/src/core/descriptor-meta-runtime.ts`). The driver sends both as startup options on every connection it opens.

Measured against a real Prisma Postgres database on 2026-11-18 (`probe/probe*.mjs` and `.out`; the scripts read a `created.json` from `npx create-db --json`, which is not committed because it holds credentials):

- The pooled address accepts `DateStyle`, `TimeZone` and `extra_float_digits` as startup options. It refuses `lc_monetary`, `statement_timeout`, `search_path` and `lc_messages`. So `lc_monetary` alone causes the failure.
- It pools per transaction. Two clients shared one server process.
- `DateStyle` set by statement stays with the client. `lc_monetary` set by statement lands on the shared server connection and reaches other clients.
- Named prepared statements and `pg_advisory_xact_lock` work through it.
- `ALTER ROLE ... SET lc_monetary = 'C'` works over the direct address and applies to server connections opened afterwards.

`lc_monetary=C` exists only for the `money` column type: the codec reads only the `C` print form, and PostgreSQL scales a written `money` value by the locale's number of fraction digits.

## 3. The agreed design

Will agreed to this user experience on 2026-11-18. It is `design-v2.md`, section 3:

- The target stops declaring `lc_monetary`. `sessionSettings` becomes `{ DateStyle: 'ISO' }`. Nothing else in the mechanism changes.
- A pooled URL then connects through all three entry points, with no option and nothing for the user to know. Direct connections behave as today, with no extra statements.
- `money` works as today on a database whose `lc_monetary` prints the `C` form (`C`, `POSIX`, `en_US`, and Prisma Postgres). On another locale a `money` read fails with `RUNTIME.LC_MONETARY_NOT_C`, which names the setting and the fix.

Both reviewers (architect and principal engineer personas, `review-v2-*.md`) found it sound with changes. `design-v2.md` section 10 is the revised build plan. Read it with these corrections, which are newer than the document:

- **Section 10.3 item 2 (send `money` parameters in binary) cannot be built as written.** The implementer found that the codec's `toWire` output is also used for each element of a list parameter (`encodeParamValue` in `packages/2-sql-family/5-runtime/src/codecs/encoding.ts`) and for DDL literal defaults (`encodeLiteralDefault` in `packages/2-sql-family/4-lanes/relational-core/src/ast/ddl-default.ts`). A binary wire value breaks `money[]` writes and every migration with a `money` default. Doing it properly needs the SQL family's encoding to tell the codec which of the three it is encoding, which is a change to an interface every SQL target shares. Binary scalar and whole-array parameters themselves do work, on PGlite too (`probe/binary-money.out`).
- **Section 10.2 and the architect's finding 1 say to rewrite the framework's doc comment on `sessionSettings`.** Do not. The repository rule `.agents/rules/never-change-the-framework-domain.mdc` forbids it, and the comment stays true. State the rule in the PostgreSQL-side docs and the two decision records only. Touch nothing under `packages/1-framework`.
- Section 10.4 (the CLI side) stands: add `lc_monetary: 'C'` to `INTROSPECTION_OUTPUT_SETTINGS`, set `lc_monetary` locally inside the migration runner's transaction, and run introspection inside a transaction when it is not already in one. Without the first two, migrations with a `money` default fail on `de_DE`-style databases where they work today.

## 4. Designs Will rejected, and why

Do not propose these again.

1. **Retry the connection without the startup options when the server refuses them.** His rule: the code never guesses why a connection failed and never retries with different settings.
2. **Apply the settings with a statement on every connection.** It makes every direct connection pay for the pooled case.
3. **An explicit option that says the URL reaches a pooler** (`design.md`, with `review-architect.md` and `review-principal-engineer.md`). The user would have to track which environments need which option and which extra SQL.
4. **Raising the refusal with the Prisma Postgres team.** He said there is nothing to raise.

He also said: if a user runs `RESET ALL`, that is the user's problem. A facade option to turn off the client-side pool (his own idea, because a pooled URL already has a pooler) is no longer part of this fix; it is separate work, not started and not requested yet.

## 5. The decision waiting on Will

The last message to him asked this, and he has not answered:

Without binary parameters, on a database with `money` columns whose monetary locale has no or three fraction digits (for example `ja_JP`): today the forced setting keeps amounts correct. After the change, writing 1234.56 stores 1235, and filters compare in that locale's units. The first read fails loudly. If the user then sets `lc_monetary = 'C'` as the error advises, rows written in between read back 100 times too small, with no error. 39 of 350 glibc locales scale this way (`probe/all-locales.out`).

The recommendation given: ship the small fix without binary parameters, warn about exactly this in the error text and the upgrade note, and record binary `money` parameters as follow-up work. The alternative is to design the shared codec interface change first and have it reviewed.

Do not build until he answers. If you must ask again, ask it as that scenario, once, with the recommendation.

## 6. How Will wants to be worked with

These cost real anger in the previous session. They are also in his global instructions.

- Settle the design with him before spending anything: no implementer, no reviewer, no CI run. A rejected design restarts the design discussion.
- Do not hand him engineering questions. He decides what the user experiences. You decide how. When you do need him, ask one question, as a concrete scenario, with your recommendation.
- Read the design docs before any design opinion, and say what you read. The two that matter here are "ADR 254 - Data types and casts" (the Money section and the alternatives list) and "ADR 159 - Driver Terminology and Lifecycle" (a target's session settings), under `docs/architecture docs/adrs/`.
- Never state a cause you have not confirmed. The previous session described this failure wrongly three times before measuring it.
- He asked for the architect and the principal engineer to review a design before it is implemented. Reviewers run on `model: "opus", effort: "high"`; implementers on `model: "opus", effort: "medium"`.
- Plain English, short, no apologies, no question box.

## 7. State of the code

- **`prisma/orm#31081`** is open as a draft. Its remote branch `claude/pooled-url-startup-options` holds four superseded commits (tip `9bee8b8e80`): the retry design, then the statement-on-every-connection design. All of it is to be thrown away. Its title and description describe the superseded design.
- **This branch, `claude/pooled-url-design-notes`,** is `main` at `858ec6e549` plus this folder. It exists only to carry the notes. Do not merge it as it is.
- No implementation of the agreed design exists anywhere.

To continue: make a fresh worktree from the latest `main`. Build on a branch, then force-push it to `claude/pooled-url-startup-options` on the `bot` remote so #31081 becomes the new change, and rewrite its title and description. Bring this folder along if the notes should ship with the change; the repository's `projects/README.md` says a project folder is deleted when the project closes.

## 8. Build plan once Will answers

If he accepts the risk (the recommended path):

1. `sessionSettings: { DateStyle: 'ISO' }`.
2. `RUNTIME.LC_MONETARY_NOT_C` keeps its code. Rewrite its message, `why`, `fix` and doc comment to be true: the database or role prints `money` in another locale's form. The fix is `ALTER ROLE` or `ALTER DATABASE ... SET lc_monetary = 'C'`, which applies to server connections opened afterwards, or `options=-c lc_monetary=C` in the URL of a direct connection. No session `SET` advice. Do not say English locales in general work (`en_GB` prints `£`). Warn about the zero- and three-fraction-digit case from section 5.
3. The CLI side, `design-v2.md` section 10.4.
4. Tests, `design-v2.md` section 10.6, minus the binary ones. The pooler stand-in is built from `startStartupParameterRecorder` in `test/utils/src/startup-parameters.ts` and refuses a startup whose `options` name a setting outside `DateStyle`, `TimeZone`, `extra_float_digits`. The integration database is PGlite, which has only the `C` locale, so use the real locale texts in `probe/` as codec unit fixtures.
5. Docs: amend both decision records (the architect's review quotes the sentences), the driver README, `docs/reference/scalar-types.md`, `docs/reference/error-reference.md`, the target README's introspection settings section, an upgrade note, and the changelog. The rc.22 release note promised `money` "reads and writes the same value in any locale"; say that this changes. Record binary `money` parameters as work not done, with the reason in section 3. The principal engineer's finding 8 lists every test and doc that mentions `lc_monetary`; its line numbers are at commit `234d27acb2`, so find code by name.
6. Run `/drive-code-review` without the walkthrough, fix what it finds.
7. Manual check against a real pooled Prisma Postgres URL, with a second client connected: a query and a `money` round trip through `postgres({ url })`, a serverless connection, and `db verify`, `migration plan` and one migration apply through the CLI. `npx create-db --json` gives a temporary database; the pooled address is the same URL with host `pooled.db.prisma.io`. Will approved one such database on 2026-11-18; ask before creating another.
8. Rewrite the pull request, mark it ready, and follow it to merge.

If he does not accept the risk: design the SQL family encoding change first (the implementer's option: an optional codec method that encodes a whole list, plus a way for DDL literals to get text), have it reviewed by both personas, and bring him the reviewed design before building.

## 9. Repository mechanics

- Act as the `wmadden-electric` bot. Push through the `bot` remote (`git@github-wmadden-electric:prisma/orm.git`). Commit with `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`.
- Never run `pnpm test:integration`, `pnpm test:e2e` or `pnpm test:all` in full locally. Run single files. In `prisma/orm`, integration tests run in CI only in the merge queue; run them on demand with `gh workflow run integration.yml --ref <branch>`.
- `gh pr edit` fails with the bot token. Use `gh api -X PATCH repos/prisma/orm/pulls/31081`. Draft and ready are toggled with the GraphQL mutations `convertPullRequestToDraft` and `markPullRequestReadyForReview` by node id. Auto-fix is refused because the bot is the pull request's author.
- Working files go in the worktree's gitignored `wip/`, never in `/tmp`.

## 10. Files in this folder

- `design-v2.md`: the agreed design. Section 10 is the build plan, with the corrections in section 3 above.
- `review-v2-architect.md`, `review-v2-principal-engineer.md`: reviews of it.
- `design.md`, `review-architect.md`, `review-principal-engineer.md`: the rejected pooler-option design and its reviews. Background only. Section 12 of `design.md` holds the first write-up of the measurements.
- `probe/`: measurement scripts and output. `probe*.mjs` ran against real Prisma Postgres; the `locale-*` and `all-locales*` files and `binary-money.*` ran against local PostgreSQL containers.
