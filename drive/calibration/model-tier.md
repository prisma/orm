# Model-tier routing

Which model tier should this dispatch run on? Per [`docs/drive/principles/decomposition-and-cost.md`](https://github.com/prisma/ignite/blob/main/docs/drive/principles/decomposition-and-cost.md), the cost-vs-capability decision is dispatch-shape-dependent, not size-dependent. A judgment-heavy M dispatch belongs on the orchestrator tier; a mechanical M dispatch belongs on the cheap tier.

## Operator override (2026-09-24)

Every subagent dispatch in this repo runs on **Opus**: implementers, reviewers, and spikes. Pass `model: "opus"` explicitly on every dispatch. The routing table below records the earlier trial of cheaper tiers and is kept for history; it does not govern dispatches until the operator lifts this override.

## Routing table

| Dispatch shape | Recommended tier |
|---|---|
| Substrate change / design judgment / spec interpretation | Opus (orchestrator tier) |
| Codemod / mechanical migration / batch fix | composer-2.5 by default; Sonnet if the codemod crosses multi-system invariants |
| Test-literal rewrites / fixture regen | composer-2.5-fast (cheap tier) |
| Spike (read, count, structure findings) | Sonnet or composer-2.5 |
| Architect-class finding remediation (single discipline, narrow surface) | Sonnet by default; **composer-2.5 when the brief is precise and a sibling dispatch already established the pattern** |
| Voice-aware doc edits (skill / README / matcher updates with explicit insertion points and an established voice to match) | composer-2.5 |
| Long-running validation gate runs (typecheck, test:packages) | Whichever tier the parent dispatch chose (no model dispatch — just bash) |

## Confidence notes

The composer-2.5 entries above reflect a small but consistent trial — currently two-for-two on dispatches where the design was settled before the dispatch fired (an ownership-rule refactor and a multi-file doc update). The tier holds for:

- Brief-precise dispatches where the implementer's job is to apply an already-named rule or replicate an already-landed pattern, not to negotiate one.
- Narrow-surface diffs (single package, <100 LoC source / <200 LoC including tests in our trial), where context-retention across many files isn't load-bearing.
- Work with a strong validation gate (typecheck/test/lint/build for code; existing voice / structure for docs) that catches deviation before it propagates.

Known **non**-fits (kept on Sonnet / Opus until evidence accumulates):

- Dispatches where the design must settle mid-implementation (re-route through `drive-discussion` first; the implementer should not be the one settling design).
- Multi-package refactors where the diff is wide and the load-bearing context is "what other code in the same family does."
- Meta-reporting that requires faithful representation of git/workspace state — composer-2.5 has been observed to misread `git status` in its surprise / pushback sections (the deliverable was correct; the prose claim about "uncommitted work" was not). Validate state assertions in the deliverable against `git status` / `git log` rather than the prose summary.

The trial continues. Bump the table or carve a new row as more evidence accumulates; pair each adjustment with a retro entry referencing the worked example.

## Worked examples

**TML-2500 M3b (2026-06, cross-contract-refs):** every implementer dispatch across the M3b milestone was spawned without an explicit `model:` parameter and silently inherited the orchestrator's (opus) tier. Mechanical work — fixture regen, cast drops, typecheck fixes — ran on opus for the whole milestone until the operator caught it mid-milestone and added explicit `model: "sonnet"` pins to implementer briefs and `model: "opus"` pins to reviewer briefs. Confirms the "defaulting to parent tier is a bug" rule with a concrete, recoverable cost: a milestone of cheap-tier dispatches burned orchestrator-tier budget.

## How this table updates

Per the trigger rule in [`README.md § Maintenance discipline`](./README.md#maintenance-discipline): adjust a row when **three consecutive failed dispatches at the recommended tier** are recorded, OR when a single retro names the tier choice as a contributing factor (e.g. "we routed this to cheap tier and it lost the spec's edge case; mid tier would have caught it"). Note the rationale in the retro that triggered the change.

Defaulting to the parent agent's tier (the Cursor SDK's `Task` default) is treated as a bug — every dispatch's brief carries an explicit tier choice per the brief-discipline principle.
