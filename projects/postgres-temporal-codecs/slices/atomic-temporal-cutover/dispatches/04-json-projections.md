# Brief: D4 — JSON projections cast to text

## Task

Change the `jsonProjection` of all eight temporal descriptors — the four `*String` codecs from D2 and the four Temporal codecs from D3 — so the value is cast to `text` before PostgreSQL builds it into a JSON document. A nested, JSON-built read must then expose the same server text a flat read exposes. This retires `utcIsoJsonProjection`. Alongside it, teach the conformance harness to express **round-trip equality** for codecs whose application value is not a string, and apply it to the two cases where byte equality is the wrong test.

## Why the projection changes

Today `utcIsoJsonProjection` wraps `timestamptz` in `to_char(timezone('UTC', …), 'YYYY-MM-DD"T"HH24:MI:SS.MS"+00:00"')`. Two problems:

- **`.MS` is milliseconds.** The nested read path already truncates microseconds today. This is a live precision bug, not a hypothetical.
- **Flat and nested disagree.** A flat read returns server text; a nested read returns that hand-built format. The project requires they agree.

The cast makes nested reads session-`TimeZone`-dependent, which the UTC-pinning was deliberately avoiding. That reversal is decided and is not yours to relitigate — the project spec's non-goals make session-dependent output explicit, and `Temporal.Instant.from()` accepts any offset, so the Temporal codecs are unaffected by which offset the session renders. Explain the reversal in the code where the old helper's comment used to justify the opposite; do not leave the codebase asserting a policy it no longer follows.

`CastExpr` already exists at `packages/2-sql/4-lanes/relational-core/src/ast/types.ts:950`.

## The conformance invariant — settled, implement it

Byte-equality between the projected value and `encodeJson` output is the right invariant **only for identity codecs**, where "projected bytes equal `encodeJson` bytes" and "`decodeJson(projected)` reconstructs the value" are the same statement. For a Temporal codec they come apart: `encodeJson` produces the spelling PostgreSQL must **accept on write**, the projection produces the spelling PostgreSQL **emits on read**, and PostgreSQL is under no obligation to emit what it accepts. Both are correct.

The property the runtime actually depends on is the round-trip one — the nested path calls `decodeJson` on the projected document and never calls `decode`.

**Implement:** a conformance case may declare round-trip equality — `decodeJson(projected)` equals the expected value under the codec's own equality (`Temporal.*.equals`, or `Temporal.*.compare(...) === 0`) — instead of byte equality.

**Apply it to exactly two cases:** `pg/timestamp-temporal@1` and `pg/timestamptz-temporal@1`. `date-temporal` and `time-temporal` need nothing; `::text` and `toString()` coincide exactly for them.

**Do not extend `notYetCanonical` to cover this.** Its contract is that the suite forces someone to resolve a marked case. Using it for a permanent, correct asymmetry would make the fixture set permanently assert that a working system is broken. The `timestamptz-temporal` marker should come **off** and be replaced by a round-trip case.

## The tripwire you must trip, exactly

D2 left two markers as a deliberate tripwire for this dispatch:

- **`pg/timestamp-string@1` and `pg/timestamptz-string@1`** carry `notYetCanonical: 'mismatch'` because PostgreSQL's JSON rendering uses a `T` separator and `+00:00` where a flat read gives a space and `+00`. The text cast resolves both. **Delete exactly those two markers.**
- **`pg/date-string@1` and `pg/time-string@1`** already agree in both paths. If you find yourself touching their cases, the cast did something unintended — **halt and surface**.

The harness asserts a marked case still fails *and still fails that way* (`codec-conformance.integration.test.ts:83` compares `outcome.failure?.kind` to the declared kind), so a marker left in place after the cast lands will fail the suite rather than pass silently. That is the tripwire working; do not defeat it by deleting markers pre-emptively.

## One clause to tighten while you are in that case

The `pg/timestamptz-temporal@1` reason string written in D3 R2 says the projection "produces the spelling PostgreSQL emits on the way out, which uses a space and a `+00` offset." That describes the **post-D4** spelling; the identity projection in place today emits a `T` and `+00:00`. The reviewer caught it, declined to spend a third round on it, and recommended folding the correction into D4 — because you are rewriting this exact case anyway, and because the next clause self-corrects it so no reader is left with an actionable false belief.

