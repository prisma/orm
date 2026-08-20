---
name: github-review-iteration
description: Orchestrates a GitHub PR review loop by delegating triage and implementation to dedicated sub-agents, then repeating until actionable review items are cleared. Use when the user says “address PR review”, “triage review comments”, or “iterate until review is clean”.
argument-hint: "[triage|implement|iterate] [pr-url] [output-dir]"
---

# GitHub Review Iteration

Run an iterative PR review loop: **fetch state → render/summarize → triage actions → implement (code + Done + resolve) → re-fetch** until the PR has no remaining actionable items.

This skill is an **orchestrator**. It delegates:

- triage to `../review-triage-phase/agents/review-triager.md`
- implementation to `../review-implement-phase/agents/review-implementer.md`

The orchestrator owns sequencing, handoff, and loop control. It does not perform triage or implementation directly when delegation is available.

## Locating sibling skills and scripts

This skill depends on three sibling skills that live **in the same parent directory**:

- `../review-fetch-phase/` — fetches and renders PR review state
- `../review-triage-phase/` — triages review threads into an action plan
- `../review-implement-phase/` — implements triaged actions and resolves threads

All script paths in this document are **relative to this skill's directory**. Use `../` to reach sibling skills. Do **not** search the workspace/repo for these files — they are part of the skills installation, not the project being reviewed.

**Run the scripts from the repository root**, addressing them by their full path under the skills installation. The reviews root defaults to `wip/reviews` resolved against the working directory, so a run started elsewhere writes artifacts outside the repo-root `wip/` tree that `.gitignore` covers. Pass `--reviews-root <repo-root>/wip/reviews` if you must run from another directory.

## Usage

This skill supports subcommands:
- `triage`: fetch + triage into structured actions
- `implement`: execute the triaged actions and update status
- `iterate`: loop `triage` → `implement` until clear (default)

```text
/github-review-iteration iterate <PR_URL> [output-dir]
```

When `output-dir` is omitted, use the standard layout: `wip/reviews/<owner>_<repo>_pr-<number>/` (derived from the PR URL, with owner and repo lowercased — derive a directory name by hand the same way, or the artifacts split across two directories).

Example:

```text
/github-review-iteration iterate https://github.com/OWNER/REPO/pull/123
```

## Files written (deterministic layout)

Store artifacts under:

`wip/reviews/<owner>_<repo>_pr-<number>/`

Canonical artifacts:

- `review-state.json` (canonical v2)
- `review-actions.json` (canonical v2)

Derived artifacts:

- `review-state.md`
- `summary.txt` (or JSON summary)
- `review-actions.md`
- `apply-log.json` (optional)

When you need a thin wrapper for path setup + standard script calls, run:

```bash
node ./scripts/review-iterate.mjs --pr <PR_URL>
```

For phase-specific execution without full orchestration, use:

- `/review-fetch-phase <PR_URL> [output-dir]`
- `/review-triage-phase <PR_URL> [output-dir]`
- `/review-implement-phase <PR_URL> [output-dir]`

## Behavioral rules

- **WILL ADDRESS** items:
  - reply + 👍
  - leave unresolved until fixed
- **Not addressed in this PR** items:
  - reply with rationale + 👎
  - resolve the thread
- **Implementation**:
  - granular, intent-driven commits
  - explicit staging only (never `git add -A` / `git add .`)
  - reply “Done” and resolve when complete

## Operational reliability notes (Cursor)

### `gh api` TLS / cert failures in sandboxed shells

If GitHub administration fails with an error like:

- `x509: OSStatus -26276` (or similar TLS/certificate verification failures)

Treat it as an **environment/sandbox cert-store mismatch**, not a script bug.

Recovery:

- Re-run the affected `gh` calls **outside** the sandbox (use a shell mode that uses the system cert store).
- Do **not** disable TLS verification (no `GH_NO_VERIFY_SSL`, no custom curl flags).
- After re-running, continue the loop normally (fetch → triage → implement → resolve → repeat).

### JSON-first deterministic commands

All script paths below are relative to this skill's directory.

1. Fetch canonical JSON:

