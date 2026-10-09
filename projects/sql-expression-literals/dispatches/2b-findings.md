# Slice 2b findings

## 1. `contract print` also prints the six places, and the design does not name it

`contract print` (PR #30315) prints policies in `packages/3-targets/3-targets/postgres/src/core/psl-print/row-level-security.ts` with `JSON.stringify(policy.using)`, and prints indexes and checks through `buildIndexAttribute` and `buildCheckAttribute` in `psl-build/index-attributes.ts`, which `contract infer` shares. Design section 11.2 names only the `contract infer` printers.

What this dispatch did: `row-level-security.ts` prints `using` and `withCheck` with `printSqlExpressionLiteral`, and indexes and checks get the `sql` literal through the shared builders. Without this, `contract print` would write plain strings, which PSL now refuses.

What is open: `contract print` does not check `sqlTextReadsBack`. A contract built with the TypeScript builder can still hold a text that is not canonical (for example `"x\n"` or an indented body) until slice 3 canonicalizes TypeScript values. `contract print` would then write a `sql` literal that reads back as different text, and the printed schema would not emit the same contract.

Recommendation: `contract print` refuses such an object through its refusal mechanism (`psl-print/refusals.ts`), with a message in the style of the existing refusals, for indexes, checks and policies. Slice 3 makes every stored text canonical, so the refusal would then only fire for contracts built before slice 3. Alternatively accept the gap until slice 3 merges. This needs a decision on the refusal code and message; the dispatch did not add one.

Decision (dispatches (c) and (d)): `contract print` refuses it. `refuseSqlTextThatDoesNotReadBack` in `psl-print/refusals.ts` raises `CONTRACT.PRINT_UNSUPPORTED` for an index `expression` or `where`, a non-derived check `expression`, and a policy `using` or `withCheck` that fails `sqlTextReadsBack`. The error reference lists the case. Test: `postgres/test/psl-print/refusals-sql-text.test.ts`.

## 2. The journey test cannot yet end a text in a `--` comment

The plan's `sql-expression-literals.e2e.test.ts` authors "one text that ends in a `--` comment". Without slice 1 (TML-3287, not started), a body whose last line ends in `--` comments out the SQL that the planner puts after it, such as the closing parenthesis of `WHERE (...)`, so the migration fails. The test in this dispatch leaves that case out. Recommendation: slice 1 adds the case to this test when it lands, or slice 2b waits for slice 1.

Decision (dispatches (c) and (d)): slice 1 adds the case. `plan.md` now lists the update under slice 1's Tests, and slice 2b's journey entry no longer asks for it.
