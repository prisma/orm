# Brief: D6 — Delete `sql/timestamp@1` and the old PostgreSQL temporal IDs

## Task

Remove the retiring surface entirely. The `sql/timestamp@1` descriptor, codec, helpers and ID leave `relational-core`; `field.timestamp()` goes; `pg/date@1`, `pg/timestamp@1`, `pg/timestamptz@1`, `pg/time@1` and their codec classes, descriptors and column helpers go from the PostgreSQL target; every registration, aggregate mapping, control-plane hook, storage entry, testkit case and consumer follows. When you are done, no production code can author a retiring ID and no test references one.

This is the dispatch the whole slice has been building toward. It also closes eleven of the fourteen current reds.

## You are being judged against a prediction

`d6-prediction.md` was written at D5 specifically so this dispatch is falsifiable rather than merely green. **Read it first.** Its enumeration was independently reproduced at review — 260 distinct files across two search axes, 16 production files (5 definitions + 11 consumers), path-for-path identical to a separate measurement.

**Your first deliverable is a comparison, not a deletion.** Re-run both `rg` axes recorded in the document, diff your result against its lists, and report the difference before you delete anything. Then:

- **A file in the prediction you did not need to touch** — say so and why. Usually benign.
- **A file you had to touch that is not in the prediction** — that is the interesting case. Report it prominently. It means the enumeration had a third blind spot, and the document names the only ways that could happen: a renaming re-export, a dynamic record lookup, or a runtime-assembled ID. Review confirmed none of the first two exist today and exactly one of the third does (below).

Matching the prediction is not the goal; **explaining every difference is.** A silent match is worth less than a reported mismatch.

## Five things the prediction and review already worked out for you

1. **`schema-verify.helpers.ts:107` fabricates IDs rather than naming one.** `` codecId: col.codecId ?? `pg/${col.nativeType}@1` `` — the single runtime-assembled ID in the tree. Repointing it means changing a **fallback rule**, not swapping a string. It sits in the undifferentiated "repointed" bucket where that distinction is invisible; treat it as a judgment site, not a mechanical edit.

2. **`marker-ledger.ts:89-92`'s codec choice is behaviourally inert.** `NOW` declares `returns: { codecId: PG_TIMESTAMPTZ_CODEC_ID }`, but the read returns raw driver rows (`:117-118`) with **no decode step**, and `NOW` is a zero-interpolation `RawExpr` so nothing encodes a temporal param either. The codec is lowering-time metadata only. Review specifically tested the stronger worry — that repointing would make `prisma migrate` require a `Temporal` global on stock Node, the same trap the scaffold decision avoided — and the code refutes it. **Pick to match whatever `contract-free/columns.ts` becomes, and do not wait for a test to tell you.** No suite can distinguish the choice.

3. **Per-fixture replacements are already chosen.** Group 3a names a replacement per row and states why: `timestamptzTemporalColumn` preserves what a parity fixture demonstrates, while `timestamptzStringColumn` would make the suite pass while silently changing the fixture's subject. Do not apply one uniformly. Do `test/utils/src/column-descriptors.ts` first — it is shared infrastructure, not a fixture.

4. **Call site and definition move together.** `timestamptzColumn` is defined in the public `exports/column-types.ts` barrel. The parity fixtures and that definition are one change; splitting them breaks the build.

5. **Add the missing guard after deletion.** `byTargetType('int8')` and `('numeric')` carry single-element assertions against a second claimant; the temporal target types carry none — which is exactly why D3 could add a second `date` claimant without anything breaking. With the old codecs gone, add the equivalent assertion so the resolution is locked permanently.

## Scope

**In:**

- `packages/2-sql/4-lanes/relational-core/src/ast/` — `sql-codecs.ts`, `sql-codec-helpers.ts`: the `sql/timestamp@1` descriptor, codec, helpers, ID.
- `field.timestamp()` and its registrations.
- `packages/3-targets/3-targets/postgres/src/` — `codec-ids.ts`, `codecs.ts` (four codec classes, descriptors, `pg*Column` helpers), `codec-type-map.ts`, `core/aggregates.ts`, `contract-free/columns.ts`.
- `packages/3-targets/6-adapters/postgres/src/` — `core/descriptor-meta.ts`, `core/marker-ledger.ts`, `exports/column-types.ts`.
- `packages/3-targets/6-adapters/postgres-codec-testkit/` — the retiring codecs' cases, including the two transient `notYetCanonical` markers on `pg/timestamptz@1` that resolve by deletion.
- The ~15 hand-written TS authoring fixtures in Group 3a, across `test/integration`, `test/e2e`, `examples/` and `contract-ts/test`.
- `test/integration/test/sql-orm-client/include-codecs.test.ts` — migrate its fixture to a representation-explicit codec. This is how that red resolves; it does not resolve by deletion alone.
- `pnpm lint:deps` runs here.

