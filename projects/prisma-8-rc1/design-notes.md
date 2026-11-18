# Prisma 8 RC1 — Design Notes

The settled decisions behind [spec.md](spec.md), each with its rationale. Alternatives considered are collected at the end. These were settled in operator discussion, July 15 2026.

## The release is an RC, and that defines the cut line

"GA by July 31" reframed as **Prisma 8.0.0-rc.1**. An RC freezes API surface; it does not promise completeness. That gives every work item a mechanical classification: it either affects frozen surface (must land before Jul 31) or it doesn't (may trail). The freeze set: package names, error codes, config keys, the `migrations/` directory layout, CLI bin names, version floors. The release bar is "everything we ship works, and we're confident" — not v7 parity.

## Version number: 8

Skipping to 10 buys a vague "big jump" signal at the cost of permanent "what happened to 8 and 9" noise; the discontinuity story is already told by the architecture and the marketing. The RC publishes under a non-`latest` dist-tag so `npm install prisma` keeps resolving to v7 until 8.0.0 final — nobody gets v8 by accident, which defuses most same-package-name risk.

## Repo merge: on a branch early, to main at the end

The v8 branch lands in `prisma/prisma` immediately and runs full CI for weeks; merge mechanics (history graft, CI wiring, publish pipeline) are proven long before release week. The mass issue-close (everything except v7 bugs) happens **at merge time** with a pinned explanation issue — doing it early generates weeks of confused reactions with no announcement to point at. v7 history lives on a `v7` maintenance branch: bug fixes for **12 months, clock starting at 8.0.0 final** (not RC — an RC-dated clock silently shortens the promise if final slips, and generosity toward the v7 base is the right trade given low EA uptake).

## Parallel install: three collision surfaces, three answers

1. **npm names.** No collisions: Prisma Next has its own package set and no client in v7's sense, so `@prisma/client` stays v7-only. Library-level coexistence is the documented alias pattern (`"prisma-v7": "npm:prisma@^7"`).
2. **The CLI bin.** v8's `prisma` package ships **exactly one binary: `prisma-next`** — it deliberately does not declare a `prisma` bin at RC. Reasoning: when two installed packages declare the same binary name, which one wins `node_modules/.bin` is package-manager-specific and effectively undocumented, so a coexistence story that depends on "v7 wins the collision" is nondeterministic across npm/pnpm/Yarn/Bun. With only `prisma-next` declared, there is no collision at all: `prisma` unambiguously means v7 on every package manager until v7 is removed. Whether v8 ever adds a bare `prisma` binary (at 8.0.0 final, or later via `@prisma/cli`) is deliberately deferred — v8's commands share nothing with v7's, so v7 muscle memory doesn't transfer regardless of the binary's name, and adding a bin later is purely additive.
3. **Migration ownership.** Two migration systems must never both mutate one schema. **v7 owns migrations until a single final cutover.** v8 adopts the database read-only via the shipped, e2e-tested brownfield path (ADR 122): `contract infer` → `db sign` (which verifies the live schema satisfies the contract before writing anything, then records only a marker in the reserved `prisma_contract` schema — it never touches `_prisma_migrations`). After each v7 migration during coexistence: re-infer, review the diff, re-sign; `db verify --schema-only` in CI. At cutover: final sign against the last v7-migrated state, then normal v8 migration flow.

**Known wrinkle:** v7 puts `_prisma_migrations` in `public`, so it is an "unclaimed element" to v8 — tolerated by default `db verify`, but a failure under `--strict` and flagged by `db init`. The upgrade guide blesses **lenient mode until cutover** (one paragraph) rather than building an ignore/allowlist mechanism (a feature nobody needs after the transition).

**Known gaps on this path:** the Dub.co side-by-side evaluation (WS1 M4) never ran — the fixture (plan S1) is the first real test of the coexistence claim. `migration plan --advance` (TML-2560) is documented but unimplemented; it sits on the *cutover* path, not the parallel-run path, so it is a named public gap for final, not an RC blocker. Brownfield step-count ergonomics are tracked as TML-2561.

## Packaging: rename only the visible set; consolidation is already designed

