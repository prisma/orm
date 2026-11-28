# orm-update-expressions — Plan

**Spec:** `projects/orm-update-expressions/spec.md`
**Linear Project:** none. The operator chose to run this project without Linear.

## At a glance

Ten slices in three threads: typed conditions, the callback form of update, and operations. Three slices wait on nothing and can start at once (1, 4 and 9); the rest follow the "builds on" column.

The operator set the slice size: about 500 changed lines, 1000 at most. That is why there are ten slices and not the two to four a project usually has.

| # | Slice | Thread | Builds on | Estimate (changed lines) |
|---|---|---|---|---|
| 1 | `fns-conditions` | conditions | none | 450 |
| 2 | `field-conditions` | conditions | 1 | 750 |
| 3 | `operation-results` | operations | 1 | 500 |
| 4 | `update-all-callback` | update | none | 800 |
| 5 | `update-callback` | update | 4 | 450 |
| 6 | `nested-update-callback` | update | 4 | 500 |
| 7 | `variant-field-reads` | update | 4 | 450 |
| 8 | `relation-conditions` | conditions | 2, 4 | 450 |
| 9 | `numeric-fns` | operations | none | 600 |
| 10 | `numeric-field-methods` | operations | 3, 4, 9 | 600 |

The total is about 5,550 lines, before the close-out pull request with its two ADRs.

### How the estimates were made

An estimate counts hand-written lines added and removed: source, tests, README, upgrade instructions. Each one is a sum of the parts listed under the slice. The parts come from the size of the code each slice changes and from five recent pull requests of comparable shape in `sql-orm-client`:

| Pull request | Lines added / removed |
|---|---|
| #31068, update data refuses the discriminator | 424 / 108 |
| #31014, update and delete filtered related rows | 983 / 74 |
| #31096, nested update and delete of one related row | 992 / 56 |
| #31100, the same on many-to-one and many-to-many | 1155 / 254 |
| #31070, `onConflict: 'connect'` on nested create | 2598 / 197 |

In #31014 and #31096, counted file by file, tests are two thirds of the diff (658 of 983 lines and 665 of 992), and source in `sql-orm-client` is 250 to 320 lines. The estimates assume the same proportion. Slices 2 and 4 are the ones most likely to exceed their number: slice 2 rewrites existing tests that compare a field comparison with a syntax-tree node, and slice 4 carries the value-position types and their type tests.

## Composition

### Thread A — typed conditions (slices 1, 2 and 8, in that order)

- **Slice 1, `fns-conditions`** — `projects/orm-update-expressions/slices/fns-conditions/`
   - **Outcome:** In the SQL query builder and in the ORM's `fns`, a condition is an expression of the contract's boolean codec, and its nullability follows its operands. On a MySQL or SQLite contract, `where`, join `on` and `having` accept a boolean column, and `fns.and` accepts one as an operand.
   - **Builds on:** None.
   - **Hands to:** The exported condition type (the codec with the `boolean` trait, and a nullability parameter), and run-time conditions whose `returnType` names the target's boolean codec.
   - **Focus:** `relational-core/src/functions.ts`, the `where` / `on` / `having` types of `sql-builder`, and the ORM's `fns` types (`FunctionCondition`, `fns.and`, `fns.or`). Field comparisons, operations on fields and relation conditions in the ORM keep returning nodes. Spec decisions 15 and 16.
   - **Estimate:** 450 — source 180, tests 230, upgrade instructions and public API record 40.

- **Slice 2, `field-conditions`** — `projects/orm-update-expressions/slices/field-conditions/`
   - **Outcome:** A comparison on an ORM field (`eq` … `isNotNull`) returns a typed condition, and the exported `and`, `or` and `not` return one when their operands are typed.
   - **Builds on:** Slice 1's condition type.
   - **Hands to:** Field conditions that carry a codec and a nullability, which a value position can accept.
   - **Focus:** `ComparisonMethodFns` and `COMPARISON_METHODS_META` in the ORM client, `filters.ts`, the existing tests that compare a comparison with a node (`model-accessor.test.ts` uses the accessor 59 times), and upgrade instructions for the changed return types. Operations on fields are slice 3; relation conditions are slice 8. Spec decisions 16 and 17.
   - **Estimate:** 750 — source 230, new tests 200, rewritten tests 200, upgrade instructions, README and public API record 120.

