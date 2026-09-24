# drive/retro — project-context for retros

Loaded by `drive-run-retro`. Holds prisma-next's retro conventions, recurring-pattern catalogue, and landing-surface preferences.

> **Trial period in effect (ends 2026-06-02).** When any drive-* skill in this category produces a finding, record it in [`findings.md`](./findings.md). Quality bar, tags, and format live in [`drive/trial.md`](../trial.md).

## Landing-surface preferences

When a retro lesson could land in multiple surfaces, the team's preference:

- **Calibration of size / cost / DoR / DoD items** → the matching file under [`drive/calibration/`](../calibration/README.md). These rarely generalise; they're tied to this repo's package layout and CI shape.
- **Triage / sizing heuristics** → triage decision rules go to [`drive/triage/README.md`](../triage/README.md); sizing anchors themselves go to [`drive/calibration/sizing.md`](../calibration/sizing.md).
- **Failure-mode patterns specific to this codebase** → [`drive/calibration/failure-modes.md`](../calibration/failure-modes.md); the matching grep pattern (if any) → [`drive/calibration/grep-library.md`](../calibration/grep-library.md).
- **Failure-mode patterns that generalise to any contract-first system** → canonical (via `drive-update-skills`).
- **Durable architectural decisions** → ADR under [docs/architecture docs/adrs/](../../docs/architecture%20docs/adrs/).
- **Process changes that affect the whole methodology** → propose upstream PR to `prisma/ignite` (after one or two repetitions to confirm the pattern).

## Recurring-pattern catalogue

Patterns the team has seen multiple times. Each entry: pattern → severity → mitigation surface (where it landed).

- **2026-09-23 — Final remove-dbgenerated retro:** A design that the operator has not settled is not implemented on an assumption; slice B's first PR built codec methods that took PSL text, was withdrawn after review, and was rebuilt on ADR 254 with one blocked decision named in the brief and asked before the code that depended on it. Name every unsettled decision in the brief as a stop, and write the answer into the slice spec before re-delegating. Also: order regeneration of committed generated artefacts before the deletion of the form they use (F30), and rebuild `dist` before trusting a journey failure (F31).
- **2026-09-15 — Final editor-project retro:** Editor acceptance must verify the rendered editor, not just HTTP or LSP transport. Record invocation and acceptance separately; verify the applied edit, caret, and visible follow-up suggestions, including required client opt-ins.

## Mandatory-final-retro template

Per `drive-run-retro` § Step 8, the project-close retro covers the project as a whole. Template prompts:

1. **What went well?** Patterns worth keeping; calibrations that proved out; protocol points that earned their cost.
2. **What surprised us?** Things the protocol didn't predict; assumptions that turned out to be wrong; sizing that drifted.
3. **What lessons land where?** For each lesson: pick canonical / project-context / ADR per the preferences above.
4. **What deferred work surfaced?** Genuinely-deferred *scope* — slices/features pushed out of the project (typically tracked in `projects/<project>/deferred.md`) that should become Linear tickets vs items that should just be discarded.
5. **What's the ADR-worthy decision (if any)?** Not every project has one; many do.
6. **What's the one-sentence summary for the team channel?** A retro that doesn't get communicated to the wider team is half-landed.

**A retro collects *process* findings, not code-review findings.** The retro is about how the work was *delivered* — protocol failures, calibration drift, surprises, reviewer/dispatch discipline. Code-review NITs (deferrable lint-level findings, "add a real-rollback test", "handle ENOENT more cleanly", redundant fields) are **not retro material**: they belong in the slice's `code-review.md`, the PR thread, or a follow-up Linear ticket, and they're dispositioned there. Do not enumerate them in the retro or treat "what deferred work surfaced?" (prompt 4) as a place to relist them — that prompt is for deferred *scope*, not for review nits.

## Retro-trigger frequency baselines

- Healthy team: ~1 retro per slice (on average), most fired as dispatch-failure or drift triggers.
- Mature team on a stable subsystem: < 1 retro per slice, fired mostly on surprise / scope-shift triggers.
- New domain / first project in a subsystem: 2-3 retros per slice, mostly on calibration surprises. Expected; the lessons are populating the project-context surfaces.

If retros stop firing for weeks: check whether (a) the team's actually triggering them when triggers hit OR (b) the project is genuinely going so smoothly that no triggers fire. The second is rare.
