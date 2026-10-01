---
changes:
  - id: dbgenerated-removed-from-psl
    summary: |
      `@default(dbgenerated("..."))` is removed from PSL. `contract emit` refuses it with
      `PSL_UNKNOWN_DEFAULT_FUNCTION`. Write a raw SQL default as the `sql` tagged literal, and a
      value the column's data type writes as that literal.
    detection:
      glob: "**/*.prisma"
      contains:
        - "dbgenerated("
  - id: default-sql-method-deprecated
    summary: |
      `.defaultSql('...')` on the TypeScript contract builder is deprecated and is removed at
      8.0.0. Rewrite each call to `.default(...)` with `now()`, `autoincrement()`, or the `sql`
      template tag.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\.defaultSql\('
---

## `dbgenerated-removed-from-psl`

`@default(dbgenerated("<expression>"))` no longer parses. Every use is reported at its span as `PSL_UNKNOWN_DEFAULT_FUNCTION` with the message `` Default function "dbgenerated" was removed. Write the SQL as a tagged literal: @default(sql`<expression>`). Supported functions: ... ``. `prisma contract infer` no longer prints it either: a raw expression prints as a `sql` tagged literal, and a value the column's data type writes prints as that literal.

Rewrite each use by what the expression is:

| You wrote | Write instead |
| --- | --- |
| `@default(dbgenerated("gen_random_uuid()"))` | `` @default(sql`gen_random_uuid()`) `` |
| `@default(dbgenerated("now()"))`, `@default(dbgenerated("CURRENT_TIMESTAMP"))` on Postgres | `@default(now())` |
| `@default(dbgenerated("autoincrement()"))`, `@default(dbgenerated("nextval('<seq>'::regclass)"))` on a serial column | `@default(autoincrement())` |
| `@default(dbgenerated("'<json>'::jsonb"))` on a `Json` or `Jsonb` column | `` @default(json`<json>`) `` |
| `@default(dbgenerated("'<member>'::<enum type>"))` on a column typed by that enum | `@default("<member>")` |
| `@default(dbgenerated("'<text>'::text"))` on a text column | `@default("<text>")` |
| `@default(dbgenerated("<anything else>"))` | `` @default(sql`<anything else>`) `` |

The `now()` and `autoincrement()` rows are required, not a matter of style: `` sql`now()` `` and `` sql`autoincrement()` `` are refused with `PSL_INVALID_DEFAULT_SQL`, because Prisma reads those two expressions as its own default functions. Every other expression is used exactly as written.

The mechanical rewrite for the last row is `@default(sql"<expression>")` with the argument text copied unchanged: the double-quote fence uses the same escapes as the `dbgenerated("...")` argument. The backtick fence reads better for SQL; to use it, undo the quoted string's escaping (`\"` becomes `"`), then write each backtick in the body as `` \` ``. A body that contains a backtick is easiest to keep in the double-quote fence.

The JSON and enum rows change the emitted contract: the default becomes `{ kind: 'literal', value }` instead of `{ kind: 'function', expression }`, so the storage hash moves. Run `prisma contract emit`, then `prisma db verify`: the literal compares equal to the live default, so verify passes and no migration is needed. Every other row emits the same contract as before; the storage hash does not move.

Find the uses with `grep -rn "dbgenerated(" prisma/` (or wherever the schema lives).

## `default-sql-method-deprecated`

| Call | Replacement | Import |
| --- | --- | --- |
| `.defaultSql('now()')` | `.default(now())` | `now` from the contract builder |
| `.defaultSql('autoincrement()')` | `.default(autoincrement())` | `autoincrement` from the contract builder |
| `.defaultSql('gen_random_uuid()')` | `` .default(sql`gen_random_uuid()`) `` | `sql` from the contract builder |
| `.defaultSql('<anything else>')` | `` .default(sql`<anything else>`) `` | `sql` from the contract builder |

Copy the expression's value, not its source string: first undo the TypeScript string's own escaping, then write each backtick as `` \` `` and a backslash that precedes a dollar sign as `\\$`. The emitted contract does not change.

Find the uses with `grep -rn "defaultSql(" src/` (or wherever the contract is defined).
