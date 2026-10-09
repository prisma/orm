# Verification: slice 2, last fix round (b3604607d4..fd8420ee5d) and merge cf14083578

PR prisma/orm#30564, worktree `wip/slice2` at cf14083578, left clean. I changed no tracked file. Paths without a prefix are under `packages/3-extensions/sql-orm-client/`. Line numbers are at cf14083578. Probes and logs are in `wip/verify-slice-2-last-probes/`; each probe file says how to rerun it.

## Verdict per item

1. **List kind read from the model's field: Done.** `src/scopes.ts` 497 and 512 read `many` from the domain field, and the codec and nullability from the column, as the compile-time check does (123–151). The domain field and the column differ only for a list of value objects (`storedAsListColumn`, `packages/2-sql/2-authoring/contract-ts/src/contract-definition.ts` 243). A JSON-backed scalar list cannot exist: PSL refuses scalar lists on a target without the `scalarList` capability. Probe contract `lists/` has `Address[]`, `Address?`, `Json[]`, `Json?`, an enum list with `@map` and a `String[]` with `@map`. Both checks agree on every field (run time: `zz-last-runtime.test.ts` L3; compile time: `zz-last-types.ts` T1 and T2). `Json` is `pg/json@1` and value objects are `pg/jsonb@1`, so a JSON scalar list and a value-object list never share a declaration.
2. **Write refusals in `src/write-guards.ts`: Done.** The four bulk writes compile from `state.filters` alone (`compileUpdateReturning`, `compileUpdateCount`, `compileDeleteReturning`, `compileDeleteCount`, `src/query-plan-mutations.ts` 354–430). The relation-callback update finds its row with `findFirstByFilters` (`src/mutation-executor.ts` 312). So a limit, an offset, a cursor, `distinct` and `distinctOn` are really ignored there, and refusing them is right. Nothing that applies these is refused: `update()` and `delete()` reach the private paths, which do not run the check, and their `first()` lookup applies all of them. An order alone is still accepted by the bulk writes. The only remaining writes that ignore the chain are `upsert` and `create`, already filed as TML-3490.
3. **`limit(0)`: Done, with one gap in the same class (defect 1).** `src/collection.ts` 2844 returns `null` before any statement. This covers `update()` and `delete()` with and without `include`, and a `limit(0)` that a scope adds (probe L1a, L1b, L1d). `update` with a relation callback throws `ORM.ARGUMENT_INVALID` after `limit(0)` instead (L1c), consistent with its refusal of any limit; two docs state it loosely (defect 2).
4. **`CodecListField` exported, docs, demo fixture: Done.** `src/exports/index.ts` 41. The skill now lists list kind and element nullability among what is compared. ADR 259's union-of-scopes wording matches the compiler: "No overload matches this call … The types of '[ScopeFactsType].hasWhere' are incompatible" (probe U1, `probe-types-tsc.log`). The demo declaration fixture adds `labelledAs` and `labelled`; demo typecheck and `declaration-emit.test.ts` pass.
5. **A builder's invalid `many` throws `ORM.ARGUMENT_INVALID`: Done.** `src/scopes.ts` 275–285. Tests in `test/field-scope.test.ts` cover `true`, a string, an object with a non-boolean `elementNullable`, and `many: undefined`, which is read as one value.
6. **Docs and upgrade entry: Done, with two loose statements (defect 2).** The ADR, client README, skill, `orm.ts` JSDoc and both upgrade entries (id `writes-refuse-what-they-would-ignore`) state the refusals. The upgrade entry is exact, including "without a relation callback" for `limit(0)`. No file still uses the old id or the old wording.
7. **Merge cf14083578: Kept both sides.** The only conflicts were the namespaced-accessors generated fixtures, re-emitted with main's `dataType` and slice 2's models (`remerge-cf14083578.diff`). Files changed on both sides keep both changes: `column-spec.ts` keeps the builder type and drops `nativeType`; `contract-dsl.ts` has `AuthoredStorageTypeInstance` and implements the builder type. The same holds for the codec exports, `default-input-type.test-d.ts`, `skills/prisma-8/references/contract.md`, the namespaced-accessors `contract.ts` and the PSL round-trip test. Main changed no client source. The re-emitted soft-delete fixture matches both committed copies. The planner golden test passes. fd8420ee5d changed the soft-delete schema without updating the planner manifest; the merge updated it, so the tip is right.

