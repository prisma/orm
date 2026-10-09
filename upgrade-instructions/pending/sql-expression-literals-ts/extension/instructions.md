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
  - id: policy-handles-hold-sql-values
    summary: |
      `RlsPolicyHandle`, `RlsUsingPolicyDescriptor`, `RlsWithCheckPolicyDescriptor` and `RlsUsingWithCheckPolicyDescriptor` hold `using` and `withCheck` as `SqlExpression`; `fullTextIndex`'s `where` option, `IndexConstraint.where`, `IndexExpressionInput` and `AuthoredCheckConstraint.expression` are `SqlExpression` too. Read the text with `.text`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\b(RlsPolicyHandle|RlsUsingPolicyDescriptor|RlsWithCheckPolicyDescriptor|RlsUsingWithCheckPolicyDescriptor|IndexConstraint|IndexExpressionInput|AuthoredCheckConstraint)\b'
  - id: sql-tag-lives-in-sql-contract
    summary: |
      The `sql` tag and the `SqlExpression` type live in `@internal/sql-contract/sql-expression`; `@internal/sql-contract-ts/contract-builder` re-exports both. The tag returns a `SqlExpression`, not a `ColumnDefault`. `sql-default-literal.ts` is deleted.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - 'sql-default-literal'
        - '\bsql\x60[^\x60]*\x60\s*\.(kind|expression)\b'
        - ':\s*ColumnDefault\s*=\s*sql\x60'
        - 'import\s*(type\s*)?\{[^}]*\bsql\b[^}]*\}\s*from\s*[''"]@internal/sql-contract-ts/contract-builder[''"]'
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
import { check, policySelect, sql } from '@internal/postgres/contract-builder';
```

Copy the string's value, not its source: undo the TypeScript string's own escaping first, so `'"userId"'` and `"\"userId\""` both become `` sql`"userId"` ``. Inside the template, write each backtick as `` \` ``, each `${` as `\${`, and a backslash that precedes a backtick, a dollar sign or another backslash as `\\`; every other backslash is kept as written, so `E'\n'` stays `E'\n'`. An index or check object written by hand in `.sql({ indexes, checks })` takes a `sql` value in the same fields. A shared predicate held in a `const` becomes a `sql` value too: `` const owner = sql`"userId"::uuid = auth.uid()`; ``.

Skip files under a `migrations/` folder, because migration functions such as `createIndex`, `addCheckConstraint` and the policy operations keep taking strings.

The string form is a type error. JavaScript that is not type-checked and passes a string fails when the contract is built, with `CONTRACT.ARGUMENT_INVALID`, for example ``Index "users_email_active" where must be a sql`...` value.`` The message names the index, check or policy; an index or check with no `name` or `map` is named by its model, as in `Index on "User" where`. `.default('draft')` is not raw SQL: a string there is still a literal default. The `{ fields, render }` form of an index expression still returns a string from `render`, because that text is generated by code.

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

A contract built before this release can hold a column default whose text is not canonical. `contract infer` writes such a default with a note and `contract print` refuses it, for the reason ADR 268 gives ("Column defaults that do not read back"); the app instructions of this release say what to do.

## `policy-handles-hold-sql-values`

The types behind the builder fields changed with them. In code that builds, reads or re-exports them:

- `RlsPolicyHandle.using` and `.withCheck` are `SqlExpression | undefined`. Every `using` and `withCheck` of `RlsUsingPolicyDescriptor`, `RlsWithCheckPolicyDescriptor` and both arms of `RlsUsingWithCheckPolicyDescriptor` is `SqlExpression`, required or optional as before. A function that takes a descriptor and passes its predicates on types them as `SqlExpression` too.
- `fullTextIndex`'s option `where` is `SqlExpression` and is passed to `IndexConstraint.where` unchanged.
- `IndexConstraint.where` is `SqlExpression`, `IndexExpressionInput` is `SqlExpression | DeferredIndexExpression`, and `AuthoredCheckConstraint.expression` is `SqlExpression`. `DeferredIndexExpression.render` still returns a string; lowering canonicalizes the text it returns, so a `render` that returns text that is not canonical stores different text once, as `storage-hash-may-change-once` describes.
- Import the type with `import type { SqlExpression } from '@internal/sql-contract/sql-expression';`, or from `@internal/sql-contract-ts/contract-builder`, which re-exports it.
- Read the text of a value with `.text`. Code that lowers such a value from JavaScript that is not type-checked reads it with `requireSqlExpression(value, 'Policy "p" using').text` from `@internal/sql-contract/sql-expression`, which throws `CONTRACT.ARGUMENT_INVALID` for anything else. The Postgres target lowers a policy handle's predicates this way.

The definition tree (`IndexNode`, `CheckNode`), `buildSqlContractFromDefinition`, `PostgresRlsPolicy` and the emitted contract keep strings.

## `sql-tag-lives-in-sql-contract`

`sql` is defined in `@internal/sql-contract/sql-expression`, with `SqlExpression`, `isSqlExpression`, `readSqlExpression` and `requireSqlExpression`. Read a value through `readSqlExpression` or `requireSqlExpression`, not by checking `isSqlExpression` and reading `.text`: a value made by another installed copy of the package passes `isSqlExpression`, and only those two functions canonicalize its text. `@internal/sql-contract-ts/contract-builder` re-exports `sql` and `type SqlExpression`; `packages/2-sql/2-authoring/contract-ts/src/sql-default-literal.ts` is deleted, so import from one of those modules. A contract-builder facade that re-exports `sql` also re-exports `type SqlExpression` beside it, and never the class as a value.

The tag returns a `SqlExpression`, whose `text` is the canonical text. Code that read `` sql`...`.expression `` or typed the result as `ColumnDefault` reads `.text`, or passes the value to `.default()`, which stores `{ kind: 'function', expression: value.text }`. `describeTaggedLiteralFailure` and `resolveTemplateTagEscapes` are also exported from `@internal/framework-components/authoring`.

This supersedes the sentence of the `sql-default-literal` extension instructions in the upgrade from 8.0.0-rc.11 to 8.0.0-rc.12 that says `` sql`now()` `` and `` sql`autoincrement()` `` are refused by the TypeScript `sql` tag: `.default()` refuses them now.
