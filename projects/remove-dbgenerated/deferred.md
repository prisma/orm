# Deferred decisions and follow-ups

Items the project deliberately leaves open. Each names the decision, why it is deferred, and what would reopen it.

## 1. Verification of raw SQL defaults stays as it is

**Decision (operator, 2026-09-16):** the existing verification logic is kept. Both sides pass through the target's introspection parser and are compared as normalised text. No hash, no column comment, no marker row, and no temporary table. ADR 129's `bodyHash` identifies a literal inside the contract for diffing two contracts; it is not a verification mechanism and is not adopted here.

**Reopen when:** a user reports a raw default that verifies as drift when it is not. Not before.

**Known asymmetry, deliberate:** on Postgres the introspection parser runs over the authored default in the shared schema derivation, which both the planner and verify use; on SQLite it runs only in verify (`diffSqliteSchema`), because SQLite's parser would rewrite `CURRENT_TIMESTAMP` to `now()` and the planner would then render different DDL from what the author wrote (project spec D4). Postgres's parser returns unrecognised expressions unchanged, so the same placement there changes nothing in DDL.

## 2. Tagged literals for index expressions, check bodies, and RLS predicates

**Decision open:** whether `@@index(where: "...")`, `@@check(expression: "...")`, and RLS `using:` / `withCheck:` move from plain strings to tagged literals so ADR 129's "single mechanism" claim becomes true.

**Why deferred:** out of scope for removing `dbgenerated`. Slice A adds the parser node; only `@default` accepts it in this project.

**Reopen when:** item 1 is decided, since the answer affects both.

## 3. `encodeDdl` and `decodeDdl` on codecs

**Decision open:** building the DDL half of ADR 184 so that migration rendering and verify-side normalisation of literal defaults go through the codec.

**Why deferred:** no strong reason to do it now. Consequence today: the Prisma 7 source keeps rendering `Bytes` and `DateTime` literal defaults as raw SQL text (`prisma7-binding.ts` `literalDefaultForm` with kind `sqlExpression`), because verify cannot compare those as typed values.

**Reopen when:** a second consumer needs typed DDL rendering, or the Prisma 7 workaround causes a user-visible defect.

## 4. Language server, formatter, and highlighting for tagged literals

**Owner:** Serhii. Brief delivered by slice C at `projects/remove-dbgenerated/editor-tooling-brief.md`. Known gaps as of slice A: no semantic token for a tagged literal's tag identifier, and no SQL highlighting inside backtick strings. Tag completion is implemented in slice A.

## 5. Deleting `.defaultSql()`

**When:** 8.0.0 GA. Spec D7.

## 6. Array-returning function defaults on list columns through a named function

**Status:** pre-existing rejection, unchanged. A tagged literal on a list column is allowed (spec D8), which covers the practical cases.

## 7. The shipped Supabase contract is stale against its own generator

**Found 2026-09-17** while finishing slice A. On `main`, `pnpm contract:generate` in `packages/3-extensions/supabase` produces a contract that differs from the committed one by about 490 lines of `contract.prisma`: inlined `types {}` aliases, 43 added `@@check(...)` constraints, six enum defaults printed as literals, and `@noCheck(elementNotNull)` on two list columns. `CONTRACT-FIDELITY.md` says the file is byte-identical on rerun, which is no longer true, and no test compares the committed file with fresh output. Slice A did not regenerate it (only ten of those lines are slice A's). Slice C must regenerate it first, as its spec now says. A test that fails when the committed contract differs from generator output would stop this recurring.

## 8. The SQL default body check is not quote-aware

**Found 2026-09-17** in review. `checkSqlDefaultBody` rejects `;`, `--`, `/*`, `$$`, and the word `SELECT` anywhere in the text, including inside SQL string literals, so a legitimate default such as `'a;b'` or `'SELECT'` is refused. The rule predates this project (the Postgres planner applied it on main); slice A only moved it to authoring and shared it between both planners. Making it quote-aware changes what a contract may smuggle into DDL, so it needs its own change and tests.

## 9. The TypeScript `sql` tag cannot express a body containing `${`

**Found 2026-09-17** in review of the upgrade instructions. In a JavaScript template literal `${` starts an interpolation, which the tag refuses, and the only JavaScript way to write the two characters literally is `\${`. The tag reads raw text and, since the `${` rule was removed from tagged literals, resolves only `` \` `` and `\\`, so `\${` keeps its backslash. PSL has no such limit. The upgrade instructions tell users to leave such a default on `.defaultSql(...)`, which is removed at 8.0.0 GA, so this must be settled before GA. Options: resolve `\$` to `$` in the TypeScript tag only (PSL and TypeScript then differ for a body containing `\$`), resolve it in both, or keep `.defaultSql` for this case.
