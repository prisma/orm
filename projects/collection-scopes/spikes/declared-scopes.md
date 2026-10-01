# Spike: cost of scopes declared on the model (variant F)

**Date:** 2026-09-28
**Branch:** `spike-collection-scope-declared`, started from `spike-collection-scope-types` at `5a72d85b57` (variant E).
**Question:** what does type checking cost when scopes are declared on the model in the contract, and not found by comparing index shapes with registry entries?

## Answer

Declared scopes work and cost about the same as variant E. All six requirements hold. For an application, variant F is slightly cheaper than variant E: the demo costs +0.12% over the baseline with no scope in use, against +0.49% for variant E. For the ORM client package's own typecheck, variant F is more expensive: +3.0% against +1.0%. No TypeScript error appeared while building it. Cost does not decide between E and F. The differences are small in both directions.

## Measurements

Instantiation counts from `tsc --extendedDiagnostics`. Every count was measured twice in this session, and the two runs gave the same number. The percentages compare with the baseline.

| Variant | Package, no scopes | Package, with scopes | Demo, no scopes | Demo, with scopes |
| --- | --- | --- | --- | --- |
| Baseline (`072aeb7f57`), measured again | 1,495,458 | n/a | 732,083 | n/a |
| E: registry, matched by shape (`5a72d85b57`), measured again | 1,510,673 (+1.02%) | 1,573,222 (+5.20%) | 735,693 (+0.49%) | 748,029 (+2.18%) |
| **F: declared scopes** (`ed92d4c10a`) | 1,540,332 (+3.00%) | 1,598,705 (+6.90%) | 732,962 (+0.12%) | 745,740 (+1.87%) |
| F with an early return for a model with no scopes, not kept | 1,562,032 (+4.45%) | 1,620,847 (+8.38%) | 733,080 (+0.14%) | 746,797 (+2.01%) |

How to read the table:

- **"Package"** is the typecheck of `packages/3-extensions/sql-orm-client`. "No scopes" excludes `test/scopes*`. "With scopes" includes them.
- **"Demo"** is the typecheck of `examples/prisma-8-demo` against built `dist` output. "No scopes" is the demo unchanged: its contract declares no scopes, and two registry entries are still registered (the Postgres facade and pgvector). "With scopes" adds the declared scopes to the demo's `contract.d.ts` and adds one probe file. The script removes both afterwards.
- **The baseline and variant E counts match the earlier spike exactly.**
- **The "with scopes" columns of E and F use different test files and probes.** Compare the "no scopes" columns first.
- **Wall-clock times are left out**, as in the earlier spike.

## Requirements

| Requirement | Result | Evidence |
| --- | --- | --- |
| (a) The scope operation is typed from the index literal | Holds | Package: `language` is `'english'` for one index and `'simple'` for another, and `only` accepts only the index's columns. Demo: `expression` and `physicalName` are the literal values of the index. |
| (b) Available on root, chained and include-refinement collections | Holds | Package tests "a scope operation returns the collection of the model", "the scope is present on chained collections", "the scope is present inside an include refinement". The demo probe covers all three. |
| (c) A model with no declared scopes has `scopes` of `{}` | Holds | `expectTypeOf(db.public.User.scopes).toEqualTypeOf<{}>()` in the package and in the demo. |
| (d) `this.scopes` is typed inside a custom collection class | Holds | `PostCollection.relevant` calls `this.scopes.search.fulltext(query)`. The result is asserted not to be `any`. |
| (e) Contributions from two packages, typed through built output | Holds | The demo probe declares one scope of type `postgres/fulltext` and one of type `pgvector/spike` on the same index. Each has only its own operations. |
| (f) No type arguments or annotations beyond `<Contract>` | Holds | The demo's `src/prisma/db.ts` is unchanged. |

Also checked:

- A declared scope whose type is not in the registry is left out of `scopes`.
- The scope name comes from the declaration, not from the index. In the demo, `scopes.post_title_search` is an error and `scopes.titleSearch` exists.
- Every demo run also typechecks a probe that asserts `db.orm.public.Post` and its `scopes` are not `any`. The declared-scopes probe asserts the same for the root, chained, include-refinement and `User` collections.

## Every type that changed

Paths are under `packages/`. The comparison is with variant E.

