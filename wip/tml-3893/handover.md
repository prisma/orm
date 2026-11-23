# Handover: a statement sent on a single-connection Postgres client must wait for an open transaction to end (TML-3893)

Written on 2026-11-24 by the agent session morpheus-11, which stopped because of a rate limit. You are taking over the whole piece of work. Read this file, then `spec.md` and `plan.md` beside it.

## Where things stand

**The design is written and reviewed. Nothing is built. Will has not said "build it".** Do not create the implementation branch, write code, or dispatch an implementer until he says so. He stopped the previous session twice for trying.

One point is still open with Will: whether the wait belongs in the driver or the runtime (see "The open point"). Your first message to him should say you have taken over, state that point in two or three plain sentences, and ask whether to build.

## How to get the files

The spec, plan, both reviews and this file are on the branch `tml-3893-handover`, pushed to the `bot` remote (`git@github-wmadden-electric:prisma/prisma.git`). There is no pull request for it and there must never be one: it holds working files only. In your worktree:

```bash
git fetch bot tml-3893-handover
git checkout bot/tml-3893-handover -- wip/tml-3893
git reset -q wip/tml-3893
```

That puts the files at `wip/tml-3893/`, which is ignored through `.git/info/exclude`, so they stay out of your commits. The paths inside the spec and plan then work as written.

| File | What it is |
| --- | --- |
| `wip/tml-3893/spec.md` | The slice spec: terms, the defect, the decided design, scope, documents to change, every test (sections A to F), edge cases, done conditions. |
| `wip/tml-3893/plan.md` | Four dispatches for implementers, the rules for every brief, and the steps after them up to the pull request. |
| `wip/tml-3893/reviews/system-design-review.md` | Architect review of the first spec, 12 findings. All are folded into the spec. |
| `wip/tml-3893/reviews/engineering-review.md` | Engineering review, 20 findings, with line references and a sketch of the fix. All are folded into the spec. |

Transcript of the previous session, for anything this file leaves out (it is outside your worktree; ask Will before reading it if your worktree boundary forbids that):

`/Users/wmadden/.claude/projects/-Users-wmadden-Projects-prisma-orm--claude-worktrees-postgres-serverless-transaction-query-516034/55e1f151-343e-4f6d-82d3-622ffc112747.jsonl`

