# ADR 247 — Whole-query raw SQL is the fragment mechanism at statement position

Status: **Accepted**

Amended: 2026-11-10 — a builder query, or a builder INSERT, UPDATE or DELETE after `.returning()`, embeds in a raw template as one statement part (see "Amendment 2026-11-10").

Related: [ADR 012 — Raw SQL escape hatch with required annotations](<./ADR 012 - Raw SQL Escape Hatch.md>) introduced raw plans as AST-less envelopes carrying `meta.annotations`. This ADR supersedes that plan-construction model: a whole-query raw statement is an AST node like any other. ADR 012's minimal annotation schema is unaffected.

## The surface

A raw statement is the same tagged template that produces raw *fragments* inside a builder query, terminated differently. From the shipped demo (`examples/prisma-8-demo/src/queries/raw-query-demo.ts`):

```ts
const user = db.sql.public.user;

const plan = db.raw.sql`
  SELECT u.id, u.email, count(p.id) AS "postCount"
  FROM "user" u
  LEFT JOIN "post" p ON p."userId" = u.id
  GROUP BY u.id, u.email
  ORDER BY count(p.id) DESC, u.email ASC
  LIMIT ${limit}
`
  .returnsRow({
    id: user.columns.id,
    email: user.columns.email,
    postCount: 'pg/int8@1',
  })
  .build();
```

`plan` is an ordinary `SqlQueryPlan<{ id: string; email: string; postCount: bigint }>`. It flows through the same lowering, guardrail, decode, and execution machinery as a builder-produced plan, because it is the same kind of value.

A statement that reports how many rows it touched terminates differently and declares nothing:

```ts
const plan = db.raw.sql`
  UPDATE "post"
  SET "viewCount" = "viewCount" + 1
  WHERE "userId" IN (SELECT id FROM "user" WHERE kind = ${kind})
`
  .affectedCount()
  .build();
```

## Decision

**1. One statement-level node, sharing the fragment representation.** `RawQueryAst` (kind `raw-query`) joins `AnyQueryAst` beside `SelectAst`, `InsertAst`, `UpdateAst`, and `DeleteAst`. It carries the same `parts` array as the expression-position `RawExpr` — literal SQL interleaved with interpolated expression nodes and `ParamRef`s — plus the result its author declared. No new query lane, no new execution surface, no second path through the runtime.

**2. The result is declared at the terminator, once.** A raw template is unfinished until it is terminated:

- `.returnsRow(rowSpec)` declares the result columns and yields a buildable that mints a row-streaming plan.
- `.affectedCount()` declares no columns and yields a buildable that mints `SqlQueryPlan<AffectedCount>` — statement statistics carrying the brand that names where they came from, and assignable to `SqlStatementStats` wherever a caller wants the plain shape.

A bare template builds nothing. The node's `result` field is the discriminator the rest of the system reads: `{ kind: 'rows', columns }` or `{ kind: 'affected-count' }`.

**3. `returns*` names what is usable where expressions go.** `.returns(codecId)` yields an expression; `.returnsRow(spec)` yields a statement that produces rows and therefore embeds in another template. `.affectedCount()` carries no prefix because it yields a plan handle and nothing else. The prefix is the reader's cue, and the type system enforces it: of the raw queries, only a row-returning one is in the interpolation union. A builder query, and a builder mutation after `.returning()`, are in it too (see "Amendment 2026-11-10").

**4. A row spec is hybrid.** Each entry is either a contract column reference — `user.columns.email`, which carries the column's codec id, its nullability, and the TypeScript type the contract resolves it to — or an explicit codec id (`'pg/int8@1'`) or `{ codecId, nullable }` descriptor for a column the contract has no name for, such as a `count(*)`. Both forms resolve through the same codec-type map the query builders read, so a mixed spec types each entry by its own form. The explicit form is structurally the contract-free lane's `ColumnDescriptor`, so a spec written against one lane reads as a spec for the other.

**5. The tag binds its context once.** `db.raw.sql` sits beside the namespace map rather than inside it. A raw statement names its own tables, so it is a peer of the table proxies, and the client composes it as its own lane. Constructing the tag binds the adapter's codec inferer and the contract. An authoring site then carries only its template, its spec, and a terminator. Nothing about codecs or plan metadata is restated per call.

## Why the fragment mechanism rather than a new surface

The fragment tag already solves the hard parts: interleaving SQL text with typed nodes, binding interpolated values as parameters rather than splicing them, and carrying a declared codec for what comes back. Statement position needs those same properties. Reusing the representation means the raw path inherits the machinery instead of duplicating it — one parts walker per target renderer serves both node kinds, one decode context builder serves projections and row specs, and a raw plan is indistinguishable from any other plan to middleware, telemetry, and the prepared-statement path.

