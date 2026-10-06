# Spike: a filtered collection as a subtype of an unfiltered one

**Date:** 2026-09-30
**Branch:** `spike-collection-state-subtyping`, started from `bot/spike-pipe-fragments` at `822597dcf4`.
**Question:** Today a filtered and an unfiltered collection of the same model are assignable to each other, so `search ? c.where(...) : c` sometimes keeps the filtered type and unlocks `update` on a collection that may have no filter. If the type state becomes part of assignability, and the unknown flags default to `boolean` instead of `false`, does TypeScript pick the unfiltered type by itself?

## Answer

Yes, for the common case, and the change is small and nearly free. With the flags defaulting to `boolean` and the state declared as a property of `Collection`, a filtered collection is assignable to an unfiltered one and not the reverse. `search ? c.where(...) : c` now always gives the unfiltered type, in either branch order, on a root collection, after `select`, in an include refinement and inside `pipe`, and all read methods work on it while `update`, `updateAll`, `delete`, `deleteAll` and `cursor` are refused. The same holds for `let` with `if`, for `pipe` bodies with early returns, a `switch` or a loop, and `const f: Filtered = db.Post` is now an error. Two cases do not reduce to one type, because neither branch is a subtype of the other: a `where` branch against an `orderBy` branch, and a custom collection class against its own filtered collection (including `this` inside the class). There the result is a union: it is sound (`update`, `delete` and `cursor` are refused), and `where`, `orderBy`, `select`, `limit`, `first` and `all` work, but `include` fails with TS2349 and custom methods are gone. Nothing else in the repository stopped compiling: the package, its tests and all 104 packages that depend on it typecheck, and the 17 variant casts that broke in the previous spike do not break here. The cost is +601 instantiations in the demo when unused (+0.08%) and +2,120 in the package (+0.14%). It does not make the ternary cheaper: it still costs about 11,000 instantiations per use in the demo. I recommend making this change in its own ticket, separately from `when`.

## What was changed

Three lines of production code in `packages/3-extensions/sql-orm-client`:

- `src/types.ts`: `DefaultCollectionTypeState` now has `hasWhere: boolean`, `hasOrderBy: boolean` and `hasUniqueFilter: boolean` instead of `false`. `where`, `orderBy` and `variant` still set `true`. `boolean` means "not known to be set".
- `src/collection-internal-types.ts`: a new `export declare const StateType: unique symbol`, next to `RowType`.
- `src/collection.ts`: `declare readonly [StateType]: State;` as the first member of `CollectionImpl`, before `[RowType]`.

Why it works: the flags used to appear only in method parameter types (`update(data: State['hasWhere'] extends true ? ... : never)`), and TypeScript compares method parameters in both directions. A declared property is compared in one direction. `{ hasWhere: true }` is assignable to `{ hasWhere: boolean }`, but `{ hasWhere: boolean }` is not assignable to `{ hasWhere: true }`. So the filtered collection is a subtype of the unfiltered one. For a conditional expression, and for the inferred return type of a function with several `return` statements, TypeScript removes union members that are subtypes of another member, so the filtered branch disappears.

Every check on a flag in the source is `extends true`, which already treats `boolean` as not set. There was no `extends false` check. `hasUniqueFilter` is never set to `true` anywhere; it only changed its default.

What else refers to the state, and what happened:

| Place | Result |
| --- | --- |
| `GroupedCollection` | Carries only `nsId`. No change. |
| `PreparedCollection` | Uses the state only in parameter types. No change. |
| `.variant()` and `test/collection-variant.test.ts` | No change. The previous spike's 17 TS2352 failures on `variant(...) as typeof collection` came from the `false` default: the variant collection has `hasWhere: true` and the root had `false`, so neither type was assignable to the other. With `boolean`, the variant collection is assignable to the root, and the casts are allowed. |
| Include refinements (`Omit<Collection, ...>`) | `Omit` keeps symbol keys, so the refinement type carries `[StateType]` too. `posts.where(...)` is assignable back to the refinement type, and the ternary reduces to the refinement type. |
| `IncludeRefinementResult` constraint (`CollectionTypeState`) | Every concrete state still satisfies it. No change. |
| Postgres facade and every other dependent | `pnpm turbo run typecheck --filter='...@internal/sql-orm-client'`: 104 of 104 tasks pass, including the examples and `test/integration`. |
| `test/annotations.types.test-d.ts` | Declares a state with `hasOrderBy: false`. `false` is still a valid state. No change. |
| `test/generated-contract-types.test-d.ts` | One assertion changed: `DistinctUsersState['hasOrderBy']` is now `boolean`, not `false`. |
| `test/pipe-q1-conditional.types.test-d.ts` | The previous spike's tests of the unsound behaviour now fail as intended. Three tests were rewritten to assert the new behaviour. |

