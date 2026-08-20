---
name: review-triage-phase
description: Produces canonical review actions from fetched review state and renders action markdown. Use when the user wants only triage/action-planning for the review-framework workflow.
argument-hint: "[pr-url] [output-dir]"
---

# Review Triage Phase

Run only the triage phase of the review-framework loop:

read current review state artifacts, bootstrap canonical `review-actions.json`, update triage fields, validate, then render `review-actions.md`.

Run commands from this skill directory. All script paths below are relative to it.

## Inputs

- Required:
  - PR URL
- Optional:
  - output directory

If output directory is omitted, derive:

`wip/reviews/<owner>_<repo>_pr-<number>/`

## Preconditions

Expected inputs in output dir:

- `<output-dir>/review-state.json`
- `<output-dir>/review-targets.json` (optional)
- `<output-dir>/review-state.md` (optional)
- `<output-dir>/summary.txt` (optional)

If `review-state.json` is missing, instruct user to run:

- `/review-fetch-phase <PR_URL> [output-dir]`

Note:
- `review-actions.json` scaffolding is generated from `review-state.targets`, taking the thread and review-body targets. Issue-comment targets are captured in `review-state.json` but get no scaffolded action.
- **Compound review bodies**: A single `pull_request_review` target may contain multiple distinct findings (e.g., CodeRabbit bundles "outside diff range" comments, actionable comments, and nitpicks into one review body). The triager must decompose these into individual action items during triage — never blanket-dismiss a review body without reading its content.

## Behavior

1. Compute deterministic paths:
   - `<output-dir>/review-state.json`
   - `<output-dir>/review-actions.json`
   - `<output-dir>/review-actions.md`
2. Enforce artifact safety before generation (must be ignored by git):

```bash
node ../review-fetch-phase/scripts/guard-review-artifacts-ignored.mjs --dir <output-dir>
```

3. Bootstrap canonical action scaffold from review state:

```bash
node ./scripts/bootstrap-review-actions.mjs --in <output-dir>/review-state.json --out <output-dir>/review-actions.json
```

4. Delegate triage to:
  - `./agents/review-triager.md`
5. Require triager output contract:
   - `review-actions.json` is valid v2
   - targets use node IDs only
   - actions remain intentionally ordered
   - every `defer` action includes a Linear issue identifier
   - will-address actions for `review_thread` targets must remain actionable via **thread replies** (not PR reviews)
6. Create Linear tracking for deferred work:
   - create one or more Linear tickets (group related deferred comments)
   - attach each deferred action to a Linear issue ID (`linearIssue`)
   - ensure the deferred thread reply includes that Linear ticket URL
7. Validate canonical actions JSON and enforce completed triage decisions:

```bash
node ./scripts/validate-review-actions.mjs --in <output-dir>/review-actions.json --require-final
```

8. Render markdown from canonical actions JSON:

```bash
node ./scripts/render-review-actions.mjs --in <output-dir>/review-actions.json --out <output-dir>/review-actions.md
```

## Schema contract

- `review-actions.json` is canonical and must be schema version `2`.
- No backward compatibility is provided for v1 artifacts.
- The triager edits scaffolded actions in place instead of reconstructing the entire file.
- Triage phase is only complete when there are zero `triage_pending` decisions.
- Review artifacts are generated files and must remain untracked in git.
- `defer` decisions require Linear tracking (`linearIssue`) and a thread reply with that link.

## Output to user

Return artifact paths:

- `review-actions.json`
- `review-actions.md`

Suggest next step:

- `/review-implement-phase <PR_URL> [output-dir]`