- **Slice 8, `relation-conditions`** — `projects/orm-update-expressions/slices/relation-conditions/`
   - **Outcome:** A relation's `some`, `every` and `none` return a typed condition that is never nullable, and an update sets a boolean column from a field condition or a relation condition on Postgres, MySQL and SQLite.
   - **Builds on:** Slice 2's field conditions; slice 4's callback form.
   - **Hands to:** Every condition a callback can produce is typed, and conditions are tested as update values.
   - **Focus:** `RelationFilterAccessor` types and `createRelationFilterAccessor`, the rejection test for a nullable condition in a non-null column, integration tests of `popular: p.views.gt(100)` and `hasPosts: u.posts.some()`. Spec decisions 3 and 17.
   - **Estimate:** 450 — source 80, tests 300, README and upgrade instructions 70.

### Thread B — the callback form of update (slice 4, then 5, 6 and 7 in parallel)

- **Slice 4, `update-all-callback`** — `projects/orm-update-expressions/slices/update-all-callback/`
   - **Outcome:** `updateAll` and `updateAndCount` take a callback `(model, { fns, indexes })` that returns the update object with a plain value or an expression per scalar field. A value position checks codec id, nullability and enum. The object form binds every value as a parameter.
   - **Builds on:** None. Without the other threads, a value is a plain value, a column of the same codec, or `fns.raw`.
   - **Hands to:** The value-position type, and a run-time path that carries an expression from the returned object to `UpdateAst.set` through field-to-column mapping and update defaults.
   - **Focus:** The overloads in `collection.ts`, the value-position types in `types.ts`, `storage-rows.ts` and `mutation-statements.ts`, integration tests on three databases, the README section. Single-row `update`, nested forms and variant fields are slices 5, 6 and 7. Spec decisions 1, 2, 3, 4, 7 and 10.
   - **Estimate:** 800 — source 300 (types 130, run time 170), tests 430 (type tests 150, unit 100, integration 180), README 70.

- **Slice 5, `update-callback`** — `projects/orm-update-expressions/slices/update-callback/`
   - **Outcome:** Single-row `update` takes the callback. The returned object may hold relation callbacks beside scalar fields, and the updated row is returned on every database.
   - **Builds on:** Slice 4's value-position type and run-time path.
   - **Hands to:** The callback form on all three top-level update functions.
   - **Focus:** The `update` overload, `parseMutationInput` for a callback's result, the read-back on a database without `RETURNING`, including the existing refusal of a key column set by an expression. Spec decisions 1 and 2.
   - **Estimate:** 450 — source 110, tests 300, README 40.

- **Slice 6, `nested-update-callback`** — `projects/orm-update-expressions/slices/nested-update-callback/`
   - **Outcome:** Inside a relation callback, `update` and `updateAll` take a callback that receives the related model's accessor. Setting the column that links the row to its parent is a compile error in both forms.
   - **Builds on:** Slice 4's value-position type and run-time path.
   - **Hands to:** The callback form at every level a user can write an update.
   - **Focus:** `relation-mutator.ts`, the `RelationMutationUpdateAllData` types, the two places in `nested-mutations.ts` that turn nested update data into storage values. Spec decision 8.
   - **Estimate:** 500 — source 150, tests 310, README 40.

- **Slice 7, `variant-field-reads`** — `projects/orm-update-expressions/slices/variant-field-reads/`
   - **Outcome:** On a collection narrowed with `.variant(...)`, an update value that reads a field stored in the variant's own table is sent as a subquery on that table, on Postgres, MySQL and SQLite.
   - **Builds on:** Slice 4's run-time path.
   - **Hands to:** Every field the accessor offers in an update callback can be read in a value.
   - **Focus:** Turning a reference to a variant table's column into a subquery matched by primary key, as `countMutationWhere` does for filters. Spec decision 6.
   - **Estimate:** 450 — source 130, tests 290, README 30.

### Thread C — operations (slices 9 and 3 in parallel, then 10)

- **Slice 9, `numeric-fns`** — `projects/orm-update-expressions/slices/numeric-fns/`
   - **Outcome:** `fns.add`, `fns.subtract`, `fns.multiply` and `fns.divide` exist in the SQL query builder on every SQL target, typed to return the codec of their first argument, with nullability from both arguments.
   - **Builds on:** None.
   - **Hands to:** The operations in the registry of every SQL execution context, their declarations as type functions of the receiving field, and the family's operation type in the `QueryOperationTypes` of every SQL contract.
   - **Focus:** The operations and their declarations in `relational-core`, the optional member on `QueryOperationTypeEntry`, registration in `createExecutionContext`, the SQL emitter, the types of a contract authored in TypeScript, the re-export in each SQL target package, and the regenerated `contract.d.ts` files. The ORM's field methods and the ORM's `fns` are slice 10. Spec decisions 9, 11, 12, 13 and 14.
   - **Estimate:** 600 — source 300, tests 260, README 40. About 350 regenerated `contract.d.ts` files come on top and are not counted.

