# Deferred decisions and follow-ups

Items the project deliberately leaves open. Each names the decision, why it is deferred, and what would reopen it.

## 1. A sound comparison for raw SQL defaults in `db verify`

**Problem:** verify compares the expression in the contract with the expression the database reports. Postgres and SQLite report their own reprint of an expression, not the author's text (see ADR 234 for the same problem on RLS predicates). Today both sides are pushed through the target's introspection parser and then compared as lower-cased, whitespace-stripped text. That parser recognises a handful of shapes and passes everything else through verbatim, so any expression Postgres reprints differently from how it was written reports drift forever.

**How indexes, checks, and RLS policies solve it:** the authored body is hashed and the hash is part of the object's name in the catalog (ADR 234, ADR 243, ADR 244). Verify compares names and never reads the body. A column default has no name in the catalog, so that exact mechanism does not transfer.

**Candidate plans, to be decided after slice C:**

1. **Let the database normalise both sides.** Verify already holds a connection. It creates a temporary table with one column carrying the authored default, reads back what the database reprints for it, and compares reprint to reprint. The database is then the only normaliser, which is the same idea as name comparison: never parse SQL in JavaScript. Cost: one round trip per raw default at verify time, and a temporary object on a connection that may be read-only. Recommended candidate.
2. **Record the hash out of band.** Store `SHA-256(canonical body)` in the column's comment (`COMMENT ON COLUMN`, read from `pg_description`; SQLite has no column comments, so it would need another place). Verify compares hashes and never reads the expression. Cost: verify silently trusts the hash if someone edits the default and not the comment, the same trade-off ADR 244 accepts for checks; and SQLite needs a different mechanism.
3. **Wrap every raw default in a named function** (`DEFAULT prisma_default_<hash>()`), giving the default a catalog name that carries the hash. Rejected in advance: it creates one database function per default and changes the SQL the user wrote.
4. **Store the default as ADR 129's `ext` envelope with a `bodyHash`.** Changes the contract shape (project spec D1 keeps it). On its own it does not solve verification, since the database still has no name to compare; it only helps contract-to-contract diffing, which the storage hash already covers. Only worth doing together with 1 or 2.

**Reopen when:** slice C is merged.

## 2. Tagged literals for index expressions, check bodies, and RLS predicates

**Decision open:** whether `@@index(where: "...")`, `@@check(expression: "...")`, and RLS `using:` / `withCheck:` move from plain strings to tagged literals so ADR 129's "single mechanism" claim becomes true.

**Why deferred:** out of scope for removing `dbgenerated`. Slice A adds the parser node; only `@default` accepts it in this project.

**Reopen when:** item 1 is decided, since the answer affects both.

## 3. `encodeDdl` and `decodeDdl` on codecs

**Decision open:** building the DDL half of ADR 184 so that migration rendering and verify-side normalisation of literal defaults go through the codec.

**Why deferred:** no strong reason to do it now. Consequence today: the Prisma 7 source keeps rendering `Bytes` and `DateTime` literal defaults as raw SQL text (`prisma7-binding.ts` `literalDefaultForm` with kind `sqlExpression`), because verify cannot compare those as typed values.

**Reopen when:** a second consumer needs typed DDL rendering, or the Prisma 7 workaround causes a user-visible defect.

## 4. Language server, formatter, and highlighting for tagged literals

**Owner:** Serhii. Brief delivered by slice C at `projects/remove-dbgenerated/editor-tooling-brief.md`.

## 5. Deleting `.defaultSql()`

**When:** 8.0.0 GA. Spec D7.

## 6. Array-returning function defaults on list columns through a named function

**Status:** pre-existing rejection, unchanged. A tagged literal on a list column is allowed (spec D8), which covers the practical cases.
