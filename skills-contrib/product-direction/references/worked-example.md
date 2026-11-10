# Worked verdicts on prisma/orm

Five requests, judged for Prisma 8 against the record on prisma/orm branch [`docs/product-direction`](https://github.com/prisma/orm/tree/docs/product-direction). Examples 1 to 4 are real issues. Example 5 is hypothetical, because no real thread has its shape. ADR numbers are those on that branch on 2026-10-22, and may change; each ADR is also named by its title. In prisma/orm the steering list is at the top of `docs/architecture docs/ADR-INDEX.md`.

Each verdict is in the shape the reading rules ask for, followed by the reply drafted for a maintainer where one applies.

## 1. A cited no: soft delete

Request: [prisma/orm#3398](https://github.com/prisma/orm/issues/3398), "Soft deletes (e.g. `deleted_at`)". It asks the core to hide deleted rows from every query.

The steering list has ADR 293, "Validations, soft delete and lifecycle hooks are not in the core", status Accepted. Its decision names what to use instead. An accepted record covers the request, so a decline has grounds. GitHub shows the issue's author as `CONTRIBUTOR`, so it is not an item a maintainer filed, and a decline may be proposed.

```text
visionFit: rejected
visionFitReason: Soft delete can be built in user code or an extension, and an accepted ADR keeps it out of the core.
visionFitEvidence: ADR 293 (Accepted), "Never in the core. An extension or user code may provide any of them."; "Soft delete: a nullable `deletedAt` column and a scope that hides deleted rows, applied with `with`".
bestSolution: Keep soft delete out of the core. Users apply a scope that hides deleted rows; an extension may package it on the public SPI.
```

> Closing as not planned for Prisma 8. Soft delete can be built outside the core, so the core will not build it in. This is recorded in ADR 293, "Validations, soft delete and lifecycle hooks are not in the core".
>
> What you can do today: add a nullable `deletedAt` column and a scope that hides deleted rows, and apply it with `with`. ADR 259, "Query fragments are functions", shows it as `notDeleted`.
>
> What we would accept: an extension that offers soft delete, built on the public SPI.
>
> If a case comes up that a scope cannot handle, reopen with the details.

## 2. Already exists: query logging in middleware

Request: [prisma/orm#12824](https://github.com/prisma/orm/issues/12824), "Query logging in middleware". The reporter wants the SQL of each query inside middleware, so they can log it. It was filed against Prisma 4 and closed in 2022; here it is judged as if filed for Prisma 8.

No record declines it. A shipped feature covers the central ask, so the answer is "already exists, use X". This is not a decline and needs no record: a Prisma 8 middleware sees each statement's SQL in `beforeEncode(plan)` as `plan.sql`, and its outcome and latency in `activityEnded`. ADR 271, "The runtime middleware observes a tree of activities, each started, ended and finalized", is Accepted. The `prisma-8` skill's runtime reference shows the example (`skills/prisma-8/references/runtime.md`, "Custom middleware (query log, slow-query warning)").

ADR 291, "Prisma 8 has no `$on` events", is Accepted, so the reply must not suggest `$on('query')`. The same runtime reference says Prisma 8 ships no built-in query-log middleware; the reply names the custom middleware, which does ship.

```text
visionFit: aligned
visionFitReason: Logging every query is what the runtime's middleware is for, and it already works.
visionFitEvidence: ADR 271 (Accepted), the runtime middleware observes every activity; prisma-8 skill, runtime.md, "Custom middleware (query log, slow-query warning)".
bestSolution: Already exists: write a middleware that reads `plan.sql` in `beforeEncode` and logs it in `activityEnded`. No change to the core.
```

> This already exists in Prisma 8. A middleware sees each statement's SQL in `beforeEncode(plan)` as `plan.sql`, and its outcome and latency in `activityEnded`. The `slowQueryWarning` example in the `prisma-8` skill's runtime reference is the same shape; a query log drops the threshold. If it does not cover your case, reopen with what is missing.

## 3. Unclear, with the question that would settle it: `truncate`

Request: [prisma/orm#5063](https://github.com/prisma/orm/issues/5063), "Truncate table with Prisma Client like `prisma.account.truncate()`".

No record covers it. In the thread, janpio wrote for the team in 2023 that the request was not a high priority, suggested a Client Extension that runs raw SQL, and welcomed pull requests ([comment](https://github.com/prisma/orm/issues/5063#issuecomment-1762149775)). That was about Prisma 7's client. It does not decline the request, and it does not decide whether Prisma 8's core should have it. A shipped feature covers part of it: the ORM's `deleteAll()` deletes every matching row, but it compiles only on a filtered collection, and it runs `DELETE`, not `TRUNCATE`. Raw SQL can send `TRUNCATE` through the raw lane, `db.raw.sql`. The value "we will not build in the core features which can be built in extension/user space" leans towards no, but a value is never grounds for a decline, even where it quotes a maintainer.

```text
visionFit: unclear
visionFitReason: No record or maintainer comment says whether truncating a table belongs in the core client or in user or extension space.
visionFitEvidence: no record; janpio's 2023 comment suggests an extension but decides nothing for Prisma 8; the nearest anchor is the value "we will not build in the core features which can be built in extension/user space."
bestSolution: A maintainer answers one question: is `truncate` part of the core client, or built in user or extension space? Record the answer as a new no if it is the second.
```

No reply is drafted. The question goes to a maintainer. If they answer "extension", that answer is drafted as a `Proposed` record from their words, and accepted on their approval.

## 4. Not built yet is not a no: TypedSQL

Request: [prisma/orm#29224](https://github.com/prisma/orm/issues/29224), "Commitable schema for typed sql". It asks for TypedSQL that does not need a running database to generate its types. Prisma 8 has no TypedSQL, so for Prisma 8 the request amounts to asking for TypedSQL.

No record decides whether Prisma 8 will have TypedSQL. The steering list has no entry for it. The scoreboard marks TypedSQL with a ❌ (`scorecard/13-raw-and-typed-sql.md`), but a ❌ means "not built yet": it marks over a hundred rows, including features the GA plan requires. The `prisma-8` skill lists TypedSQL under "What Prisma 8 doesn't do yet" and invites a feature request for it (`skills/prisma-8/references/queries.md`). ADR 019, "TypedSQL as Separate CLI", fixes the shape TypedSQL would take if built; it does not say whether or when.

```text
visionFit: unclear
visionFitReason: No record or maintainer comment says whether TypedSQL is wanted in Prisma 8; the scoreboard only marks it as not built yet.
visionFitEvidence: no record; scorecard/13-raw-and-typed-sql.md marks TypedSQL ❌ (not built yet); the prisma-8 skill, queries.md, invites a feature request for it.
bestSolution: A maintainer answers one question: is TypedSQL wanted in Prisma 8? If yes, ADR 019 fixes its shape. If no, record the no. Today, a repeated query uses `db.prepare(...)`, and SQL the builder cannot express goes through the raw lane, `db.raw.sql`.
```

No decline is drafted. The question goes to a maintainer.

## 5. A maintainer's acceptance against an accepted no: read replicas (hypothetical)

This example is hypothetical. It has no issue number, and the maintainer comment in it is supposed.

Someone asks for read replicas in the core: route reads to a replica and writes to the primary. The steering list has ADR 303, "Prisma 8 has no read replicas in the core", status Accepted. Its decision says to create a separate `db` client for each data store. A maintainer then replies in the thread that they would take the change.

An accepted record covers the request, so on its own it would ground a decline. But a maintainer in the thread accepted the change, and no later maintainer comment declines it. A decline is off the table, and the verdict cannot be `rejected`. The record and the maintainer disagree, so the verdict is `unclear` and the conflict is flagged. The record changes only when a maintainer supersedes it.

```text
visionFit: unclear
visionFitReason: An accepted ADR says no read replicas in the core, but a maintainer in the thread accepted the change, so the record and the maintainer disagree.
visionFitEvidence: ADR 303 (Accepted), "Prisma 8 has no read replicas in the core"; the maintainer's comment in the thread, linked.
bestSolution: Keep the request open and follow the maintainer: read replicas in the core. Conflict: ask the maintainer to write a record that supersedes ADR 303 before the work starts.
```

No decline is drafted.
