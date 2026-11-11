# Definition of Ready — overlays at every scope

Canonical DoR (the shape) lives in [`docs/drive/principles/definition-of-ready.md`](https://github.com/prisma/ignite/blob/main/docs/drive/principles/definition-of-ready.md). This file holds the **team's overlays** — the concrete items the agile orchestrator checks at pickup time, in addition to the canonical items each scope already requires.

Overlays grow by retro accretion (per [`README.md § Maintenance discipline`](./README.md#maintenance-discipline)): a retro reveals a pickup-time gap, the matching scope's overlay grows by one item. The canonical protocol layer stays small; the team's overlays grow.

## Project-DoR overlay

In addition to the canonical project DoR:

- [ ] Linear Project exists (created via `save_project` MCP tool).
- [ ] If started from a ticket: promotion pattern applied (ticket moved into Linear Project, marked Done, renamed `Plan: <project name>` — see promotion ceremony in [`drive/triage/README.md`](../triage/README.md)).
- [ ] Project working branch exists, named with Linear Project ID (e.g. `tml-2549-<descriptive-slug>`).
- [ ] `projects/<project>/` folder scaffolded with `spec.md` + `plan.md` placeholders; `README.md` present.

## Slice-DoR overlay

In addition to the canonical slice DoR:

### Tracker / branch / linkage items

- [ ] Linear issue created and linked from the slice spec (issue description carries a link back to `projects/<x>/slices/<s>/`).
- [ ] Slice's PR-to-be will carry a `Refs: <issue-id>` line in its description.
- [ ] Slice's parent branch is the project's working branch (or `main` for orphan slices).

### Plan-side items

- [ ] Slice plan references the relevant entries from [`failure-modes.md`](./failure-modes.md) that apply to this slice's shape (so dispatch briefs can thread them in).
- [ ] Slice plan references the relevant entries from [`grep-library.md`](./grep-library.md) that apply to this slice's shape.

## Dispatch-DoR overlay

In addition to the canonical dispatch DoR:

- [ ] If a dispatch changes a public or cross-family API shape, the brief names the design owner who approved that exact shape and links the durable decision record. An agent-authored spec is not evidence of operator approval. If the shape is unsettled, route to `drive-discussion` before implementation. (Added after a final retro on an unapproved operation-discriminated middleware SPI that was implemented and later reverted.)
- [ ] Brief's "Inputs" section references the applicable [`failure-modes.md`](./failure-modes.md) entries with their dispositions in the edge-case table.
- [ ] Brief's "Inputs" section references the applicable [`grep-library.md`](./grep-library.md) entries this dispatch should run.
- [ ] Brief's tier is one of the three the team uses (orchestrator / mid / cheap — see [`model-tier.md`](./model-tier.md)).
- [ ] Brief specifies a slice plan path under `projects/<x>/slices/<s>/` (or "orphan" if no parent project).
- [ ] Brief's edge-case table includes "destructive git operations forbidden without orchestrator approval" disposition (non-negotiable for all subagent dispatches; see [F5 in failure-modes.md](./failure-modes.md#f5-destructive-git-operations-executed-by-subagents-without-orchestrator-approval)).
- [ ] Affected packages identified (so `pnpm build` of dependent packages can fire as a "done when" gate).
- [ ] Fixture regeneration in-or-out-of-scope decided (`pnpm fixtures:check` either passes or is part of the dispatch).
- [ ] If touching `packages/0-shared` or `packages/1-framework-core`, downstream package builds named as "done when" gates.
- [ ] If the dispatch adds a new public type, the dependent packages' typecheck is named.
- [ ] Brief's "Outcome" section includes a *property statement* alongside the mechanical instruction (*"such that <invariant the change preserves>"*). If the brief authorises adding a field / collapsing operations / consolidating implementations, it must also name the architectural property the change preserves (target-agnostic core, adapter ownership of an operation, caller's contract semantics, etc.) — not just the mechanic. See [F17 in `failure-modes.md`](./failure-modes.md#f17-dispatch-brief-frames-the-win-as-mechanics-implementer--reviewer-ship-wrong-shape-work-that-satisfies-it). (Added by `TML-2753` retro.)
- [ ] If the dispatch **collapses two distinct operations into one primitive**, brief asserts (as properties, not file enumerations): (a) which caller's contract motivates the collapse; (b) that the post-collapse primitive satisfies every other caller's contract (idempotent / fail-loudly / CAS / etc.) — if it doesn't, the brief keeps both operations or adds a deliberate variant; (c) that no reference to the pre-collapse operations survives in production source after the dispatch. The implementer enumerates callers via `git grep` during execution; the brief asserts the *property* that must hold, not the *file set* that must be touched. See [F19 in `failure-modes.md`](./failure-modes.md#f19-single-primitive-collapse-changes-semantics-for-some-callers-but-not-others). (Added by `TML-2753` retro; revised after operator review flagged file enumeration as over-prescriptive against Drive's "briefs assert properties, not file lists" principle.)
- [ ] If the brief lists specific items for the reviewer to verify, it also includes a generic *"trace each public-API change through all callers, naming each caller's contract and how the change satisfies it"* prompt. Specific lists narrow reviewer attention; the generic prompt re-widens it. (Added by `TML-2753` retro.)

_(Living; add items as retros surface pickup-time gaps.)_
