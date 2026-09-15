---
from: 8.0.0-rc.11
to: 8.0.0-rc.12
# The Prisma 7 contract source PR adds the `examples/prisma7-adoption` example and the
# `prisma7Schema` config surface. Additive; nothing for a Prisma 8 user to translate.
# contract.d.ts now orders every collection the way contract.json does; a re-emit reorders, nothing else.
changes:
  - id: json-default-literal-is-json-text
    summary: |
      A string literal `@default("…")` on a `Json` or `Jsonb` column, or each string element of a list default on a `Json[]`/`Jsonb[]` column, is now read as JSON text; a default that meant the JSON string itself must quote it.
    detection:
      glob: "**/*.prisma"
      matches:
        - '\b(?:Json|Jsonb)(?:\[\])?\??(?:\s+@(?!default\b)\w+(?:\([^)\r\n]*\))?)*\s+@default\(\s*(?:\[\s*)?"'
  - id: scalar-list-fields-keep-type-params
    summary: |
      Emitted `contract.d.ts` now carries `typeParams` on scalar list fields; run `prisma contract emit` once and commit the regenerated artifacts.
    detection:
      glob: "**/contract.json"
      matches:
        - '"many":\s*true'
  - id: params-only-sql-facade-prepare
    summary: Replace injected SQL-builder preparation callbacks with params-only callbacks and lexical facade SQL access.
---

# 8.0.0-rc.11 → 8.0.0-rc.12 — User upgrade instructions

## `json-default-literal-is-json-text`

For every Prisma schema matched by `detection`, decide what each string default on a `Json` or `Jsonb` field means. Before rc.12 the literal was stored as a JSON string: `payload Jsonb @default("{}")` meant the string `"{}"`. From rc.12 the literal is JSON text: `@default("{}")` means the empty object, `@default("[]")` the empty array, and `@default("{\"a\":1}")` the object `{ "a": 1 }`; text that does not parse as JSON fails `prisma contract emit` with `PSL_INVALID_JSON_DEFAULT`. The rule applies per element to a list default on a `Json[]` or `Jsonb[]` field: `tags Jsonb[] @default(["{}"])` now means a list holding the empty object. If the default was meant as the JSON *string* value, wrap it in JSON quotes: change `@default("hello")` to `@default("\"hello\"")` and `@default(["hello"])` to `@default(["\"hello\""])`. If it was meant as the JSON document the text spells, leave it as it is. `dbgenerated("…")` defaults are unaffected. Run `prisma contract emit` afterwards and commit the regenerated `contract.json` and `contract.d.ts`.

## `scalar-list-fields-keep-type-params`

For every project whose `contract.json` matches `detection` (it has at least one scalar list field), run `prisma contract emit` once and commit the regenerated `contract.json` and `contract.d.ts`. Scalar list fields (`String[]`, `VarChar(32)[]`, `pg.enum(Role)[]`, …) now carry the same `typeParams` in the domain plane as the single-valued fields of the same type, so `contract.d.ts` field types gain `readonly typeParams: { … }` where the column has a length, precision, scale, or enum type name, and enum list fields gain their value-set reference in `contract.json`. No source edits are needed; a contract without list fields regenerates unchanged.

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