The repo publishes 65 lockstep-versioned packages, but npm existence isn't the ratchet — **blessing is**. ADR 211 already defines the end state: the unscoped bin-only shim plus the three target facades are the entire user-facing surface; everything else is implementation detail, and Flavor 2 (TML-2265) later bundles internals into the shim so they stop being published — non-breaking, hence deferred past RC. So the July move is small: the shim becomes `prisma@8.0.0-rc.1`, and the facades become `@prisma/postgres` / `@prisma/sqlite` / `@prisma/mongo` **at RC** (RC is the freeze moment — renaming between RC and final would break the one promise an RC makes). The rename set is collision-audited against classic-owned `@prisma/*` names (`client`, `config`, `engines`, `adapter-*`, …) because parallel-installed users resolve both scopes simultaneously. All other `@internal/*` packages stay published and untouched.

The repo rename (`prisma/prisma` → `prisma/prisma-orm`) is parked: GitHub redirects make it cheap whenever it happens, and it doesn't need to ride along with the merge.

## Version floors: already ratified, one under revisit

ADR 222 ratified Node ≥24, TS ≥5.9 (optional peer), ESM-only, Postgres 17, MongoDB 8.0 — so "clear Node + TS version requirements" is announcement copy, not engineering. Node ≥24 and ESM-only are themselves headline breaking changes and lead the upgrade guide. The **Postgres 17 floor was an EA-era convenience** and was lowered to 15 on August 11 (ADR 248): the migrating-from-v7 audience skews to older Postgres, and a floor that excludes them contradicts the incremental-migration promise. Each supported floor version is a permanent CI matrix row — that cost is the decision.

## Error codes: one scheme, decided before the freeze

The current state is four parallel error models with two incompatible code formats (~46 `PN-DOMAIN-NNNN` in the CLI layer, ~89 dotted `NAMESPACE.SUBCODE` in the runtime and migration-tools layers), ~16 codeless bespoke classes, and no central registry — ADR 027's factory/registry/redaction spec is unimplemented. The consistency pass is mechanical and parallelizable *once a scheme is ratified*; the ratification (due Jul 18) is the bottleneck. Recommendation on the table: **dotted wins** (twice the usage, self-describing), with a published crosswalk for the PN codes per ADR 027's own stability policy. Codes freeze at RC; message wording and golden-test scaffolding may trail. There is deliberately **no classic P-code compatibility** — the clean break already shipped; the upgrade guide gets a P-code → new-code mapping table for the runbook-migration crowd instead.

## Migration snapshot centralization: pre-freeze by necessity

Every migration directory currently carries redundant contract copies; a chain of M migrations stores ~2M contracts where M+1 distinct ones exist. The fix is content-addressed storage — `migrations/snapshots/<storageHash>.json` — mirroring the `prisma_contract.contract` table the database side already has. Migration dirs need no link files: `migration.json` already carries the from/to hashes, so the contract-reference resolver learns the snapshot store and the change concentrates in resolver + emitter (+ example regeneration). This is **safe** because ADR 199 excludes snapshots from migration identity (hash covers manifest + ops only) — nothing invalidates. It is **urgent** because the `migrations/` layout becomes frozen public surface at RC. Compression: writer emits plain JSON (git packs already delta-compress; gzipped blobs cost PR reviewability and greppability), but the reader accepts `.json.gz` from day one so compression remains a future non-breaking writer-side option.

## Testing: mine P7, don't convert it

The P7 functional suite is thousands of tests against a different API; wholesale conversion is months. The valuable artifact is the **database and relational-algebra edge cases encoded in it**. Two moves: (1) extract those scenarios, filtered by the supported-surface matrix, into the existing `test/integration/` + `test/e2e/` per-target structure — the matrix and the converted tests become the same artifact, making "everything we ship works" checkable; (2) differential testing through the side-by-side fixture where v7-as-oracle beats hand-porting assertions. With thin EA adoption, this suite does the confidence work production feedback normally would.

## Benchmarks: public Bencher, measurements only

