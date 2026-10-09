# Verification: slice 1 formal review, at 06da08363c

PR prisma/orm#30560, head 06da08363c. All 25 CI checks pass. I read the code and docs. I built nothing and changed no code. "Lines" are line numbers at 06da08363c unless stated otherwise. The two type probes are standalone files under `wip/verify-slice-1-probes/`.

## Findings

| Id | Ruling | Verdict | Evidence |
| --- | --- | --- | --- |
| SD01 | Rename to `CollectionTypeStateOf`, `HasTypeState`, `TypeState` everywhere | Done | `src/collection-types.ts` lines 5, 13–15, 36. `src/exports/index.ts` lines 4, 8, 14. `src/collection.ts` lines 76–86, 270–272, 472, 734, 824, 852, 1307–1324. ADR 258 lines 112–124, 197, 199, 220. README line 85. Both upgrade copies lines 43 and 160–183. The facades have no hand-written list of names. The skill reference never used the old names. Old names survive only in spike notes and the PR body (see Notes). |
| SD02 | No change to `Scope`; add one sentence to the ADR | Done | `Scope` is unchanged at `collection-types.ts` line 33. The sentence is at ADR 258 line 55. |
| SD03 | No change (TML-3428) | Done | `hasUniqueFilter` is unchanged. The PR body lists TML-3428. |
| SD04 | `variant` really filters, so fix the ADR sentence | Done | ADR 258 lines 88 and 199. Checked against `collection.ts` lines 516–542: `variant` adds `BinaryExpr.eq` on the discriminator column. |
| SD05 | Map flag, interface and alias in the ADR and README | Done | ADR 258 line 57. README line 85. JSDoc at `collection-types.ts` lines 17 and 20. |
| SD06 | One sentence in the `HasRow` doc comment and the ADR | Done | `collection-types.ts` line 7. ADR 258 line 74. |
| SD07 | Remove `_row` or explain it; correct the symbol-key reason | Done | `_row` is kept at `collection.ts` line 274. ADR 258 line 168 explains why. The reason is true: `ResultType<P>` reads `_row` at `framework-components/src/execution/query-plan.ts` line 49. The symbol-key reason is corrected at ADR 258 line 106. |
| SD08 | Fix the Query Lanes line | Done | `docs/architecture docs/subsystems/3. Query Lanes.md` line 358 now says that Mongo loses the subclass. |
| SD09 | No ruling given | Not done | The PR body still gives one reason for both `select` and `variant` (body line 49) and says "four files" (body line 63). The handover leaves this to the PR description rewrite. |
| SD10 | Direct subtyping test; the declaration-emit test runs in the demo's `pnpm test` | Done | Test at `test/collection-conditionals.types.test-d.ts` lines 58–76 (Filtered, Ordered, ternary in both orders). The demo's `test` script is `vitest run --config vitest.config.ts` (`examples/prisma-8-demo/package.json` line 19) and the config has no include filter, so `test/declaration-emit.test.ts` already ran there. README line 87 now says so. No code change was needed. |
| F01 (and D15) | Widen detection to `include`, `distinct`, `distinctOn`; mention `distinct<['title']>` | Done | Entry `chaining-methods-take-no-explicit-type-arguments`, both copies lines 56–62 (pattern `\.(?:include\|distinct\|distinctOn)<`) and the section at lines 198–205. ADR 258 line 201. |
| F02 | Find the TS2589 cause, fix it, test six methods on an `Omit` receiver | Done, but the fix causes new defect 1 | The four writes now return `CollectionRowOf<Self & HasRow>`: `collection.ts` lines 2324, 2414, 2542, 2584. Test at `test/collection-guards.types.test-d.ts` lines 114–148 covers `deleteAll`, `updateAll`, `update`, `delete`, `all`, `first`, and the refusals. Cause: commit e8b90f0b87 says the first such call in a file failed. That explains why the reviewer saw `deleteAll` fail and `updateAll` pass. ADR 258 line 167 records it. |
| F03 | Re-measure for ADR 258; rewrite "Outside the class body the facts are kept" | Partly done | ADR 258 lines 177–181: 744,614 → 693,649 (−6.8%) and 1,512,211 → 1,322,999 (−12.5%). The arithmetic checks. Commit 06da08363c says each figure was measured twice. ADR 258 line 191 and README line 81 now say "for every caller". Not done: the PR body, where the review found the problem, still says 694,561 and 13% (body line 65) and still says "Outside the class body the facts are kept" (body line 82). |
| F04 (and E4) | Update the slice 1 spec on `model-scopes-design` | Done | Commit b7c45a835d is on `bot/model-scopes-design` (tip 4434a20bee). `slices/1-collection-keeps-its-class/spec.md` lines 27–32 name `TypeState`, `HasTypeState`, `CollectionTypeStateOf`, `Scope`, the final `apply` signature and an unexported `CollectionBase`. Line 51 describes the receiver-form `cursor` guard. Line 59 lists the widened upgrade entry. Commit faa4b77ebf also fixes the project `spec.md`. |

