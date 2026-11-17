# Sizing calibration — INVEST rubric for this codebase

This file is this team's calibration of the [`sizing principle`](https://github.com/prisma/ignite/blob/main/docs/drive/principles/sizing.md). Read the principle doc first; this file specialises it to the patterns, packages, and gates that recur in this codebase.

The principle: size units by **logical coherence**, not by logistical footprint (file count, LoC, time-box). The check is **INVEST**, applied at dispatch / slice / project altitudes.

## How to use this file

When you're sizing a new unit (dispatch, slice, or project), run the INVEST checklist at the matching altitude. The checklists below are this repo's specialisations — what *Independent*, *Small*, *Testable* etc. mean in this codebase's vocabulary. If a unit fails a letter, refine it before dispatching / planning.

## Dispatch INVEST — specialised for this repo

| Letter | This-repo specialisation |
|---|---|
| **Independent** | The dispatch produces a state that subsequent dispatches in this slice can build on without concurrent work elsewhere. Hand-off is named in the slice plan's `Hands to`. |
| **Negotiable** | The brief's `Task` paragraph names the *outcome* — what's true after this lands. The implementation path is the executor's discovery (grep pre-flight on the named surface). |
| **Valuable** | The dispatch moves the slice's outcome materially. "Wire up scaffolding I'll use in dispatch 2" is rarely a dispatch on its own; bundle it into the dispatch that consumes it. |
| **Estimable** | A `Completed when` checklist of 1–3 items can be written, each binary and verifiable (a command, a grep gate, a file-existence check, or a specific fact about the codebase). If you can't write the checklist, the dispatch isn't shaped yet. |
| **Small** | The brief plus its references fit in one executor session. As a rough heuristic: if the executor would need to evict the slice spec from context to load the dispatch's references, the dispatch is too big. |
| **Testable** | A small set of gates verifies the outcome. The typical gate vocabulary in this codebase: `pnpm typecheck`, `pnpm lint:deps`, `pnpm fixtures:check`, `pnpm --filter <pkg> test`, plus targeted `rg` greps for retired/added literals. |

### Dispatch-shape patterns this repo runs cleanly

These are recognisable shapes that pass dispatch-INVEST cleanly. They are *patterns*, not size buckets.

- **Surgical substrate change** — one IR shape changes, all consumers in one package adapt. Outcome: "the substrate change holds and the package's tests are green." Verification: package typecheck + package tests + grep for the retired shape.
- **Mechanical fan-out / codemod** — uniform transformation across N files. Outcome: "every instance of pattern X reads pattern Y." Verification: grep for X returns empty + workspace typecheck + targeted tests. File count is irrelevant; the transformation is uniform.
- **Single-package new feature** — a new operation, validator, or helper plus its tests. Outcome: "the new surface ships with positive + edge tests." Verification: package tests cover the new surface + type-level tests if it's a typed API.
- **Fixture regen + replay probe** — regenerate canonical fixtures after an upstream substrate change; verify replay against the previous head's expectations. Outcome: "fixtures match the canonical shape and the replay probe passes." Verification: `pnpm fixtures:check` + the replay-probe command.
- **Single-file judgment call** — a small change that requires reading a spec or ADR carefully to get right. Outcome: "the edge case is handled per the spec." Verification: a new test that names the edge case.

### Dispatch-shape patterns that signal mis-sizing

When a dispatch matches one of these shapes, run INVEST again — usually the fix is to re-decompose.

- **Substrate change + consumer migration in one dispatch.** Two outcomes pretending to be one. Split: dispatch 1 lands the substrate; dispatch 2 migrates the consumers. The hand-off is the substrate's new shape.
- **Mechanical fan-out + design judgment in one dispatch.** The judgment site is buried in the fan-out's diff and the reviewer misses it. Split: dispatch 1 makes the judgment in one canonical location; dispatch 2 fans the resolved decision out mechanically.
- **"While I'm in there" cleanup bundled with the named outcome.** The cleanup is its own outcome. Either drop it (out of scope), file a follow-up, or run it as its own dispatch with its own brief.
- **A dispatch whose `Completed when` reads like a paragraph rather than a checklist.** The outcome is fuzzy. Sharpen it before dispatching — otherwise the executor invents what "done" means.

## Slice INVEST — specialised for this repo