TS performance is measured **before** the type freeze (deep conditional types are exactly the pattern that blows up check time at schema scale — if the numbers are bad, the runway to fix types exists only pre-freeze). Public surface: a **Bencher project (public, free for OSS)** carrying per-commit series — `tsc --extendedDiagnostics` check time, type instantiations, memory — split by schema size (10/100/500 models) and TS version (5.9, 7). **Measurements only, no v7 or competitor comparison**: fair comparison is hard, and a comparative claim makes the benchmark the story. PR regression checks fail on **instantiation counts** (deterministic) rather than wall time (CI-runner jitter). Consequence, accepted: the announcement can't say "dramatically faster types" with a public receipt — wording is calibrated against one internal v7 comparison run, or softened to what the dashboard shows.

## Dashboards

- **Pre-RC, org-internal:** the Linear project *is* the dashboard — milestones carry the checkpoints, status updates land at each one, and tickets are created just-in-time (an exhaustive up-front backlog was explicitly rejected as waste under a fast-changing plan). Any separate internal page is a second copy of Linear that goes stale.
- **Post-RC, public:** the rendered supported-surface matrix **is** the dashboard — a grid of ticks and crosses regenerated by CI from the checked-in data. There is no separate progress board: cells flipping from cross to tick as proving suites go green *is* the distance-to-done reading. Ticks link to the suite that proves them; deliberate crosses are the not-in-8.0 list and link to gap issues on an `8.0.0` milestone. Promises limited to: API stability with named experimental carve-outs, the 12-month v7 window, **promotion criteria instead of a date** (every cell green or explicitly not-in-8.0; N weeks without a new release-blocker; the migration recipe passing its fixture), the explicit not-in-8.0 list, and a biweekly status cadence. Rule: nothing goes public that we aren't willing to be held to in a GitHub thread six weeks later — per-feature dates fail that test.

## Staffing

Will (lead: merge, npm ops, decisions, announcement, and the agent-executed engineering under his review), Serhii (coexistence fixture, then test mining), Alexey (polymorphism, untouched, through the go/no-go). Agent-executed work lands as bot PRs and costs Will review time, not implementation time — the split that keeps the lead off the critical path for everything except the things only the lead can do.

## Alternatives considered

- **Version 10** — rejected: permanent numbering noise for a signal the marketing already carries.
- **Reusing classic P-codes (P1001-style)** — rejected: zero compatibility exists in the codebase by design; retrofitting would break EA users to please v7 muscle memory. A mapping table in the upgrade guide serves the runbook crowd instead.
- **`prisma8` as the coexistence bin** — rejected in favor of keeping `prisma-next`: it already exists and EA users already use it; no second habit migration.
- **v8 claiming the `prisma` bin during coexistence** — rejected: breaks every existing v7 script and CI job on install.
- **v8 shipping both `prisma` and `prisma-next` bins ("v7 wins the collision")** — rejected, superseding an earlier version of this plan: bin-collision winners are package-manager-specific and undocumented, so the coexistence behavior would be nondeterministic. The RC ships `prisma-next` only.
- **Both migration systems owning DDL** — rejected: requires reconciliation machinery that doesn't exist; single-owner-until-cutover is the shipped, tested model.
- **An ignore/allowlist mechanism for v7's `_prisma_migrations` under `db verify --strict`** — rejected for now: lenient-mode guidance is one paragraph; the allowlist is a feature with a lifespan of one transition.
- **Renaming all 65 packages to `@prisma/*` at RC** — rejected: blesses ~65 names as frozen public API; only the visible set (shim + facades) is user-facing per ADR 211.
- **ADR 211 Flavor 2 bundling before RC** — rejected: non-breaking later, unnecessary risk in a 13-day window.
- **Wholesale P7 test-suite conversion** — rejected: months of work porting assertions written against a different API; mining + differential testing capture the value.
- **Comparative public benchmarks (v7, competitors)** — rejected: fair methodology is its own project, and the comparison becomes the story.
- **Hand-curated public roadmap page** — rejected: goes stale in weeks; every stale cell reads as a broken promise. Derive from maintained sources or don't publish.
- **Exhaustive up-front Linear backlog** — rejected by the operator: the plan changes too fast; milestones + just-in-time tickets instead.
- **Gzipping snapshots at write time** — deferred: dedup is the big win; git already compresses; reviewability wins. Reader-side `.gz` tolerance ships so the option stays open without a second layout break.
