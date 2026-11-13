# Handover — MySQL proof of concept (2026-11-13)

Written by `donatello-73` on 2026-11-11 before a rate limit, and updated by `aida-20` on 2026-11-13 after Will revised the 6b-1 design. Give this file to the next agent. It covers the whole project. It replaces the handover of 2026-10-30.

## Start here

1. **Branch:** `tml-3697-per-relation-includes`, pushed to the `bot` remote (`git@github-wmadden-electric:prisma/orm.git`). It is `main` plus the docs for slice 6b-1. No PR yet. Check out a fresh worktree on it.
2. **Read, in order:**
   - this file;
   - `projects/mysql-poc/slices/mariadb-runtime/include-loading-design.md` — the approved design you build next;
   - `projects/mysql-poc/slices/mariadb-runtime/spec.md` — slice 6b (split into 6b-1 and 6b-2);
   - `projects/mysql-poc/{spec.md,plan.md,design-notes.md,coupling.md,deferred.md}` — the project;
   - `projects/mysql-poc/research/` — the research and design reviews behind 6b (copied from gitignored folders so a fresh worktree has them).
3. **Transcript of the session that wrote this** (read it for the reasoning and Will's rulings; it was summarised once near the start): `/Users/wmadden/.claude/projects/-Users-wmadden-Projects-prisma-orm--claude-worktrees-mysql-poc-handover-930c2f/afcd4df1-a0a9-414e-b93a-b28c379d17ed.jsonl`. List Will's own messages with `jq -r 'select(.type=="user" and (.message.content|type=="string")) | .message.content' <file> | grep -v '^<'`.
4. **Earlier transcripts** (other macOS user `will`; Will grants read access with a `chmod +a` command if needed): `/Users/will/.claude/projects/-Users-will-Projects-prisma-orm--claude-worktrees-mysql-poc-handover-0df1b0/8a87e94d-b65f-489f-8c2e-d8a8b518fd42.jsonl` and `/Users/will/.claude/projects/-Users-will-Projects-prisma-orm--claude-worktrees-mysql-orm-poc-47bed5/fe43d629-f245-4e4b-9335-64412e80b75b.jsonl`.

## What the project is

Will asked for a MySQL proof of concept in `prisma/orm` (Prisma 8, release candidate). Three aims:

- **Find every place the framework and SQL family cannot serve a database like MySQL or MariaDB, and fix it.** Will: "THIS IS THE ENTIRE REASON WE ARE DOING THIS PROJECT". `coupling.md` is the register of what was found. Answers come from reading code and probing real servers, never assumptions.
- Be the foundation of production MySQL and MariaDB support: what is built is built properly.
- One folder per database for target code (done).

It runs on the Drive process (`/drive-process`): spec, design reviews, slices built by Opus implementer subagents, `/drive-code-review` (architect and principal-engineer passes, no walkthrough), fixes, manual QA, PR. Linear project "MySQL proof of concept" (team Terminal); the open ticket is TML-3697 (MariaDB).

## Done and merged

| Slice | What | PR |
| --- | --- | --- |
| 1 | One folder per database | prisma/orm#30829 |
| 2a | MySQL target, control driver, emit, introspection | prisma/orm#30836 |
| 2b | MySQL migrations, `db verify`, `db sign` | prisma/orm#30841 |
| 2c | Public `@prisma/orm-mysql` packages; `examples/prisma-8-demo-mysql` migrates in CI | prisma/orm#30856 |
| 3 | ORM reads with includes on MySQL | prisma/orm#30863, drivers on `mariadb` #30893, #30918 |
| 4 | ORM writes without `RETURNING` on MySQL (TML-3696) | prisma/orm#30927 |
| 6a | MariaDB control plane: `mariadb` target extending MySQL, public `@prisma/orm-mariadb` and `@prisma/orm-target-mariadb`, `examples/prisma-8-demo-mariadb` migrates/verifies/signs in CI | prisma/orm#30964 (merged 2026-11-10) |

Layout after 6a: MySQL in `packages/3-targets/mysql/1-mysql/{1-target,2-adapter,3-driver,9-facade}`, MariaDB beside it in `packages/3-targets/mysql/2-mariadb/{1-target,2-adapter,3-driver,9-facade}`. The layering rule is one sentence (ADR 278, `Package-Layering.md`): **a package imports only from lower-numbered folders; numbers compare only between folders in the same parent.** It exists to prevent cycles between packages, adapting Clean Architecture. `scripts/lint-target-layering.mjs` enforces it.

6a also landed repo-wide agent guidance: `.agents/rules/running-tests.mdc` (every suite must pass, but agents run only their own packages' tests locally on the shared machine; CI runs full suites; a full `pnpm build` is fine, never partial builds), matching text in `AGENTS.md`, the Drive DoD docs and onboarding docs.

## Next: slice 6b-1, loading includes with one query per relation

**Why.** The ORM loads includes in one query: a correlated subquery aggregating child rows into JSON, reading from a derived table that refers to the outer row. MariaDB 10.11 cannot resolve that outer reference ("Unknown column"), so every row include fails on MariaDB. MariaDB also silently truncates `JSON_ARRAYAGG` (a cut on an element boundary is valid JSON with fewer rows), so no single-query rewrite is safe.

**Decision (approved by Will 2026-11-11, revised with him 2026-11-13):** when the database cannot run the one-query include correctly, the ORM loads includes per relation: parents first, then one query per relation for all parents, keyed by the parents' identity, attached in JavaScript. Everything is specified in `include-loading-design.md`; the names are final:

- the one-query include needs three capabilities: `sql.jsonAgg` (kept; MySQL gains it, Postgres also reports it under `sql`) and the new `sql.outerReferencesInDerivedTables` and `sql.jsonAggWithoutTruncation`. Postgres, SQLite and MySQL report all three; MariaDB only `jsonAgg`;
- `selectIncludeStrategy(contract): 'join' | 'query'`;
- a read with includes is a statement graph: `Find` for the parents, one new statement node per relation that reads the related rows by the parents' keys (suggested name `FindRelated`, not yet confirmed by Will), and a new node `NestJoin` beside `CrossJoin` and `UnionAll`. Writes add the same steps after their read-back step (`Find` or `FindByKeys`). `Find` itself is not changed. There is no `Preload` node;
- the folder `sql-orm-client/src/mutation-graph/` is renamed `statement-graph/`, in its own commit;
- a graph that writes no table runs without a transaction;
- `stitchKey`; chunks of at most 10 000 keys and 1 MiB of encoded keys, split by one helper shared with `FindByKeys`;
- refusals use existing codes `ORM.ROW_IDENTITY_MISSING` and `ORM.CAPABILITY_MISSING`;
- no `secondarySelectAnnotation`, and no change to the SQL runtime or its `budgets` and `lints` middleware. Completing or removing those two is stream 6, row 8 of the GA plan (branch `planning/prisma-8-ga`);
- ADR 296 and ADR 302 are reworded in the 6b-1 PR to state their motivation: do in the database what the database can do. They do not forbid this strategy (Will, 2026-11-13).

**Plan.** 6b-1 is one PR with no MariaDB code, tested by running the existing Postgres include tests a second time with both capabilities switched off through the adapter descriptor. Build it in two dispatches:

The design was reviewed against the code by an architect and a principal engineer on 2026-11-14, and their findings are folded in. Will has not yet given the go-ahead to build.

1. The folder rename, in its own commit. Then capabilities, `selectIncludeStrategy`, the graph read for every include form (design section 4's table), `NestJoin`, `stitchKey`, chunking, the transaction rule, tests. No code for 6b-1 exists yet.
2. Writes with includes, the cache key, the prepared-read refusal, the docs and the two ADRs.

Then `/drive-code-review`, fixes, a second review if fixes are substantial, manual QA, PR. Then **6b-2**: the MariaDB runtime (`mariadb()`, runtime target/adapter factories, `createMysqlClient`, a `MysqlSqlRenderer` class that MariaDB subclasses only to write `VALUES(c)` in upserts, true error messages, MySQL's ORM live tests run against both servers, the example's reads and writes). Then **close-out** (`.drive` `close-project.md`: final retro, DoD evidence, migrate long-lived decisions to ADRs, strip references to `projects/mysql-poc/`, delete it, mark the GA plan row done).

**Rejected, do not revisit** (reasons in the design's Alternatives): a single-query MariaDB include checked for truncation via a deliberate overflow error (too fragile, 2^depth cost — Will agreed); Drizzle's no-lateral mode (still correlates inside derived tables); restoring the multi-query code removed in commit `70482700f2` as it was; a `Preload` node with a separate loader for reads; `secondarySelectAnnotation`; deleting or redefining `jsonAgg`.

**Known gaps in these docs:** `research/` holds the research only, and two of its three files describe the dropped single-query design. The architect and principal-engineer design reviews were not copied. The session that revised the design (`aida-20`): `/Users/wmadden/.claude/projects/-Users-wmadden-Projects-prisma-orm--claude-worktrees-tml-3697-review-5b2f93/56ec0b86-ccb1-4c4c-a7d6-f35aacc9efb4.jsonl`.

## Will's standing instructions (in force)

- **Execution mode:** design with Will, then execute through Drive without interrupting him; his input is the design at the start and final verification at the end. Make engineering decisions yourself. Do not end reports with open-question lists. Never use the question UI; never put a question in `wrap_up`.
- **Research before talking to Will;** verify every claim in code or on a live server; answer from the repo, not conjecture. When asked for prior art, search for it.
- **Never change `packages/1-framework`.** Shared-code changes in the SQL family or ORM client are fine when the design says so; do not ask Will for permission ("Shut the fuck up about my go-ahead") — explain decisions instead.
- **No target names in shared code;** capabilities state database facts precisely (MariaDB having `JSON_ARRAYAGG` is why `jsonAgg` could not mean "the one-query include works").
- **Never say "on every target"** — capabilities exist because nothing is expected to work everywhere.
- **Read an ADR for its motivation,** not its wording. Do not report a conflict because one sentence is no longer literally true.
- **Be sceptical of any flag or parameter added to shared code for one caller** (`integerRepresentation`, `containsRawSql`, `holdMarkerLock` and `secondarySelectAnnotation` were all rejected).
- **Docs and PR descriptions:** lead with the decision and a concrete example, state the design (not requirements to reverse-engineer), name the requirements it meets, alternatives last, no counts that go stale, nothing that "adds nothing meaningful". Write for a teammate without our context. Plain English, brief; never hard-wrap markdown.
- **Don't add duplicate guidance.** When an instruction was ignored, find why (usually a conflicting doc) and fix that.
- **Copy Postgres's patterns;** no invented names (reuse code or industry vocabulary, else leave the name to Will).
- **Our code never writes a value into SQL;** the `mariadb` driver substitutes values.
- **Merge at will** once Will approves: enable auto-merge, keep every review thread resolved (the merge queue needs it), fix and re-queue if the queue drops the PR (it runs integration tests that PR CI does not).

## Rules for agents and subagents

- Subagents use model `opus`.
- Run node, pnpm and commits through `mise exec --`. Use `pnpm`, never `npm`/`npx`; a shell hook blocks command lines containing the word "npm".
- Never run whole test suites locally (`test:packages`, `test:integration`, `test:e2e`, `test:all`); run the touched test files. A full `pnpm build` at the root is fine; never build single packages. Do not run repo-wide chains after merging main; check whether the merged files touch your packages.
- Never write to `/tmp`; use `wip/` (gitignored).
- Commit with `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`. No Co-Authored-By or "Generated with Claude Code" lines. Never amend, rebase or force-push. Push only to the `bot` remote.
- PR titles: `TML-NNNN: <what a user can now do>`. PR body ends with `Agent: <name>`. Don't open PRs for small changes; they ride along in the next real PR.
- Auto-fix cannot be enabled on PRs the bot opened; Will turns it on.
- Live servers: Docker (OrbStack; `orb start` if it is not running). Use containers with unique names and ports, remove only those: `docker run -d --name <name> -p <port>:3306 -e MARIADB_ALLOW_EMPTY_ROOT_PASSWORD=1 mariadb:10.11`, or `mysql:8.4` with `MYSQL_ALLOW_EMPTY_PASSWORD=1` and `?allowPublicKeyRetrieval=true` in `MYSQL_URL`. Tests read `MYSQL_URL` and `MARIADB_URL`. Never kill processes by name.

## Open items outside 6b

- **Before the release that ships `@prisma/orm-mariadb` and `@prisma/orm-target-mariadb`:** someone must hand-publish a placeholder version of each (as `@prisma/orm-mysql` got `0.0.0-stage`) so npm trusted publishing accepts them.
- `deferred.md` lists follow-ups: splitting `returning` by statement kind, MariaDB JSON/boolean types, `tx_isolation` deprecation on MariaDB 11.1+, `target: 'mysql'` in shared error metadata (6b-2 decides), MySQL's cut-include failure surfacing as a JSON decoding error rather than a size message, TML-3777 (startup check of the database environment).
