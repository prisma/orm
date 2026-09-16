# Deferred decisions and follow-ups

Items the project deliberately leaves open. Each names the decision, why it is deferred, and what would reopen it.

## 1. Content-addressed raw SQL defaults

**Decision open:** whether a raw SQL default should be stored as ADR 129's `ext` envelope (`{ pack, tag, body, bodyHash }`) and compared by hash, the way index expressions, check constraints, and RLS predicates are (ADR 234, ADR 244).

**Why deferred:** this project keeps `{ kind: 'function', expression }` (spec D1). A column default has no catalog name to carry a hash, so verification would still have to compare the database's own reprint of the expression; the hash would only help contract-to-contract diffing, which the storage hash already covers. That argument was not settled with the operator and is to be decided once everything else in this project has shipped.

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