Linear: [TML-3893](https://linear.app/prisma-company/issue/TML-3893/postgres-serverless-client-a-query-sent-outside-an-open-transaction) is the defect. TML-3899 is the deferred follow-up (see "What was ruled out").

## The defect

Some Postgres clients have exactly one database connection: `postgresServerless().connect({ url })`, `postgres({ pg: client })` with a `pg.Client`, and `postgres({ binding: { kind: 'pgClient', client } })`. All three use the driver class `PostgresDirectDriverImpl` in `packages/3-targets/postgres/3-driver/src/postgres-driver.ts`.

On these clients, a statement sent on the client (`db.query(...)`) while a transaction is open on the same client is sent on the transaction's connection. So it runs inside the transaction. If the transaction rolls back, the statement's write is lost without an error. If the transaction has already failed, the statement fails with Postgres error 25P02. It can also read rows that are never committed.

Will's requirement, in his words: all clients must run this successfully.

```ts
await Promise.all([
  db.transaction(async (tx) => {
    await tx.query(insertUser);
  }),
  db.query(selectOrders),
]);
```

Pooled clients (`postgres({ url })`, `postgres({ pg: pool })`, `supabase()`, `mysql()`, MariaDB) already do: the second statement gets its own connection. It was reproduced on 8.0.0-rc.23 and the code path was unchanged on `main` at `2681eb45de`.

## The decided design

1. **The statement on the client waits** until the transaction, or any held connection, is released. Then it runs. Nothing is rejected. Will agreed to waiting over rejecting after a survey of other libraries: waiting is what Kysely (SQLite, PGlite), postgres.js with `max: 1`, Go's `database/sql` and the Prisma 7 libSQL adapter do; none rejects a statement because a transaction is open.
2. **A known consequence, accepted by Will:** code that awaits `db.query(...)` inside the transaction callback never finishes on a single-connection client. No detection, no timeout. It is documented. His words: "it's a miracle if code in this state works today".
3. **The wait is in the driver.** The driver already has a first-in-first-out lock that `acquireConnection()` and `close()` take (the spec calls it the lease). Today, statements sent straight to the driver do not take it. The fix: `acquireClient()` takes it and `releaseClient()` releases it. `acquireConnection()` must use a private step that does not take it a second time, because the lock is not re-entrant. The lock is released on any failure after it is taken.
4. **The runtime needs one change too.** The SQL runtime reads the contract marker once, on the first statement, and shares that pending read between all statements (`setupDriverExecution` in `packages/2-sql-family/5-runtime/src/sql-runtime.ts`). With the driver fix alone, the `Promise.all` example hangs on every new connection: the transaction's first statement waits for a marker read that is itself waiting for the transaction. The rule: a statement on a held connection or transaction never awaits a marker read that is pending on the driver; it runs its own read on its own connection. This goes in before the driver change.
5. **The rule is stated on the `SqlDriver` interface** as a doc comment (`packages/2-sql-family/4-lanes/relational-core/src/ast/driver-types.ts`), and in the Adapters & Targets subsystem doc.
6. **A new decision record** is written; the record on the serverless connection's query interface (ADR 263) and the record on the activity tree (ADR 271) get status lines pointing to it. Pick the number after checking `main` and open pull requests, because numbers have clashed before.
7. Nothing in `packages/1-framework` changes. If the work seems to need that, stop and tell Will.

## The open point

Will said: "I'm not really convinced this is a driver concern. it seems like a runtime concern to me. evaluate". The previous session evaluated and kept the wait in the driver, for these reasons:

- The driver already chooses which connection each statement uses. A single-connection driver is a pool of one, and a pool makes callers wait.
- The rule must hold for every caller of the driver, not only our runtime, and several runtimes can share one driver.
- A lock in the runtime would be a second queue beside the driver's.

What supports his view: Kysely does this in its runtime layer; a runtime could cancel a waiting statement on abort; a future single-connection driver would get it free. The cost of moving it: a new property on the SQL driver interface, a runtime lock that replaces the driver's, and no protection when two runtimes share a driver.

Will replied "this sounds good but i don't fully understand" and asked whether the driver hands the runtime a connection that the runtime assumes it alone uses. The answer given: the runtime sends a statement either through a connection it holds or straight to the driver; the single-connection driver breaks the assumption by sending both on one socket; the fix makes the driver path wait. He has not replied since. If he prefers the runtime, rewrite the spec and plan before building.

## What was ruled out

- **Rejecting the statement.** A statement that only happens to overlap a transaction, as in the `Promise.all` example, would fail by timing.
- **`AsyncLocalStorage` to find statements sent from inside the callback.** Will objected strongly; do not propose it again.
- **Detecting `db.query` inside the callback through the promises `tx` returns.** An experiment showed it catches a call on the callback's first line and directly after `await tx.query()`, and misses the rest. Will chose not to spend time on it now. The full design is in TML-3899 (Backlog, Low).
- **A default transaction timeout, or cancelling a waiting statement.** Not filed. Raise them only if Will asks.

## Out of scope, to be filed as tickets when the work is done

Search Linear first; another project may own them.

- SQLite: a write on the client beside an open transaction. Predicted, not yet run: the event loop stalls for 5 seconds, then "database is locked". The first dispatch runs it once to confirm.
- A connection released with its transaction still open. The pool driver has the same gap.

## What comes next, once Will says build

Follow `plan.md`. In short: (1) tests that show the defect on every client, no production code; (2) the marker read in the runtime; (3) the driver fix, including four existing driver tests that hang or assert the defect and must be rewritten; (4) documents and upgrade instructions. A reviewer checks each dispatch. Then file the two tickets, run `/drive-code-review` without the walkthrough on the tip, merge `origin/main`, do the manual check, walk the definition of done, and open one pull request titled `TML-3893: <what a user can now do>`.

## Facts that cost time to learn

- `db.query()` is lazy. Start it with `.toArray()`, and collect results with `Promise.allSettled`.
- `SELECT 1 / 0` is not an error on MySQL, MariaDB or SQLite. Use another failing statement there.
- Packages outside the driver load it from `dist`. Run a full `pnpm build` after any driver or runtime change, before running facade, Supabase, integration or example tests.
- `createDevDatabase()` is PGlite, and it queues other connections during a transaction.
- MySQL and MariaDB live tests skip without `MYSQL_URL` and `MARIADB_URL`. Report them as "not run", never as passed.
- Coverage thresholds are applied when vitest runs from the repository root, not from inside the package.
- In zsh, `--include=*.test.ts` and `**` fail as globs. Use `git grep` or `find`.

## Working rules Will has set

Your own instructions carry most of these. The ones that bit this session:

- Read the design docs before giving any design opinion, and say what you read. Explain with concrete code examples; a dense explanation got "i don't know what the fuck you're talking abotu".
- Agreement is not a go. Build only when Will says to.
- Never run a whole test suite on his machine. Run test files by path, plus typecheck and lint. Put this in every brief.
- Run `node` and `pnpm` through `mise exec --`. Never `npx`.
- Subagents: reviewers on Opus at high effort, implementers on Opus at medium. Every brief says: no "Co-Authored-By" or "Generated with" lines.
- Commit as the bot with `git commit -s --trailer "Signed-off-by: Will Madden <madden@prisma.io>"`, staging files by name. Push only through the `bot` remote. Never amend, rebase, squash or force-push.
- No questions through any question box or card. One question per message, in plain text.

## Other sessions

The release coordinator session (dali-19) asked on 2026-11-24 whether this work affects that day's release. Answer given: no dependency, no engine change, nothing to do after; the release still has the defect on single-connection Postgres clients.
