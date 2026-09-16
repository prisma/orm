# Deferred decisions and follow-ups

Items the project deliberately leaves open. Each names the decision, why it is deferred, and what would reopen it.

## 1. Verification of raw SQL defaults stays as it is

**Decision (operator, 2026-09-16):** the existing verification logic is kept. Both sides pass through the target's introspection parser and are compared as normalised text. No hash, no column comment, no marker row, and no temporary table. ADR 129's `bodyHash` identifies a literal inside the contract for diffing two contracts; it is not a verification mechanism and is not adopted here.

**Reopen when:** a user reports a raw default that verifies as drift when it is not. Not before.

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