| Letter | This-repo specialisation |
|---|---|
| **Independent** | The slice ships as one PR without needing a sibling slice in the project plan to merge concurrently. Sequential dependencies on prior slices (slice 2 builds on slice 1's hand-off) are fine; concurrent ones mean the two are one slice. |
| **Negotiable** | The slice spec pins the chosen design and the slice-DoD. The dispatch plan is re-decomposable without changing the slice's outcome. |
| **Valuable** | The slice closes a real gap in the project's purpose. A slice whose only value is "preparation for slice 3" is a sequencing artifact — fold it into slice 3 or surface why the prep needs to ship on its own. |
| **Estimable** | The slice-DoD lists conditions that a CI run + reviewer pass can verify at PR-open time. |
| **Small** | **Manageable in a single code review.** One reviewer reads the PR in one sitting, holds the coherence in their head, and reaches a verdict without needing to re-orient mid-review. The test is *coherence*, not LoC: a 2000-LoC mechanical migration with one outcome passes; a 200-LoC PR spanning a substrate change + a fixture regen + a new error type fails. |
| **Testable** | The slice-DoD plus the project-DoD floor compose into a passable bar at PR-open time. Validation gates: the affected packages' own tests (whole suites run in CI), `pnpm fixtures:check`, plus any slice-specific grep gates the spec names. |

### Slice-shape patterns this repo runs cleanly

- **Hard-cut migration of one substrate concept.** Outcome: "the old encoding is gone; the new encoding is the only path." Dispatches: substrate update → consumer migration → fixture regen + grep gate.
- **One new authoring surface end-to-end.** Outcome: "users can author X; it round-trips through emitter → adapter → runtime." Dispatches: type-side authoring → runtime hookup → tests + fixtures.
- **Bug fix with regression test.** Outcome: "the bug is fixed; the regression test prevents recurrence." Often one dispatch, occasionally two if the fix touches multiple surfaces.

### Slice-shape patterns that signal mis-sizing

- **A slice whose dispatch plan lists 11+ Ms.** Re-check the slice's *Independent* and *Valuable*. Frequently this is two slices wearing one trenchcoat.
- **A slice that needs the reviewer to read three unrelated areas of the codebase to verify.** The slice has three outcomes; re-spec as three slices.
- **A slice whose `chosen design` keeps drifting during the dispatch loop.** The slice spec didn't settle; route back to `drive-specify-slice` (or `drive-discussion`).

## Project INVEST — specialised for this repo

| Letter | This-repo specialisation |
|---|---|
| **Independent** | The project's purpose stands alone. It is not "the first half of a bigger thing that needs the second half to make sense." |
| **Negotiable** | The project spec pins the purpose + cross-cutting requirements; the slice composition is negotiable. |
| **Valuable** | The project closes a real gap. Groundwork-only projects file as groundwork (a slice or a research artifact), not as projects. |
| **Estimable** | Each slice in the project plan can be sized at slice-INVEST without further decomposition. If a slice keeps coming back as "this is bigger than it looked," the project is mis-shaped. |
| **Small** | The branch stack survives normal rebasing cadence. If `main` drifts past the project's base on every slice and rebases become a noticeable cost, the project is too long. |
| **Testable** | The project-DoD lists conditions checkable at close-out — typically "all slice ACs met" + project-wide invariants (e.g. fixture-stability across the slice sequence). |

### Project-shape pattern this repo runs cleanly

- **One purpose, 2–4 slices, mostly stacked with 1–2 parallelisable.** Example shape: substrate-change slice → consumer-migration slice → cleanup slice, with a parallelisable docs/ADR slice.

### Project-shape patterns that signal mis-sizing

- **A project whose plan lists 5+ slices.** Probably two projects with one shared umbrella ticket. Re-spec into separate projects with explicit dependencies between them.
- **A project whose purpose statement keeps growing slice by slice.** The purpose wasn't settled at project-spec time; route back to `drive-specify-project`.
- **Slices that are really layers of one reviewable change, planned as separate PRs.** If slice N's interim state ships a pattern slice N+1 immediately deletes (e.g. a transitional shim, a placeholder class), the boundary is wrong — that's one PR delivered as a dispatch sequence, not N PRs. Consolidating mid-flight is correct when the slices turn out to share one coherent review; the cost of over-slicing is shipping-then-reverting a shape, plus N× the review/CI/stacking overhead. When you consolidate a multi-slice plan into one PR, the units *inside* that PR are **dispatches** (with reviewer rounds) — there is no "stage" or "milestone" unit in Drive. Slice = one PR; dispatch = one delegated implementation unit; round = one implement→review cycle. Don't invent intermediate vocabulary; it makes the trace and the plan illegible. (Reference: runtime-target-layer / TML-2502 — a 4-slice stacked plan was collapsed to one PR #792 once it was clear each "slice" was a layer of a single reviewable change; the remaining work ran as dispatches on that one slice.)

## Reference patterns from past slices in this repo

These are concrete past slices / dispatches whose shape is worth remembering when sizing new work. They are *patterns*, not size buckets.

### Mechanical-fan-out dispatch that passes INVEST cleanly

A hard-cut migration of a named literal across the family-sql source. Single outcome (the old literal is gone), uniform transformation, large file count, small reviewer load. Sized correctly *despite* the file count because the outcome is one sentence and verification is one grep + one typecheck.

### Surgical substrate change that passes INVEST cleanly

Replacing a class method with a free function while keeping the consumers' call shape the same. Small diff, narrow surface, one design judgment site that the reviewer can locate in seconds.

### Underspecified outcome that produced defensive expansion

A dispatch whose outcome was named in vague terms ("migrate the cross-reference encoding") and whose brief did not enumerate halt conditions for stale fixtures. The executor invented a sub-purpose — defensive helpers that normalise old shapes to new shapes — and shipped a 81-file diff that defeated the slice's hard-cut intent. The reviewer rejected the helpers; the rework was a 3-file subtractive dispatch that passed INVEST cleanly.

The sizing lesson: the original dispatch was not too big in file count; it was *underspecified* in outcome and halt conditions. Re-decomposing into smaller file-bounded dispatches would not have prevented the defensive expansion. Naming the outcome sharply and pre-naming the stale-fixture case as a halt condition would have.

### Mechanical-fanout with embedded judgment that should have split

A dispatch that bundled a descriptor-mechanism design judgment with the mechanical fan-out it cascaded into. The reviewer accepted the result but flagged that the design site was hard to locate amid the fan-out. The sizing lesson: when a single dispatch carries one judgment + N mechanical sites, the judgment dispatch and the mechanical dispatch are two units.

## Parallelisation heuristics

These are pattern-level signals for which slices can run in parallel within a project.

- **Slices that touch different operation families in `packages/1-framework-sql/**`** typically parallelise well.
- **Slices that touch the same adapter** (e.g. `packages/3-targets-pg/**`) typically serialise — adapter-internal changes collide.
- **Migration-shaped slices** (substrate change → dual-write → migrate → remove old path) always serialise; if multiple migration-shaped slices are in flight in the same project, that's a sequencing red flag.
- **Docs/ADR slices** are almost always parallelisable with implementation slices, provided the ADR is settled before the implementation slice's spec is written.

## What this file deliberately does not contain

- **A T-shirt sizing matrix (XS/S/M/L/XL).** This codebase tried that shape; it trained orchestrators to size on file count, which produced underspecified-outcome dispatches that passed the size check but failed in the loop. INVEST replaces it. A T-shirt scheme can be restored at any altitude if and when a real use case appears.
- **Per-altitude file-count thresholds.** A 30-file dispatch can be one logical unit (codemod) or three (substrate change + cleanup + fixture regen). The thresholds were misleading.
- **Per-altitude time-box ceilings as validity criteria.** Time-box matters as a *constraint check* (does this fit the executor's session?), not as a unit boundary.

## See also

- [`docs/drive/principles/sizing.md`](https://github.com/prisma/ignite/blob/main/docs/drive/principles/sizing.md) — the principle this file calibrates.
- [`docs/drive/principles/decomposition-and-cost.md`](https://github.com/prisma/ignite/blob/main/docs/drive/principles/decomposition-and-cost.md) — why model tier follows dispatch shape.
- [`docs/drive/principles/brief-discipline.md`](https://github.com/prisma/ignite/blob/main/docs/drive/principles/brief-discipline.md) — where the dispatch-INVEST checklist lands in writing (the brief's `Task`, `Completed when`, and `Halt conditions`).