It also settles composition for free, which a separate surface would have had to invent.

## Composition: embeddable iff row-returning

Interpolating a row-spec'd raw query into another raw template splices the inner parts into the outer parts list. Parameters keep their template order because the flattened list is the order:

```ts
const authorsWithPosts = db.raw.sql`
  SELECT p."userId" AS "userId", count(*) AS "postCount"
  FROM "post" p
  GROUP BY p."userId"
  HAVING count(*) >= ${minPosts}
`.returnsRow({
  userId: post.columns.userId,
  postCount: 'pg/int8@1',
});

const plan = db.raw.sql`
  WITH active AS (${authorsWithPosts})
  SELECT u.email, active."postCount"
  FROM active
  JOIN "user" u ON u.id = active."userId"
  ORDER BY active."postCount" DESC, u.email ASC
`
  .returnsRow({ email: user.columns.email, postCount: authorsWithPosts.returns.postCount })
  .build();
```

Two rules follow, both deliberate:

**The inner spec is discarded on splice.** The outer template declares the row it returns; the inner declaration described a statement that is now a subquery, and a subquery's columns are not the outer result. Keeping the inner spec would mean deciding how two specs merge when the outer query renames, aggregates, or drops the inner columns — a question with no answer that holds for every SQL shape. Discarding is the rule that needs no exceptions.

The author does not lose the inner declaration, though. A row-spec'd query publishes it as `.returns`, one column reference per declared key. Those references are row-spec entries like any other, so an outer spec can inherit `postCount: inner.returns.postCount` instead of restating the codec id the inner statement already named.

The runtime still discards the inner spec. Merging two specs remains the question with no general answer. What the author reuses is the declaration, at the site where the outer spec is written, so declaring a column pays for itself twice: once where the inner statement decodes, and once where the outer one composes.

**Embeddability keys on the declared result, not the statement keyword.** A mutation with `RETURNING` produces rows, so it takes a row spec and composes exactly like a `SELECT` — which is what makes data-modifying CTEs expressible:

```ts
const promoted = db.raw.sql`
  UPDATE "post"
  SET priority = 'high'
  WHERE title ILIKE ${`%${titleTerm}%`} AND priority <> 'high'
  RETURNING id, title, "userId"
`.returnsRow({
  id: post.columns.id,
  title: post.columns.title,
  userId: post.columns.userId,
});
```

A mutation without `RETURNING` terminates with `.affectedCount()`, which is a plan handle, and the type system rejects it as an interpolation. The enforcement is structural rather than a runtime check: the row-returning buildable exposes the AST accessor the splice needs, and the affected-count buildable does not.

## Responsibilities

- **Lane (`@internal/sql-relational-core`)** owns the node, the terminators, spec normalization (a bare codec id becomes `{ codecId, nullable: false }`), the splice of a raw row query, and the placement of a builder statement's AST as one part, including the runtime refusal of a mutation without `RETURNING`.
- **Contract-typed lane (`@internal/sql-builder`)** owns the lane type and its factory (`createRawLane`, which each facade composes as `db.raw`), the table proxy's `columns` accessor, the resolution of spec entries to TypeScript row types, and the mutation builders' `buildAst()` and row-returning marker.
- **Adapters** render the node by walking its parts. A string is written as is, an expression part goes through the same expression renderer that serves `RawExpr`, and a statement part goes through the adapter's own statement renderer. Each target writes its own placeholder form (`$N` for Postgres, `?N` for SQLite and MySQL).
- **Runtime** reads the node's `result` twice: where it decodes, a row spec becomes the decode context's aliases and per-column codecs; where it prepares, the declared result picks which prepared handle the statement earns. Which runtime operation a plan belongs to needs no raw-specific code — a row-returning statement is run through `runtime.query(plan)`, which streams decoded rows, and a statement declaring an affected-row count through `runtime.execute(plan)`, which resolves to `SqlStatementStats`. Guardrails run over the SQL text via `evaluateRawGuardrails`, because a raw statement has no structural shape for the AST lints to inspect.

## Result semantics

**The declared result picks the runtime operation.** A row-returning statement is run through `runtime.query(plan)` and streams rows decoded against its spec; a statement declaring an affected-row count is run through `runtime.execute(plan)`, which resolves to `SqlStatementStats`. The terminator and the operation say the same thing, so a raw statement needs no dispatch of its own — the row type each terminator mints is what tells a caller which operation its plan belongs to.

