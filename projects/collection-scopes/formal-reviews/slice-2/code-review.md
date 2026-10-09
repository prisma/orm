# Code review: slice 2, shared query fragments as scopes

Reviewed: commit 3cb751a92d on branch tml-3436-fragment-helpers (prisma/orm#30564), against base bot/tml-3403-collection-keeps-its-class. Lens: principal engineer (failure modes, blast radius, operability, cost). Design source of truth: ADR 259, "Query fragments are functions".

## Summary

The slice is in good shape. The three helpers match ADR 259. The type-level checks hold up against most attempts to make a scope claim more than its query does. The test suites, the demo and the cost target all pass when run.

The weakness with the most leverage is F02. The body of a scope for any model may call `limit` and `offset`, and the scope's result records only `Filtered`. So `deleteAll`, `updateAll` and `update` compile after it, and those mutations ignore the limit and the order at run time. I ran a scope that filters, orders and takes 10 rows, then called `deleteAll`: the DELETE statement had the filter and nothing else. Every matching row would be deleted. The client already behaves this way when the chain is written inline. The scope makes it worse, because the call site, `db.orm.public.Post.apply(recentTen).deleteAll()`, does not show the limit.

The second concern is security. With no `allowed` list, `orderByField` lets request text pick any orderable field, including secret ones (F01).

Everything else is small. Some checks for JavaScript callers are missing. A typo in a codec id shows up as an unclear error far from its cause. The run-time error is missing the namespace. One column lookup is still duplicated.

Commands I ran on the reviewed commit, with their logs under `wip/review-slice-2-skill/`:

- `pnpm lint:deps`: exit 0 (`lint-deps.log`).
- sql-orm-client tests: 1,198 passed, no type errors (`test-orm-client.log`).
- postgres facade tests: 329 passed (`test-postgres.log`).
- prisma-8-demo tests: 90 passed, including `declaration-emit.test.ts` (`test-demo.log`).
- One integration file, `namespaced-accessors-scopes.integration.test.ts`: passed (`test-int-ns.log`).
- Demo typecheck: 769,040 instantiations (`demo-current.log`).

Probe files are in `wip/review-slice-2-skill/probes/`. Their results are in `probe-scope-typecheck.log`, `typecheck-integration-probe2.log` and `probe-runtime-out.txt`.

## What looks solid

- **The facts brand on `ScopeQuery` works.** I tried several ways to make a scope claim a filter or order its query lacks. All of them were refused:
  - reassigning a `let`;
  - explicit type arguments on `db.orm.scope` and on `Post.scope`;
  - an explicit namespace that differs from the receiver's;
  - union receivers that include a model without the field;
  - `.call` with a wrong model;
  - `Pick` of a collection without its state.

  `Omit<Collection, 'where' | 'deleteAll'>` is accepted. That is sound, because the real object still has the methods. A union of two valid receivers gives `Filtered<union>`.
- **The run-time field check runs before the body and reads the receiver's own contract and namespace.** A wrong type or a JavaScript caller cannot reach SQL with a field the model lacks. The tests show the body is not called on refusal (`field-scope.test.ts`, "refuses a model without the field before running the body").
- **`orderByField` passes request text to SQL only as a checked identifier.** The name must be in `Object.keys(model.fields)`, filtered by the `order` trait and by `allowed`. It then goes through the model accessor's field-to-column mapping. The direction must pass `isOrderByDirection`. Names such as `__proto__` and `constructor` are refused, and a test covers this. Error text is passed through `JSON.stringify` and cut to 64 characters.
- **The removed `where` overload was an exact duplicate.** `WhereDirectInput` is `WhereArg` (`collection.ts` line 201), so no code that compiled before fails now.
- **Bundle cost of the facade `field`.** `contract/define-contract.ts` already imports `@internal/family-sql/pack` and `@internal/target-postgres/pack` in the same `contract-builder` entry, so the new `contract/field.ts` adds no new module to that entry. The composed `field` keeps `column`, `generated` and `namedType` (`composed-authoring-helpers.ts` lines 228–230), so no existing member disappeared. The client reads builders only through the structural `ScopeFieldBuilder` interface and does not import the DSL.
- **Unused cost is as stated.** I measured the demo with the base demo sources in both runs. With the slice's packages it took 730,140 instantiations; with the base packages, 729,854. The difference is +286 (+0.039%), which is exactly the ADR's figure and well under the spec's 0.2% limit (`demo-A-basedemo-curpkgs.log`, `demo-B-basedemo-basepkgs.log`).
- **Tests assert results, not just that something exists.** The run-time plan tests compare the applied plan with the same query written inline. They also include a control that must differ, for example `not.toEqual(unfiltered)`, so they would fail if `apply` did nothing.

## Findings

### F01: `orderByField` without `allowed` lets request text order by any field, including secret ones (security)

Location: `packages/3-extensions/sql-orm-client/src/query-fragments.ts` lines 424–494 (default at line 466); `packages/3-extensions/sql-orm-client/README.md`, "A field to order by, from a request".

When there is no `allowed` list, `allowedNames` is every orderable field of the model. I checked this with `orderByField(plain.Post, 'userId')`, which returns a selector. A text column such as `passwordHash`, `resetToken` or `apiKey` has the `order` trait. A caller who controls the sort parameter can therefore order rows by a secret value. If they can also see the order of the results, for example by creating their own row and watching where it lands, they can recover the secret by binary search. Leaking data through sort order is a known attack class. The helper exists for request input, so its default should be the safe one. The skill reference already tells authors to pass a list. The README and the ADR describe the open default as a feature.

Suggestion: make `allowed` required. Typed callers get a compile error; JavaScript callers get `ORM.ARGUMENT_INVALID`. If keeping all fields as the default is a deliberate product choice, record it as such in ADR 259 and warn about it in the README.

```ts
export function orderByField<..., const Allowed extends OrderableFieldName<TContract, ModelName, NsId>>(
  collection: ModelCollection<TContract, ModelName, NsId>,
  name: string,
  direction: string | undefined,
  allowed: readonly [Allowed, ...Allowed[]],
)
```

### F02: a scope's `limit` and `offset` are dropped by `deleteAll`, `updateAll` and `update`, and the result type allows those calls (correctness, data loss)

Location: `packages/3-extensions/sql-orm-client/src/query-fragments.ts` lines 83–93 (`ScopeQuery` offers `limit` and `offset`) and the `WithFacts` type; `packages/3-extensions/sql-orm-client/src/collection.ts` lines 2620–2650 (`deleteAll` compiles only `this.state.filters`).

Probe P6 (`probe-runtime-out.txt`) defines a scope that filters on `deletedAt is null`, orders by `deletedAt desc`, and takes 10 rows. It then calls `plain.Post.apply(recentTen).deleteAll()`. This compiles, because the result is `Ordered<Filtered<…>>`. The executed AST was a `delete` with only the null check: no order and no limit. Every non-deleted post would be deleted. The same thing happens with `db.Post.where(…).limit(10).deleteAll()` written inline, so the cause predates this slice. What is new is that this slice lets the limit live inside a named scope that the mutation's call site does not show. The ADR also presents "`update` is allowed after a scope that filters" as a benefit. On-call would see a delete that removed far more rows than the code seems to ask for, and nothing in the logs would explain it.

Suggestion, cheapest first:

1. Take `limit` and `offset` out of `ScopeQuery`. They are the only body methods whose effect is lost by mutations, and a caller can still write `.limit(n)` after `apply` where it is visible. This changes ADR 259's list of body methods, so Will needs to agree.
2. If they stay, make the mutation methods throw `ORM.ARGUMENT_INVALID` when the collection's state has `limit`, `offset` or `orderBy`. Add a test that `apply(scopeWithLimit).deleteAll()` throws. This fix lives in the collection and also protects the inline chain.

Either way, add a test that proves the outcome.

### F03: a typo in a declared codec id is accepted by `scope` and only fails later, with an unclear error

Location: `packages/3-extensions/sql-orm-client/src/query-fragments.ts` lines 25–31 and 45 (`ScopeFieldSpec`, `ScopeFieldDeclarations`), lines 62–70 (`ScopeRow` maps an unknown codec to `never`); `packages/3-extensions/sql-orm-client/src/orm.ts` lines 101–120.

Probe P10 runs `client.scope({ title: { codecId: 'pg/txt@1', nullable: false } }, …)`. The declaration compiles. A body that uses the field fails with `Property 'eq' does not exist on type 'never'`. Every application fails with a long TS2345 error that never mentions the codec id. A package that offers a scope written with `{ codecId, nullable }`, the form the ADR recommends for packages, gets no check at the place where the mistake was made.

Suggestion: constrain the declarations in the client's `scope` signature to the contract's codecs, so the error points at the typo:

```ts
scope<const Declarations extends Readonly<Record<string, ScopeFieldBuilder<keyof ExtractCodecTypes<TContract> & string> | ScopeFieldSpec<keyof ExtractCodecTypes<TContract> & string>>>, Facts extends ScopeFacts>(…)
```

Re-measure the instantiation cost after the change.

### F04: the value a scope body returns is not checked at run time, so a body can return a different collection under the receiver's type

Location: `packages/3-extensions/sql-orm-client/src/query-fragments.ts` lines 303–335 (`defineFieldScope` casts whatever `body` returns).

Probe P1 shows that any value typed `ScopeQuery<Row, {hasWhere: true; hasOrderBy: true}>` satisfies the body's return type, even one not built from `rows`. Probe P1b captures the query from one application and returns it from a later application: `plain.Post.apply(replaying).modelName` was `Comment`, while the type said `Filtered<Post collection>`. This needs a deliberately odd body, and P1b needed a cast because `captured` was typed `unknown`; P1, which types it properly, compiles without a cast. Still, the cast message, "return a collection of the same class", states an invariant that nothing checks.

Suggestion: before returning, check at run time that the body returned a collection with the receiver's `modelName` and `namespaceId`, and that it is an instance of the receiver's constructor. Throw `ORM.ARGUMENT_INVALID` otherwise. This costs one comparison per application and turns a silent mix-up into a clear error.

### F05: a collection without a namespace in its type, which includes every custom collection class, passes a scope for any model in every namespace that has a model of that name

Location: `packages/3-extensions/sql-orm-client/src/query-fragments.ts` lines 116–149 (`ModelScopeTarget` requires `HasState<{ nsId: NsId }>`; a state whose `nsId` is `never` is assignable to every namespace); `packages/3-extensions/sql-orm-client/src/collection-types.ts` lines 37–47.

Probe `probes/zz-probe-ns.test-d.ts` uses the namespaced-accessors contract, where `public.User` has `email` and `auth.User` has `token`. With `users: Collection<Contract, 'User'>` (the type a custom class extends), both `users.apply(withToken)` and `users.apply(withEmail)` compile. Whichever namespace the instance really belongs to, one of the two then throws `ORM.FIELD_UNKNOWN` at run time. Likewise, a `Post.scope` made from such a collection accepts both `orm.auth.User` and `orm.public.User`. Its body can only use fields both models share (`select('email')` and `select('token')` are refused), so it is not unsound. The run-time check limits the damage, but the README and the skill say that a model without the field "is a compile error".

Suggestion: in the README and the skill reference, state that a custom collection class in a contract with the same model name in several namespaces is checked only at run time. A type-level fix would need custom classes to carry their namespace, which is outside this slice.

### F06: `orderByField` takes `name: string` but `direction: Direction`, so typed callers must check or cast the direction themselves

Location: `packages/3-extensions/sql-orm-client/src/query-fragments.ts` line 436; `examples/prisma-8-demo/src/main.ts` lines 324–342; `packages/3-extensions/sql-orm-client/test/order-by-field.test.ts` line 104 (`'up' as Direction`).

The helper already checks the direction at run time and returns a good error. But the parameter is typed `Direction`, so the demo checks it a second time (lines 331–337, with its own error message), and the test has to cast. Every application that reads `?direction=` from a request will write the same check or cast. The cast is the riskier choice: it compiles and works, and if `orderByField` stopped checking later, nothing would catch it.

Suggestion: type `direction` as `string | undefined`, as `name` already is. Keep the run-time check, and remove the duplicate check from the demo.

### F07: input checks for JavaScript callers are incomplete in `orderByField` and when a scope is applied

Location: `packages/3-extensions/sql-orm-client/src/query-fragments.ts` line 466 (`allowed ?? orderable`, then `.filter`) and lines 255–264 (`assertScopeFields` reads `collection.ctx.context`).

Results in `probe-runtime-out.txt`:

- `orderByField(Post, 'title', 'asc', 'title')`, with a string instead of an array, throws `TypeError: allowedNames.filter is not a function`.
- Applying a scope to a value that is not a collection throws `TypeError: Cannot read properties of undefined (reading 'context')`.

The rest of the slice deliberately turns bad JavaScript input into `ORM.ARGUMENT_INVALID` with why, fix and meta. These two paths still produce bare `TypeError`s.

Suggestion: add `Array.isArray(allowed)` and a collection check (an object with `ctx`, `modelName` and `namespaceId`) that throw `ORM.ARGUMENT_INVALID`, and add matching `it.each` rows to the "input from a JavaScript caller" tests.

### F08: the `ORM.FIELD_UNKNOWN` error from a scope does not name the namespace

Location: `packages/3-extensions/sql-orm-client/src/query-fragments.ts` lines 255–298 (`meta = { model, field, codecId, nullable }`; messages read "Cannot apply a scope to ${modelName}").

The error exists mainly for the cases above where the namespace matters (F05, the integration test with `public.User` and `auth.User`). The message and the meta both leave out `namespaceId`. On-call reading "Cannot apply a scope to User: it has no field token" cannot tell which `User` it was.

Suggestion: add `namespace: namespaceId` to `meta`, and write the message as `${namespaceId}.${modelName}` when the contract has more than one namespace.

### F09: `column-codec.ts` brings two lookups together but leaves a third copy, and it hides lookup errors

Location: `packages/3-extensions/sql-orm-client/src/column-codec.ts` lines 6–21; `packages/3-extensions/sql-orm-client/src/collection-dispatch.ts` lines 738–745 (`resolveStorageColumn`); `packages/3-extensions/sql-orm-client/src/filters.ts` lines 76–85.

The new module moves `resolveColumn` out of the model accessor and shares `hasTrait`. That is good. But:

- `collection-dispatch.ts` still has its own `resolveStorageColumn`, which does the same lookup a different way.
- `filters.ts` reads a field's codec from the domain field type (`model.fields[f].type.codecId`), while the scope and `orderByField` read it from the storage column. So there are two sources for "the codec of a field".
- `resolveColumn` catches every exception from `storageTableForContract`. For a scope, a missing table therefore turns into "has no column", which hides the real problem.

Suggestion: point `collection-dispatch.ts` at `resolveColumn`, or note why it differs. Narrow the `catch` to the "table not found" case, or let unexpected errors propagate. This is not urgent.

### F10: the compile-time cost was measured only on a 7-model demo, and the type for any model grows with the size of the contract

Location: `packages/3-extensions/sql-orm-client/src/query-fragments.ts` lines 96–149 (`MismatchedField` and `CollectionWithFields` map every namespace, then every model, then every declared field); ADR 259, "What it costs".

The ADR says the list of models that match a scope "is computed once per scope type". That holds, but each new scope type, including each different field set and each `Facts`, computes it again. The work is the number of models across namespaces times the number of declared fields. The demo has 7 models. Applications with hundreds of models are where editor latency hurts. The number in the ADR is measured, but the claim that this cost stays acceptable at scale is an assumption.

Suggestion: measure one definition and ten uses against a generated contract with about 200 models, and add the result to the ADR. If it is large, compute the list of matching models lazily, from the receiver's model only, rather than as a union over the whole contract.

## Deferred (out of scope)

- **Mutations ignore `limit`, `offset` and `orderBy` for inline chains too.** This is the collection behaviour behind F02. Only the part that scopes make reachable is in scope for this slice. The fix for inline chains belongs in a separate ticket against the collection's mutation methods.
- **A Post.scope made from one contract can be applied to a collection of another contract with the same model name and a matching row.** `ModelScopeReceiver` does not constrain the contract. At run time the body works on the real collection, so the effect is only a slightly wrong result type. Multi-database applications are rare, and fixing this would mean changing the receiver's type, which ADR 258 owns.
- **Recording the variant on a scope for any model.** A collection narrowed with `variant('Bug')` is refused for a field that only the variant has. Whether that is right is a product question for the ADR.

Referrals to other reviewers (outside this lens):

- **Naming and typology** (architect): the spec says `db.scope` and `db.Post.scope`, but the code and the ADR say `db.orm.scope` and `db.orm.public.Post.scope`. A wrong column type is reported as `ORM.FIELD_UNKNOWN`. The refusal message is carried as a property name.
- **Learnability** (devrel): the cryptic errors in F03 are also a learnability problem.
- **Product scope** (PM): whether `limit` and `offset` belong in a scope for any model at all (F02, option 1).

## Already addressed

Found by earlier review rounds and fixed on the branch:

- **Facts soundness hole.** A body could claim a filter it had not applied. Fixed in b932608435 ("scope bodies carry their facts in a declared property"). Tests: "a body cannot claim a filter it may not have applied" in `field-scope.types.test-d.ts`. My probes P1 and P7 confirmed the explicit-type-argument and `let` cases are now refused.
- **Post.scope ignored the namespace.** Fixed in b932608435 ("Post.scope reads the namespace"). Tests: `namespaced-accessors-scopes.integration.test.ts`. I confirmed in the probe that `users.apply(tokens)` is refused.
- **The refusal did not name the missing field.** Fixed in 3cb751a92d ("names the field a model lacks in its refusal"). Test: "the refusal names the field the model lacks". An earlier version, for `CodecField`, was fixed in fa0df9b308.
- **The demo silently used `desc` for an invalid direction.** Fixed in 591675ba7e (`examples/prisma-8-demo/src/main.ts` lines 331–337). F06 suggests removing the need for this check.
- **JavaScript input to `scope`.** Fields that are not an object, bad declarations, and a body that is not a function are now `ORM.ARGUMENT_INVALID`. Fixed in b932608435. `orderByField` refusing a name or direction that is not a string was fixed in 452ab57e06.

## Acceptance-criteria verification

| # | Criterion (spec.md) | Verdict | What I read in the implementation | What I read in the test assertions |
| --- | --- | --- | --- | --- |
| D1 | Type tests for `db.scope`: accepted on two models, refused for a missing field, another column type, another nullability; body cannot name an undeclared field or call `select`/`include`; result records filter and order; works at every site | PASS | `ScopeQuery` (query-fragments.ts lines 83–93) offers only where, orderBy, limit and offset on the declared row. `MismatchedField` compares codec and nullability both ways. `WithFacts` maps facts to `Filtered`/`Ordered`. The method is `db.orm.scope` / `client.scope`, not `db.scope` (referred as naming). | `field-scope.types.test-d.ts`: `toEqualTypeOf<Filtered<typeof plain.Post>>` and the same for Comment; `@ts-expect-error` for Tag, views as text, nullability in both directions, `r.title`, `select`, `include`; `Ordered<Filtered<…>>` for liveNewestFirst; update allowed, cursor refused, and the reverse; sites: custom class `Filtered<SoftPostCollection>`, after where, after select, include refinement (row's `title: string`), `this` (`Filtered<LivePostCollection>`). |
| D2 | Type tests for `db.Post.scope`: every site accepted, select- and variant-narrowed refused, wrong model refused | PASS | `collection.ts` lines 473–486: `this` gives the contract, model and namespace; `ModelScopeReceiver` requires the full row and `variantName: undefined`. | `model-scope.types.test-d.ts`: `toEqualTypeOf<ReturnType<typeof summary>>` for plain, custom, declared, filtered, ordered plus limit, included, include refinement (`PostSummary[]`), and `this`; `@ts-expect-error` for `db.User`, `select('id')` in both places, `variant('Bug')`. Namespace refusal is in the integration test. |
| D3 | Runtime tests: the plan contains the scope's filter and order; `ORM.FIELD_UNKNOWN` refusal | PASS | `assertScopeFields` runs before `body`; the plan comes from the real collection's `where`/`orderBy`. | `field-scope.test.ts`: applied AST `toEqual` inline AST and `not.toEqual` unfiltered; the order-and-limit AST equals inline; custom class and include refinement ASTs equal inline; `ORM.FIELD_UNKNOWN` with exact message, why and meta; body spy not called; `executions` empty. `model-scope.test.ts`: the same comparison, with controls for no change and no order. |
| D4 | Demo uses all three; typecheck through `dist`, tests and declaration-emit test pass | PASS | `fragments.ts` (`createdSince`, `ownedBy`, `postSummary`), `get-recent-posts.ts` (`orderByField` with an allowed list), `get-recent-users.ts`. | I ran the demo typecheck (exit 0) and `pnpm test` (18 files, 90 tests, including `declaration-emit.test.ts` and `query-fragments.types.test-d.ts`). `repositories.integration.test.ts` compares the `ownedBy` plan with the same query written inline. |
| D5 | Unused cost ≤ 0.2% on the demo; per-definition cost of `db.scope` in ADR 259 | PASS | ADR 259, "What it costs": unused +286 (+0.04%), definition 225. | I measured unused +286 (729,854 to 730,140, +0.039%). I did not re-measure the per-definition figure; the ADR states it. |
| E1 | Facade exports field builders; client reads codec and nullability without a layering violation | PASS | `postgres/src/contract/field.ts`, exported from `contract-builder`; the client uses the structural `ScopeFieldBuilder` (query-fragments.ts lines 34–42). | `field-presets.test.ts`: `toMatchObject` on descriptor codecId and nullable, and the contract built from the imported `field` equals the one built from the callback. `pnpm lint:deps` exit 0. |
| E2 | `@map`: the check is on the field, not the column | PASS | `assertScopeFields` looks up the field name in `model.fields`, then `resolveFieldToColumn`. | The soft-delete fixture maps `deletedAt` to `deleted_at`. The applied plan equals the inline plan, and the inline plan uses the field name. |
| E3 | Declared fields are not matched against relations or variant-only fields | WEAK | Type level: `FieldsOf` excludes both. Run time: `Object.hasOwn(model.fields, name)` excludes relations, and should exclude variant fields because they live on the variant model. | Type: `@ts-expect-error` for `user`, and for `severity` on Task and on `variant('Bug')`. Run time: the relation case is asserted ("Cannot apply a scope to Post: it has no field user"). No run-time test covers a variant-only field. |
| E4 | Tests use emitted fixtures, not patched files | PASS | `soft-delete/contract.prisma` is emitted by the package `emit` script, and `emit:check` diffs `test/fixtures/soft-delete/generated/`. | Fixtures are loaded through `deserializeContract`; no test edits contract data. |

| Verdict | Count |
| --- | --- |
| PASS | 8 |
| FAIL | 0 |
| NOT VERIFIED | 0 |
| WEAK | 1 |