No test needed a new cast, and no `as never` was added.

## What works and fails at each site

Tests: `test/pipe-state-subtyping.types.test-d.ts` (new) and the updated `test/pipe-q1-conditional.types.test-d.ts`. Every negative uses `@ts-expect-error`. I removed the directives in a copy and read each error to check it fails for the stated reason; the codes are in the table. "Reads" means `where`, `orderBy`, `select`, `include`, `limit`, `first` and `all` all type-check with a non-`any` result. "Writes refused" means `update`, `updateAll`, `delete`, `deleteAll` and `cursor` all fail: TS2345 (argument not assignable to `never`) for `update`, `updateAll` and `cursor`, TS2684 (`this` not assignable to `never`) for `delete` and `deleteAll`.

| Case | Site | Result type | Reads | Writes |
| --- | --- | --- | --- | --- |
| a. `search ? c.where(...) : c` | root `db.Post`, either branch order | root type | all work | refused |
| a | after `where` | filtered type | all work | `update`, `delete` work (both branches are filtered, so this is correct); `cursor` refused |
| a | after `where`, `orderBy` on one branch | filtered type | all work | `cursor` refused |
| a | after `select` | the `select` type | all work | refused |
| a | include refinement | the refinement type | `include`, `orderBy`, `limit` work | `cursor` refused (writes do not exist there) |
| a | inside `pipe` | root type | all work | refused |
| a | custom class root (`custom.Post`) | `SoftPostCollection \| filtered base` | `where`, `first` work; `include` TS2349; `popular()` TS2339 | refused |
| b. `flag ? c.where(...) : c.orderBy(...)` | root, and inside `pipe` | `Filtered \| Ordered` | `where`, `first` work; `include` TS2349 | refused |
| b | with `const x: Base = ...` | root type | all work | refused |
| c. `let q = c; if (...) q = q.where(...); if (...) q = q.orderBy(...)` | root | root type | all work | refused |
| c | after `select` | the `select` type | work | refused |
| c | custom class root | fails at `q = q.where(...)` with TS2741 (`popular` missing), as before | | |
| d. unconditional chain | `c.where(...)` | filtered | all work | `update`, `updateAll`, `delete`, `deleteAll` work; `cursor` refused |
| d | `c.where(...).orderBy(...)` | filtered and ordered | all work | all work |
| d | a filtered or ordered collection passed to `(c: typeof db.Post) => ...` | accepted | | |
| e. `pipe` with `if` and early return | root | root type | all work | refused |
| e | `pipe` with `switch` (`where`, `orderBy`, unchanged) | root type | all work | refused |
| e | `pipe` with a loop of `where` calls | root type | all work | refused (the loop may run zero times) |
| e | `pipe` where every `return` is filtered | filtered type | | `update` works |
| g. `const f: Filtered = db.Post` | | TS2375 (TS2322 with an extra `exactOptionalPropertyTypes` hint) | | |
| g | `const f: Filtered = db.Post.orderBy(...)` | TS2375 | | |
| g | passing `db.Post` to `(c: Filtered) => ...` | TS2379 (the argument form of the same error) | | |

The previous spike's probes (`gen-pipe-probes.mjs.txt`, cases 1a and 1b, ten sites each) also compile with no errors after the fix, in the package and in the demo. They cover the chained, include refinement after `where`, and `this` sites for `let` and the ternary inside `pipe`.

### f. The custom class and `this`

```ts
class ConditionalPosts extends Collection<Contract, 'Post'> {
  ternary(term: string | undefined) {
    return term ? this.where((p) => p.title.eq(term)) : this;
  }
}
```

The return type is `ConditionalPosts | Collection<Contract, 'Post', Row, WithWhereState<DefaultCollectionTypeState>>`. Inside the method the first member is the polymorphic `this` type; outside it is the class. The union survives because neither member is a subtype of the other: the filtered base collection lacks the class's methods, and the class has `hasWhere: boolean`, not `true`. The same union results from an early return (`if (term) return this.where(...); return this;`) and from `this.pipe((c) => (term ? c.where(...) : c))`.

On that union:

- `where`, `orderBy`, `select`, `limit`, `first`, `all` and `pipe` work.
- `include` fails with TS2349, "This expression is not callable. Each member of the union type ... has signatures, but none of those signatures are compatible with each other."
- `update`, `delete` and `cursor` are refused (TS2345, TS2684). This is sound; before the fix the result collapsed to the filtered type and `update` was unlocked.
- The class's own methods (`ternary`) fail with TS2339.
- `let q = this; if (term) q = q.where(...)` fails with TS2375: the filtered base collection is not assignable to `this`. This was already the case.
- `let q: Collection<Contract, 'Post'> = this; if (term) q = q.where(...)` compiles, and `q` has the base type: reads work, `update` is refused, and the class's methods are lost.