**Preparing a statement keeps that answer.** `runtime.prepare()` reads the declared result too: a rows plan prepares into a statement consumed with `prepared.query(target, params)`, and an affected-count plan into one consumed with `prepared.execute(target, params)`, resolving `SqlStatementStats`. The two prepared faces share no consumption method, so neither can be read the wrong way round, and the choice is made twice over — from the AST's declared result where the implementation is picked, and in the type where the caller's handle is named.

**`AffectedCount` is the public row type `.affectedCount()` mints**, exported from `@internal/sql-relational-core/expression`: statement statistics carrying a required unique-symbol brand. The brand, not the statistics shape, is what selects the execution face — a row spec is free to declare a column named `affectedRows`, and a plan that does so prepares as a row statement like any other. Nothing holds the brand at runtime, since the plan's row type is phantom.

**A declared column the result omits is an error.** The runtime never parses the SQL, so the spec is its only description of what comes back; a spec naming a column the statement does not return is a mismatch the caller has to see. It raises `RUNTIME.RAW_ROW_COLUMN_MISSING`, naming the column and both column lists. This is distinct from `RUNTIME.DECODE_FAILED`, which means a codec rejected a value the runtime did expect.

**A result column the spec does not declare is dropped.** Adding a column to a `SELECT *`-shaped statement, or to a `RETURNING` list, does not break a caller who did not ask for it. Surplus columns are not decoded and do not appear in the row.

## Deliberate limitations

**Raw statement plans carry no annotations.** `.annotations()` is not part of this surface. One consequence is concrete: `evaluateRawGuardrails` reads `meta.annotations.intent` to decide whether a mutation contradicts a read-only intent, so `LINT.READ_ONLY_MUTATION` cannot fire for a raw statement plan until annotations reach it. The text-derived lints do apply: `LINT.SELECT_STAR` and `LINT.NO_LIMIT` both fire for a raw statement. `evaluateRawGuardrails` also computes an unbounded-select budget finding, but the lint middleware reads only the lints it returns, so that finding reaches no consumer — for raw statements as for any other plan the function evaluates.

**The lane is composed, not derived.** The client builds `db.raw` alongside `sql`, `runtime()` and `prepare`. It is not a key the namespace map answers, so nothing a contract declares can collide with it, and a storage namespace may be named `raw` like any other. The lane holds one key today: `sql`. That is the key an editor keys its SQL highlighting on, and the name the plans' `lane: 'raw'` already uses. Anything else raw authoring needs can join it later, without moving the address again.

## Amendment 2026-11-10: builder queries embed as statement parts

A raw template also accepts a query written with the SQL builder. A `SelectQuery` or `GroupedQuery` embeds as it is. A builder INSERT, UPDATE or DELETE embeds once `.returning()` has named at least one column. From the shipped demo (`examples/prisma-8-demo/src/queries/raw-query-demo.ts`):

```ts
const copies = post
  .innerJoin(user, (f, fns) => fns.eq(f.user.id, f.post.userId))
  .innerJoin(user.as('target'), (f, fns) => fns.eq(f.target.email, toEmail))
  .select((f, fns) => ({
    id: fns.raw`gen_random_uuid()`.returns('pg/uuid@1'),
    title: fns.raw`${titlePrefix} || ${f.post.title}`.returns('pg/text@1'),
    body: f.post.body,
    userId: f.target.id,
  }))
  .where((f, fns) => fns.eq(f.user.email, fromEmail));

const plan = db.raw.sql`
  INSERT INTO "post" (id, title, body, "userId")
  ${copies}
  RETURNING id, title, "userId"
`
  .returnsRow({
    id: post.columns.id,
    title: post.columns.title,
    userId: post.columns.userId,
  })
  .build();
```

On Postgres the plan lowers to:

```sql
INSERT INTO "post" (id, title, body, "userId")
SELECT gen_random_uuid() AS "id", $1 || "post"."title" AS "title", "post"."body" AS "body", "target"."id" AS "userId" FROM "public"."post" INNER JOIN "public"."user" ON "user"."id" = "post"."userId" INNER JOIN "public"."user" AS "target" ON "target"."email" = $3 WHERE "user"."email" = $2
RETURNING id, title, "userId"
```

The builder query's parameters take their place in template order. The two `fns.raw` fragments cover what the builder has no function for: `gen_random_uuid()` and text concatenation.

**The statement AST is one part.** The tag calls the query's `buildAst()` once and decides by the class of what comes back. A `RawQueryAst` is still flattened into the outer parts, as described under "Composition". A `SelectAst`, `InsertAst`, `UpdateAst` or `DeleteAst` is placed in the parts as one element. The parts type is `RawPart = string | AnyExpression | SelectAst | InsertAst | UpdateAst | DeleteAst`, shared by `RawExpr` and `RawQueryAst`. The node walkers handle the statement kinds: `RawQueryAst.rewrite` rewrites a statement part, so a `beforeCompile` rewriter reaches into it; `collectParamRefs` collects its parameters in place; and `RawExpr.fold` folds a select part through the folder's `select` arm and a mutation part through its `mutation` arm. Because parameters are numbered from that collection, a parameter written before, inside or after the embedded query keeps its template position.

