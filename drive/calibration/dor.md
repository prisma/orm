# Definition of Ready — overlays at every scope

Canonical DoR (the shape) lives in [`docs/drive/principles/definition-of-ready.md`](https://github.com/prisma/ignite/blob/main/docs/drive/principles/definition-of-ready.md). This file holds the **team's overlays** — the concrete items the agile orchestrator checks at pickup time, in addition to the canonical items each scope already requires.

Overlays grow by retro accretion (per [`README.md § Maintenance discipline`](./README.md#maintenance-discipline)): a retro reveals a pickup-time gap, the matching scope's overlay grows by one item. The canonical protocol layer stays small; the team's overlays grow.

## Project-DoR overlay

In addition to the canonical project DoR:

- [ ] Linear Project exists (created via `save_project` MCP tool).
- [ ] If started from a ticket: promotion pattern applied (ticket moved into Linear Project, marked Done, renamed `Plan: <project name>` — see promotion ceremony in [`drive/triage/README.md`](../triage/README.md)).
- [ ] Project working branch exists, named with Linear Project ID (e.g. `tml-2549-<descriptive-slug>`).
- [ ] `projects/<project>/` folder scaffolded with `spec.md` + `plan.md` placeholders; `README.md` present.
- [ ] The spec, the design records and the tickets use the words of [`docs/glossary.md`](../../docs/glossary.md) from the first draft. Example: four design documents and four tickets said "database package" where the glossary says "target", and each had to be reworded after the operator read them.

## Slice-DoR overlay

In addition to the canonical slice DoR:

### Tracker / branch / linkage items

- [ ] Linear issue created and linked from the slice spec (issue description carries a link back to `projects/<x>/slices/<s>/`).
- [ ] Slice's PR-to-be will carry a `Fixes <issue-id>` line in its description (`Part of <issue-id>` if it does not complete the issue).
- [ ] Slice's parent branch is the project's working branch (or `main` for orphan slices).

### Plan-side items

- [ ] Slice plan references the relevant entries from [`failure-modes.md`](./failure-modes.md) that apply to this slice's shape (so dispatch briefs can thread them in).
- [ ] Slice plan references the relevant entries from [`grep-library.md`](./grep-library.md) that apply to this slice's shape.
- [ ] If the slice's design comes from a handover or an earlier session, it is checked before building against the code and against each earlier ruling of the operator's on the topic, read in the original conversations and not only in the handover. Example: a ruling that packages may read any part of a model never reached a handover, and a design limited to one index was built and then rejected.
- [ ] No hand-off between dispatches leaves an application broken until a later dispatch repairs it. Check each hand-off against what an application sees, not only against what compiles. Example: targets stated their published module in one dispatch and target packages restated it in the next, and between the two an application would have imported a package it does not depend on.
- [ ] A plan's claim that nothing emitted changes is checked against every way the file is emitted, including an application that loads the package from its published build. Example: two briefs made the claim, and both times it was false for that application.

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
- [ ] If a brief comes from one report of a defect, it names the class of defect and asks for a search of every place of that class, and the reviewer brief asks for the places the fix missed. Example: a table named `constructor` broke the SQL contract builder; names used as object keys were then fixed in three pull requests, each covering the places its brief named, and a later fix to one error message left the same internal name in eight other messages of the same package until review.
- [ ] If the brief says to fix every instance of a pattern, it states the boundary by what the code feeds. Example: a brief said to replace a locale-dependent sort in every emitter, renderer and serialiser, and the implementer also changed a migration planner, where the sort decides the order of operations. The brief should have said: wherever the order only affects the text of a generated file, and nowhere that it affects a plan, a hash or a canonical form.
- [ ] If the brief asks for a check that runs on every pull request, it says to put the check in a command CI already runs and not to edit a workflow file, because a change to CI needs the operator's agreement. Example: asked for such a check, an implementer added a workflow step, and the check was then moved into a command the lint job already runs.
- [ ] When the orchestrator and a subagent work in one worktree, the brief says to commit with an explicit path (`git commit -- <path>`), and the orchestrator does the same. A bare `git commit` takes everything staged, including the other's files. An explicit path commits the whole file as it is on disk, so each file has one editor at a time: the brief names the files the subagent owns, and the orchestrator does not edit those until the subagent reports.

_(Living; add items as retros surface pickup-time gaps.)_
