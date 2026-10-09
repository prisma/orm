# Verification: slice 2, fix round and adaptation to main, at b3604607d4

PR prisma/orm#30564, worktree `wip/slice2` at b3604607d4, left clean. I changed no tracked file. Paths without a prefix are under `packages/3-extensions/sql-orm-client/`. Line numbers are at b3604607d4. Probes and logs are in `wip/verify-slice-2-final-probes/`; each probe file says how to rerun it.

## Status

- The PR is `CONFLICTING` with main, which moved to b32ec30b6d (TML-3388). `git merge-tree` shows conflicts only in `test/integration/test/namespaced-accessors/fixtures/generated/contract.{json,d.ts}`; they need a merge, a re-emit and a new manifest hash.
- CI has not run on b3604607d4, because of the conflict. The last green CI is at f8a0009000. The checks below are the only evidence for range 2.

## Checks I ran (all at b3604607d4)

| Check | Result | Log |
| --- | --- | --- |
| Client `pnpm typecheck` (includes every `*.test-d.ts`) | exit 0 | `client-typecheck.log` |
| Client tests `field-scope`, `scope-run-time-checks`, `order-by-field`, `model-scope` | 93 passed | `client-scope-tests.log` |
| Client `pnpm lint` | exit 0 | `client-lint.log` |
| Postgres package `pnpm typecheck`, `pnpm lint`, `test/contract-builder/field-presets.test.ts` | exit 0, exit 0, 3 passed | `postgres-typecheck.log`, `lints.log`, `postgres-field-presets.log` |
| contract-ts and framework-components `pnpm typecheck` | exit 0, exit 0 | `contract-ts-typecheck.log`, `framework-components-typecheck.log` |
| Demo `pnpm typecheck`, `test/declaration-emit.test.ts` | exit 0, 2 passed | `demo-typecheck.log`, `demo-declaration-emit.log` |
| Integration files, one at a time: `planner-golden/planner-ddl-golden.test.ts`, `psl-print/every-postgres-contract-roundtrip.integration.test.ts`, `namespaced-accessors-scopes.integration.test.ts` | 704, 562, 2 passed | `planner-golden.log`, `psl-roundtrip.log`, `nsa-scopes-integration.log` |
| `lint:deps`, `lint:throws`, `lint:framework-vocabulary`, `check:upgrade-coverage` | all exit 0 | `lints.log` |
| Re-emit of the soft-delete, scope-namespace and namespaced-accessors fixtures into copies, diffed against the committed files (both locations) | identical | `fixture-reemit.log` |

## Verdict per change

| Change | Verdict | Evidence |
| --- | --- | --- |
| `update()` and `delete()` change the row `first()` returns | Done | `src/collection.ts` 2420–2436 and 2601–2613 find the row with `#findFirstMatchingRowIdentityWhere` (`first()` keeps order and offset). Tests `test/scope-run-time-checks.test.ts` 191–215. Probe R3: with `include`, the lookup has `offset: 2, limit: 1` and no later statement carries the offset. The relation-callback path is the only `update` path that ignored order, limit and offset. |
| `update` with a relation callback refuses an order, a limit or an offset | Done | `src/collection.ts` 2395 and 2667–2682, before any statement. Tests 225–243 assert no execution. |
| Refusal kept on `updateAll`, `updateAndCount`, `deleteAll`, `deleteAndCount` | Done, but see defect 2 | `src/collection.ts` 2472, 2549, 2645, 2790. Tests 128–186. |
| `delete()` with `include` reads back without the offset | Done | `src/collection.ts` 2607–2611; test 217–223. |
| Error when the scope cannot read the receiver's model | Done | `src/scopes.ts` 159–160; `test/field-scope.types.test-d.ts` 244–260; ADR 259 line 97. |
| A union of two scopes with different facts is refused | Done, wording see defect 3 | `test/field-scope.types.test-d.ts` 263–273; probe `zz-final-types.ts` line 86. |
| List-field matching, then element nullability (`many: false \| { elementNullable }`) | Done for scalar lists; defect 1 for value-object lists | Compile time `src/scopes.ts` 123–151, run time 427–429 and 490–499. Tests in both test files. Probe `zz-final-types.ts`: a widened `elementNullable: boolean` is refused for both lists (58, 63) and the body treats elements as possibly null (56); `.many({ elementsNullable: flag })` is refused by the builder (66); `many: false \| {…}` is refused (74, 75); a `@map`ped `String?[]` agrees at compile time (89–94) and run time (R1b). A `.many()` body never sees nullable elements as non-null. |
| Soundness test restored | Done | `test/field-scope.types.test-d.ts` 188 is `(rows) => rows` again. |
| JavaScript receiver with an empty `ctx` refused with `ORM.ARGUMENT_INVALID` | Done | `src/scopes.ts` 323–346; tests in `scope-run-time-checks.test.ts` and `order-by-field.test.ts`. |
| Docs and wording from the previous round (F05, SD07, custom classes, codec vs column type) | Done, small gaps in defect 3 | ADR 259 lines 85, 91, 99, 101, 130; README line 108; skill line 377. |
| Merge 6513528b0f (slice 1 final tip) | Kept both sides | `contract-dsl.ts` keeps main's `ApplyMany`/`ManyOptions` and slice 2's `implements ScalarFieldDeclarationBuilder`. |
| Merge d915bbc10d (main at 7bc1b4dd20) | Kept both sides | `remerge-d915bbc10d.diff`: declaration fixtures, README and skill sections, emit script with the new fixtures, `ModelScopeReceiver`, `apply` overloads, `scope`, the four write refusals, the SKILL.md row, and the namespaced-accessors source with main's lookups and the two `Note` models. The dropped `where(fn => WhereArg)` overload is slice 2's own earlier change (eff53287e1), not a lost side. |
| 7dd27ec70e: facade `field` passes the lookups | Done | `packages/3-extensions/postgres/src/contract/field.ts` builds them exactly as `define-contract.ts` 137–148 does with no extensions. Extension packs: the facade has no extension presets by design, and `field.column(...)` reads no lookup, so nothing differs. `field-presets.test.ts` exercises the preset path that needs `codecLookup`; probe `zz-final-facade-field.test.ts` checks `.many()` on presets. Building the lookups at import costs about 1.3 ms (`measure-field-import.mjs`). |
| 1b3acdbe73: fixtures and planner manifest | Done | Re-emitted fixtures are identical. Manifest changes are only slice 2's: four new entries (soft-delete and scope-namespace, package and integration copies) and namespaced-accessors, whose `Note` models slice 2 added. The planner golden test passes, including "records exactly the committed contracts". |
| b3604607d4: costs | Numbers match the logs; not re-measured | `wip/slice2/wip/logs/main-base-tip.tsv`, `mm-unused-main-*.log`, `mm-probe-200.log`. Every derived figure in ADR 259 lines 141–155 matches. |

