# System design review: a collection keeps its class through the chain

**Reviewed:** commit 7e0e3cac24 on `tml-3403-collection-keeps-its-class` (PR prisma/orm#30560) against `bot/collection-chaining-and-fragments-design`. **Lens:** architect. **Design source of truth:** ADR 258 (Accepted on this branch), ADR 175.

## Verdict

The design holds together. The concept is sound and the code matches ADR 258: the type state and the row are declared properties keyed by unique symbols, unknown flags are `boolean`, every chaining method infers its receiver through a `this` parameter and returns the receiver plus a named fact, and so a filtered collection is a subtype of an unfiltered one. The asymmetry for `select` and `variant` is real, has two different reasons, and ADR 258 and the README state both reasons correctly. The Mongo client is left unchanged, and ADR 258 says so. `pnpm lint:deps` passes in the tree (1484 modules, no violations; output in `wip/review-slice-1-skill/lint-deps.arch.txt`).

The findings concern the vocabulary this PR makes public. These names are new exports in this PR, so renaming them now costs nothing for users. Renaming them after a release needs upgrade instructions. The two that matter most are SD01 (the word "state" now names two different things on the public surface) and SD02 (`Scope` does not encode what ADR 258 says a scope is).

## Findings

### SD01: "State" names two different things on the public surface

**Where:** `packages/3-extensions/sql-orm-client/src/collection-types.ts` lines 5 and 12–15 and 35–36; `packages/3-extensions/sql-orm-client/src/types.ts` lines 89–98 and 144–168; `packages/3-extensions/sql-orm-client/src/exports/index.ts` lines 2–15 and 36–37.

**Issue:** The package already exports `CollectionState`, the run-time record of filters, includes and order. The Query Lanes subsystem doc describes it as the state that all database families share. It also exports `CollectionTypeState`, the compile-time flags. This PR adds `HasState`, `StateType` and `CollectionStateOf`, and all three refer to `CollectionTypeState`, not to `CollectionState`. If you show a new reader `CollectionStateOf<C>` with no context, they will expect it to return a `CollectionState`. It returns a `CollectionTypeState`. In the same export list, `CollectionStateOf` and `CollectionState` sit next to each other and name different things. This is a homonym in the shared vocabulary of the client.

**Suggestion:** Name the new exports after the concept they carry: `CollectionTypeStateOf`, `HasTypeState`, `TypeStateType` (or `TypeStateKey`). The shortest acceptable fix is to rename `CollectionStateOf` alone, because users write it most often. Update ADR 258, the README section "Custom collections", the skill references and the upgrade instructions to match. Do it in this PR, before the names ship.

### SD02: `Scope<In, Out>` does not encode what ADR 258 says a scope is

**Where:** `packages/3-extensions/sql-orm-client/src/collection-types.ts` lines 32–33; ADR 258 line 46.

**Issue:** ADR 258 defines a scope as "a function from a receiver type `Self` to `Self` plus a fact". The exported type is `(collection: In) => Out`, with no constraint on `In` or `Out`. `Scope<number, string>` is valid, and so is a function that ends in `first()`. The name claims a domain concept, but the type is an ordinary one-argument function type, so it costs the reader a name without adding any check. `apply` does not use `Scope`; it takes `(collection: Self) => Out`, which is correct because `apply` accepts any function. That leaves `Scope` as the only place where the concept could be enforced, and it does not enforce it.

**Suggestion:** Constrain the result to the receiver: `type Scope<In, Out extends In = In> = (collection: In) => Out`. This encodes "the receiver plus a fact". `Filtered<C>`, `Ordered<C>` and `Including<C, …>` all extend `C`. A function that uses `select` or ends in a terminal is then a function, not a scope, which is what the ADR says. Before you change it, check that the slice 2 plan (`db.scope`, `db.Post.scope`) agrees with the constraint. If the constraint is not wanted, document `Scope` as a plain alias and explain why it is worth having a name for it, or drop the export.

### SD03: `hasUniqueFilter` is a flag that nothing sets

**Where:** `packages/3-extensions/sql-orm-client/src/types.ts` lines 147 and 165; `upgrade-instructions/pending/collection-keeps-its-class/app/instructions.md` lines 35 and 157 (the same lines in `extension/instructions.md`); ADR 258 line 71.

**Issue:** `CollectionTypeState` and `DefaultCollectionTypeState` declare `hasUniqueFilter`, but no source in the package sets it or reads it. This PR changes its default from `false` to `boolean`, and the upgrade instructions tell users about the change. ADR 258 line 71 lists what the type state holds and does not list `hasUniqueFilter`. So the public type has a field that the design does not describe and that nothing uses.

**Suggestion:** Remove `hasUniqueFilter` from both types and from the upgrade instructions. If removing it is out of scope for this PR, add one sentence to ADR 258 line 71 saying that the flag exists and nothing establishes it, and record its removal as follow-up work.

### SD04: The filter fact has two homes

**Where:** `packages/3-extensions/sql-orm-client/src/collection-internal-types.ts` lines 34–36 (`WithWhereState`); `packages/3-extensions/sql-orm-client/src/collection.ts` lines 471–494 (`variant`); ADR 258 lines 86 and 195.

**Issue:** ADR 258 line 195 says "The type arguments hold what the collection started with; the facts are in the intersection." `variant` breaks that rule: it writes `hasWhere: true` into the `State` type argument through `WithWhereState`, while `where` adds the `HasWhere` intersection. Line 86 states this, but line 195 then states a general rule that `variant` breaks. Two internal names also describe the same fact in two ways: `WithWhereState<S>` and `Filtered<C>`.

**Suggestion:** Change line 195 to cover `variant`, for example: "The type arguments hold what the collection started with, and what `variant` fixes; every other fact is in the intersection." Rename `WithWhereState` to a name that says it writes the filter fact into a type argument, for example `FilteredTypeState`, so that the internal and public names share one vocabulary.

### SD05: The `Has*` prefix covers carriers and facts; the flag, the interface and the alias each use a different word

**Where:** `packages/3-extensions/sql-orm-client/src/collection-types.ts` lines 7–27.

**Issue:** Discriminator probe. `HasRow<R>` and `HasState<S>` are carriers: generic interfaces that name a declared property. `HasWhere` and `HasOrderBy` are facts. Their names come from the method names and the flag names (`where`, `hasWhere`), while their aliases use adjectives (`Filtered`, `Ordered`). So a reader meets three words for one fact: the flag `hasWhere`, the interface `HasWhere` (which error messages print), and the alias `Filtered` (which the documentation teaches). The family holds together structurally, because `HasWhere extends HasState<{ hasWhere: true }>`, so the shared prefix is true. But no document states how the three words map onto each other, and a user who reads "not assignable to … 'HasWhere'" has to work out that this means "not `Filtered`".

**Suggestion:** Keep the names; renaming would cost more than the confusion. Add one sentence to ADR 258 under "How it works" and to the README: the flag `hasWhere` is set by `HasWhere`, which is what `Filtered<C>` adds and what errors print. Do the same for `hasOrderBy`, `HasOrderBy` and `Ordered`. The JSDoc on `HasWhere` already does half of this; make the README say it too.

### SD06: `HasRow` also carries values that are not rows

**Where:** `packages/3-extensions/sql-orm-client/src/collection-types.ts` lines 7–10; `packages/3-extensions/sql-orm-client/src/types.ts` (`IncludeScalar`, `IncludeCombine`, which now extend `HasRow`); `packages/3-extensions/sql-orm-client/src/collection-internal-types.ts` lines 116–131.

**Issue:** Before this PR the carrier was `RowSelection`, and it was internal. Now it is the public `HasRow`, and its doc comment says that an include scalar "produces rows". An include scalar produces one value, such as a count, for each parent row. `IncludeRefinementValue` has to tell the two cases apart with a `kind` check, because the carrier does not separate them. The public name hides a difference that the code still has to handle.

**Suggestion:** Reword the doc comment to say what is true, for example: "Something that yields a value of type `Row` for each parent row or collection: a collection's row, or an include scalar's or combine's result." Or keep a separate internal carrier for include results, so that `HasRow` means only a collection's row. The first option costs one line and is enough.

### SD07: Two declared row properties, and the ADR gives the wrong reason for symbol keys

**Where:** `packages/3-extensions/sql-orm-client/src/collection.ts` lines 272–274; ADR 258 line 104.

**Issue:** The class declares `[RowType]` and `_row?: CollectionRowOf<this>`. `_row` is the `ResultType` protocol that `framework-components` reads across query lanes (ADR 250 item 8). It is derived from `[RowType]`, so the two cannot drift apart. But ADR 258 does not mention `_row`, and a reader of the class sees two row properties with no explanation. Separately, ADR 258 line 104 says that symbol keys mean the properties "never collide with a model's field names and never show up in a row". The properties are on the collection, not on the row. The collisions that symbol keys prevent are with collection members: methods of a custom class, aggregate reducer names, and `_row` itself.

**Suggestion:** Correct line 104: the symbol keys keep the properties from colliding with members of a custom class or with aggregate reducer names, and keep them out of autocompletion. Add one bullet under "How it works": `_row` is the framework's `ResultType` property and is defined as `CollectionRowOf<this>`.

### SD08: The shared-interface section of the subsystem doc now describes behaviour that only SQL has

**Where:** `docs/architecture docs/subsystems/3. Query Lanes.md` line 358.

**Issue:** The section lists what both database families share (ADR 175). This PR adds to that list that domain methods "stay available through the chaining methods", with the note "(SQL: ADR 258)". The Mongo `MongoCollection` chaining methods still return `MongoCollection<…>`, so on Mongo a subclass is lost after one call, and Mongo has no `hasWhere` guard. The parenthetical shows the difference, but the bullet sits in a list of shared properties. ADR 175 itself stays coherent, because ADR 258 "What this decision covers" and "Later decisions" state the gap.

**Suggestion:** Reword the bullet so that the difference is stated plainly, for example: "… with domain methods. On SQL they stay available through the chaining methods (ADR 258); the Mongo client does not keep the subclass yet."

### SD09: The PR description gives a different reason for the `select` and `variant` asymmetry than the ADR

**Where:** PR #30560 body, the "What this PR does" table and the "What reviewers should look at" list; ADR 258 lines 84–86; `packages/3-extensions/sql-orm-client/README.md` line 79.

**Issue:** The asymmetry is right, and ADR 258 and the README state it correctly: `select` narrows the row, which an intersection cannot express; `variant` changes the type argument that the model accessor reads. The PR table gives one reason for both ("because the rows are no longer the model's"), and that reason is wrong for `variant`, whose row is a subtype of the model's row. The PR body also gives different cost numbers from the ADR (694,561 and 13% against 700,735 and 11%) and says the tests are "in four files" when there are seven.

**Suggestion:** Make the PR body match the ADR: give the two reasons, use the numbers that ADR 258 last measured, and list the seven type test files (see the test strategy section below).

### SD10: Test strategy: the subtyping property is never tested directly, and the declaration-emit check sits outside the owning package

**Where:** `packages/3-extensions/sql-orm-client/test/collection-guards.types.test-d.ts`; `packages/3-extensions/sql-orm-client/test/collection-conditionals.types.test-d.ts`; `examples/prisma-8-demo/test/declaration-emit.test.ts`.

**Issue:** Each test file proves one property, and together they cover the design:

- `collection-chaining.types.test-d.ts` proves that the class and the facts survive the chain, that `include` widens the row, that `select` and `variant` leave the class, and that `apply` works.
- `collection-conditionals.types.test-d.ts` proves that every form of conditional reduces to the unfiltered type.
- `collection-guards.types.test-d.ts` proves the guards on the receiver and the TML-3397 regression.
- `collection-generic-row-reads.types.test-d.ts` and `collection-include-in-class.types.test-d.ts` prove that rows can be read through a generic receiver.
- `collection-variant-chaining.types.test-d.ts` proves the behaviour of `variant`.
- `collection-chaining.test.ts` proves the run-time class and `apply`.
- `declaration-emit.test.ts` proves that the declarations can be emitted and used.

Two gaps remain at the architectural level. First, the property everything else depends on, that `Filtered<C>` is assignable to `C` and `C` is not assignable to `Filtered<C>`, is proven only through what follows from it (conditionals reducing). No assertion states the property itself, so a failure would show up as many confusing conditional failures instead of one clear one. Second, the declaration-emit check is the standing check for the exported vocabulary (TS2527 and similar errors), but it lives in `examples/prisma-8-demo` and runs only under `test:examples`. `pnpm test:packages`, which AGENTS.md documents as the cheapest health signal, does not run it. A change to `sql-orm-client` that is verified locally with `test:packages` can break it unnoticed. This is acceptable, because the test needs the published facade and CI runs `test-examples`, but nothing in the package tells a contributor that the check exists.

**Suggestion:** Add one test, `a filtered collection is a subtype of an unfiltered one`, with `expectTypeOf<Filtered<PostCollection>>().toExtend<PostCollection>()` and `expectTypeOf<PostCollection>().not.toExtend<Filtered<PostCollection>>()`, plus the same pair for `Ordered`. Add one sentence to the README section "Custom collections" (or to a comment in `collection-types.ts`) saying that the declaration output of these names is checked by `examples/prisma-8-demo/test/declaration-emit.test.ts`.

## Checked and found coherent

- **Concept.** Facts as intersections, monotonic from `boolean` to `true`; `Filtered<Filtered<C>>` collapses to one fact; a `this` parameter instead of the polymorphic `this` type, because of the `Omit` used for include refinements. Each choice has its reason recorded in ADR 258, and the code matches it.
- **Subsystem fit.** All new types live in `sql-orm-client` (extension layer). Nothing moved into `packages/1-framework`. The Postgres, SQLite and Supabase facades get the names through the `@prisma/orm-family-sql/orm-client` shell build with no hand-written re-exports. `lint:deps` passes.
- **Vocabulary.** No public name uses "step", "fragment" or "pipe". The commits that renamed `Step` to `Scope` and `pipe` to `apply` are complete in the source, the README, the skill references and the upgrade instructions. No public name ends in `Impl`; the base class is `CollectionBase`, kept internal as ADR 258 says.
- **Mongo and ADR 175.** The Mongo interface is unchanged, and ADR 258 records the gap as a later decision (apart from the subsystem doc wording in SD08).
- **Public names that pass the probes.** `Filtered`, `Ordered`, `Including`, `CollectionRowOf`, `RowType` (a PascalCase exported symbol, as `RelationKeys` in `framework-components` already is) and `DefaultCollectionTypeState` (an existing name; "default" here means the default of the type parameter).

## Deferred (out of scope)

- **`where` with an input that normalizes to no filter still returns `Filtered<Self>`** (`packages/3-extensions/sql-orm-client/src/collection.ts` lines 433–438). The type then allows `deleteAll` on a collection that has no `WHERE`. Whether `where({})` or a callback returning nothing can get there is about whether the implementation is correct. Referred to the principal-engineer pass.
- **A run-time guard on `deleteAll` and `updateAll`.** ADR 258 lists it as a later decision. Whether it is needed is a question of operational risk and product scope. Referred to the principal-engineer and PM passes.
- **Emitted declarations name `@prisma/orm-family-sql`, not the facade (TML-3433).** This is how the facades publish their types, and it predates this PR. Referred to the principal-engineer and OSS passes.
- **Inside a class body, a class method loses the facts of the call before it (TML-3434).** The limit is documented. Whether it is acceptable is a question of learnability and product scope. Referred to the devrel and PM passes.
- **Instantiation cost and the extra overloads on `select` and `variant`.** These are questions of cost and buildability. Referred to the principal-engineer pass.
- **Whether the README and skill prose teach the concept well.** Referred to the devrel pass.
