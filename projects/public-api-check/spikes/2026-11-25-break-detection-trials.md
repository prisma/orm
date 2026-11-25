# Trials: finding breaks against the last release (2026-11-25)

Two trials, run on `8.0.0-rc.25` against the build of `main` from 2026-11-25. Briefs: [../slices/break-detection/dispatches/](../slices/break-detection/dispatches/). Full reports and code are gitignored under `wip/break-spike/types/` and `wip/break-spike/apps/`.

## Generated type tests

**Verdict: works, with four changes to Fluid's method.** Over all 21 released packages it found both real changes since `rc.25`, the join-scope change in prisma/orm#31150 and the widened `storedNameUnsupported` key in prisma/orm#31185, and every planted break. 127 seconds for all packages on a laptop, including forwarded names, which are 70% of the tests and are skipped.

1. **Keep signatures.** Fluid's `TypeOnly` turns every function and method into `{}`, so it only checks that they exist. It missed every planted signature change and #31150, and gave 110 false failures from branded types. The trial's preprocessor keeps call and construct signatures and turns methods into function-typed properties. It is written twice, once per side, because with one shared alias TypeScript compares by the alias's measured variance, which treats method parameters as bivariant and let a narrowed method parameter pass.
2. **One direction: the current type must be assignable to the last release's type**, for types and values. With signatures kept, a new required member on a type users implement (`CacheStore`) fails through the exported function that accepts it (`createCacheMiddleware`), and a new member on a type users only receive (`CacheMiddleware`) passes. So the compiler decides which interfaces users implement, and nothing needs tagging. Fluid tests both directions and needs `@sealed` and `@input` tags only because its preprocessor erases signatures.
3. **The release's copies get their own version, and its third-party dependencies are pinned to the lockfile's versions.** The build and the release were both `8.0.0-rc.25`, and TypeScript treats two copies with the same name and version as one package without comparing them: the first run checked nothing. Different `pg` and `mongodb` versions between the two installs gave 47 false failures. Each generated file also ends with a test that must fail.
4. **"Type instantiation is excessively deep" (TS2589) is reported as undecided, not as a break.** It is the only false failure left: 16 of 18,216 tests on the packages' own exports, on recursive types such as `JsonObject`.

A deliberate break is recorded with its reason; the generator writes `// @ts-expect-error <reason>` above that test, and once the break is undone the unused directive fails the compile.

**Planted changes** in a copy of the cache middleware's declarations: removing an export, narrowing a parameter, narrowing a method parameter, making an optional parameter required, widening a return type, and adding a required member to an implemented interface all fail. Adding an optional parameter or property, and a required member on a type users only receive, pass.

**Known limits.** Generic types are tested with `never` for type parameters without a default (20% of type tests; #31150 was still caught through `Db<never>`). Generic functions are compared at their constraints and overloads by the last signature; neither was planted. Brands reduce to their primitive, so swapping one branded string for another is not seen. A break inside a TS2589 type is not seen. A recorded break hides other errors on the same test until the next release. Up to 3.2 GB of memory per package. `declare module` augmentations were not tested.

**The last release.** The registry's `latest` is `8.0.0-rc.25` for 21 packages. `@prisma/orm-better-auth` has `latest` at a hand-published `0.0.0` and no `rc.25`, so a package's own dist-tag is not reliable. `publish.yml` publishes a release when the root version changes on `main` and tags it `v<version>`; dev builds get `-dev.N` tags. A package with no version equal to the last release has no release yet and is not checked.

**The fallback** (comparing `api.txt` at the release tag) is not needed, and would not yet work: `rc.25` predates the lists.

## The last release's example apps

**Verdict: works and is cheap.** `examples/prisma-8-demo` at `v8.0.0-rc.25` compiles against the current build with 0 errors in about 4 seconds. In CI's `typecheck` job: fetch the tag with depth 1, replace each app's files apart from `node_modules` with the tag's (`git archive`), and run its `tsc --noEmit`. The app's `node_modules` already resolve `@prisma/*` through `exports` to the current build, as a user's would. No second install, no git worktree, no database.

Planted changes to a result type in a copy of `orm-family-sql`'s declarations: every row field made nullable gave 35 errors in 15 files; rows made `readonly`, 8. Dropping `| null` from a query operation's return was not caught, because no app has one.

1. **The apps' type tests assert exact types.** A new optional property on a row failed 15 checks, and an input that used to be rejected and is now accepted fails `@ts-expect-error` lines. Both are additions the compatibility policy allows, so these failures are recorded with a reason, as the generated tests' are.
2. **Old contracts.** At `rc.20`, the app's committed contracts gave 1,491 errors against today's build; with the main contract re-emitted, 123. The compatibility policy says a contract and its generated types are read by every later release with no re-emit, so the check compiles the contracts as committed.
3. Two apps need a step before typecheck (`prisma7-adoption`, `react-router-demo`). An app that did not exist at the tag is skipped.

## A comparison that decides the large packages (2026-11-26)

Brief: [../slices/break-detection/dispatches/06-trial-comparison.md](../slices/break-detection/dispatches/06-trial-comparison.md). Code and logs (gitignored): `wip/compare-trial/`.

**Why it was needed.** The structural helpers above map every member recursively. Once a "type instantiation is excessively deep" error stopped hiding later tests (TypeScript caches the failure, and every later test reaching that type passed unchecked), 7,758 of 9,108 comparisons over all packages ended undecided within a two-minute budget per package.

**Verdict: compare natively, on declarations rewritten in memory, with fallbacks.** Over all 21 packages: 9,991 tests, 79 undecided, every known break found, no break in a control run comparing each package with a copy of itself, all 16 fixtures unchanged. 405 s one package at a time.

1. A compiler host rewrites our packages' declarations on both sides as it reads them: methods become function-typed properties (overloads a literal with one call signature each), so parameters compare contravariantly; private, protected and `#private` members are dropped; each `unique symbol` constant becomes a string literal, so keys made from it still compare across the two copies. In third-party declarations only private and protected members are dropped: rewriting their methods would make arrays invariant.
2. TypeScript compares the rewritten exports natively, which handles recursion with its own caching. Classes also get a constructor-parameters test, because constructor parameters stay bivariant.
3. A native failure is confirmed against a second copy of the release. If the same test fails there too, TypeScript cannot relate two copies of that type (deferred generic types), and it falls back: first to comparing with generic signatures instantiated at their constraints, then to the structural helpers, then to undecided.

Native comparison without the rewrite gave 643 false breaks in `orm-framework` and 1,130 in `orm-family-sql` (`#private` members), and missed a narrowed method parameter. Generating one test per member was not needed once methods are rewritten. A structural cut at "named types from our packages" cannot be written at type level.

Breaks planted in a copy of `orm-family-sql` were found: a deep method parameter narrowed (10 breaks), a member removed (1), a required field added to the framework's `ExecutionPlan` (18). One false break remained, in `orm-toolchain`, from two physical copies of `vite` on the two sides; fixed by resolving both sides to one copy.

**Not seen.** The 79 undecided: generic APIs TypeScript cannot relate across two copies, and 9 stack overflows in the Mongo query builder. TypeScript's own recursion limit, where it assumes deeply nested types are related.