Count: 12 done (F02 with a new defect), 1 partly done (F03), 1 not done (SD09, which had no ruling).

## New defects

1. **`ReturnType` of a write no longer gives the row.** The fix for F02 caused this. In `collection.ts` lines 2321–2324, 2411–2414, 2539–2542 and 2581–2584, `update`, `updateAll`, `delete` and `deleteAll` return `CollectionRowOf<Self & HasRow>`. `ReturnType` replaces `Self` with its constraint, `HasWhere`. `HasWhere & HasRow` has row `unknown`, so `CollectionRowOf` gives `{}`.
   - **Example:** `type Updated = NonNullable<Awaited<ReturnType<PostCollection['update']>>>` was the Post row on main and at 7e0e3cac24. Now it is `{}`. `updated.title` fails with TS2339, and as an annotation the type accepts any object.
   - **Evidence:** I reproduced it on a standalone model of the signatures: `wip/verify-slice-1-probes/return-type-of-writes.ts` and `.out`. Line 32 (the old `this & Self` form) passes. Line 33 fails. Line 34 shows that the result is `{} | null`.
   - **Where it is missed:** ADR 258 line 167 still says "`ReturnType` reads them through the constraint". No upgrade entry covers this; the entry at lines 48–55 covers only the chaining methods. No test checks it.
   - **Recommended fix:** try `CollectionRowOf<Self & HasRow<Row>>`, where `Row` is the class's type argument. In the model, this restores `ReturnType`, keeps included relations and accepts an `Omit` receiver (`wip/verify-slice-1-probes/return-type-candidate.ts`, no errors). The model cannot reproduce TS2589, so the F02 test has to confirm the fix on the real type. If it fails, record the change in the `return-type-of-a-chaining-method` entry, correct ADR line 167, and add a type test either way.

## Notes (not defects)

- Old names remain in `projects/collection-scopes/spikes/state-subtyping.md` lines 16–30 and `spikes/this-typed-chaining.md` (17 lines). These are historical spike records. Leaving them is acceptable.
- The PR body is stale in more places than F03 and SD09. It still names `CollectionStateOf` (body lines 61 and 73) and `this[StateType]` (line 95). It also says only `include` refuses explicit type arguments (line 75). The planned PR description rewrite should fix all of these.
- `skills/prisma-8/references/queries-postgres.md` line 340 does not say "for every caller", unlike the README and the ADR. This is a small gap; the line is not wrong.
- ADR 258 line 88 now says the `variant` filter "is a true fact". There is one exception, which existed before this slice: `collection.ts` lines 501–515 return `this` unchanged when the run-time contract has no discriminator metadata, yet the type still records `hasWhere: true`. This only happens when the emitted JSON and type contracts disagree.