Since you are replacing the marker with a round-trip case, the sentence may simply disappear. If any of it survives, make it accurate for the post-cast world.

## Scope

**In:**

- `packages/3-targets/3-targets/postgres/src/core/codecs.ts` — the `jsonProjection` bodies of all eight temporal descriptors; retire `utcIsoJsonProjection`.
- `packages/3-targets/6-adapters/postgres-codec-testkit/` — the round-trip case capability, the two applications of it, and the two marker deletions.
- Tests proving flat/nested agreement at full precision.

**Out — do not touch:**

- Any codec's `encode` / `decode` / `encodeJson` / `decodeJson` body. This dispatch changes *SQL projection* and *test harness*, not codec value handling. If you believe an `encodeJson` must change, halt — that contradicts the settled invariant.
- The old Date-typed codecs. Still D6's.
- `timetz` and `interval` `jsonProjection`s. `isoDurationJsonProjection` stays; `interval` is out of project scope.
- Authoring, PSL, introspection — D5.

## Completed when

- [ ] All eight temporal descriptors project through a `text` cast; `utcIsoJsonProjection` is gone.
- [ ] A test proves flat and nested reads return the **same string** for all eight, including a microsecond-bearing value. Per F13, the fixture must carry a sub-millisecond component that the retired `to_char(… .MS …)` format would have truncated — a whole-second fixture would pass with the old projection still in place and prove nothing.
- [ ] The `pg/timestamp-string@1` and `pg/timestamptz-string@1` markers are deleted and their cases pass; `pg/date-string@1` and `pg/time-string@1` cases are untouched.
- [ ] Round-trip equality exists in the harness and is applied to `timestamp-temporal` and `timestamptz-temporal`; the `timestamptz-temporal` `notYetCanonical` marker is gone.
- [ ] Any existing test asserting the `+00:00` suffix or the `to_char` shape is **rewritten**, not preserved. Those pinned the behaviour being retired.
- [ ] Session-`TimeZone` dependence of nested reads is covered by a test that observes it, not one that hides it behind a UTC-pinned session.
- [ ] Gate set green apart from known-red: `@internal/target-postgres`, `@internal/adapter-postgres`, `@internal/postgres-codec-testkit` — `typecheck` / `test` / `lint` each — plus `pnpm lint:casts`.
- [ ] Known-red set has not grown. Serial runs; state that they were, with durations.

## Standing instruction

Stay focused on the goal; control scope. Trivial-and-related fixes that obviously serve the goal go in the same dispatch with a one-line note. Anything that pulls you off the goal halts and surfaces.

## Halt conditions

- Achieving flat/nested agreement appears to require changing an `encodeJson` body.
- The `date-string` or `time-string` conformance case needs touching.
- `CastExpr` cannot express the cast against the JSON-construction path, or the cast has to be applied somewhere other than the descriptor's `jsonProjection` hook.
- A generic-layer change (`packages/1-framework/**` or the SQL runtime) turns out to be needed. The whole point of the per-descriptor hook is that it should not be.

## References

- Slice spec § Chosen design › JSON projections.
- Slice plan § D4.
- `projects/postgres-temporal-codecs/reviews/code-review.md` § Orchestrator notes — the settled conformance-invariant decision, in full.
- D3's task-zero results for the exact server spellings; reuse those literals rather than writing new ones from memory. Taking spellings from a live server and duplicating them into the unit suite is the pattern the reviewer asked to see repeated.
- Failure modes: [F13](../../../../drive/calibration/failure-modes.md#f13-regression-test-for-a-boundary--scoping-property-doesnt-discriminate) (the microsecond fixture is the discrimination), [F26](../../../../drive/calibration/failure-modes.md#f26-review-comment-point-fixed-the-defect-class-re-ships-in-new-places-next-round) (eight descriptors change together; a review comment on one is a comment on all eight).

## Operational metadata

- **Model tier:** mid — the design decision is settled; this is careful application plus a small harness extension.
- **Time-box:** none fixed. Surface if the harness change alone exceeds ~45 minutes.
- **Validation gate:** the three packages' `typecheck` / `test` / `lint`, `pnpm lint:casts`, serial workspace suites for red-set accounting.