**The adapter renders the part with no parentheses.** Each adapter renders a statement part with the renderer it uses for that statement at top level, with the same contract and placeholder numbering. It adds no parentheses and checks no column count. The author writes parentheses where SQL needs them, as with a spliced raw query: `WITH x AS (${q})` and `FROM (${q}) AS t` have them, and `INSERT INTO t (a, b) ${q}` does not. SQLite rejects a parenthesised SELECT as the source of an INSERT, so adding parentheses in the renderer would make that shape impossible.

**Why a statement part and not `SubqueryExpr`.** `SubqueryExpr` is the expression node for a scalar subquery: it is rendered in parentheses and must project exactly one column. Statement position needs neither property, and `SubqueryExpr` keeps that meaning for expression position. A flag on `SubqueryExpr` would be settable in every expression position where it has no meaning, and every consumer of `SubqueryExpr` would have to read it. A new expression kind would have to join `AnyExpression`, `ExprVisitor` and every exhaustive expression visitor, for a node that is legal only in raw parts. The statement ASTs already carry `rewrite` and `collectParamRefs`, so the walkers need one branch each.

**The row-returning rule applies to builder mutations.** "Embeddable iff row-returning" holds for builders as it does for raw queries. A mutation builder carries a type-only marker that holds its row type once `.returning()` names a column, and a type no row matches before that, so the type system rejects a mutation builder without `RETURNING` (and one whose `.returning()` lists no column) as an interpolation. The tag also refuses such a mutation at runtime with `RUNTIME.RAW_SQL_UNSUPPORTED_INTERPOLATION`, telling the author to call `.returning(...)`. A raw `.affectedCount()` query stays rejected, as before.

**The targets differ on mutation parts, and the adapters do not refuse them.** Postgres runs a data-modifying CTE, such as `WITH renamed AS (${update}) SELECT …`. SQLite's grammar allows only a SELECT in a CTE or subquery, so it rejects the statement when it runs. MySQL has no `RETURNING`, so its adapter refuses every mutation part at render time, as it refuses `RETURNING` anywhere. An adapter renders a mutation part the same way whatever surrounds it, because the author writes the surrounding SQL, and the database reports SQL it does not accept, as it does for any raw text.

**Out of scope: reusing the builder query's row in the outer spec.** A raw row query publishes its declared columns as `.returns`; a builder query has no equivalent. Its row fields carry codec ids but not the output types an outer spec entry needs. The outer `returnsRow` names its columns with contract column references (`post.columns.title`) or codec ids.

## Consequences

- A raw statement is subject to the same lints, budgets, middleware, telemetry, and abort handling as any other plan. Raw is an escape hatch from the *builder*, not from the runtime.
- `SqlQueryPlan.ast` is populated for raw plans, so every consumer that branches on `plan.ast` sees a node it can dispatch on. Any target renderer that walks `AnyQueryAst` exhaustively must handle `raw-query`.
- Column-level codec identity is resolved from the spec's codec ids, not from contract storage lookup, so a computed column decodes exactly as declared.
- Nullability in a spec is carried for the TypeScript row type. It is not enforced at decode: a `null` in a column declared non-nullable passes through, matching how the builder path treats a contract column.

## Alternatives considered

**A separate raw execution surface (a `$queryRaw`-style client method).** Rejected: it would need its own decode, guardrail, and telemetry integration, and raw plans would stop being composable with anything. Making raw a node keeps one pipeline.

**Reusing the AST-less plan shape from ADR 012.** Rejected: a plan with no AST cannot carry per-column codecs, so results come back as wire values, and nothing downstream can dispatch on what the statement is. The declared row spec is precisely the metadata an AST-less plan lacked, and once the plan carries it, it is an AST.

**Inferring the row shape by parsing the SQL.** Rejected: it puts a SQL parser in the runtime for every dialect, and it fails on exactly the statements raw exists to serve — target-specific syntax, extension operators, functions the contract has never seen. Declaring the row is a sentence the author writes once.

**A marker on the embedded query instead of discarding the inner spec.** Rejected: a cheaper marker would still leave the two-specs question open at every splice site. Discarding is the rule a reader can state in one sentence.

**Keying embeddability on the statement keyword (`SELECT` embeds, `UPDATE` does not).** Rejected: it would require classifying the SQL text, and it would be wrong — a data-modifying CTE is a legitimate and useful shape. The declared result already answers the question exactly.