## Measurements

Instantiation counts from `tsc --extendedDiagnostics`, TypeScript 5.9.3, by the previous spike's method and tools (`measure-pipe.sh.txt`, `gen-pipe-probes.mjs.txt`, `contract-soft-delete.mjs.txt`). Every count was measured twice and both runs gave the same number. "Package" is the typecheck of `packages/3-extensions/sql-orm-client` with the spike tests (`test/fulltext-search*`, `test/pipe-*`) excluded. "Demo" is `examples/prisma-8-demo` against the built `dist` output. The baseline reproduces the previous spike's numbers exactly. Raw counts are in `state-subtyping-measurements.tsv.txt`.

### States

| State | Package | Demo |
| --- | --- | --- |
| Branch point `822597dcf4` | 1,527,498 | 745,201 |
| After the fix, unused | 1,529,618 (+2,120, +0.14%) | 745,802 (+601, +0.08%) |

### Probes

Each probe has ten sites (see the previous spike). With N uses, the first N sites use the form and the rest use the unconditional chain. Numbers are the increase over the probe with 0 uses in the same state. "Further use" is (10 uses − 1 use) / 9.

| Case | State | Package, 1 use | Package, 10 uses | Package, further use | Demo, 1 use | Demo, 10 uses | Demo, further use |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1a. ternary in `pipe` | before | +28,819 | +170,140 | 15,702 | +23,598 | +126,060 | 11,385 |
| 1a. ternary in `pipe` | after | +28,883 | +146,879 | 13,111 | +23,662 | +123,014 | 11,039 |
| 1b. `let` and `if` | before | +19,628 | +95,812 | 8,465 | +16,016 | +83,971 | 7,551 |
| 1b. `let` and `if` | after | +19,676 | +96,030 | 8,484 | +16,064 | +84,244 | 7,576 |

The unconditional chain (1c) on its own:

| Probe | State | Package | Demo |
| --- | --- | --- | --- |
| Ten sites with the unconditional chain (0-use probe), over the state | before | +43,173 | +15,340 |
| Ten sites with the unconditional chain (0-use probe), over the state | after | +43,247 | +15,383 |
| Ten chained steps on one collection, over no chain | before | +1,916 | +399 |
| Ten chained steps on one collection, over no chain | after | +1,916 | +399 |
| The same ten steps each in its own `pipe`, over no chain | before | +1,984 | +467 |
| The same ten steps each in its own `pipe`, over no chain | after | +1,984 | +467 |

The fix changes almost nothing per use. The ternary and the `let` form are still expensive, because TypeScript still compares the two collection types member by member to reduce the union or check the assignment. I expected the state property to let TypeScript compare the type arguments instead (variance), but the state also appears inside conditional types, which likely prevents that. I did not confirm the cause.

## Repeated sites

**Question:** is the ternary's cost of about 11,000 instantiations per use paid once for each pair of collection types, or at every site? The ten-site probe above used ten different kinds of site, so every use was a new pair of types, and TypeScript caches assignability results per pair of types.

**Answer:** once per pair of types. The first ternary on `db.Post` costs about 14,000 in the demo and 20,000 in the package. Nine more identical ternaries cost 0 to 9 in total, and nine more with different filters cost 57 in the demo and 207 in the package. The filter does not matter, because it does not change the collection type. A ternary on a different model is a new pair of types and pays again: about 9,800 in the demo and 13,300 in the package for `db.User` after `where`, which is about 70% of the first cost.

All probes were measured in the state after the fix, with `pipe` present, twice each, with identical results. That state costs 1,529,618 in the package and 745,802 in the demo with no probe, as in "States" above. Every probe declares ten `search` values (`s1` to `s10`, `string | undefined`) and ten numbers, and then has N top-level statements. The numbers are the increase over the probe with the declarations and no statements: 1,531,533 in the package and 746,682 in the demo. The generator is `gen-repeat-probes.mjs.txt`.

1. `export const rI = Post.pipe((c) => (sI ? c.where((p) => p.title.eq(sI)) : c)).limit(10);`
2. `export const rI = (sI ? Post.where((p) => p.title.eq(sI)) : Post).limit(10);`
3. `let qI = Post; if (sI) qI = qI.where((p) => p.title.eq(sI)); export const rI = qI.limit(10);`
4. As 1, with a different filter in each statement: `eq`, `neq`, `gt`, `gte`, `lt` and `lte` on `title`, and `eq` and `neq` on `userId` and `id` (in the package: `views`, `id` and `userId` with numbers).
5. Ten statements of form 1, then K statements `User.where((u) => u.email.neq('x')).pipe((c) => (sI ? c.where((u) => u.email.eq(sI)) : c)).limit(10)`. The numbers for 5 are over the probe with ten statements of form 1.

