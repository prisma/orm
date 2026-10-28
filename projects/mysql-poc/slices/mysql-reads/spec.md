# Slice 3 — MySQL ORM and SQL builder reads

**Linear:** [TML-3695](https://linear.app/prisma-company/issue/TML-3695) · **Branch:** `tml-3695-mysql-orm-reads` (stacked on 2b) · **Project:** [`../../spec.md`](../../spec.md) · **Research:** `wip/slice3-research.md` (local)

## At a glance

With the project's example contract, migrated by slice 2b:

```ts
import mysql from '@internal/mysql/runtime'
import { contractFromJson } from '@internal/mysql/static'

const db = mysql({ contract: contractFromJson<Contract>(contractJson), url })

const users = await db.orm.User.where({ role: 'ADMIN' }).orderBy((u) => u.email.asc()).limit(10).all()
const withPosts = await db.orm.User.include('posts', (posts) => posts.orderBy((p) => p.title.desc())).first({ id: 1 })
const authors = await db.orm.Post.include('author').all()
const rows = await db.query(db.sql.user.select('id', 'email').where((f, fns) => fns.eq(f.role, 'ADMIN')).build())
```

Each call lowers to one MySQL statement. Related rows come back in the order the include asks for.

## Chosen design

- **Runtime plane for every MySQL package.** The adapter, driver, target and facade each get a `./runtime` entry; the facade also gets `./static` with `contractFromJson`, and a `mysql({ contract, url })` client like `sqlite(...)` and `postgres(...)`. Copy SQLite's runtime structure.
- **Lowering in the MySQL adapter.** A renderer for every AST node the ORM and SQL builder emit for reads, modelled on SQLite's: backtick quoting, `?` placeholders, `LIMIT`/`OFFSET` (a large `LIMIT` when only `OFFSET` is given), `<=>` for IS NOT DISTINCT FROM, NULLS FIRST/LAST emulated with an `x IS NULL` sort key, casts with MySQL type names, `JSON_OBJECT` for to-one includes. FULL JOIN, function sources, lock clauses and anything else MySQL can't express are refused with `RUNTIME.AST_UNSUPPORTED`, through capabilities where the ORM checks them.
- **To-many includes keep their order with `GROUP_CONCAT`.** `JSON_ARRAYAGG` has no `ORDER BY`, and MySQL ignores a derived table's `ORDER BY` when the outer query aggregates. The adapter renders a to-many include as `CAST(CONCAT('[', GROUP_CONCAT(<json object> ORDER BY … SEPARATOR ','), ']') AS JSON)`, and `COALESCE(…, JSON_ARRAY())` when there are no rows (never the string `'[]'`, which would turn nested includes into strings). The driver raises the session's `group_concat_max_len` on every connection, so an overflow fails the JSON cast, never truncating silently. If a live test shows MySQL breaks this order, stop and report: the fallback needs a shared change.
- **JSON projection per codec.** Each codec's `projectJson` writes what the driver would hand over for a row: `int`, `varchar`, `text` and `enum` pass through; `bigint` and `datetime` render as text (`CAST(x AS CHAR)`), so precision and the fraction digits match the row form.
- **Runtime driver.** A mysql2 pool and the text-protocol `query()`, reusing 2a's server-text `typeCast` and session setup (backslash escaping off, UTC, multiple statements off, and now `group_concat_max_len`), run once per connection. Rows stream through the connection; transactions use one connection; `close()` waits for streams in flight, as the Postgres driver does.
- **Marker read for the runtime.** The runtime's marker check reads the marker through the same control tables 2b writes.

## Coherence rationale

One reviewer reads this as "MySQL can read": a runtime plane and a renderer, with one design choice (the to-many order) stated up front. Writes are slice 4.

## Scope

**In:** runtime entries, the client, lowering for reads, includes (to-one, to-many, nested), JSON projection, the runtime driver, golden lowering tests, live ORM and SQL builder read tests.

**Out:** writes (slice 4); `count()` and scalar includes, which need MySQL aggregate descriptors (filed as follow-up); coupling rows 10, 11 and 26, which capabilities already handle for MySQL.

**Added 2026-10-23, when the example moved to slice 2c:** the public `@prisma/orm-mysql` package gains its `./runtime` and `./static` entries, and the example in `examples/prisma-8-demo-mysql` runs this slice's reads through them, in CI.

## Pre-investigated edge cases

| Case | Disposition |
| --- | --- |
| Outer reference inside a derived table, one and two levels out | MySQL 8.0.14+ allows it; prove both depths with live tests |
| Empty to-many include | `COALESCE(…, JSON_ARRAY())` |
| `group_concat_max_len` default is 1024 bytes | Raise it per session; an overflow fails the JSON cast |
| `bigint` beyond 2^53 inside JSON | Render as text |
| `datetime(3)` inside JSON prints 6 fraction digits | Render as text, so it matches the row form |
| The include column arriving as a binary buffer | Check live; decode as UTF-8 text if so |
| Shared code that names a target | Never add one (`no-target-branches.mdc`) |
| Destructive git operations | Forbidden without orchestrator approval |

## Done when

The At a glance calls return the expected rows against MySQL 8.4 in live tests, including a nested include and an ordered to-many include; golden tests cover every rendered node kind; and build, typecheck, lint, `lint:deps` and the changed packages' tests pass.

**Added 2026-10-23, after the reviews:** the runtime driver runs statements as server-side prepared statements with a bounded cache (design notes section 8), replacing client-side escaping.

## Changed during the slice

The reviews changed four parts of the chosen design above. Design notes sections 7 and 8 give the reasons.

- **Placeholders are numbered.** The renderer writes `?N`, N being the parameter's place in the runtime's list, not `?`.
- **The length limit is in the statement.** A statement that uses `GROUP_CONCAT` carries a `SET_VAR(group_concat_max_len = …)` optimizer hint; the driver no longer sets it for the session.
- **Values travel apart from the SQL.** The runtime driver runs every statement as a server-side prepared statement, with a bounded cache, not the text protocol. Integer parameters are written `CAST(?N AS SIGNED)`, except as `LIMIT` or `OFFSET` operands.
- **Raw SQL never leaves a setting on a shared connection.** A pooled connection that ran raw SQL is closed, not returned to the pool.

The slice also made four shared changes, each with an upgrade note in `upgrade-instructions/pending/mysql-orm-reads/`:

1. Every SQL driver request carries `containsRawSql`, computed by the runtime from the query's AST.
2. An ORM `having` comparand is a bound parameter on every target, so a fractional or out-of-range comparand against an integer aggregate now fails.
3. Codec descriptors can declare `integerRepresentation`, which the `having` comparand's type and runtime check both read.
4. `fns.and` and `fns.or` accept only `true` and `false` as raw operands.
