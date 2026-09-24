---
# The Prisma 7 contract source adds `prisma7Schema` and the `examples/prisma7-adoption` example.
# The surface itself is new, so there is nothing to translate for it; the entries below cover the
# changes it made to paths every Postgres project already uses.
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
  - id: postgres-verify-reads-more-default-spellings
    summary: |
      `db verify` now reads negative and cast numerals, enum literals cast to a type in another schema, zoneless `timestamp` literals, and `ARRAY[...]` list defaults as the values they are. Columns previously reported as drift verify clean; no contract or database change is needed.
  - id: postgres-introspection-pinned-session
    summary: |
      Introspection now reads defaults, check constraints, index predicates, and policy text with `TimeZone = UTC`, `DateStyle = ISO, MDY`, and `IntervalStyle = postgres`, restoring the caller's settings. A contract inferred earlier from a server outside UTC that holds a `timestamptz` constant in such text shows that text once as a difference.
  - id: contract-infer-prints-emittable-defaults
    summary: |
      `contract infer` now prints each column default in the form `contract emit` accepts: decimal text in quotes for `Decimal` and `Numeric`, plain digits for a large `BigInt`, and `dbgenerated(...)` for a list default holding a `NULL` element.
  - id: source-load-failure-carries-diagnostics
    summary: |
      A contract source that fails to load now reports each finding in a `diagnostics` array on `CONTRACT.SOURCE_LOAD_FAILED`, alongside the existing `meta.diagnostics` and `meta.issues`.
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

## `postgres-verify-reads-more-default-spellings`

No code or schema edit. Run `prisma db verify` once against each Postgres database and read the result.

Postgres prints a column default in spellings the reader did not all recognise. It now reads a negative or cast numeral (`'-1'::integer`, `(5)::smallint`) as the number, an enum literal cast to a type in another schema (`'confidential'::auth.oauth_client_type`) as the enum value, a zoneless `timestamp` literal as that timestamp, and an `ARRAY[...]` default of text, boolean, integer, bigint, float, decimal, timestamp, or enum elements — with the casts Postgres prints, and an empty `VARCHAR(n)[]` — as the list. An element that is an expression or a function call still stays a raw expression.

The effect is one-way: columns that were reported as drift on these spellings now report nothing. No column that verified before starts failing. If a test pins the exact findings `db verify` returns for such a column, remove that expectation rather than adjusting it.

The same rendering is now used when planning a migration, so a list literal default is written with its cast (`ARRAY['1', '-2']::int8[]`). Update snapshots of planned DDL that hold the uncast form.

## `postgres-introspection-pinned-session`

No code or schema edit. This matters only if you have a committed contract that was inferred from a server whose session time zone was not UTC.

Every introspection read now runs with `TimeZone = UTC`, `DateStyle = ISO, MDY`, and `IntervalStyle = postgres`, and the caller's settings are restored afterwards, so the text read back no longer depends on the server, the role, or the caller. Postgres prints a `timestamptz` constant in the session time zone, so a check constraint or index predicate whose text contains one was recorded in that server's zone.

Run `prisma db verify`. If a check constraint or an index predicate is reported as different and the only difference is the time zone written into a `timestamptz` constant, that is this change. Re-emit and re-sign once; the new text is stable from then on. Column defaults are compared as instants where they can be, so most of them are unaffected.

## `contract-infer-prints-emittable-defaults`

No edit to an existing contract. This changes what `prisma contract infer` writes the next time you run it.

Each default is now printed in the form `contract emit` reads back, so an inferred `contract.prisma` emits without hand-editing:

- a `Decimal` or `Numeric` default is quoted decimal text (`@default("1.5")`), the only form that keeps every digit and survives `db init`;
- a `BigInt` default beyond ±(2^53 − 1) is printed as its digits instead of `dbgenerated(...)`;
- `NaN` and `Infinity` are printed as quoted text, which the float and numeric codecs accept;
- a list default holding a `NULL` element is printed as `` @default(sql`<expression>`) `` (`dbgenerated(...)` is removed in this release; see the `remove-dbgenerated` fragment), because no PSL list literal spells a null element. Earlier the default was dropped in silence and the column was emitted without it. `contract emit` stops at such a field with a diagnostic; edit the field or drop the default from the inferred file.

If you keep an inferred contract in version control, re-run `contract infer`, review the diff for these spellings, and re-emit. The stored defaults in the database do not change.

## `source-load-failure-carries-diagnostics`

Only for code or agents that read the CLI's `--json` output.

When a contract source fails to load, `CONTRACT.SOURCE_LOAD_FAILED` now carries a `diagnostics` array: one entry per finding, each with `code`, `summary`, `severity`, and, where the source gave a position, `where.path` and `where.line`. A finding whose source code is dotted (`PSL.PRISMA7_VIEW_UNSUPPORTED`) carries that code directly. A finding whose source code is an undotted legacy code (`PSL_INVALID_DECLARATION`) carries `CONTRACT.SOURCE_DIAGNOSTIC` with the original code in `meta.code` and at the start of the summary.

Nothing is removed: `meta.diagnostics` and `meta.issues` carry what they carried before. Read `diagnostics` in new code, and leave existing readers alone until you want the codes.
