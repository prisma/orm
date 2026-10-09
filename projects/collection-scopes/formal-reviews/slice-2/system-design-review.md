# System design review: scopes (TML-3436, PR #30564)

**Reviewed:** commit 3cb751a92d on `tml-3436-fragment-helpers`, against `bot/tml-3403-collection-keeps-its-class`. Source read from `wip/review-slice-2-skill/tree/`.

**Lens:** architect. This review covers system shape, naming, typology, dependency direction, ADR 259 and the test strategy at the level of which properties must be proven. It does not judge whether the code is correct. Paths below are relative to the repository root.

**Verdict:** CONCERNS. The central idea is sound and well placed: a scope is a plain function, the client reads field builders without importing the contract DSL, and `pnpm lint:deps` passes. The defects are in the vocabulary and typology this PR adds. It re-creates two existing types under new names (`ScopeFieldSpec` duplicates the SQL builder's `ScopeField`; `ScopeFacts` and `ScopeFactsType` duplicate the collection state mechanism). Its two scope makers give opposite result guarantees without saying so. And it pays for a `{ codecId, nullable }` input form that has no consumer and whose stated consumer cannot be written with the public names.

## What the PR adds, at the level of types and modules

- **A scope for any model with given fields.** `db.orm.scope(fields, body)` is a member of the object `orm()` returns. Its result type is `FieldScope<Contract, Fields, Facts>`: a generic function that accepts any collection, of any model in any namespace, whose model has each declared field with the same codec and nullability. It returns the receiver's own type plus `Filtered` or `Ordered` when the body applied a filter or an order. The body receives `ScopeQuery<ScopeRow<…>, ScopeFacts>`, a reduced collection with only `where`, `orderBy`, `limit` and `offset`, whose model accessor holds only the declared fields, each typed as `CodecField`. At run time the scope checks the receiver's model once (`ORM.FIELD_UNKNOWN`). The client contributes only the contract type: the proxy returns the unbound `defineFieldScope` function (`packages/3-extensions/sql-orm-client/src/orm.ts` line 232).
- **A scope for one model.** `Post.scope(body)` is a member of every collection. Through a `this` parameter it reads the contract, model and namespace from the receiver. It returns `Scope<ModelScopeReceiver<…>, Result>`, where `Result` is whatever the body returns when typed against the plain collection of the model.
- **`orderByField(collection, name, direction, allowed)`.** It returns an `orderBy` selector, typed against `OrderableFieldName` and checked at run time.
- **`CodecField<Contract, CodecId, Nullable>`.** This is the model accessor's field type keyed by codec instead of by model field. A parity type test keeps it in step with the model accessor.
- **The facade's composed `field`.** `@prisma/orm-postgres/contract-builder` now exports `field` built from the SQL family pack and the Postgres target pack (`packages/3-extensions/postgres/src/contract/field.ts`). It replaces the family's plain `field` at that entry.
- **A shared column and codec-trait lookup** in `src/column-codec.ts`.

The guarantees introduced are these. A field scope's result is the receiver plus what the body established. A model scope cannot be applied to a collection narrowed by `select` or `variant`. An order name from a request reaches SQL only as an identifier of a column the model owns.

## Subsystem fit and dependency direction

- **The client does not depend on the contract DSL.** `query-fragments.ts` imports nothing from `@internal/sql-contract-ts`. It reads a builder through the structural interface `ScopeFieldBuilder`, which declares a `build()` that returns `{ descriptor?: { codecId }, nullable }`. This matches `ScalarFieldState` in `packages/2-sql/2-authoring/contract-ts/src/contract-dsl.ts` lines 54-75. SD06 covers how this seam is hosted.
- **The facade's `field` is in the right place.** The Postgres facade package already composes the family and target packs for `defineContract`. A standalone composed `field` belongs beside that, in `src/contract/`, and is exported from the `contract-builder` entry. The family package exports only `createComposedAuthoringHelpers`. The direction is target facade → family authoring, which is correct.
- **`pnpm lint:deps` passes** in the reviewed tree: no dependency violations (1,670 modules), no framework-to-target imports, no app-space or import-root violations. The output is in `wip/review-slice-2-skill/lint-deps.txt`.
- **No module cycle.** `collection.ts` imports `assertScopeBody` from `query-fragments.ts`, and `query-fragments.ts` does not import `collection.ts`.

## Findings

### SD01 — `ScopeFieldSpec` duplicates the SQL builder's `ScopeField`, and the two uses of "scope" collide in one package

`packages/3-extensions/sql-orm-client/src/query-fragments.ts` lines 24-31; `packages/2-sql/4-lanes/relational-core/src/expression.ts` lines 13-27; `packages/2-sql/4-lanes/sql-builder/src/scope.ts` lines 24-28.

The relational core already has `ScopeField = { codecId, nullable, many?, codec? }`. It is the descriptor every `Expression<T>` carries, and `@prisma/orm-postgres/builder/types` exports it publicly. There, "scope" means a name scope: the tables and columns visible to a query (`Scope = { topLevel, namespaces }`). This PR adds `ScopeFieldSpec = { codecId, nullable }` to `@prisma/orm-postgres/orm-client`. It has the same shape and the same fields as `ScopeField`, but its "scope" means a function from a collection to a collection. A reader who meets both in one package will assume `ScopeFieldSpec` is the specification of a `ScopeField`. It is not.

The same type therefore exists twice under two names, and one word has two meanings within one public package. Slice 1 already added `Scope` to `orm-client` beside the builder's `Scope`. This PR deepens that homonym by naming a sibling of `ScopeField`.

Discriminator check. The `Spec` suffix has no singular inverse in the client: there is no `ScopeField` in the client, and the `Scope` prefix names the consumer, not what the type is. What the type is: a field declared by codec and nullability. The module already calls it that, in `DeclaredField` and `DeclaredFields`.

**Suggestion.** Rename `ScopeFieldSpec` to `DeclaredField<CodecId, Nullable>`. That makes it the singular of the existing `DeclaredFields`, and the `Scope` prefix goes away. Record the `Scope` homonym between `builder/types` and `orm-client` in `projects/collection-scopes/deferred.md`, so the team can decide whether the builder's name scope is renamed (for example to `NameScope`) before 8.0 GA.

### SD02 — `ScopeFacts`, `ScopeFactsType` and `WithFacts` re-create the collection state mechanism

`packages/3-extensions/sql-orm-client/src/query-fragments.ts` lines 72-93 and 134-138; `src/collection-types.ts` lines 7-29; `src/types.ts` lines 144-168.

ADR 258 gives every collection a declared state property, `[StateType]: State`, with `hasWhere` and `hasOrderBy` flags. It also defines `HasWhere`, `HasOrderBy`, `Filtered` and `Ordered` as the names of those facts. `ScopeQuery` carries a second unique symbol, `ScopeFactsType`, holding a second interface, `ScopeFacts`, with the same two flags. `WithFacts` then translates `ScopeFacts` back into `Filtered` and `Ordered`. So the state mechanism exists twice, and the PR exports a symbol-backed public name (`ScopeFacts`) for a subset of `CollectionTypeState`.

ADR 259 line 87 says the facts are "a declared property of that collection, as on every collection (ADR 258)". The code does not do that. It uses a different property.

**Suggestion.** Make `ScopeQuery<Row, State>` implement `HasState<State>` with `State extends Pick<CollectionTypeState, 'hasWhere' | 'hasOrderBy'>`, and have `where` return `ScopeQuery<Row, State & { readonly hasWhere: true }>`. Then `ScopeFacts` and `ScopeFactsType` are no longer needed, and `WithFacts` reads `CollectionStateOf`. If a separate symbol is required, for example so that a `ScopeQuery` cannot be assigned to a real collection, say so in ADR 259 and name the type for what it is (the state of a field scope body), not for its consumer.

### SD03 — The two scope makers give opposite result guarantees, and ADR 259 states only half of the difference

`packages/3-extensions/sql-orm-client/src/collection.ts` lines 466-485; `src/collection-types.ts` lines 35-47; `src/query-fragments.ts` line 158; ADR 259 lines 116-118.

`db.orm.scope` returns `WithFacts<C, Facts>`: the receiver's own class and state, plus what the body established. This is the ADR 258 shape ("a function from a receiver type `Self` to `Self` plus a fact"). `Post.scope` always returns the body's `Result`, typed against the plain `Collection<Contract, 'Post'>`. That is true even when the body keeps the full row. So `PostCollection.where(…).apply(Post.scope((p) => p.orderBy(…)))` loses the custom class and the earlier filter at the type level. At run time it keeps both, because the body runs on the real receiver.

ADR 259 line 118 says only "A scope that changes the row produces a collection with the default state". A reader concludes that a scope which does not change the row keeps `Self`. It does not. Both makers share the name `scope`, so the asymmetry is invisible at the call site.

**Suggestion.** Choose one of two options and record it in ADR 259.
- (a) Make the asymmetry explicit. State that a model scope's result is always the body's result on the plain collection, so a model scope is for changing the row, and that a filter or order for one model belongs in a class method or a field scope. Add a type test with a body that keeps the row.
- (b) Remove the asymmetry. When the body's row equals the model's full row, return `WithFacts<Self, CollectionStateOf<Result>>`, as field scopes do.

Option (a) is cheaper and keeps both concepts honest. Option (b) is what ADR 258's subtyping rule implies.

### SD04 — Only the field scope checks its receiver at run time

`packages/3-extensions/sql-orm-client/src/collection.ts` lines 473-485; `src/query-fragments.ts` lines 315-322.

A field scope checks the receiver's model before the body runs and throws `ORM.FIELD_UNKNOWN`. A model scope does not capture the model or namespace it was made from. The returned closure runs the body on any collection. A JavaScript caller, or a caller who casts, can apply a `Post` scope to a `Comment` collection, and it fails later with an unrelated error. ADR 259 presents the two makers as parallel, but their run-time guarantees differ.

**Suggestion.** Have `Post.scope` capture `this.modelName` and `this.namespaceId`. The returned scope should throw a model-mismatch error before running the body, in the same `why`/`fix`/`meta` form `assertScopeFields` uses. State the run-time guarantee for both makers in ADR 259.

### SD05 — The `{ codecId, nullable }` input form has no consumer, and its stated consumer cannot be written with the public names

`packages/3-extensions/sql-orm-client/src/query-fragments.ts` lines 24-59 and 164-222; `src/orm.ts` lines 101-125; `src/exports/index.ts` lines 28-33; ADR 259 lines 56, 85 and 145.

ADR 259 justifies the second declaration form with "a package that does not import the facade". Three facts weaken this.

1. No code in the PR, the demo or ADR 260 uses the form. Only the client's own tests do.
2. A package that does not import the facade can already use the family-level `field.column(itsColumnType)` from the SQL contract builder. The structural `build()` interface accepts that builder. Codec ids are target-specific (`pg/...`), so the string form does not make a package more portable than a column type descriptor does.
3. The ADR's consequence, "it takes the client as an argument to call `scope`", cannot be typed with public names. `OrmClientMembers` is not exported, and the `scope` signature uses `ScopeFieldDeclarations`, `DeclaredFields`, `ScopeQuery` and `ScopeRow`, none of which is exported. The declaration-emit fixture (`examples/prisma-8-demo/test/fixtures/declaration-library.ts`) imports the application's own `Contract`, so it does not exercise the package case.

The form costs a second branch in the declaration type, a run-time validator, a public name (SD01), wording in every error and doc string ("a field builder or `{ codecId, nullable }`"), and a second vocabulary (codec id strings) beside the one ADR 259 argues for ("the words the schema used").

**Suggestion.** Remove `{ codecId, nullable }` as an input and remove the package consequence from ADR 259. Keep the normalised type internally under its SD01 name. Declaration output still needs that name, because `FieldScope`'s second argument prints with it. When ADR 260's first package scope exists, add the form back together with a fixture that is generic over the contract, uses only public names, and exports what that fixture proves is needed. If the form stays, add that fixture now.

### SD06 — The builder seam is an implicit interface hosted in the consumer, and it reads two of the builder's facts

`packages/3-extensions/sql-orm-client/src/query-fragments.ts` lines 33-42 and 164-209; `packages/2-sql/2-authoring/contract-ts/src/contract-dsl.ts` lines 54-75.

The client recognises a builder by duck typing: any object with a `build()` method is treated as one. Nothing on the DSL side declares that its builders satisfy `ScopeFieldBuilder`. If `ScalarFieldState.descriptor` is renamed, every builder becomes "names no column type" at run time, and type checking does not catch it. A type test in the demo checks the fit, but the type system does not.

The interface also reads only `descriptor.codecId` and `nullable`. It ignores `kind`, `many`, `typeRef`, the descriptor's native type and type parameters, the column name and the default. So `field.text().many()` and `field.uuidString()` (a `char(36)`) declare more than the scope checks.

The "SPI at the lowest consuming layer" pattern (`docs/architecture docs/patterns/spi-at-lowest-consuming-layer.md`) says that both sides should depend on a declared interface at the lowest layer that can name its types.

**Suggestion.** Declare the shape once, at a layer both packages already import. One option is a type next to `ColumnTypeDescriptor` in `packages/1-framework/1-core/framework-components/src/shared/column-spec.ts`, for example `ScalarFieldDeclaration { kind: 'scalar'; descriptor?: ColumnTypeDescriptor; nullable: boolean; many?: true }`. Have `ScalarFieldBuilder` declare that its `build()` returns that type, and have the client import it. Then decide explicitly whether `many` takes part in matching; whether a list field can match is a correctness question for the code reviewer. Rename `ScopeFieldBuilder` after what it is, not who reads it (SD08).

### SD07 — "Column type" is used to mean "codec"

ADR 259 lines 85, 89 and 95; `packages/3-extensions/sql-orm-client/src/query-fragments.ts` lines 140, 202, 263 and 286; `src/orm.ts` line 103.

A field matches on its codec id and nullability. The ADR, the JSDoc and the error messages call this "column type". An example message is "has column type pg/timestamptz-temporal@1". In this codebase a column type is a `ColumnTypeDescriptor`: a codec id plus a native type plus type parameters. The ADR itself has to explain that "type parameters of the column type are not compared, so `field.uuidString()`, a `char(36)` column, matches a field of any `char(n)`". So the name says one thing and the mechanism does another. The exported names (`CodecField`, `codecId`) already say "codec".

**Suggestion.** Say "codec" wherever matching is described: "a field with that codec and nullability". Keep "column type" only for what the user writes (`field.temporal.timestamptz()`). The other option is to match on the full column type, which is a design change and needs its own decision.

### SD08 — `ScopeRow`, `ScopeQuery` and `ScopeFieldBuilder` name the consumer or the wrong concept

`packages/3-extensions/sql-orm-client/src/query-fragments.ts` lines 33-45, 61-70 and 82-93.

- **`ScopeRow`** is a model accessor: field name → expression with comparison methods. In this package "row" means the result row (`RowType`, `HasRow`, `CollectionRowOf`), and the accessor type is `ModelAccessor`. Read cold, `ScopeRow` is "the rows a scope returns". Rename it to `ScopeModelAccessor`, or better `DeclaredFieldsAccessor`, which describes what it is.
- **`ScopeQuery`** is the collection a field scope's body receives. Everywhere else, including ADR 259 line 87, it is called a collection. Read cold, `ScopeQuery` is "a query that has a scope". Rename it to `FieldScopeCollection`.
- **`ScopeFieldBuilder`** is the shape of a contract field builder, named for the one module that reads it. See SD06.
- **`ScopeFieldDeclarations`** is acceptable once SD01 renames its element type: `DeclaredField` and `DeclaredFields` make `FieldDeclarations` the natural input name.

None of the four is exported from the entry, but all four appear in the public signature of `db.orm.scope` (`src/orm.ts` lines 113-118), so they appear in hovers and error messages. Their names reach users.

### SD09 — "Field scope" and "model scope" are the code's terms but not the ADR's

`packages/3-extensions/sql-orm-client/src/query-fragments.ts` lines 154-158 and 303; `src/collection-types.ts` line 38; test files `field-scope.*` and `model-scope.*`; ADR 259 lines 54-58.

The code partitions scopes into field scopes (`FieldScope`, `defineFieldScope`, `field-scope.test.ts`) and model scopes (`ModelScopeReceiver`, `model-scope.test.ts`). The ADR, README and skill use only the long descriptions "a scope for any model with given fields" and "a scope for one model". Read cold, `FieldScope` sounds like "the scope of one field". Also, `FieldScope` has a named type while the model scope has none, which is a symmetry gap. The gap is acceptable, because a model scope is an ordinary `Scope<In, Out>`, but it should be stated.

**Suggestion.** Define the two terms once in ADR 259 ("a *field scope* … a *model scope* …") and use them in the README and skill. Do not add a `ModelScope` alias. Instead, state that a model scope is a plain `Scope`, and that a field scope needs its own type only because it is generic over its receiver.

### SD10 — "Fragment" survives as module, file and heading vocabulary

`docs/architecture docs/adrs/ADR 259 - Query fragments are functions.md` (title and lines 52-60); `packages/3-extensions/sql-orm-client/src/query-fragments.ts`; `packages/3-extensions/sql-orm-client/test/fragments-fixture.ts`; `packages/3-extensions/sql-orm-client/README.md` lines 87-121; `skills/prisma-8/references/queries-postgres.md` line 359; `examples/prisma-8-demo/src/orm-client/fragments.ts`; `examples/prisma-8-demo/test/query-fragments.types.test-d.ts`; `upgrade-instructions/pending/query-fragment-helpers/`.

No exported identifier says "fragment" or "step", which is good. But the settled word is "scope". The module that defines scopes is still `query-fragments.ts`, and the demo's scopes live in `fragments.ts`. The README heading and the skill section are "Query fragments". The ADR uses "query fragment" as an umbrella term, and the README adds a second term, "row fragment", for a function of the model accessor. Two umbrella words for the same idea will drift.

**Suggestion.** Rename `src/query-fragments.ts` to `src/scopes.ts`, the demo's `fragments.ts` to `scopes.ts`, and the fixture and type-test files to match. Change the README and skill headings to "Scopes". In ADR 259, either define "query fragment" once as the umbrella for "a function of the model accessor or a scope" and keep it out of headings, or retitle the ADR to "Shared queries are functions" and call the row-level case "a `where` function". The upgrade directory name is internal and can stay.

### SD11 — `OrderableFieldName` and `NumericFieldNames` differ in number

`packages/3-extensions/sql-orm-client/src/types.ts` lines 531 and 1356.

Both are exported unions of field names filtered by a codec trait. One is singular and one is plural. **Suggestion.** Use the singular form for new names, as `OrderableFieldName` does, and record the rename of `NumericFieldNames` to `NumericFieldName` as debt, or rename it in this PR if its few uses allow.

### SD12 — Resolving a namespace named `scope`: the rule is acceptable for now but untested and only partly stated

`packages/3-extensions/sql-orm-client/src/orm.ts` lines 120-125 and 226-233; ADR 259 lines 99 and 148; `projects/collection-scopes/deferred.md` (design branch).

The rule is this: if the contract has a namespace named `scope`, the namespace keeps the key and the client has no `scope` method. It is applied the same way at the type level and at run time. It is the only option that does not break existing `db.orm.<namespace>` reads, and the deferred item records the real fix (put the namespaces or the methods under their own member).

Two parts are weak. First, the ADR states the rule but does not say that such an application has no way to make a field scope, or link the deferred fix. Second, nothing tests the rule. Note also that the method uses nothing from the client at run time: the proxy returns the unbound `defineFieldScope`. The client carries only the contract type. That makes the deferred fix cheap.

**Suggestion.** In ADR 259, state the consequence (no field scopes for such a contract), name it a known limitation, and link the deferred item. Add a type test and a run-time test with a contract that has a namespace named `scope`.

### SD13 — A field scope on a receiver whose namespace is not in its type matches the model in any namespace

`packages/3-extensions/sql-orm-client/src/query-fragments.ts` lines 116-149; `src/types.ts` lines 1118-1137.

`CollectionWithFields` requires `HasState<{ nsId: NsId }>` for each namespace of the contract. A collection whose state has `nsId: never`, such as a directly constructed `Collection<Contract, 'Post'>` or some custom classes, satisfies every namespace's entry. So the type check passes if a model named `Post` in any namespace has the fields. At run time the scope resolves the model's own namespace and may throw. ADR 259 documents this widening for model scopes (line 116) but not for field scopes. The package already has `ResolvedNsId`, which resolves `never` to the model's own namespace for exactly this case.

**Suggestion.** Resolve the receiver's namespace with the same fallback the model accessor uses, so that the type check and the run-time check look at the same model. If that is not done, document the widening for field scopes in ADR 259 and add a type test for it.

### SD14 — Test strategy: the partition is sensible, but three properties are not proven

Files: `packages/3-extensions/sql-orm-client/test/field-scope*.ts`, `model-scope*.ts`, `order-by-field*.ts`, `codec-field*.ts`; `test/integration/test/namespaced-accessors-scopes.integration.test.ts` lines 33-61; `examples/prisma-8-demo/test/query-fragments.types.test-d.ts`.

These properties must hold:
1. The facts of a field scope body are sound.
2. A field scope is refused by field shape (missing field, other codec, other nullability, relation, variant-only field).
3. A model scope is refused for a row narrowed by `select` or `variant`.
4. Namespaces are handled correctly.
5. `CodecField` matches the model accessor.

The files split cleanly by helper and by type versus run-time behaviour. A parity test covers property 5, and a compiler-API test checks the refusal message. Properties 1 to 3 are covered well.

Gaps:
- **Namespace refusal is not isolated.** The integration test's `auth.User` and `public.User` have different fields (`token` and `email`). So `orm.public.User.apply(tokens)` would be refused for its row alone, and the test cannot show that the namespace takes part. Use two same-shaped models in two namespaces. These type properties also sit inside a database integration test. A type test over the same emitted fixture would prove them without a database and keep the integration test for run-time behaviour.
- **A model scope whose body keeps the row** is not tested (SD03).
- **A namespace named `scope`** is not tested (SD12).
- **A package-shaped consumer**, generic over the contract and using only public names, does not exist (SD05).
- **The model scope's run-time refusal** does not exist (SD04).

### SD15 — `CodecField` and the model accessor's field type are built twice and kept in step by a test

`packages/3-extensions/sql-orm-client/src/types.ts` lines 322-385 and 558-573.

`CodecOperations` is a copy of the body of `FieldOperations`, and `CodecField` repeats the `Expression & ComparisonMethods & operations` construction of `ScalarModelAccessor`. They differ in one input, the JavaScript value type, because a field can refine its codec (an enum, `Char<36>`). The parity test exists because the two constructions can drift.

**Suggestion.** Build both from one generic over codec id, nullability, value type and traits. Define `FieldOperations` as `CodecOperations<Contract, FieldCodecId<…>>`. Then the parity test only has to guard the documented difference in value type. The effect on type-checking cost is a question for the principal engineer.

### SD16 — The slice spec still says `db.scope` and `db.Post.scope`

`projects/collection-scopes/slices/2-fragment-helpers/spec.md` (reviewed as `wip/review-slice-2-skill/spec.md`, lines 10-24 and 29-31).

The code and ADR 259 use `db.orm.scope` and `db.orm.public.Post.scope`, because `db` is the facade and `db.orm` is the client. ADR 259 is the source of truth, so the code is right. The spec is a project document that later slices will read. **Suggestion.** Update the spec, or note in its header that ADR 259 supersedes its examples.

## Confirmed without findings

- The `scope` members follow Rails usage. A collection member that defines a scope from the receiver's model reads correctly.
- `orderByField` and `OrderableFieldName` fit the existing `orderBy` selector types and add no new concept.
- The facade's composed `field` is correctly placed and correctly documented as "the callback's `field` without extension helpers". Having two objects named `field` (the callback's and the entry's) is a documented trade-off and is acceptable.
- ADR 259's examples match the code: the method names, the refusal message on line 92, and the public names list on line 150, which matches `src/exports/index.ts`.
- ADR 259's alternatives are reasoned from measured costs and from the subtyping rule of ADR 258, and the rejected options are recorded.

## Deferred (out of scope for this lens)

- **Implementation failure modes**, for the code reviewer. `isFieldBuilder` accepts any object with a `build()` method, including a relation builder, which then gets a misleading "named type" error. A list field (`many`) may match a scalar declaration. It is unclear whether `field.namedType(...)` is refused at the type level or only at run time. After `include('comments')` followed by a model scope, the run-time row may have fields its type does not list. Reason: these concern correctness, not shape.
- **Blast radius**, for the principal engineer. Every collection now reserves `scope`, so custom classes and aggregate operations named `scope` break, and the facade's `field.column(...).default(...)` now checks values. Reason: these concern compatibility and upgrades, which the upgrade instructions cover.
- **Type-checking cost**, for the principal engineer. The instantiation counts in ADR 259's cost table, and the cost of SD02 and SD15 if they are adopted. Reason: these concern performance.
- **Learnability**, for devrel. Whether the README "Query fragments" section and the skill reference teach the two makers clearly, beyond the vocabulary points in SD09 and SD10. Reason: this concerns how the prose reads.
- **Scope and user value**, for the PM. Whether a default scope per model, or selecting by shape across models, should follow. Reason: this concerns product framing.
