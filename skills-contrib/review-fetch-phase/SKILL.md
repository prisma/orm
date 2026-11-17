---
name: review-fetch-phase
description: Fetches canonical PR review state and renders derived state artifacts. Use when the user wants the state acquisition phase only (fetch, render, summarize) for a review-framework PR.
argument-hint: "[pr-url] [output-dir]"
---

# Review Fetch Phase

Run only the state acquisition phase of the review-framework loop:

fetch canonical review state JSON (v2), validate it, and render all derived artifacts via scripts.

Run commands from this skill directory. All script paths below are relative to it.

## Inputs

- Required:
  - PR URL (for example: `https://github.com/OWNER/REPO/pull/123`)
- Optional:
  - output directory

If output directory is omitted, derive:

`wip/reviews/<owner>_<repo>_pr-<number>/`

## Behavior

1. Validate and parse PR URL, then compute deterministic paths:
   - `<output-dir>/review-state.json`
   - `<output-dir>/review-state.md`
   - `<output-dir>/summary.txt`
   - `<output-dir>/review-targets.json`
2. Ensure `<output-dir>` exists.
3. Enforce artifact safety before generation (the artifacts must stay untracked). In a git checkout the guard asks git directly; in a Jujutsu workspace with no git directory it accepts a directory under the workspace root's ignored `wip/` tree:

```bash
node ./scripts/guard-review-artifacts-ignored.mjs --dir <output-dir>
```

4. Run fetch script to produce canonical JSON:

```bash
node ./scripts/fetch-review-state.mjs --pr <PR_URL> --out-json <output-dir>/review-state.json
```

5. Validate canonical JSON before deriving additional files:

```bash
node ./scripts/validate-review-state.mjs --in <output-dir>/review-state.json
```

6. Render markdown from canonical JSON:

```bash
node ./scripts/render-review-state.mjs --in <output-dir>/review-state.json --out <output-dir>/review-state.md
```

7. Generate text summary from canonical JSON:

```bash
node ./scripts/summarize-review-state.mjs --in <output-dir>/review-state.json --format text --out <output-dir>/summary.txt
```

8. Extract deterministic triage targets for downstream bootstrap:

```bash
node ./scripts/extract-review-targets.mjs --in <output-dir>/review-state.json --out <output-dir>/review-targets.json
```

Target extraction includes:
- unresolved review threads
- pull-request reviews with body text
- issue comments with body text

## Schema contract

- `review-state.json` is canonical and must be schema version `2`.
- No backward compatibility is provided for v1 artifacts.
- Derived artifacts (`review-state.md`, `summary.txt`, `review-targets.json`) are regenerable from canonical JSON.
- Review artifacts are generated files and must remain untracked in git.

## Error handling

- Treat fetch failures as operational errors.
- If `gh api` fails with TLS/cert errors in sandbox (`x509` / `OSStatus -26276`), fail fast and instruct rerun outside sandbox.
- Never disable TLS verification.

## Output to user

Return artifact paths:

- `review-state.json`
- `review-state.md`
- `summary.txt`
- `review-targets.json`

Suggest next step:

- `/review-triage-phase <PR_URL> [output-dir]`
