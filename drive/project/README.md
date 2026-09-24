# drive/project — project-context for project-level workflows

Loaded by `drive-create-project`, `drive-close-project`, `drive-deliver-workflow`, and `drive-plan-project`. Holds prisma-next's operational conventions for project-scope work — tracker integration, status-update cadence, slice-composition patterns, and close-out destinations.

> **Trial period in effect (ends 2026-06-02).** When any drive-* skill in this category produces a finding, record it in [`findings.md`](./findings.md). Quality bar, tags, and format live in [`drive/trial.md`](../trial.md).

## Calibration

Project-scope calibration lives in [`drive/calibration/`](../calibration/):

- [`drive/calibration/dor.md`](../calibration/dor.md) — project-DoR overlay (Linear Project, working branch, scaffold)
- [`drive/calibration/dod.md`](../calibration/dod.md) — project-DoD overlay (repo-wide gates, doc/migration, Linear close-out, manual-QA roll-up, ADR audit)
- [`drive/calibration/patterns.md § Slice-composition patterns`](../calibration/patterns.md#slice-composition-patterns) — sandwich / migration / canary patterns for project decomposition

## Linear conventions

- **Project creation.** Linear Projects are created via the `save_project` MCP tool.
- **Working-branch naming.** Project working branch is named with the Linear Project ID: `<tml-id>-<descriptive-slug>` (lowercased; hyphens). Example: `tml-2549-agile-agent-orchestration`.
- **Initial status update.** Links the project's spec.
- **State conventions.** Don't manually transition issues to a completed state; the GitHub integration handles it on PR merge (auto-transitions to the team's terminal state). Manual transitions before merge are fine (e.g. moving to `In review` when the PR opens).
- **Single-issue multi-slice auto-close.** When a whole project is tracked as one Linear issue, the GitHub integration auto-closes it on **every** slice-PR merge (each PR's title prefix matches the issue). The orchestrator must reopen after each merge — or prefer per-slice sub-issues under a parent issue, so auto-close fires per-slice. (Learned on lsp-interpreter-diagnostics: one issue, five reopens.)
- **Promotion / demotion.** Handled by `drive-triage-work`; see [`drive/triage/README.md`](../triage/README.md) for the ceremony.

## PR boundaries under mid-flight scope shifts

A stacked PR is justified only when its base PR is independently valuable to merge as-is. When a mid-flight scope addition rewrites an unmerged slice's internals, fold the two into one PR — the transient scaffolding then nets out of the diff entirely instead of costing two reviews. (Learned on lsp-interpreter-diagnostics: a stacked PR folded into its base after the operator flagged the review-time waste.)

## Status-update cadence

- Linear Project status: update at slice-merge (`drive-deliver-workflow` does this implicitly via `drive-check-health`).
- Wider-team comms: optional, operator-set. Use `drive-post-update` for the cadence the project needs.
- Cross-team dependencies: surface in the project plan's `Dependencies` section; ping owners explicitly when a dependency is blocking.

## ADR cadence

Projects that introduce durable architectural decisions (subsystems, patterns, conventions) write ADRs as part of close-out — `drive-close-project` migrates them into `docs/architecture docs/adrs/`. The mandatory-final retro is a natural surface for "did this project produce an ADR-worthy decision?"

## Close-out destinations

`drive-close-project` uses these defaults when migrating long-lived methodology out of `projects/<project>/`:

| Source pattern under `projects/<project>/` | Destination root |
| --- | --- |
| `principles/**.md` | `docs/<project>/principles/` |
| `model.md`, `vocabulary.md`, `glossary.md`, `domain-model.md` | `docs/<project>/` (top-level of project subtree) |
| `workflow.md`, `process.md` | `docs/<project>/` |
| `*-conventions.md` | `docs/<project>/` |
| `adrs/**.md`, `decisions/**.md` | `docs/architecture docs/adrs/` (use the repo's ADR numbering — surface to operator before assigning) |
| `calibration/**` | **Lift** into [`drive/calibration/`](../calibration/) (not migrated as docs). Same lift-then-delete pattern as worked-example pollution; see `drive-close-project` step 4.5. |

Index doc: `docs/<project>/README.md` (created at migration time).

Transient artefacts (deleted at close, never migrated): `spec.md`, `plan.md`, `problem-statement.md`, `*-restructure.md`, `migration-plan.md`, `design-decisions.md` (decisions that needed preservation should already be ADRs by close-out), `retros.md`, `trial.md`, project-level `README.md`, `specs/`, `plans/`, `assets/` (unless explicitly tagged "keep").

A project `spec.md` that carries a decisions section or a decision log is treated like `design-decisions.md`, not as a plain transient file. Before deleting it, map every decision to its durable home (an ADR, a reference doc, a package README, a Linear issue, or code that enforces it) and put the mapping in the close-out PR. A decision that is architecturally durable (cross-cutting, hard to reverse, or shaping future work) needs an ADR, exactly as the ADR audit in [`dod.md`](../calibration/dod.md#adr-audit-final-retro-item) requires for `design-decisions.md`; a README, reference doc, Linear issue or enforcing code is enough only for decisions that are not. A decision with no home is written into the matching ADR or README in the same PR. (Learned on remove-dbgenerated, 2026-09-24: the spec was deleted first, and two decisions, list-column defaults and what `contract infer` prints, existed nowhere else until the close-out PR added them to ADR 129.)

Ambiguous-by-default: anything not matching the rules above. `drive-close-project` surfaces these to the operator at classification time — never silently classified.
