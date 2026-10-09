---
changes:
  - id: builder-raw-sql-is-a-sql-value
    summary: |
      In a TypeScript contract, `index({ where, expression })`, `check({ expression })`, `fullTextIndex({ where })` and the `using` and `withCheck` of `policySelect`, `policyInsert`, `policyUpdate`, `policyDelete` and `policyAll` take a `sql` value. A string there does not compile. Migration files keep strings.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '(?<!readonly |''function'', )\b(where|expression|using|withCheck)\s*:\s*[''"\x60]'
  - id: sql-tag-interpolates-sql-values
    summary: |
      The `sql` tag interpolates other `sql` values: `` sql`${owner} AND deleted_at IS NULL` ``. Compose predicates this way instead of joining strings.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '(?<!\bsql)\x60\$\{[\w.]+\}\s+(AND|OR)\b'
  - id: sql-tag-error-codes-renamed
    summary: |
      `CONTRACT.DEFAULT_SQL_INTERPOLATION` is renamed `CONTRACT.SQL_EXPRESSION_INTERPOLATION`. A NUL character or an oversize text in a `sql` value is `CONTRACT.SQL_EXPRESSION_INVALID`, not `CONTRACT.DEFAULT_INVALID`. `.default()` raises `CONTRACT.DEFAULT_INVALID` for `` sql`now()` ``, `` sql`autoincrement()` `` and unsafe SQL.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\bDEFAULT_SQL_INTERPOLATION\b'
        - '\bCONTRACT\.DEFAULT_INVALID\b'
  - id: storage-hash-may-change-once
    summary: |
      A raw SQL string with indentation shared by every line, blank lines at the start or end, a whitespace-only line or CRLF line breaks is stored as its canonical text once it is written as a `sql` value, which changes the contract's storage hash once.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '(?<!readonly )\b(where|expression|using|withCheck)\s*:\s*(\x60[ \t]*$|[''"\x60][ \t\r\n])'
  - id: infer-notes-defaults-that-do-not-read-back
    summary: |
      `contract infer` writes a column default whose text a `sql` literal cannot write back unchanged and adds a note to the model; `contract print` refuses such a default with `CONTRACT.PRINT_UNSUPPORTED`.
    detection:
      glob: "**/contract.prisma"
      matches:
        - '@default\(\s*sql\x60[^\x60]*$'
        - '@default\(\s*sql"[^"]*\\[rn]'
---

# Raw SQL in a TypeScript contract is a `sql` value

## `builder-raw-sql-is-a-sql-value`

Every field of the TypeScript contract builder that holds raw SQL takes a `sql` value, as `.default()` already did. Wrap each string in the `sql` tag, imported from the same contract-builder module as the other helpers:

| Place | Before | After |
| --- | --- | --- |
| `index` `where` | `constraints.index([cols.email], { where: '(archived_at IS NULL)', name: 'users_email_active' })` | ``constraints.index([cols.email], { where: sql`(archived_at IS NULL)`, name: 'users_email_active' })`` |
| `index` `expression` | `constraints.index({ expression: 'lower(email)', name: 'users_email_lower' })` | ``constraints.index({ expression: sql`lower(email)`, name: 'users_email_lower' })`` |
| `fullTextIndex` `where` | `fullTextIndex(cols.text, { where: 'archived_at IS NULL', name: 'message_text_search_live' })` | ``fullTextIndex(cols.text, { where: sql`archived_at IS NULL`, name: 'message_text_search_live' })`` |
| `check` `expression` | `check({ expression: 'total > 0', name: 'order_total_positive' })` | ``check({ expression: sql`total > 0`, name: 'order_total_positive' })`` |
| a policy's `using` and `withCheck` | `policySelect(Profile, { name: 'profile_owner_read', roles: [authenticated], using: '"userId"::uuid = auth.uid()' })` | ``policySelect(Profile, { name: 'profile_owner_read', roles: [authenticated], using: sql`"userId"::uuid = auth.uid()` })`` |

```ts
import { check, policySelect, sql } from '@prisma/orm-postgres/contract-builder';
```

Copy the string's value, not its source: undo the TypeScript string's own escaping first, so `'"userId"'` and `"\"userId\""` both become `` sql`"userId"` ``. Inside the template, write each backtick as `` \` ``, each `${` as `\${`, and a backslash that precedes a backtick, a dollar sign or another backslash as `\\`; every other backslash is kept as written, so `E'\n'` stays `E'\n'`. An index or check object written by hand in `.sql({ indexes, checks })` takes a `sql` value in the same fields. A shared predicate held in a `const` becomes a `sql` value too: `` const owner = sql`"userId"::uuid = auth.uid()`; ``.

Skip files under a `migrations/` folder, because migration functions such as `createIndex`, `addCheckConstraint` and the policy operations keep taking strings.

The string form is a type error. JavaScript that is not type-checked and passes a string fails when the contract is built, with `CONTRACT.ARGUMENT_INVALID`, for example ``Index "users_email_active" where must be a sql`...` value.`` The message names the index, check or policy; an index or check with no `name` or `map` is named by its model, as in `Index on "User" where`. `.default('draft')` is not raw SQL: a string there is still a literal default. The `{ fields, render }` form of an index expression still returns a string from `render`, because that text is generated by code; lowering canonicalizes that text as it canonicalizes a `sql` value.

This supersedes the TypeScript `fullTextIndex(cols.text, { where: 'archived_at IS NULL', … })` example of the `postgres-full-text-search` app instructions in the upgrade from 8.0.0-rc.11 to 8.0.0-rc.12: write it as ``fullTextIndex(cols.text, { where: sql`archived_at IS NULL`, … })``.

## `sql-tag-interpolates-sql-values`

The `sql` tag accepts other `sql` values inside `${…}`. It joins their text into the template and canonicalizes the whole text once. A predicate that was built by joining strings is written as one `sql` template:

```ts
const owner = sql`owner_id = current_setting('app.uid')::int`;
const ownerAlive = sql`${owner} AND deleted_at IS NULL`;
```

Anything else inside `${…}`, such as a string or a number, is a type error, and throws `CONTRACT.SQL_EXPRESSION_INTERPOLATION` from JavaScript that is not type-checked. Prisma never quotes a value into SQL, so write any other text inside the template. Each line of an interpolated value after its first takes the indentation of the template line the `${…}` sits on, so a multi-line value inside an indented template stores the same text as the same SQL written out in one template.

## `sql-tag-error-codes-renamed`

- `CONTRACT.DEFAULT_SQL_INTERPOLATION` is now `CONTRACT.SQL_EXPRESSION_INTERPOLATION`, and its message is ``sql`...` only interpolates other sql`...` values; write any other text inside the template.``
- A `sql` value whose text holds a NUL character or is larger than 65536 bytes throws `CONTRACT.SQL_EXPRESSION_INVALID` when it is made. It was `CONTRACT.DEFAULT_INVALID`.
- `` sql`now()` ``, `` sql`autoincrement()` `` and unsafe SQL (`;`, a comment token, `$$` or `SELECT`) are no longer refused by the tag. `.default()` refuses them with `CONTRACT.DEFAULT_INVALID` and the same messages, so `` const current = sql`now()` `` compiles and runs, and `.default(current)` throws. In every other place such text is passed to the database unchanged.

Update code that matches on these codes. Code that catches `CONTRACT.DEFAULT_INVALID` around a `sql` template that is not passed to `.default()` no longer sees it.

## `storage-hash-may-change-once`

A `sql` value stores its canonical text, as a PSL `sql` literal does: indentation shared by every line, blank lines at the start and end, whitespace-only lines and carriage returns are removed. A raw SQL string whose text had any of these, for example a multi-line template string, is stored differently once it is written as a `sql` value, so the contract's storage hash changes once. Prisma-generated index, check and policy names do not change. Skip files under a `migrations/` folder, because migration functions keep taking strings and their text is not canonicalized. Follow the steps of the `storage-hash-may-change-once` change of the PSL instructions in this release: run `prisma migration plan` once and commit the migration it writes. For an index or check named with `map:` whose text changed, `migration plan` stops with a conflict and asks for a migration written with `migration new`, which needs no operations. The TypeScript policy helpers take no exact name, so a policy never needs this. A `{ fields, render }` index expression whose `render` returns text that is not canonical, such as indented multi-line text, also stores different text once, with the same steps; `fullTextIndex` stores its fields and language as data, renders no SQL, and is not affected.

## `infer-notes-defaults-that-do-not-read-back`

A column default whose text a `sql` literal cannot write back unchanged, for example a string constant holding a carriage return or a whitespace-only line, is treated differently by the two commands that write PSL, for the reason ADR 268 gives ("Column defaults that do not read back"):

- `contract infer` still writes the default as a `sql` literal and adds the comment `// prisma: default of "<column>" holds text a sql literal cannot write back unchanged; check its string constants before applying a migration` to the model. The literal reads back as a different constant, so a database created from the inferred schema gets that constant. Check the constant, and fix it in the schema or in the database before you apply a migration planned from it.
- `contract print` refuses the default with `CONTRACT.PRINT_UNSUPPORTED` (``default of column "public"."post"."slug" holds SQL that a sql literal cannot write back unchanged``). Write the default in its canonical form in the contract's source. A contract holds such a default only when it was built before this release, or through `.default({ kind: 'function', expression })` or `.defaultSql('...')`.

This applies to projects that write only PSL as well as TypeScript projects.