```bash
node ../review-fetch-phase/scripts/fetch-review-state.mjs --pr <PR_URL> --out-json <review-dir>/review-state.json
```

2. Render and summarize from JSON (pure scripts):

```bash
node ../review-fetch-phase/scripts/render-review-state.mjs --in <review-dir>/review-state.json --out <review-dir>/review-state.md
node ../review-fetch-phase/scripts/summarize-review-state.mjs --in <review-dir>/review-state.json --format text --out <review-dir>/summary.txt
```

3. Render triage plan from canonical actions JSON:

```bash
node ../review-triage-phase/scripts/render-review-actions.mjs --in <review-dir>/review-actions.json --out <review-dir>/review-actions.md
```

## Data exchange format (triager → implementer)

`review-actions.json` is the contract between the triager and implementer.

Minimum v2 shape:

```json
{
  "version": 2,
  "pr": { "url": "https://github.com/OWNER/REPO/pull/123", "nodeId": "PR_kw..." },
  "reviewState": { "path": "review-state.json", "fetchedAt": "...", "version": 2 },
  "actions": [
    {
      "actionId": "A-001",
      "target": { "kind": "review_thread", "nodeId": "PRRT_xxx", "url": "..." },
      "decision": "will_address",
      "summary": "One-line description of what will be done",
      "rationale": null,
      "targetFiles": ["path/to/file.ts"],
      "acceptance": "How to tell it's done",
      "status": "pending",
      "done": null
    }
  ]
}
```

Rules:

- Use **node ids only** for targets (`target.nodeId`).
- Preserve `actions[]` order intentionally (do not reorder).
- Implementer updates `status` (`pending|in_progress|done`) and `done` records in place.
- **Compound targets**: A single `pull_request_review` body may contain multiple findings (especially from automated reviewers like CodeRabbit which bundle "outside diff range" comments into the review body). The triager must decompose these into sub-actions (e.g., `A02a`, `A02b`). Never blanket-dismiss review bodies without reading their content.

## Procedure

### `triage`

1. **Delegate to triage sub-agent**

Invoke the review triager agent at `../review-triage-phase/agents/review-triager.md` and pass:

- PR URL
- output paths:
  - `<output-dir>/review-state.md`
  - `<output-dir>/review-state.json`
  - `<output-dir>/review-actions.md`
  - `<output-dir>/review-actions.json`
- optional scope constraints

2. **Require triage outputs**

The triager must:

- fetch review state (via `../review-fetch-phase/scripts/fetch-review-state.mjs`)
- triage review threads into `review-actions.json` decisions/status
- write/update `review-actions.md` and `review-actions.json`

3. **Validate handoff contract**

Before returning from `triage`, verify that `<output-dir>/review-actions.json` exists and is valid for implementer consumption (`version`, PR metadata, and `actions[]` with `target.kind` + `target.nodeId`).

### `implement`

1. **Delegate to implementation sub-agent**

Invoke the review implementer agent at `../review-implement-phase/agents/review-implementer.md` and pass:

- PR URL
- `<output-dir>/review-actions.md`
- `<output-dir>/review-actions.json`
- optional scope constraints

2. **Require implementation outputs**

The implementer must:

- work through pending `will_address` actions
- make focused, explicit-staging commits
- run smallest relevant checks per action
- reply "On it" when starting, then "Done" and resolve the thread when complete
- update `review-actions.json` in-place (`status`, `done`)
- re-fetch review state at the end to verify remaining actionable items

Responsibility note:
- Posting "Done" and resolving completed threads belongs to the implementer phase and is part of marking actions done.

### `iterate`

Repeat delegated `triage` → delegated `implement` until there are no remaining actionable review items.

Loop contract:

1. Run `triage` delegation and read resulting `review-actions.json`.
2. Inspect `review-actions.json`; if no `will_address` actions remain with `pending` or `in_progress` status, stop and report completion.
3. Run `implement` delegation.
4. Re-run `triage` delegation to refresh state and determine next iteration.
5. Continue until clear.

## Optional shortcuts (repo-specific)

If this repo provides dedicated slash commands or subagents for triage/implementation, prefer them to reduce manual steps.
