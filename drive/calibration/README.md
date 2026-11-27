# drive/calibration — the team's living calibration

Calibration is the team's accumulated answers to the questions Drive's workflows ask at every checkpoint: *how big is this work, is it ready to start, what should we watch for, what does done look like, what shapes does this work usually take?* Each answer started as a single observation in a retro, hardened into a rule the next dispatch reads.

This directory is the **single home** for that knowledge. Earlier shapes spread it across each `drive/<category>/README.md`, which made calibration hard to find (operator has to know which category owns which question) and hard to maintain (a single failure mode can inform plan-side DoR, dispatch-side DoR, and spec-side DoD overlays in different files). Calibration is cross-cutting; it lives here.

The category READMEs (`drive/plan/`, `drive/project/`, `drive/spec/`, `drive/pr/`, `drive/qa/`) retain their operational conventions — how this team integrates the skill with the team's tooling, tracker, branch conventions, etc. — and link out to the relevant calibration files.

## Reading guide

| File | Answers the question |
| --- | --- |
| [`sizing.md`](./sizing.md) | *How big is this dispatch? Should it parallelise with that one?* |
| [`model-tier.md`](./model-tier.md) | *Which model tier should this dispatch run on?* |
| [`dor.md`](./dor.md) | *Is this project / slice / dispatch ready to start?* |
| [`dod.md`](./dod.md) | *Is this project / slice / dispatch done? Which validation gates apply?* |
| [`failure-modes.md`](./failure-modes.md) | *What's likely to go wrong, and what catches it?* |
| [`grep-library.md`](./grep-library.md) | *Which rg patterns catch which anti-patterns?* |
| [`patterns.md`](./patterns.md) | *What shapes does this kind of work usually take? Which audiences does it touch?* |

A typical brief touches four of these: `sizing.md` + `model-tier.md` to pick the dispatch's tier; `failure-modes.md` + `grep-library.md` to thread the right edge cases and gates into the brief. A typical retro updates one of these — usually `failure-modes.md`, `grep-library.md`, or one of the overlays.

## Which skills load which files

| Skill family | Loads (in addition to its category README) |
| --- | --- |
| `drive-plan-project`, `drive-plan-slice` | `sizing.md`, `model-tier.md`, `dor.md`, `dod.md`, `failure-modes.md`, `grep-library.md`, `patterns.md` |
| `drive-build-workflow` | `sizing.md`, `model-tier.md`, `dor.md`, `dod.md`, `failure-modes.md`, `grep-library.md` |
| `drive-specify-project`, `drive-specify-slice` | `patterns.md`, `failure-modes.md` (scope traps) |
| `drive-create-project`, `drive-deliver-workflow`, `drive-close-project` | `dor.md`, `dod.md` (project scopes) |
| `drive-pr-description`, `drive-pr-walkthrough` | `dod.md` (PR-side slice DoD) |
| `drive-qa-plan`, `drive-qa-run` | `dod.md` (QA-side slice DoD), `failure-modes.md` (coverage-gate gaps), `patterns.md` (consumer audiences) |

Each category README has a "Calibration" section near the top listing the files it points at; the skill follows those pointers as part of its workflow-step-1 load.

## Maintenance discipline

All files in this directory are updated **trigger-based, not periodically** — per `docs/drive/principles/retro.md`. The retro names which calibration file to update; the update lands in the same commit as the retro entry (the retro is not done until the update is in a surface the next dispatch will read).

| Calibration file | Update trigger |
| --- | --- |
| `sizing.md` | Retro reveals an estimated M was actually L; calibration miss on parallelisation; a new reference task is worth pinning. Add the worked example showing the miscalibration; never delete existing anchors. |
| `model-tier.md` | Three consecutive failed dispatches at a tier this table recommends; OR a retro that names tier choice as a contributing factor. Adjust the row; record the rationale in the retro. |
| `dor.md` | Retro reveals a pickup-time gap (the work started without a precondition that, if checked, would have caught the problem). Append the new item to the relevant overlay. |
| `dod.md` | Retro reveals a handoff-time gap (the dispatch / slice / project handed off in a state that masked a defect later caught downstream). Append to the relevant overlay; never delete (entries become baseline). |
| `failure-modes.md` | Every retro that surfaces a failure mode appends an entry. Recurrence means the entry's mitigation was inadequate — update the mitigation and note the recurrence under the same entry. Never remove. |
| `grep-library.md` | Every retro that surfaces a new anti-pattern catchable by a pattern adds the pattern. Mark obsolete entries historical (don't delete) when the underlying anti-pattern is structurally impossible (e.g. removed at the type level). |
| `patterns.md` | New consumer audience, new substrate location QA scripts repeatedly touch, new slice-composition shape the team finds itself reusing, new edge case worth pinning. Append; reduce with explanation if a pattern is no longer relevant. |

Never delete calibration content. Mark obsolete entries historical and explain why (the historical entry is itself memory: it tells the next agent why a pattern that *looks* like a known failure mode actually isn't).

## When calibration belongs somewhere else

Three kinds of content look like calibration but live elsewhere:

- **Canonical methodology** — invariants every team should honour, ritual shapes (what DoR *is*, what a brief *contains*) — lives in `docs/drive/principles/`. Calibration is the *content* of overlays; principles are the *shape* the overlays plug into.
- **Operational team conventions** — how this team integrates Drive with its tracker, branch naming, PR title prefixes, where artefacts get filed — lives in the matching `drive/<category>/README.md`. Calibration grows by retro accretion; operational conventions document how the team operates.
- **Per-project artefacts** — a specific project's spec, plan, design-decisions log, manual-QA reports — live under `projects/<x>/` and delete at close-out per [`drive-close-project`](https://github.com/prisma/ignite/blob/main/skills/.pilot/drive-close-project/SKILL.md). Surfaces of value get *lifted* into `drive/calibration/` during close-out (the operation `drive-close-project` calls "lift-example-to-context").
