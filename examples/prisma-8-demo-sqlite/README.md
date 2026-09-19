# Prisma 8 Demo (SQLite)

A minimal runnable demo showing how to use `@prisma/orm-sqlite`. Covers a
simple read + a relational read + a write through both the ORM client and
the SQL builder + an atomic check-then-act transaction (per-user post quota)
+ the full many-to-many ORM API (`Post ↔ Tag` via the `PostTag` junction):
include reads in both directions, `some`/`none`/`every` relation filters, and
nested `connect`/`disconnect`/`create` writes.

End-to-end SQLite coverage (codecs, runtime, migrations, ORM/SQL builder
semantics) lives in `test/e2e/framework/test/sqlite/` and the
`@prisma/orm-sqlite/orm-client` / `@prisma/orm-sqlite/builder` integration
suites — this example deliberately doesn't duplicate it.

## Setup

```bash
pnpm install
pnpm emit                              # generates src/prisma/contract.json + contract.d.ts
SQLITE_PATH=./demo.db pnpm db:init     # creates the schema
SQLITE_PATH=./demo.db pnpm seed        # inserts 2 users + 3 posts (with engagement counters) + 3 tags + junction rows
```

## Run the CLI

```bash
SQLITE_PATH=./demo.db pnpm start -- users
SQLITE_PATH=./demo.db pnpm start -- repo-user <userId>
SQLITE_PATH=./demo.db pnpm start -- repo-user-posts <userId> 5
SQLITE_PATH=./demo.db pnpm start -- repo-create-user <newId> new@example.com 'New User'
SQLITE_PATH=./demo.db pnpm start -- insert-user new2@example.com 'New User 2'
# Transaction (under quota): read count + insert atomically; prints created posts
SQLITE_PATH=./demo.db pnpm start -- add-posts <userId> 'One More'
# Transaction (over quota): QuotaExceededError rolls back; prints unchanged count
SQLITE_PATH=./demo.db pnpm start -- add-posts <userId> 'A' 'B' 'C' 'D' 'E'
# Many-to-many (ids are printed by the seed)
SQLITE_PATH=./demo.db pnpm start -- post-tags <postId>
SQLITE_PATH=./demo.db pnpm start -- tag-posts <tagId>
SQLITE_PATH=./demo.db pnpm start -- posts-with-tag-some typescript
SQLITE_PATH=./demo.db pnpm start -- posts-with-tag-none typescript
SQLITE_PATH=./demo.db pnpm start -- posts-with-tag-every typescript
SQLITE_PATH=./demo.db pnpm start -- connect-post-tags <postId> <tagId>
SQLITE_PATH=./demo.db pnpm start -- disconnect-post-tags <postId> <tagId>
SQLITE_PATH=./demo.db pnpm start -- create-post-with-tags <newPostId> <userId> 'Title' label1 label2
SQLITE_PATH=./demo.db pnpm start -- create-post-connect-tags <newPostId> <userId> 'Title' <tagId>
# Integer representations and aggregate precision
SQLITE_PATH=./demo.db pnpm start -- integer-representations
SQLITE_PATH=./demo.db pnpm start -- aggregate-precision
```

| Command | Lane | Operation |
|---------|------|-----------|
| `users` | SQL builder | `SELECT … FROM user LIMIT n` |
| `repo-user` | ORM | `db.User.first({ id })` |
| `repo-user-posts` | ORM | `db.User.include('posts', …).where({ id }).first()` (relational) |
| `repo-create-user` | ORM | `db.User.create({ … })` |
| `insert-user` | SQL builder | `INSERT INTO user … RETURNING id, email` |
| `add-posts` | ORM + SQL builder | `db.transaction()`: SQL builder `COUNT(*)` check → ORM `create()` per title |
| `post-tags` | ORM | `db.Post.include('tags', …)` — N:M include through the junction |
| `tag-posts` | ORM | `db.Tag.include('posts', …)` — the same junction, reverse direction |
| `posts-with-tag-some/none/every` | ORM | `db.Post.where((p) => p.tags.some/none/every(…))` — EXISTS through the junction |
| `connect-post-tags` | ORM | `db.Post.update({ tags: (t) => t.connect([…]) })` — junction INSERT |
| `disconnect-post-tags` | ORM | `db.Post.update({ tags: (t) => t.disconnect([…]) })` — junction DELETE |
| `create-post-with-tags` | ORM | `db.Post.create({ …, tags: (t) => t.create([…]) })` — insert targets + links |
| `create-post-connect-tags` | ORM | `db.Post.create({ …, tags: (t) => t.connect([…]) })` — connect in the create flow |
| `integer-representations` | ORM | `db.Post.select('viewCount', 'impressionCount')` — `BigIntNumber` beside `BigInt` |
| `aggregate-precision` | ORM | `count`/`sum`/`avg` beside `countBigInt`/`sumBigInt`, including the `sum` that raises |

The `add-posts` command demonstrates why an interactive transaction is necessary: the count (SQL
builder aggregate) and the inserts (ORM create) must be one atomic unit so that two concurrent
callers cannot each pass the quota check and jointly exceed it (TOCTOU). Exceeding the quota throws
`QuotaExceededError` which rolls the transaction back; the command re-reads the count to show it is
unchanged.

## Integer representations on SQLite

`Post` carries two engagement counters. Both are INTEGER columns; each reads
back as a different JavaScript value, because each chose a different
representation.

| Column | Type | Codec | Reads as |
| --- | --- | --- | --- |
| `viewCount` | `BigIntNumber` | `sqlite/bigintnumber@1` | `number`, throwing outside ±(2^53 − 1) |
| `impressionCount` | `BigInt` | `sqlite/bigint@1` | `bigint` |

SQLite declares no `UnboundedInt`: that type needs lossless unbounded integer
storage, which SQLite has not got, so the type is not on offer at all. The
PostgreSQL sibling (`examples/prisma-8-demo`) has all three.

`aggregate-precision` shows the same defaults policy PostgreSQL states, in
SQLite's terms. The seeded impressions total 2^53 + 1000, so the bare `sum`
raises rather than rounding:

```text
impressionCount — BigInt, and the total is 2^53 + 1000:
  sum('impressionCount')        refused — this is the guard working:
    RUNTIME.DECODE_FAILED: sqlite/bigintnumber@1 value must be an integer within the safe integer range, got 9007199254741992
  sumBigInt('impressionCount')  9007199254741992n (bigint)
```

There is no `avgDecimal` on a SQLite contract at all — an exact mean needs a
decimal result codec, and SQLite has none, so the method is absent from the
emitted types rather than failing at runtime.

Reference: [integer representation types](../../docs/reference/integer-representation-types.md).

The M:N relation API shown here is available because `PostTag` is a *pure* junction (its only
columns are the two foreign keys). When a junction carries a required non-FK payload column, the
relation sugar cannot populate it, so nested `create`/`connect` on that relation are disabled at
the type level (their inputs become `never`) and rejected at runtime; populate such junctions
through the junction model's own relations or the SQL builder instead. There is deliberately no
runnable example of that guard — the type-level gate makes it uncompilable.

## Key files

- `prisma/contract.ts` — TypeScript contract authoring (User + Post FK, Post ↔ Tag M:N via PostTag)
- `prisma.config.ts` — CLI config wiring SQLite target/adapter/driver
- `src/prisma/db.ts` — `sqlite()` one-liner client
- `src/orm-client/` — ORM client examples
- `src/queries/` — SQL builder examples
- `src/transactions/` — Transaction example (`db.transaction()`)
- `scripts/seed.ts` — Demo seed
