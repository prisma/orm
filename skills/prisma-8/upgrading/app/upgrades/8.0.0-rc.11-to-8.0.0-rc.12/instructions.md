---
from: 8.0.0-rc.11
to: 8.0.0-rc.12
# The Prisma 7 contract source PR adds the `examples/prisma7-adoption` example and the
# `prisma7Schema` config surface. Additive; nothing for a Prisma 8 user to translate.
# contract.d.ts now orders every collection the way contract.json does; a re-emit reorders, nothing else.
changes:
  - id: params-only-sql-facade-prepare
    summary: Replace injected SQL-builder preparation callbacks with params-only callbacks and lexical facade SQL access.
  - id: postgres-target-owned-list-framing
    summary: |
      PostgreSQL list result decoding is target-owned; direct driver reads now expose raw array literals, and fixed-scale numeric arrays return database-normalized decimal text such as `"1.5000000000"`.
  - id: psl-number-defaults-keep-digits
    summary: |
      A PSL number `@default` on a `Decimal` or `Numeric` column now emits as decimal text with every digit (`"10"`, `"1.50"`) instead of a JSON number. Re-emitting such a contract changes its storage hash, so re-sign databases signed with the old contract. `BigInt` and `UnboundedInt` defaults beyond 2^53 now emit, and `contract infer` prints such `BigInt` defaults as plain numbers.
    detection:
      glob: "**/*.prisma"
      regex:
        - '@default\(\[?-?(\d|NaN|Infinity)'
---

## `params-only-sql-facade-prepare`

Find calls to `prepare(declaration, callback)` on clients created by the Postgres or SQLite facade (`@prisma/orm-postgres/runtime`, `@prisma/orm-sqlite/runtime`, or their `@internal/postgres/runtime` and `@internal/sqlite/runtime` counterparts). Resolve the receiver and callback rather than rewriting every method named `prepare`: native SQLite `database.prepare(sql)` and SQL runtime's existing params-only preparation are different APIs and must remain unchanged.

Change callbacks from `(sql, params) => ...` to `(params) => ...`. Replace references bound to the removed `sql` callback argument with the same facade receiver's lexical `.sql` property. Preserve the params argument's name, declaration, SQL chain, row selection, filters and invocation target/options. For extracted callbacks, capture the same client in the enclosing scope; do not capture an invocation target or evaluate the callback twice. Update explicit callback type annotations to accept only the placeholder-params argument.

```ts
// Before
const query = await db.prepare({ id: 'pg/int4@1' }, (sql, params) =>
  sql.public.users.select('id').where((f, fns) => fns.eq(f.id, params.id)).build(),
);

// After
const query = await db.prepare({ id: 'pg/int4@1' }, (params) =>
  db.sql.public.users.select('id').where((f, fns) => fns.eq(f.id, params.id)).build(),
);
```

Apply the same translation to SQLite's flat SQL facade (`sql.users` becomes `db.sql.users`), retaining its existing codec ids. Keep `.query(target, params, options?)` and SQL statistics `.execute(target, params, options?)` calls unchanged. Do not rewrite historical release notes, applied upgrade recipes, generated contracts or tests as part of this source translation.

## `postgres-target-owned-list-framing`

Review application code and snapshots that assert exact PostgreSQL list result spellings. Ordinary Prisma Next runtime reads still return JavaScript arrays, and builtin and enum lists now use the same raw-text-to-element-codec path. If you assert `Decimal[]` / `numeric[]` strings for fixed-scale columns, update those expectations to PostgreSQL's database-normalized scale: a `numeric(30,10)[]` element inserted as `1.5` reads as `"1.5000000000"`; scalar numeric decoding already follows this text-preserving policy. If you use lower-level Postgres driver direct-query rows, parse raw PostgreSQL array literal strings such as `'{a,b}'` instead of expecting registered builtin arrays to arrive as JavaScript arrays. Do not re-emit contracts solely for this change: codec ids, `typeParams`, and `CodecRef.many` stay unchanged.

## `psl-number-defaults-keep-digits`

In every PSL schema matched by `detection`, look for number defaults on fields typed `Decimal`, `Numeric`, `Numeric(...)`, or a `types {}` alias of one of them, including list fields. If there are none, this entry changes nothing. The schema itself needs no edit.

Before you re-emit: if a database was signed with a contract holding such a default with more digits than a JavaScript number holds (for example `12345678901234567890.123456789`), `db verify` and `db sign` report a default mismatch on that column.

Run the project's emit command (`prisma contract emit`, or the project's `contract:emit` script). In `contract.json`, each such default becomes decimal text: `@default(10)` becomes `"10"`, `@default(1.50)` becomes `"1.50"`, `@default(007)` becomes `"7"`, `@default(-0)` becomes `"0"`, a long value keeps every digit, and `@default(NaN)` becomes `"NaN"` instead of `null`. The storage hash changes. The column default in the database does not, so no migration is needed.

Then run `prisma db sign` against the regenerated contract for every database signed with the old one. Until you do, `db verify` reports a hash mismatch and the application logs `CONTRACT.MARKER_MISMATCH`.

`db init` can now create these defaults; before, it failed with `pg/numeric@1 database JSON value must be a decimal string`. `BigInt` and `UnboundedInt` defaults within ±(2^53 − 1) emit exactly as before. Larger ones now emit instead of failing, and `contract infer` prints such `BigInt` defaults as plain numbers instead of `dbgenerated(...)`.
