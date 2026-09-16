# Deferred decisions and follow-ups

Items the project deliberately leaves open. Each names the decision, why it is deferred, and what would reopen it.

## 1. A sound comparison for raw SQL defaults in `db verify`

**Problem:** verify compares the expression in the contract with the expression the database reports. Postgres and SQLite report their own reprint of an expression, not the author's text (see ADR 234 for the same problem on RLS predicates). Today both sides are pushed through the target's introspection parser and then compared as lower-cased, whitespace-stripped text. That parser recognises a handful of shapes and passes everything else through verbatim, so any expression Postgres reprints differently from how it was written reports drift forever.

**How indexes, checks, and RLS policies solve it:** the authored body is hashed and the hash is part of the object's name in the catalog (ADR 234, ADR 243, ADR 244). Verify compares names and never reads the body. A column default has no name in the catalog, so that exact mechanism does not transfer.

**What ADR 129 gives and does not give:** the `ext` envelope with `bodyHash` identifies a literal inside the contract, so two contracts can be diffed by hash. It says nothing about comparing a contract to a live database. Storing the default that way (which project spec D1 declines for now) does not answer this question on its own.

**Rejected by the operator:** creating a temporary table on the target database at verify time so the database reprints the authored default. No shadow-database mechanism of any kind.

**Candidate plans, to be decided after slice C:**

1. **Record the hash out of band, in the column comment.** The migration that sets a raw default also sets `COMMENT ON COLUMN` to carry `SHA-256(canonical body)` in a fixed form; verify reads it from `pg_description` and compares hashes, never the expression. Same trust model as ADR 244: a default edited by hand under an unchanged comment goes undetected. SQLite has no column comments, so it needs its own carrier, for example a row in the Prisma marker schema keyed by table and column.
2. **Record the hash in the marker schema on every target.** The migration runner writes one row per raw default (table, column, hash) into the marker schema the database already carries; verify compares those rows to the contract. Uniform across targets. Weaker than 1 on Postgres because the hash lives beside the column rather than on it, so a column dropped and recreated by hand leaves a stale row.
3. **Keep text comparison but make the parser complete.** Rejected in advance for the reason ADR 234 and ADR 244 record: matching the database's reprint needs a Postgres grammar in JavaScript.

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
