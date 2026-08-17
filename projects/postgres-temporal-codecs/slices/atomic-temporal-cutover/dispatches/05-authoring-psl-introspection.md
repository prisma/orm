# Brief: D5 — Authoring, PSL, and introspection select the new codecs

## Task

Repoint every authoring surface at the representation-explicit codecs. `temporal.timestamp(...)`, `temporal.timestamptz(...)`, `temporal.createdAt()` and `temporal.updatedAt()` keep their names and resolve to the Temporal codecs. Four siblings are added — `temporal.timestampString(...)`, `temporal.timestamptzString(...)`, `temporal.createdAtString()`, `temporal.updatedAtString()` — with equivalent precision and default behaviour. PSL accepts `DateString`, `TimestampString(p)`, `TimestamptzString(p)` and `TimeString(p)` as authoring spellings. Introspection continues to emit the bare Temporal-backed names with native precision, and the `*String` spellings claim no introspection mapping.

## The hazard that decides how you write this

Between D3 and D6, each of `date` / `timestamp` / `timestamptz` / `time` has **two** claimants in `targetTypes` — the old Date codec and the new Temporal one.

This is inert today because nothing consumes `targetTypes` in reverse: `control-stack.ts:415-441` builds `targetTypesById` keyed by **codecId**, and `targetTypesFor(id)` is a keyed get. Registration order therefore decides nothing behavioural.

**You are the dispatch that could change that.** If you introduce a `targetType → codec` lookup anywhere in the introspection path, registration order silently becomes load-bearing for the D5→D6 window, and the wrong claimant wins depending on map insertion order.

**Resolve by codec ID, never by target type**, until D6 removes the second claimant. The existing comment above `pgDateDescriptor` — "PSL `Date` pins this codec by ID rather than activating a second target-type mapping" — suggests the codebase has been bitten here before. If you believe a target-type lookup is genuinely required, **halt and surface**; do not add one and rely on ordering.

## Write D6 a prediction

D2 left D4 a set of `notYetCanonical` markers as written predictions of what should change, and D4 was verifiable rather than merely green because someone had committed in advance to which cases would flip. The D5→D6 boundary has the same shape: you repoint authoring at the new codecs, D6 deletes the old ones.

**So leave D6 a written prediction: exactly which consumers must go quiet when the old codecs are deleted.** Every call site, fixture, test and registration that still references `pg/date@1`, `pg/timestamp@1`, `pg/timestamptz@1`, `pg/time@1` or `sql/timestamp@1` after your dispatch lands, enumerated by `rg` rather than from memory, written to `projects/postgres-temporal-codecs/slices/atomic-temporal-cutover/d6-prediction.md`.

D6 then either matches your list or has to explain the difference. That converts D6 from "delete things and hope the suite agrees" into a falsifiable claim, which is the property that made D4 verifiable. This mechanism was the implementer's own suggestion at the end of D4; it is a better idea than anything in the original plan for this boundary.

## Scope

**In:**

- `@internal/family-sql/control` — the `*String` authoring preset factories. **Additive only.** SQLite calls `temporalAuthoringPresets` / `temporalCodecPreset` from the same module with `sqlite/datetime@1` (`sqlite/src/core/authoring.ts:19`); existing factory signatures must not change and SQLite's behaviour must not move. Its package tests are the gate on that claim, not an assumption.
- `packages/3-targets/3-targets/postgres/src/core/authoring.ts` — repoint the four existing helpers, add the four `*String` siblings.
- `packages/3-targets/3-targets/postgres/src/core/psl-infer/postgres-type-map.ts` — the `*String` PSL spellings as authoring-only names with no entry in either introspection map. `PRESERVED_NATIVE_TYPES` and `PARAMETERIZED_NATIVE_TYPES` already map the bare names correctly and stay as they are.
- `packages/2-sql/2-authoring/contract-psl` — whatever the new PSL spellings require.
- `packages/3-targets/6-adapters/postgres/src/core/descriptor-meta.ts` — if authoring changes require it.
- Tests, including the SQLite-unaffected gate and the `d6-prediction.md` artefact.

**Out — do not touch:**