| Case | Package, 1 use | Package, 10 uses | Package, further use | Demo, 1 use | Demo, 10 uses | Demo, further use |
| --- | --- | --- | --- | --- | --- | --- |
| 1. same ternary in `pipe` | +20,925 | +20,934 | 1 | +14,292 | +14,301 | 1 |
| 2. same bare ternary | +20,917 | +20,917 | 0 | +14,284 | +14,284 | 0 |
| 3. same `let` and `if` | +17,506 | +17,506 | 0 | +11,364 | +11,364 | 0 |
| 4. ternary in `pipe`, a different filter each time | +20,925 | +21,132 | 23 | +14,292 | +14,349 | 6 |
| 5. after ten of case 1, ternary on `User` after `where` | +13,930 | +13,939 | 1 | +9,902 | +9,911 | 1 |

Two controls without a conditional separate the conditional's cost from the cost of using a model for the first time:

| Control | Package | Demo |
| --- | --- | --- |
| One `Post.where((p) => p.title.eq('x')).limit(10)`, over the empty probe | +1,186 | +60 |
| After ten of case 1, one `User.where(...).where(...).limit(10)` | +589 | +79 |

So the conditional itself costs about 19,700 in the package and 14,200 in the demo the first time for `Post`, and about 13,300 and 9,800 the first time for `User`. After that it costs almost nothing per site.

This changes how the earlier numbers should be read. The "further use" of about 11,000 in the ten-site probe is the cost of ten different pairs of types (root, after `where`, after `select`, include refinement, `this`, and so on), not the cost of repeating one. In an application, the cost of ternaries grows with the number of distinct collection types that appear in a conditional, roughly the models times the kinds of site, not with the number of conditionals. The comparison with the `when` method in the recommendation (11,039 against 87 per use) overstates the difference for code that repeats the same kind of conditional.

## Not tested

- Autocomplete and error messages in the editor, and check times (the load average was above 150 during the runs).
- The demo at run time. The change is type-only, so I added no runtime tests; the package's 1,091 existing tests pass.
- The Mongo ORM client, which has its own collection type.
- Polymorphic variants inside a conditional (`flag ? c.variant('A') : c`). The variant tests pass `'Admin' as never`, so they do not exercise a real variant name; `test/polymorphism.test-d.ts` does and passes.
- Case e inside a custom class, an include refinement, or after `select`. Only the root was tested for `switch` and loops.
- Removing `variantName` or `nsId` from the declared state. The whole state is declared; `nsId` was already checked through `namespaceId: State['nsId']`.
- Whether a smaller property (`Pick<State, 'hasWhere' | 'hasOrderBy'>`) would be cheaper.
- A fix for the two cases that keep a union.

## Recommendation

Make this change, as its own ticket, independent of `pipe` and `when`. It fixes the unsound ternary that exists in code today, costs +0.08% in the demo, needs no new casts, and broke only one assertion that checked the old `false` default. It does not replace `when`: the ternary costs about 10,000 to 14,000 instantiations in the demo for each new pair of collection types it joins (see "Repeated sites"; repeating the same kind of conditional is almost free), and the two remaining union cases, a custom class and `where` against `orderBy`, give sound but awkward types where `include` fails with an unhelpful TS2349. `when` keeps the caller's type in both cases. Document the annotation `const q: typeof db.Post = flag ? ... : ...` as the way to get one type out of the `where` against `orderBy` case.

The change touches a public type: `DefaultCollectionTypeState` is exported, and code that reads `State['hasWhere']` from a root collection now sees `boolean` instead of `false`. Record upgrade instructions for it.

## Files

- `packages/3-extensions/sql-orm-client/src/types.ts`, `src/collection-internal-types.ts`, `src/collection.ts`: the change.
- `packages/3-extensions/sql-orm-client/test/pipe-state-subtyping.types.test-d.ts`: the type tests for cases a to g.
- `packages/3-extensions/sql-orm-client/test/pipe-q1-conditional.types.test-d.ts`, `test/generated-contract-types.test-d.ts`: updated assertions.
- `state-subtyping-measurements.tsv.txt`: every count, per state and run.
- `gen-repeat-probes.mjs.txt`: writes the probes for "Repeated sites". Run it with `measure-pipe.sh.txt` from the previous spike.
