# drive/triage — project-context for triage

Loaded by `drive-triage-work` and `drive-start-workflow`. Holds prisma-next's accumulated triage protocol — failure modes, sizing anchors, ticket-shape patterns, Linear-sync conventions.

> **Trial period in effect (ends 2026-06-02).** When any drive-* skill in this category produces a finding, record it in [`findings.md`](./findings.md). Quality bar, tags, and format live in [`drive/trial.md`](../trial.md).

## Sizing anchors (calibration for this repo)

Reference tasks that calibrate "what's a direct change vs orphan slice vs in-project slice in prisma-next." Populated by retros + operator calibration; treat as living.

| Task | Verdict | Why |
|---|---|---|
| _e.g._ Typo fix in a markdown file under `docs/` | Direct change | One-file diff; obvious-from-reading; no downstream effect. |
| _e.g._ Add a new operation to an existing SQL operation family | Slice (in-project under an active SQL project; orphan otherwise) | Touches contract + emitter + tests + fixtures. Reviewable in one sitting but not 30-sec. |
| _e.g._ Introduce a new target pack | New project | Multi-layer; new contract surface; new fixtures; new tests; multiple PRs. |

_(Add anchors as the team accrues calibration via retros.)_

## Ticket-shape patterns

Patterns that have a known verdict in this repo:

| Pattern | Verdict | Notes |
|---|---|---|
| _e.g._ "Bump <dep> to <version>" with no breaking changes | Direct change | Lockfile + maybe one or two type fixes. |
| _e.g._ Bump that triggers a breaking change (typing, behaviour shift) | Slice | Needs migration. |
| _e.g._ "Add lint rule X" | Usually orphan slice | Rule + initial code-fix sweep. |

_(Add patterns as they emerge from operator experience.)_

## Linear-sync conventions

- Linear team: _<team-key>_ (to be filled in by operator)
- Linear project for orphan-slice "umbrella": _<project-key or note "none — orphan slices have no Linear Project">_
- Issue identifier prefix: _<e.g. TML->_
- Branch-name convention for issue link: _e.g. `tml-NNNN-short-slug`_
- PR-title convention: _e.g. include `Refs: TML-NNNN` in the description to let GH integration auto-close on merge_

## Promote / demote ceremony notes

- **Promote**: when an in-flight slice grows past one PR.
  - Create a new Linear Project.
  - Move the original ticket into the Project; mark it Done; rename it `Plan: <project-slug>` (or comment-and-leave-name if rename is disruptive).
  - Scaffold `projects/<project>/` via `drive-create-project`.
  - Migrate the in-flight slice spec / draft to `projects/<project>/spec.md` as the starting point for `drive-specify-project`.
- **Demote**: when an in-flight project's remaining scope fits one PR.
  - Identify the surviving issue.
  - Close other open issues in the Linear Project with comments "merged into <surviving>".
  - Move the surviving issue out of the Linear Project (set `project = null`).
  - Mark the Linear Project Cancelled (if no slices shipped) or Completed (if at least one shipped).
  - Migrate useful content from `projects/<project>/` to the surviving PR body.
  - Delete `projects/<project>/`.

Both ceremonies require operator authorisation per `drive-triage-work`'s authorisation flag.

## Failure modes (catalogue; populated by retros)

_When triage misroutes work, the retro lands here. Each entry: pattern → consequence → mitigation._

_(Empty at seeding; populated by `drive-run-retro`.)_

## Triage heuristics

Heuristics applied during triage to route work to its right shape. Distinct from `## Failure modes` (which records pattern → consequence → mitigation entries from retros) and from `## Sizing anchors` (which calibrates sizing decisions). Heuristics are meta-level questions to ask during triage itself.

### Problem-statement vs design-to-implement

Triage asks: *"Is this work a **problem to solve** (still needs design work before implementation starts) or a **design to implement** (the spec is settled)?"*

Routing per answer:

- **Problem-statement** → trigger a design discussion or spike first. Cross-link to `drive-triage-work`'s existing "spike first" verdict — the work is not yet ready for a slice or direct change because the *what* hasn't been decided. Treating an unsettled problem as if it were a design-to-implement is how teams end up planning implementation around a design they haven't settled; the plan/spec then has to be rewritten partway through.
- **Design to implement** → route to slice or direct change per normal sizing (see `## Sizing anchors` and `## Ticket-shape patterns`). The *what* is settled; the work is to execute it.

The diagnostic question: *if you handed this ticket to an Implementer right now, would they need to make design decisions to get started, or just execute?* If "make design decisions", it's a problem-statement and needs a design pass first. If "just execute", it's a design-to-implement.

This heuristic operates at triage, which is Orchestrator-owned (see [`drive/roles/README.md`](../roles/README.md)); the resulting design discussion (when the answer is problem-statement) is dispatched to a Specialist sub-agent following the dispatch-by-default pattern.

### Design depth ≠ slice count

After a design discussion settles, triage asks the project-vs-slice question by **counting expected PRs**, not by feeling.

A meaty design conversation does not predict implementation size. The conversation's depth determines whether the work needs a *project* (a durable home for design artifacts — spec, plan, alternatives, design notes); it does NOT determine the *slice count* (how many PRs implementation will need).

- **Deep discussion can yield a single clean slice** when the design produces a contained result.
- **Thin discussion can yield many slices** when scope unfurls after settling on a path.

Routing per signal:

- *Substantial design ceremony needed?* → **Project**. The project provides the design home regardless of how many slices the implementation requires.
- *Implementation needs more than one PR?* → **Multiple slices** within the project (or, if no project, multiple orphan slices). Each slice is one PR.
- *Implementation fits one PR?* → **One slice**. May be an orphan slice (no project home needed) or the single slice of a one-slice project (when design ceremony justified the project home anyway).

The diagnostic question: *after the design settles, how many PRs will the implementation take to land?* That answer drives slice count. The design conversation's depth is a separate signal that drives project-or-orphan-slice routing.

Failure mode this guards against: triaging a design-heavy discussion as a multi-slice project just because the discussion was deep, then over-decomposing the implementation into thin horizontal slices. The horizontal slices are not vertical slices — none of them alone delivers value — and the result is multiple thin PRs that should have been one. See [`docs/drive/principles/decomposition-and-cost.md § The sizing stack`](https://github.com/prisma/ignite/blob/main/docs/drive/principles/decomposition-and-cost.md#the-sizing-stack--pr-slice-project-dispatch) for the canonical sizing model.