- The old Date-typed codecs and `sql/timestamp@1`. **D6 deletes them.** Your job is to make nothing *author* them; removing them is not yours.
- `jsonProjection` — D4 is done, all eight settled.
- Codec value handling of any kind.
- Fixture regeneration — D7. Fixtures will drift as authoring repoints; leave them, enumerate them in the prediction, and let D7 sweep.
- `timetz`, `interval`.

## Behaviour this dispatch owes

- `temporal.createdAt()` and `temporal.updatedAt()` keep their storage-default semantics **and** their one-value-per-ORM-operation guarantee. `timestampNow` remains the clock and keeps its private `Date`; that `Date` is wire-level only and must not widen a generated type. `sql-orm-client/src/collection.ts:140` documents the guarantee — a test must pin it, not a comment.
- The `*String` counterparts provide equivalent precision and default behaviour.
- Bare PSL `Date` / `Timestamp` / `Timestamptz` / `Time` select Temporal codecs. `DateString` / `TimestampString` / `TimestamptzString` / `TimeString` select string codecs. Precision survives into contract type parameters and native-type rendering both ways.
- Introspection maps native columns to the Temporal-backed names with native precision. The `*String` descriptors keep `targetTypes = []` and gain no introspection entry.

## Completed when

- [ ] All eight authoring helpers exist and resolve to the intended codecs; a test asserts which codec each resolves to, by ID.
- [ ] PSL round-trips all eight spellings with precision preserved.
- [ ] Introspection emits the bare Temporal-backed names; a test proves an explicitly-authored `*String` column round-trips through emission **without** claiming an introspection mapping.
- [ ] `temporal.createdAt()` / `updatedAt()` and their `*String` siblings each pin the one-value-per-ORM-operation guarantee in a test.
- [ ] **No `targetType → codec` lookup was introduced.** State this explicitly in your report.
- [ ] `d6-prediction.md` exists and enumerates every remaining consumer of the five retiring IDs, obtained by `rg`.
- [ ] SQLite is provably unaffected: `pnpm --filter @internal/target-sqlite typecheck` / `test` / `lint` green, plus whatever adapter-sqlite gate applies.
- [ ] Gate set green apart from known-red: `target-postgres`, `adapter-postgres`, `postgres-codec-testkit`, `contract-psl`, `family-sql`, and the SQLite packages — `typecheck` / `test` / `lint` each — plus `pnpm lint:casts`.
- [ ] Known-red set: re-attribute `include-codecs.test.ts` explicitly rather than inheriting its admitted status. Report causes and resolving dispatches, not counts. Serial runs, with durations.

## Standing instruction

Stay focused on the goal; control scope. Trivial-and-related fixes that obviously serve the goal go in the same dispatch with a one-line note. Anything that pulls you off the goal halts and surfaces.

## Halt conditions

- A `targetType → codec` lookup appears necessary.
- Adding the `*String` presets requires changing an existing factory signature, or moves SQLite's behaviour.
- The one-value-per-ORM-operation guarantee cannot be preserved through the repoint.
- `timestampNow`'s private `Date` turns out to widen a generated type.
- Deleting something feels necessary to complete the dispatch. It is not — that is D6.
- Diff exceeds ~25 files excluding fixtures.

## References

- Slice spec § Chosen design › Authoring, › Introspection; § Adapter impact (the SQLite-unaffected claim).
- `projects/postgres-temporal-codecs/reviews/code-review.md` § Orchestrator notes — the two-claimants hazard in full.
- Per [F24](../../../../drive/calibration/failure-modes.md#f24-stale-dist-makes-a-red-gate-look-like-a-broken-base): exported types change here and downstream packages typecheck against them. Rebuild the producing package before believing a downstream error. D1 and D3 both hit this.
- Per [F3](../../../../drive/calibration/failure-modes.md#f3-discovery-via-test-suite-instead-of-grep): the consumer set is `rg`-findable and the suites are slow. Enumerate first — you are writing the enumeration down anyway for D6.

## Operational metadata

- **Model tier:** orchestrator — multi-package, and it touches a module shared with another target.
- **Time-box:** none fixed. Surface if the `family-sql` preset work alone exceeds ~45 minutes.
- **Validation gate:** the six packages above, `typecheck` / `test` / `lint`, plus `pnpm lint:casts`, plus serial workspace suites.