**Out — do not touch:**

- `timetz` and `interval`. Their codecs share helpers with the ones you are deleting and must keep working. `isoDurationJsonProjection` stays.
- Generated `contract.json` / `contract.d.ts` — D7 sweeps those. Hand-written `contract.ts` files **are** yours.
- Documentation — D8. Leave `(FR5.3)` at `code-templates.ts:88` alone; D8's grep gate owns it.
- The eight new codecs and their projections.

## Completed when

- [ ] The comparison against `d6-prediction.md` is reported, with every difference explained.
- [ ] `rg 'sql/timestamp@1|SQL_TIMESTAMP_CODEC_ID'` returns zero in `packages/**/src/**`. **Run both axes** — literal and constant — per F35. A single-axis grep is what produced a wrong answer at D5.
- [ ] `rg` for the four old PostgreSQL codec IDs returns zero outside `timetz` / `interval` contexts, on both axes.
- [ ] `rg '\bfield\.timestamp\('` returns zero in `packages/` and `examples/`.
- [ ] The `byTargetType` single-element assertion exists for the four temporal target types.
- [ ] `pnpm lint:deps` passes.
- [ ] `pnpm lint:casts` — the count should **fall**, not merely hold. Several pre-existing casts live on the descriptors you are deleting. Report the delta; a flat count suggests something was reintroduced.
- [ ] `timetz` and `interval` behaviour is unchanged, proven by their tests passing rather than by inspection.
- [ ] Red set reported by cause and resolving dispatch. Eleven of fourteen should resolve here. **Per the failure-kind rule: a `cli-journeys/` timeout is not evidence — get the assertion diff before counting a red.** The CLI flake is excluded by package, not by file.
- [ ] Gate set green apart from what D7 owns: the nine packages from D5 plus `relational-core` — `typecheck` / `test` / `lint` each.

## Standing instruction

Stay focused on the goal; control scope. Trivial-and-related fixes that obviously serve the goal go in the same dispatch with a one-line note. Anything that pulls you off the goal halts and surfaces.

## Halt conditions

- **Deleting something requires reintroducing a compatibility shim, alias, or fallback anywhere.** That is [F1](../../../../drive/calibration/failure-modes.md#f1-dual-shape-support-relocated-under-a-new-name) and the project forbids it explicitly. A helper that maps an old ID to a new one is the same failure mode under a new name.
- A `timetz` or `interval` test goes red.
- A generic-layer change (`packages/1-framework/**` or the SQL runtime) turns out to be needed beyond removing `field.timestamp()`.
- `include-codecs.test.ts` cannot be migrated without touching codec value handling.
- The prediction turns out to have a third blind spot large enough that the deletion set is materially different from 16 production files.

## References

- `d6-prediction.md` — your contract for what exists. Read the § "How to read a mismatch" guidance before reporting differences.
- Slice spec § Transitional-shape constraints — the no-shims rule in the project's own words.
- Slice plan § Known-red baseline and § Admitted growth — `include-codecs.test.ts` resolves by *migration*, not deletion, and must appear in D7's red accounting until green, never in an exclusion list.
- Per [F24](../../../../drive/calibration/failure-modes.md#f24-stale-dist-makes-a-red-gate-look-like-a-broken-base): you are deleting **exported symbols**, so downstream typecheck failures will point at stale `dist` before they point at real breakage. This bit D1, D3 and D5 — at D5 it produced a 208-passed false green that only a second source of truth caught. Rebuild the producing package before believing any downstream error.
- Per [F3](../../../../drive/calibration/failure-modes.md#f3-discovery-via-test-suite-instead-of-grep): the consumer set is enumerated already. Do not use the suite to find it.

## Operational metadata

- **Model tier:** orchestrator — largest blast radius in the slice, with judgment sites at the fallback rule and the fixture replacements.
- **Time-box:** none fixed. Report by heartbeat; surface if the comparison against the prediction alone exceeds ~30 minutes.
- **Validation gate:** ten packages' `typecheck` / `test` / `lint`, `pnpm lint:deps`, `pnpm lint:casts`, and serial workspace suites reported by cause.