## Checks I ran (all at cf14083578)

| Check | Result | Log |
| --- | --- | --- |
| Client `pnpm typecheck`, `pnpm lint`, `pnpm test` | exit 0, exit 0, 1,285 passed | `client-typecheck.log`, `client-lint.log`, `client-tests.log` |
| Run-time probe `zz-last-runtime.test.ts` | 16 passed (each asserts the behaviour described below) | `probe-runtime.log` |
| Type probe `zz-last-types.ts` | only the expected U1 error | `probe-types-tsc.log` |
| Demo `pnpm typecheck`, `test/declaration-emit.test.ts` | exit 0, 2 passed | `demo-typecheck.log`, `demo-declaration-emit.log` |
| Postgres facade `pnpm typecheck`, `field-presets.test.ts`; framework-components `pnpm typecheck` | exit 0, 3 passed, exit 0 | `postgres-*.log`, `framework-components-typecheck.log` |
| Re-emit of the soft-delete fixture, diffed against both committed copies | identical | `fixture-reemit.log` |
| Integration file `planner-golden/planner-ddl-golden.test.ts`, alone | 702 passed | `planner-golden.log` |
| `lint:deps`, `lint:throws`, `check:upgrade-coverage`, `lint:framework-vocabulary` | all exit 0 | `lints.log` |
| PR checks | 23 pass, 1 skipped; integration tests no longer run on pull requests (TML-3481) | — |

## Defects, by severity

1. **Low. A negative or fractional limit is refused by reads, but `update()` and `delete()` still write one row.** Reads throw `ORM.ARGUMENT_INVALID` "limit must be an integer from 0 to 9007199254740991, got -1" when the plan is built (`packages/2-sql/4-lanes/relational-core/src/ast/types.ts` 1573). `update()` and `delete()` look up their row with `first()`, which replaces the limit with 1 (`src/collection.ts` 1400). The `limit(0)` fix checks only `=== 0` (2844). So `Post.where(...).limit(-1).delete()` deletes a row while `.limit(-1).all()` throws. This is the case the upgrade entry gives for `limit(0)`: a page size taken from a request, here a negative one. Probe: `zz-last-runtime.test.ts` L4a. Recommendation: before the lookup, check a numeric limit with the rule reads use (an integer from 0) and return `null` for 0. Or check `limit()` and `offset()` arguments when they are called, which covers every terminal. Add a test with `limit(-1)`.
2. **Low. Two statements about `limit(0)` and the relation callback are loose.**
   - PR description, Breaking changes, last bullet: "`update` and `delete` after `limit(0)` change nothing and return `null`." An `update` with a relation callback throws `ORM.ARGUMENT_INVALID` instead (probe L1c). Say "`update` without a relation callback, and `delete`".
   - `README.md` 108: "Only `update` with a relation callback … throws on a collection with an order, a limit, an offset, a cursor, `distinct` or `distinctOn`." The sentence before says the four bulk writes throw on all of these except the order. Write "Of `update` and `delete`, only `update` with a relation callback …".
   - The `update` JSDoc (`src/collection.ts` 2339) and ADR 259 line 91 state the `limit(0)` result first and the relation-callback refusal after it. That is correct but leaves the reader to combine them; optional.

## Observations outside this round

- ADR 259 line 162 cites "(ADR 260)" for a scope built from an index definition. On main, ADR 260 is now "Every query has an afterTransaction stage that fires when its enclosing transaction ends". Main's copy of ADR 259 has the same citation, so this is not from the merge. Main also has two ADRs numbered 259.
- `first()` after `limit(0)` or `limit(-1)` returns a row, while `all()` returns none or throws. The docs state this for `limit(0)`; it predates slice 2.
- A text-list declaration matches an enum list such as `Role[]`, which is stored as a `pg/text@1` list. This follows from matching by codec and is the same for single values.

## Not checked

- A limit given as an expression rather than a number: `first()` replaces it with 1 as well, but only prepared reads bind such a value, so I did not probe it.
- Integration files other than the planner golden test; the PR lists the ones it ran.
