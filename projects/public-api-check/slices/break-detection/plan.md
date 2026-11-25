# Slice plan: find breaks against the last release, and make API changes visible

Spec: [spec.md](spec.md). Branch `tml-3933-break-detection`, one pull request.

Implementers run on Opus at medium effort, reviewers on Opus at high effort. Every brief says: run only the test files the change touches, plus lint and typecheck of the touched files; never a whole suite.

## Dispatches

| # | Brief | Owns | Runs |
| --- | --- | --- | --- |
| 1, 2 | [Trials](dispatches/) | `wip/break-spike/` | Done 2026-11-25 |
| 3 | [Type tests against the last release](dispatches/03-type-tests.md) | `scripts/public-api/` new files, root `package.json`, `.gitignore`, the `api-compat` job in `.github/workflows/ci.yml` | In parallel with 4 |
| 4 | [Description check and comment](dispatches/04-description-check.md) | `.github/workflows/api-changes.yml`, `.github/workflows/scripts/api-changes*.mjs` | In parallel with 3 |
| 5 | Last release's example apps (brief written after 3) | the `typecheck` job in `.github/workflows/ci.yml`, one script | After 3, which shares the last-release lookup and the record format |

Dispatches 3 and 4 share no file. Dispatch 4 does not edit `package.json`; the orchestrator adds its test file to `test:scripts` after both land.

## Written by the orchestrator

- `packages/9-public/AGENTS.md` and the `**/api.txt` path instruction in `.coderabbit.yml`.
- The decision record and the contributor guide, after dispatch 5, from what was built. The decision record passes the ADR fresh-reader review.
- Project close-out: lasting content moves to `docs/`, the project folder is deleted.

## Then

In-loop review of each dispatch, `/drive-code-review` of the tip, manual QA on a real pull request (one that adds an export gets the comment and fails the description check until the description names it), the pull request description through a fresh reader.