## Defects, by severity

1. **Medium. The two checks read a list from different places, and disagree for a value-object list.** Compile time reads `many` from the domain field (`src/scopes.ts` 123–125, used at 139); run time reads it from the storage column (`src/scopes.ts` 490). A value-object list such as `addresses Address[]` is a list in the domain and one `jsonb` value in storage (`storedAsListColumn`, `packages/2-sql/2-authoring/contract-ts/src/contract-definition.ts` 243–248). So `{ codecId: 'pg/jsonb@1', nullable: false, many: { elementNullable: false } }` compiles and then throws `ORM.FIELD_UNKNOWN`, whose `fix` says to declare it as one value; that declaration is a compile error. No declaration of the field works without a cast. ADR 259 line 99 says the run-time check "reads the same fact". Probes: `zz-final-types.ts` lines 36 (refused) and 38–39 (accepted), `zz-final-runtime.test.ts` block R1, contract `vo-list/`. Recommendation: read `many` from the same source in both checks; the domain field is the source the ADR names, and the run-time check already has the model. Add a test with a value-object list.
2. **Medium. Bulk writes still ignore a `cursor` and a `distinctOn`, the same class as the limit and offset this PR refuses.** `cursor` is applied only on reads (`src/query-plan-source.ts` 160). `updateAll`, `updateAndCount`, `deleteAll` and `deleteAndCount` compile from `state.filters` alone (`src/collection.ts` 2500, 2565, 2700, 2794), and `#assertNoLimitOrOffset` (2651) checks only limit and offset. So `Post.where(…).orderBy(id).cursor({ id: 5 }).deleteAll()` deletes every matching row, not those after the cursor. With `include`, `deleteAll` reads the rows after the cursor (2747) and deletes them all, so the rows it returns are not the rows it deleted. A field scope cannot add a cursor, but a model scope or a class method can, which is the reason the limit refusal gives. This behaviour predates slice 2. Probe: `zz-final-runtime.test.ts` block R5. Recommendation: refuse a cursor in the same check, and `distinctOn` too, or record both as a follow-up; this extends the F02 ruling, so it may need Will.
3. **Low. Four doc statements do not match the code.**
   - `skills/prisma-8/references/queries-postgres.md` line 377 ends "Only the codec and nullability are compared", two sentences after it says list kind and element nullability are compared.
   - ADR 259 line 97 says the error for a union of scopes "says the facts of one are not those of the other". The error is TypeScript's assignability message: "The types of '[ScopeFactsType].hasWhere' are incompatible" (probe line 86, `probe-types-tsc.log`).
   - ADR 259 line 87 and README line 108 name `CodecListField` as the type the body sees, but `src/exports/index.ts` does not export it, and ADR 259 line 167 does not list it. A user cannot type a row fragment for a list field. Export it, or stop naming it.
   - ADR 259 line 99, the "same fact" sentence: see defect 1.
4. **Low. The builder form does not validate `many` at run time; the package form does.** `src/scopes.ts` 273–274 reads any value other than `{ elementNullable: boolean }` as one value, while `isFieldSpec` (225–236) refuses a bad `many`. A hand-written JavaScript builder whose `build()` returns `many: true` declares one value without an error. DSL builders are not affected. No probe.

## Observations outside the reviewed changes

- **Scalar comparisons on a list field compile, inline and in a scope body.** `labels.like('%a%')` and `name.eq(labels)` type-check on a `String[]` (probe lines 42–48) and build `LIKE` on the array column (R2). Postgres has no `LIKE` operator for `text[]`; I did not run this against a database. `CodecListField` (`src/types.ts` 389–401) copies the model accessor, so this is the accessor's gap, not slice 2's. Worth a ticket.
- **`upsert` and `create` ignore a scope's filter, limit and offset.** Probe R4: after a filtering scope with a limit and an offset, `upsert` runs a plain `INSERT … ON CONFLICT … DO UPDATE` with no `WHERE`. A tenant scope in front of `upsert` therefore does not restrict the update branch. This predates slice 2; scopes make the pattern more likely. Needs a ruling: refuse, or document.
- **`limit(0)` then `update()` or `delete()` changes one row**, because `first()` replaces the limit with 1 (`src/collection.ts` 1399). Now that the docs define these writes by `first()`, a request-driven `limit(0)` in a scope still writes. This predates slice 2.

## Not checked

- Contracts written with the TypeScript DSL and used without emit: the test helper's `defineContract` does not give a typed client, so I could not probe them.
- I did not re-measure the costs; I checked them against the recorded logs only.
