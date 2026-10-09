---
changes:
  - id: raw-sql-is-a-sql-literal
    summary: |
      `@@index(where:)`, `@@index(expression:)`, `@@fullTextIndex(where:)`, `@@check(expression:)` and a policy's `using` and `withCheck` take `sql` literals. A quoted string there is refused with `PSL_VALUE_TYPE_INCOMPATIBLE`.
    detection:
      glob: "**/*.prisma"
      matches:
        - '\b(where|expression)\s*:\s*["'']'
        - '^\s*(using|withCheck)\s*=\s*["'']'
    script: ./scripts/rewrite-sql-strings.mjs
  - id: storage-hash-may-change-once
    summary: |
      A raw SQL text with indentation shared by every line, blank lines at the start or end, a whitespace-only line or CRLF line breaks is stored as its canonical text once it is written as a `sql` literal, which changes the contract's storage hash once. For an index or check named with `map:`, `migration plan` then stops with a conflict and asks for a migration written with `migration new`. For a policy named with `@@map`, `migration plan` writes a migration that drops the policy and creates it again.
    detection:
      glob: "**/*.prisma"
      matches:
        - '\b(where|expression)\s*:\s*["'']'
        - '^\s*(using|withCheck)\s*=\s*["'']'
---

# Raw SQL in PSL is a `sql` literal

## Every place that holds raw SQL takes a `sql` literal

Raw SQL in a PSL schema is written as a `sql` literal, the form `@default` already uses. A quoted string is refused in these places:

| Place | Before | After |
| --- | --- | --- |
| `@@index(where:)` | `@@index([email], where: "(archived_at IS NULL)", name: "users_email_active")` | ``@@index([email], where: sql`(archived_at IS NULL)`, name: "users_email_active")`` |
| `@@index(expression:)` | `@@index(expression: "lower(email)", name: "users_email_lower")` | ``@@index(expression: sql`lower(email)`, name: "users_email_lower")`` |
| `@@fullTextIndex(where:)` | `@@fullTextIndex([text], where: "archived_at IS NULL", name: "message_text_search_live")` | ``@@fullTextIndex([text], where: sql`archived_at IS NULL`, name: "message_text_search_live")`` |
| `@@check(expression:)` | `@@check(expression: "total > 0", name: "order_total_positive")` | ``@@check(expression: sql`total > 0`, name: "order_total_positive")`` |
| a policy's `using` | `using = "\"userId\"::uuid = auth.uid()"` | ``using = sql`"userId"::uuid = auth.uid()` `` |
| a policy's `withCheck` | `withCheck = "\"userId\"::uuid = auth.uid()"` | ``withCheck = sql`"userId"::uuid = auth.uid()` `` |

Inside a `sql` literal no quote is escaped: `\"` becomes `"`. A literal may span lines.

Run the script from the project root to rewrite every `.prisma` file:

```sh
node <this-directory>/scripts/rewrite-sql-strings.mjs '**/*.prisma'
```

It finds each quoted string in those places, outside `//` and `///` comments, decodes its escapes, and writes the same text as a `sql` literal. A text that holds a backtick is written in the double-quote form, `sql"..."`. A text that spans lines is written with the text on its own lines. The script prints each changed file and its number of rewrites, and running it twice changes nothing. Check the diff by hand.

A place the script did not rewrite, for example a string the script cannot read, is refused when the schema is emitted:

```text
PSL_VALUE_TYPE_INCOMPATIBLE: Expected sql`...`; write sql`(archived_at IS NULL)`
```

The message ends with the literal to write. When the string's text would read back from a `sql` literal as different text (it has indentation shared by every line, blank lines at the start or end, a whitespace-only line, or a carriage return), the message is ``Expected sql`...` `` alone; write the SQL in a `sql` literal, and see the next section. A number, `true` or `false` is refused the same way, an identifier is `PSL_INVALID_ATTRIBUTE_SYNTAX` (``Expected sql`...`; got an identifier``), and `pg.sql` is `PSL_UNKNOWN_LITERAL_TAG`.

`contract infer` now writes these places as `sql` literals. When an index's SQL would read back from a `sql` literal as different text and the index has a Prisma-generated name, `contract infer` writes the canonical text, which keeps the same name. It skips an index, check or policy named with `map:` whose SQL would read back as different text, and writes a comment in its place, such as `// prisma: skipped index "users_email_active": its SQL cannot be written as a sql literal that reads back unchanged. It is not in this schema, so migration plan will drop it. A sql literal written by hand holds different text, so migration plan then stops with a conflict for an index or check, or drops and recreates a policy. Either change the SQL in the database to the text of the literal, or add the object without map: or @@map so Prisma names it.` Such an object is still in the database. If you run `migration plan` without adding it to the schema, the plan drops it; for a policy, that removes a row-level security rule. Adding it by hand as written does not fix this: a `sql` literal holds canonical text, which is not the text in the database, so `migration plan` stops with a conflict for an index or check, and drops and recreates a policy. Do one of these instead:

- Change the SQL in the database to the canonical text, for example with a migration written with `migration new`, then add the object with that text.
- Add the object without `map:` (for a policy, without `@@map`) so Prisma names it. `migration plan` then drops the old object and creates it again under its new name, once.

`contract print` refuses such an object with `CONTRACT.PRINT_UNSUPPORTED`; write its SQL in the canonical form in the contract's source.

This supersedes the PSL `@@index(expression: "to_tsvector(…)", type: "gin", …)` example of the `postgres-full-text-search` app instructions in the upgrade from 8.0.0-rc.11 to 8.0.0-rc.12: write it as ``@@index(expression: sql`to_tsvector(…)`, type: "gin", …)``.

## The storage hash may change once

A `sql` literal stores its canonical text: indentation shared by every line, blank lines at the start and end, whitespace-only lines and carriage returns are removed. Every blank line at the start and end is now removed, not only the first and the last, so a `sql` literal in PSL or a `sql` template in TypeScript that starts or ends with two or more blank lines also stores a different text once. A quoted string whose text had any of these is stored differently once it is rewritten, so the contract's storage hash changes once. Prisma-generated index, check and policy names do not change, because their hash is computed from text with its whitespace collapsed.

After emitting the rewritten schema, run `prisma migration plan` once and commit the migration it writes. For objects with Prisma-generated names that migration has no operations; it records the new storage hash. For an index or check named with `map:` whose text changed, `migration plan` stops with a conflict for that object and says to write a custom migration with `migration new`. The database needs no change, so write that migration with no operations. For a policy named with `@@map` whose text changed, `migration plan` writes a migration that drops the policy and creates it again with the canonical text. A schema whose texts had none of these forms emits the same contract as before, and `migration plan` reports no change.
