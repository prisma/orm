# Definition of Done — overlays + validation gates

Canonical DoD (the shape) lives in [`docs/drive/principles/definition-of-done.md`](https://github.com/prisma/ignite/blob/main/docs/drive/principles/definition-of-done.md). This file holds the **team's overlays + validation gates** — the concrete items the agile orchestrator checks at handoff time, in addition to the canonical items each scope already requires.

> **Inherited by every project spec.** This file is the team's DoD floor; per [`drive-specify-project`](../../skills-contrib/drive-specify-project/SKILL.md), every project's `## Project Definition of Done` section inherits these items and adds project-specific conditions on top — it does not restate them.

Overlays grow by retro accretion (per [`README.md § Maintenance discipline`](./README.md#maintenance-discipline)): a retro reveals a handoff-time gap, the matching scope's overlay grows by one item. Never delete — overlay items become baseline.

## Dispatch-DoD validation gates

### Always-run

```bash
pnpm typecheck                  # catches the bulk of consumer-site issues
pnpm --filter <pkg> lint        # biome check --error-on-warnings, per touched package — CI's "Lint" job
```

> **`lint` is a separate CI job, not a side-effect of typecheck.** `pnpm typecheck` + `vitest` will pass with an unused import or a formatter diff still on disk; biome's `noUnusedImports` + formatter only fire under `pnpm lint`. Skipping it is how a dispatch reports green and CI comes back red — see [`failure-modes.md § F14`](./failure-modes.md#f14-dispatch-reports-validation-green-but-ci-is-red-dispatch-gates-didnt-mirror-ci).
>
> **Typecheck must cover the package's `test` project too.** CI compiles tests; a package whose `typecheck` script is `src`-only will miss a `TS6133`-class error in `test/**`. For such packages also run `tsc -p tsconfig.test.json --noEmit`.

### Conditional

```bash
pnpm lint:deps              # when imports/exports/architectural structure changes
pnpm test:packages          # when source or test code changes (almost always)
pnpm test:integration       # when changes affect PGlite / PG / mongo paths
pnpm test:e2e               # when changes affect emit / migrate / run cycle
pnpm fixtures:check         # when IR / emitter / serialiser changes
```

> **Per-package test invocation.** To gate a single package, use `pnpm --filter <pkg> test` (e.g. `pnpm --filter @internal/migration-tools test`). `pnpm test:packages -- <name>` is **not** a package filter — the `-- <arg>` is a workspace-wide vitest *path* filter, so it matches every path containing `<name>` (adapters, CLI, …) and red-fails on unrelated infra (e.g. a postgres `ECONNRESET`, a missing `prisma-next` bin). Use the `--filter` form for a per-package gate; pair it with `cd <pkg> && pnpm typecheck` for a package-scoped typecheck.

### Brief-specified

A brief may add gates specific to the work:

- Specific test files that must pass (e.g. a known regression after a substrate change).
- Specific PGlite tests (e.g. cross-namespace-fk, unbound-namespace integration tests).
- Grep gates from [`grep-library.md`](./grep-library.md).
- Diff-stat sanity checks ("no demo migration snapshot should change unless intentional").

### Cadence

- **Per-commit** (during the dispatch): typecheck and any grep gates the brief specifies.
- **End-of-dispatch**: full conditional set + brief-specified gates.
- **Orchestrator-side post-dispatch**: re-run the grep gates independently; spot-check the diff for spec compliance; run intent-validation.

## Dispatch-DoD overlay (beyond validation gates)

- [ ] Brief's referenced [`failure-modes.md`](./failure-modes.md) entries were checked during execution and noted as "avoided" in the dispatch summary.
- [ ] No new TODOs left behind by this dispatch.
- [ ] Per-commit messages reference the source spike artifact / slice spec where appropriate.
- [ ] If the dispatch touched test fixtures: `fixtures:check` passes; drift in unrelated fixture files is investigated, not committed.

## Slice-DoD overlay

In addition to the canonical slice DoD:

### Plan-side items

- If the slice touches `packages/3-*-extensions/**`, the slice plan must include a `pnpm fixtures:check` dispatch step.
- If the slice touches package boundaries / imports, the slice plan must include `pnpm lint:deps`.
- If the slice changes typed surfaces consumed elsewhere, the slice plan must include a downstream `pnpm typecheck` after the producing package's `pnpm build`.

### PR-side items

- [ ] Linear issue moved to `Ready to be merged` (the team's terminal-before-merge state).
- [ ] PR title carries Linear ticket prefix (e.g. `tml-XXXX:`).
- [ ] PR description follows `drive-pr-description` shape (decision-led, narrative).
- [ ] PR linked to its Linear issue via GitHub integration (auto-close on merge works).
- [ ] No `projects/` references in long-lived files added by the slice (per the doc-maintenance rule; grep gate in [`grep-library.md`](./grep-library.md)).

### QA-side items

- [ ] `drive-qa-plan` script exists + ≥1 `drive-qa-run` report exists.
- [ ] No unresolved 🛑 Blocker findings.
- [ ] Script names **both** consumer audiences (see [`patterns.md § Consumer audiences`](./patterns.md#consumer-audiences)) where relevant — OR explicit "N/A — no user-observable change" with a one-line rationale.

#### Slice-close ritual (added 2026-05-21 retro)

The orchestrator MUST walk the slice spec's `## Slice Definition of Done` checklist verbatim before handing off to the PR-opening skill, marking each item ✓ / ✗ / N/A-with-rationale. A `READY FOR PR` reviewer verdict in `reviews/code-review.md` covers reviewer-scope items (typically SDoD1-SDoD3 + the validation-gate items) but **does not** cover items the reviewer cannot see — manual-QA (the QA-side items above), `projects/`-reference scrubs in long-lived files, or any other team-specific overlay item. Treating "reviewer SATISFIED" as proxy for "DoD satisfied" is a known orchestrator failure mode in this codebase; the explicit checklist walk is the calibration that prevents it.

- [ ] **Sync `origin/main` before the final validation + push** (added 2026-05-30 retro). Merge/rebase `origin/main` into the branch, then re-run the always-run gates, *before* opening the PR. A branch that validated green against a stale base can still red-fail CI when a sibling change on `main` moved a shared shape (a status row gaining a field, an output envelope changing). Catching this locally costs one merge; catching it in CI costs a babysit round. See [`failure-modes.md § F14`](./failure-modes.md#f14-dispatch-reports-validation-green-but-ci-is-red-dispatch-gates-didnt-mirror-ci).

## Project-DoD overlay

Beyond the canonical project DoD items:

### Repo-wide gates

- [ ] `pnpm lint:deps` clean.
- [ ] `pnpm build` clean (turbo cache OK).
- [ ] `pnpm fixtures:check` clean.
- [ ] If the project introduces a new package: `architecture.config.json` updated; `pnpm lint:deps` passes the new layering.
- [ ] If the project ships a feature that changes the demo or examples: demo runs end-to-end against the new feature.

### Documentation & migration

- [ ] Long-lived docs migrated to `docs/` (per the doc-maintenance rule); subsystem / patterns docs updated if the project affects them.
- [ ] Any new architecture docs are linked from `docs/architecture docs/`.
- [ ] References to `projects/<project>/**` removed from the codebase (per the doc-maintenance rule).
- [ ] `projects/<project>/` deleted from the repo.

- **Artefact-format changes load the previous format.** Any change to the shape of `contract.json`, `contract.d.ts`, or a migration artefact must come with a test that loads an artefact produced by the previous release (a real snapshot or fixture, not a hand-built object), and the loader must derive or default the new field rather than reject the file. Migration snapshots are written once and never regenerated by users. (Added 2026-09-10 from TML-3233: a required `nullable` key would have made every existing snapshot unreadable.)

### Linear close-out

- [ ] Linear Project marked Completed (or Cancelled with rationale in final status update).
- [ ] Original promoted ticket (if applicable) reflects project completion (comment or status update).
- [ ] Final status update on Linear Project links the close-out retro.

### Manual-QA roll-up

- [ ] Every slice that touched user-observable surface has a `drive-qa-plan` script + ≥1 `drive-qa-run` report; no unresolved 🛑 Blocker findings; [`drive/qa/README.md`](../qa/README.md) updated if the project surfaced new audiences or coverage-gate gaps.

### ADR audit (final-retro item)

Walk `design-decisions.md` for any decision that hasn't migrated to an ADR. If unmigrated decisions exist that are architecturally durable (cross-cutting, hard to reverse, affect future work), block close-out until they have ADRs — closing with un-ADR'd architectural decisions is a known close-out failure mode.

## Test-dispatch brief overlay

When a dispatch's primary deliverable is a test, the brief must state what the test **proves** and on which surface — not merely "the test passes."

Two failure modes from a single PR review (PR #765): a walking-skeleton test was modified to keep passing after a schema change (seeding a row, threading an id), but those additions proved nothing about the FK — the test would have passed identically with the FK removed. In the same PR, a cascade test used raw SQL for a model that the ORM fully owns; raw SQL is correct only for the non-navigable cross-space table that has no ORM surface. A "claims preserved" acceptance criterion would have caught both: the first because the claim about the FK was gone; the second because the surface was wrong.

Acceptance criterion to add to test-dispatch briefs: **"The test fails if and only if the behaviour it claims to verify is removed or broken, and it exercises that behaviour through the right surface (ORM for ORM-owned models; SQL for non-navigable cross-space tables)."**

_(Living; add overlays as the team discovers them.)_
