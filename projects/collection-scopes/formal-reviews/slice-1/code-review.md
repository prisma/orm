# Code review: slice 1, a collection keeps its class through the chain

Reviewed: commit 7e0e3cac24 on `tml-3403-collection-keeps-its-class` (PR prisma/orm#30560), against `bot/collection-chaining-and-fragments-design`. Lens: principal engineer (correctness, failure modes, blast radius, cost).

## Summary

The change is sound. I tried to reach a write without a filter, or `cursor` without an order, through every route in the brief and found none: ternaries in both orders, early return, `switch`, loops, reassigned `let`, `apply`, `.call`, `.apply`, `.bind`, detached methods, `Omit` and `Pick`, include refinements, `this` inside a class, generic functions, unions passed through `select`, `include` and `limit`, and casts on the argument. Run-time behaviour is unchanged. The demo checks in fewer type instantiations than on the base. The whole repository typechecks.

There are two correctness findings and both are small. Explicit type arguments on `distinct` and `distinctOn` stopped compiling, and the upgrade instructions do not mention it (F01). `deleteAll` on an `Omit` of a collection type now fails with TS2589 (F02). Two documentation findings follow: the PR body has stale cost numbers and one misleading sentence (F03), and the slice spec no longer matches the code (F04).

## What looks solid

- **The subtyping argument holds.** Unset flags are `boolean`. `Filtered<C>` is `C & HasWhere`, so it is a strict subtype of `C`. A conditional between them reduces to `C`, and `C` fails `Self extends HasWhere`. Every probe produced the expected TS2684 error on the receiver (see `probes/soundness.out`).
- **One guard form, on the receiver.** All eight guarded methods have exactly one public overload, and it carries the `this` constraint. There is no fallback overload a guarded call could fall through to. Casts on the argument (`{ title } as never`, `{ id } as never`) no longer bypass the guards (P12a to P12c). Only a cast of the receiver bypasses them, which is the explicit opt-out the upgrade instructions describe.
- **The fallback overloads on `select` and `variant` are safe.** They return the class's own type argument. The receiver's state is always that type argument plus some facts, so the fallback can only drop facts, never add them (P11a, P11b).
- **Run time is unchanged.** `#cloneSelf`, `#cloneWithRow` and `#clone` all go through `#createSelf`, which uses `this.constructor`, as before. The diff in `collection.ts` changes signatures, and swaps a few internal casts for `#cloneSelf`. The only change in a method body is that `cursor`'s identity branch now returns `this` without a cast. The run-time tests check that the subclass is kept and that the query plans are equal.
- **Declaration output is tested for real.** `examples/prisma-8-demo/test/declaration-emit.test.ts` emits declarations for a library that covers every chaining and row-returning method. It then typechecks a consumer of those declarations with exact assertions, and it passes. Every other typecheck in the repository runs with `--noEmit`, so without this test a failure here would go unnoticed.
- **The negative tests are honest.** I removed every `@ts-expect-error` directive in the five new type-test files of the package (55 directives) and typechecked. Each line failed for the reason its comment states. Most were TS2684 naming `HasWhere` or `HasOrderBy`. The rest were TS2339 for missing class methods, TS2379 for assignability, and TS2769 for `first(undefined)`. Output: `probes/expect-error-reasons.out`.
- **Cost went down.** See the acceptance table below.

## Findings

### F01: Explicit type arguments on `distinct` and `distinctOn` no longer compile, and no upgrade entry covers them

Location: packages/3-extensions/sql-orm-client/src/collection.ts lines 1146–1152 (`distinct`) and 1188–1197 (`distinctOn`); upgrade-instructions/pending/collection-keeps-its-class/app/instructions.md, entry `include-takes-no-explicit-type-argument` (the extension copy too).

Issue: Both methods gained a second type parameter, `Self`, with no default. On the base branch, `db.Post.distinct<['title']>('title')` compiled. Now it fails:

```
probes/explicit-type-args.ts(4,37): error TS2558: Expected 2 type arguments, but got 1.
probes/explicit-type-args.ts(5,48): error TS2558: Expected 2 type arguments, but got 1.
```

`ReturnType<typeof posts.distinct<['title']>>` fails the same way. The repository has no such call, so the full typecheck stays green. Downstream code that has one breaks with no instruction to follow. This is the same kind of break as explicit type arguments on `include`, which the instructions do record. `select<['id']>('id')` still compiles, because its fallback overload has no `Self`.

Suggestion: Widen the upgrade entry from `include` to every chaining method with a receiver type parameter. Detect `\.(?:include|distinct|distinctOn)<`, and say "drop the type argument; it is inferred from the arguments". A default for `Self` does not help. TypeScript does not infer the remaining type parameters once some are given explicitly, so the call still cannot keep its receiver. Recording the break is the fix.

### F02: `deleteAll` after `where` on an `Omit` of a collection fails with TS2589

Location: packages/3-extensions/sql-orm-client/src/collection.ts lines 2581–2585.

Issue: Code that hides methods with `Omit` and then filters and deletes compiled on the base branch, because `where` returned the plain `Collection` type there. Now it fails with an error that does not say what is wrong:

```ts
declare const om: Omit<PostCollection, 'published'>;
om.where({ id: 1 }).deleteAll();
// error TS2589: Type instantiation is excessively deep and possibly infinite.
declare const omf: Omit<Filtered<PostCollection>, 'published'>;
omf.deleteAll(); // same error
```

On the same receivers, `delete`, `deleteAndCount`, `update`, `updateAll`, `all` and `first` all typecheck (`probes/omit.ts`, `probes/omit.out`). `deleteAll` is the only failure. Its return type, `AsyncIterableResult<CollectionRowOf<this & Self>>`, has the same shape as `updateAll`'s, which works, so I did not find the cause. The include refinement collection is an `Omit` too, but it has no writes, so refinements are not affected. Only user code that writes its own `Omit` or `Pick` of a collection type hits this.

Suggestion: Add `probes/omit.ts` lines 4–7 as a type test and find which part of `deleteAll`'s signature recurses. Compare it with `updateAll`; the difference between the two is the place to look. If the cause is a TypeScript limit you cannot avoid, record it in ADR 258's Consequences and in the README. TS2589 gives the reader nothing to act on.

### F03: The PR body's cost numbers are stale, and one sentence about class bodies is misleading

Location: PR prisma/orm#30560 description, sections "What reviewers should look at" and "Known limits".

Issue:

1. The PR says the demo checks in 694,561 instantiations. I measured 700,728 on the same source files, against 744,614 on the base. With the new demo type tests included, the number is 729,854. ADR 258 says 700,735, which matches my measurement. The PR number is from an earlier commit.
2. "Outside the class body the facts are kept" is true for a chain written outside the class. It is not true for a class method whose body chains two class methods. For `chained() { return this.published().recent(); }`, every caller gets `Ordered<P09>`, not `Filtered<Ordered<P09>>` (probe P10a: TS2375, "Type 'Ordered<P09>' is not assignable to type 'Filtered<P09>'"). ADR 258 and the README describe this correctly. The PR sentence suggests that the problem stays inside the class.

Suggestion: Update the numbers to 744,614 → 700,728 for the application source, and note the 729,854 figure that includes the new tests. Reword the limit: "A class method whose body calls one class method on the result of another loses the first call's facts, for every caller. Losing a fact refuses more calls, never fewer."

### F04: The slice spec no longer matches the code

Location: projects/collection-scopes/slices/1-collection-keeps-its-class/spec.md lines 27–32 and 51 (on the design branch; the PR tree does not carry it).

Issue: The spec names `Step<In, Out>`, `apply(this: Self, step: Step<Self, Out>)` and an exported `CollectionImpl`. It also says "`cursor` keeps the argument-form guard". The code has `Scope<In, Out>`, and `apply` takes `fn: (collection: Self) => Out`. The class is `CollectionBase` and is not exported from the public entry. `cursor` uses the receiver form. ADR 258, the PR and the upgrade instructions all describe the code correctly, so only the spec is behind. A later slice that reads this spec will build against names that do not exist.

Suggestion: Update the four lines to match ADR 258. Rewrite the `cursor` edge case to say that the receiver form replaced the argument form, and that the six ported aggregation tests now cast the receiver to `Ordered<C>`.

## Deferred (out of scope)

- **Class-body fact loss (TML-3434).** Confirmed by probes P10 and Q08. It refuses more calls, never fewer, so it is safe. Already ticketed and documented.
- **`where({})` counts as a filter (TML-3425).** `where` still returns `this` as `Filtered<this>` when the filter normalizes to nothing (collection.ts lines 432–437). This behaviour predates the change and is the one real route to an unfiltered `deleteAll`. Already ticketed.
- **Registered class inside include refinements (TML-3426)**, **declarations name the family package (TML-3433)**, **unused `hasUniqueFilter` (TML-3428)**, **MongoDB ORM client (TML-3427)**. Out of scope by the spec. Already ticketed.
- **`.call` with a foreign receiver.** `Post.where.call(db.User, { id: 1 })` checks the filter against Post's fields but types the result as `HasWhere`, because `Function.prototype.call` erases the generic. `deleteAll` is then not available, so this is not a route to an unguarded write (Q02). Not worth fixing.
- **`select` on a union drops included relations from the type.** The rows still carry them. The type shows fewer fields than the rows have, which is safe. ADR 258 documents it, and a guard test pins it.

Referrals to other lenses (not adjudicated here): the name `CollectionBase` against the spec's `CollectionImpl`, the names `HasWhere` and `HasOrderBy` in error messages, and whether `Scope` belongs in the public surface when `apply` does not use it in its signature. These go to the architect and devrel reviews.

## Already addressed

From `log.txt`:

| Concern | Fixed in | How |
| --- | --- | --- |
| Declaration emit TS2527 (a subclass method that returns rows named the `RowType` symbol) | ebc612fc42, with 927e535e0c and d00c01ba76 for the emit and consumer tests | `CollectionRowOf` prints by name; the demo emits declarations for a class library and typechecks a consumer of them. Verified: `declaration-emit.test.ts` passes. |
| `include` inside class bodies lost the relation in row-returning methods | ddac758b80, a5d73e4c57; tests in d00c01ba76 | Row-returning methods take `this: Self` and return `CollectionRowOf<this & Self>`. Verified by `collection-include-in-class.types.test-d.ts`. `prepared` keeps the limit (TML-3434). |
| Conditional `CollectionRowOf` gave unreadable rows on generic receivers | 7a5f1f5f7a; tests in b237ffb786 | `infer Row extends C[typeof RowType]` keeps the constraint, so fields can be read inside class methods and generic functions. `first(undefined)` is refused again. Verified by `collection-generic-row-reads.types.test-d.ts` and probe Q04. |
| Guard forms were mixed (argument form and `this` form) | 657147b0dd, ebc612fc42; docs in 797dcf1e80 | One form: `this: Self` with `Self extends HasWhere` or `Self extends HasOrderBy`. The upgrade instructions record that a cast on the argument no longer bypasses it. Verified by probes P12a to P12c. |
| Include refinement rows did not flatten | 06878320d6 | `IncludeRefinementValue` reads through `CollectionRowOf<HasRow<V>>`. |

## Acceptance-criteria verification

| # | Criterion | Verdict | Evidence |
| --- | --- | --- | --- |
| D1 | Type tests cover class methods after `where`, `orderBy`, `limit`, `include` and inside `apply` | PASS | `collection-chaining.types.test-d.ts` "class methods keep the class" (after where, orderBy, limit/offset/distinct, include, cursor/distinctOn, inside apply), with `toEqualTypeOf` assertions. |
| D2 | Chained includes; `select` after `include` | PASS | Tests "chained includes widen the row twice and keep the class" and "select after include keeps the included relation". Probe Q07 confirms the relation survives `include → class method → select`. |
| D3 | Guards on the class root and after a class method | PASS | `collection-guards.types.test-d.ts`: refused on the root (all six writes), refused after `recent()`, allowed after `published()`. |
| D4 | Every conditional form at every site | PASS | `collection-conditionals.types.test-d.ts`: six forms (ternary in both orders, early return, switch, loop, `let` with `if`) on the plain collection, on the class, inside a class method on `this`, and inside `apply`. Each asserts the reduced type and refuses `deleteAll`. |
| D5 | Regression test for TML-3397 | PASS | `collection-guards.types.test-d.ts` lines 93–111. Probes P01a and P01b reproduce the refusal. |
| D6 | Each `@ts-expect-error` fails for its stated reason | PASS | All 55 directives removed and typechecked; each error matches its comment (`probes/expect-error-reasons.out`). |
| D7 | The whole repository typechecks | PASS | `mise exec -- pnpm typecheck`: 171 of 171 tasks, including integration-tests, e2e-tests, prisma-8-demo and prisma7-adoption (`typecheck.log`). |
| D8 | `sql-orm-client` tests pass | PASS | 95 files, 1,093 tests, no type errors (`sql-orm-client-test.log`). |
| D9 | The demo typechecks through `dist` | PASS | The demo resolves the client through the built `@prisma/orm-postgres` → `@prisma/orm-family-sql` dist. Typecheck clean; `declaration-emit.test.ts` passes (`demo-declemit.log`). |
| D10 | Lint passes, including `lint:throws` and `check:upgrade-coverage` | PASS | `lint:throws` delta 0, `lint:casts` delta 0, `check:upgrade-coverage`, `lint:deps`, and biome lint for the package and the demo all exit 0 (`lint-*.log`). `lint:agent` was not run. |
| D11 | Type instantiations on `examples/prisma-8-demo` do not rise | PASS | Same source files: 744,614 on the base, 700,728 on the head (−5.9%). With the new demo type tests: 729,854. Measured through `pnpm typecheck --extendedDiagnostics`, after rebuilding `sql-orm-client` and `orm-family-sql` at each revision (`demo-diag-*.log`). The PR body's figure differs (F03). |
| D12 | Upgrade instructions cover `DefaultCollectionTypeState` flags | PASS | Entry `collection-state-flags-are-boolean`. Its patterns match the base files that had to change: `types.ts`, `annotations.types.test-d.ts`, `generated-contract-types.test-d.ts`. |
| D13 | Upgrade instructions cover `CollectionStateOf` and `CollectionRowOf` in place of type arguments | PASS | Entry `read-collection-state-and-row-with-helpers`. Its multi-line `infer` pattern matches `include-cardinality.test-d.ts` and `generated-contract-types.test-d.ts` on the base. |
| D14 | Upgrade instructions cover `ReturnType<C['where']>` | PASS | Entry `return-type-of-a-chaining-method`. It matches `polymorphism.test-d.ts` on the base. Its one other match, `value-objects.integration.test.ts`, is MongoDB code, which the instructions say to skip. Probe Q03 confirms `ReturnType<PostCollection['where']>` is `HasWhere`, as documented. |
| D15 | Upgrade instructions cover explicit type arguments on `include` | WEAK | The entry exists and matches `polymorphism.test-d.ts` on the base. The same break on `distinct` and `distinctOn` is not covered (F01). |
| E1 | An include refinement is an `Omit` that pins polymorphic `this`, hence `this: Self` | PASS | `prisma7-adoption` typechecks. Probe P08a: `where → orderBy → cursor` inside a refinement compiles. P08b and P08c are refused. |
| E2 | Intersection-based refinement type not pursued | PASS | The refinement type is still an `Omit` (`IncludeRefinementCollection`). |
| E3 | No second overload without `this` on `include`; only on `select` and `variant` | PASS | `include` has two public overloads, both with `this: Self`. `select` and `variant` have a fallback each. |
| E4 | `cursor` keeps the argument-form guard | FAIL | Deliberately replaced by the receiver form, in ebc612fc42. ADR 258, the PR and the upgrade instructions record the change, and the six integration casts now cast the receiver. Those three files pass when run (`integration-aggregation.log`). The spec text is stale (F04). |
| E5 | Declaration errors are fixed by the exports | PASS | The facade bundles `Filtered`, `CollectionRowOf`, `StateType` and the other names ADR 258 lists. `declaration-emit.test.ts` passes. |

| Verdict | Count |
| --- | --- |
| PASS | 18 |
| WEAK | 1 |
| FAIL | 1 |
| NOT VERIFIED | 0 |

Probe files and outputs are in `probes/`. The review checkout is clean.