| Type | Location | Change |
| --- | --- | --- |
| `ScopeOperationsShape` | `3-extensions/sql-orm-client/src/scopes.ts` | The `match` member is removed. |
| `CollectionScopeRegistry` | same file | Unchanged in form. A key is now a scope type id, which is what the contract writes in `type`. |
| `MatchingIds`, `ScopeOperationsFor`, `UnionToIntersection`, `ScopeKey`, `ScopeNamesOfIndexes`, `ScopesOfIndexes` | same file | Removed. |
| `DeclaredScopes` (new) | same file | Maps over the model's declared scopes. It leaves out a scope whose `type` is not a registry key. |
| `IndexNamed`, `IndexOfScope`, `RegisteredTypeOf` (new, not exported) | same file | Find the index whose authored name equals `params.index`, and read the registry key. |
| `ModelDeclaredScopes` (new) | `3-extensions/sql-orm-client/src/types.ts` | Reads `scopes` from the model definition. It gives `{}` when the model has no `scopes` key. |
| `CollectionScopes` | `3-extensions/sql-orm-client/src/collection.ts` | Calls `DeclaredScopes` with the declared scopes, the table's indexes and the collection type. |
| `SqlCollectionScopeContribution` | `2-sql/4-lanes/relational-core/src/query-lane-context.ts` | The `matches` method is removed. The runtime finds a contribution by `id`. |
| `PostgresFullTextScope` | `3-extensions/postgres/src/runtime/fulltext-scope.ts` | `match` removed. |
| `SpikeExtensionScope` | `3-extensions/pgvector/src/core/spike-scope.ts` | `match` removed. |

Not changed: `Collection`, `CollectionTypeState`, `orm()`, `OrmOptions`, `postgres()`, `PostgresClient`, the contract types, the emitter and the PSL attribute.

Runtime changes, all throwaway:

- The collection constructor reads `scopes` from the model entry in the contract's domain plane. It reads it through a cast, because the model entry type has no `scopes` member.
- `orm()` throws at construction when a declared scope names a type that no runtime contribution provides. This replaces the variant E check that read `options.requiresScopes` from the index.
- Contract deserialization kept the `scopes` key on the model. No validator change was needed.

## Fixtures

- **Package:** `test/scopes-fixture.ts` adds `scopes` to the `Post` model of the test contract type with a helper type. `test/scopes.test.ts` adds the same key to the contract JSON before it is deserialized.
- **Demo:** `demo-contract-declared-scopes.mjs.txt` inserts the `scopes` key into the `Post` model in `contract.d.ts`. The measuring script applies it for the "with scopes" run and restores the file afterwards. The demo is unchanged on the branch.

## TypeScript errors hit

None from the design. No "excessively deep" error and no circular reference error appeared. The `scopes` member is still written inline in the `Collection` alias, as in variant E, so caveat 7 of the first spike still applies.

One fixture error: the helper type that adds `scopes` to the contract was first constrained to `TestContract`. The contract with replaced indexes does not satisfy that constraint. Removing the constraint fixed it.

## Surprises

- **Variant F costs more than E in the package and less in the demo.** I did not find the cause. The package typechecks generic code and many tests that create collection types. The demo typechecks one concrete contract.
- **Returning `{}` early for a model with no scopes made both numbers worse.** This matches the first spike, where an early return for an empty contribution list also did not help.
- **The type tests passed on the first typecheck.**

## Not tested

- `GroupedCollection`, prepared collections, polymorphic variants (`.variant()`), contracts with several namespaces, and the Mongo ORM client.
- A declared scope whose `params.index` names no index. The `index` slot would be `never`. No test covers it.
- Two declared scopes of different types are tested on one index. Two packages that register the same type id are not tested.
- The demo was only typechecked. No demo runtime test was run with declared scopes, and the demo's `contract.json` was not changed.
- The full test suites were not run. Only `test/scopes.test.ts` (5 tests, all pass) and the typechecks were run.
- The emitter and the PSL attribute do not produce the `scopes` key. The fixtures write it by hand.
- Editor readability of the printed types was not checked again.

## Files

- `measure-declared.sh.txt`: the script that produced every number here. It runs each measurement twice.
- `demo-probe-declared.test-d.ts.txt`: the demo probe for variant F.
- `demo-probe-notany.test-d.ts.txt`: the probe that asserts the demo's collections are not `any`.
- `demo-contract-declared-scopes.mjs.txt`: the script that adds declared scopes to the demo's `contract.d.ts`.