- **Slice 3, `operation-results`** — `projects/orm-update-expressions/slices/operation-results/`
   - **Outcome:** The result of an operation called as a method on an ORM field is an expression. A predicate operation returns a typed condition; any other operation returns what a field of its return codec has. The result is nullable when the field is.
   - **Builds on:** Slice 1's condition type.
   - **Hands to:** Operation results that can be chained and used as values.
   - **Focus:** `QueryOperationMethod` in `types.ts` and `createExtensionMethodFactory` in `model-accessor.ts`. No operation is redeclared. Spec decisions 5 and 18.
   - **Estimate:** 500 — source 160, tests 280, README and upgrade instructions 60.

- **Slice 10, `numeric-field-methods`** — `projects/orm-update-expressions/slices/numeric-field-methods/`
    - **Outcome:** In the ORM, `p.views.add(1)` is typed with the field's codec and nullability, chains with other operations, and works in `where`, `orderBy` and as an update value on Postgres, MySQL and SQLite. `fns.add` in an ORM callback has the same types.
    - **Builds on:** Slice 9's operations and declarations; slice 3's operation results; slice 4's callback form.
    - **Hands to:** The numeric operations in every place the spec names.
    - **Focus:** Applying the type function in the ORM's field-method type and in the ORM's `fns` type (`OrmOperation` reads a generic signature at its constraints today), integration tests, the README section including `divide`, and the scorecard rows for atomic number operations. Spec decisions 12, 13 and 14.
    - **Estimate:** 600 — source 160, tests 340, README and scorecard 100.

### The first "At a glance" call

The first call in the spec combines a column copy, a numeric operation and a condition in a single-row `update`. It needs slices 5, 8 and 10. Whichever of the three merges last adds the integration test of that call as the spec writes it, on three databases.

## Dependencies (external)

- [ ] **Draft design #31232, `projects/orm-write-statements`** — open, draft. It proposes that `update()` requires a filter on a unique key, that a MySQL write returns a key or a count, and that the ORM client builds each write as its final statements. Slices 4 to 7 change the same code. Before slice 4 is specified, read that spec's status; if it is accepted, the spec's examples (`where({ id }).update(...)`) and the read-back parts of slices 4 and 5 are re-checked against it.
- [ ] **Open pull requests on `update()`** — #31152 and #31153 (read-back reuse), #31119 (update of the found record when a nested write breaks its filter). They touch `collection-graphs.ts` and `nested-mutations.ts`, which slices 4, 5 and 6 change.
- [ ] **Public API check, #31217** — merged. A pull request that changes a published export names the change, and CI fails on an unrecorded break against the last release. Slices 1, 2, 3 and 8 change the type a published function returns.
- [ ] **Release** — each capability reaches users with the first release of the `@prisma/orm-*` packages cut from `main` after its slice merges. The root version is `8.0.0-rc.25` today; no release is named for this project.

## Sequencing rationale

- **Slices 1 and 9 first.** They change the relational core and the SQL query builder, wait on no open pull request, and each unblocks one more slice.
- **Slice 4 after the open `update()` pull requests are merged or closed.** Slices 4 to 7 change code that #31152, #31153 and #31119 change and that the draft design #31232 would rebuild. Slice 4 can run in parallel with threads A and C once that is settled.
- **Slices 5, 6 and 7 in parallel after 4.** They change different files: `collection.ts` and the read-back, `relation-mutator.ts` and `nested-mutations.ts`, and the variant subquery.
- **Slices 2 and 3 in parallel after 1.** Both change `types.ts` and `model-accessor.ts` in the ORM client, in different declarations: comparison methods in slice 2, operation methods in slice 3.
- **Ten slices in one project.** The three threads could be three projects with the same slices. They are planned as one because the spec is one, slices 8 and 10 join the threads, and the project's definition of done is checked across all three.

## Close-out

Follow the close-out procedure named in [`drive/project/README.md`](../../drive/project/README.md). The spec's ADR pointer lists the two ADRs and three amendments the close-out pull request carries.
