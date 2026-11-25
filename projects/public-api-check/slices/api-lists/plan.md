# Slice plan: the committed API list of each published package

Spec: [spec.md](spec.md). Implementer and reviewer are Opus subagents (implementer at medium effort, reviewer at high), resumed across rounds.

## Dispatches

### 1. Read, flatten, check, commit the lists

**Outcome.** `pnpm api:update` and `pnpm api:check` exist and are tested, the `Lint` job runs the check, and the 22 `api.txt` files are committed, such that the lists are a deterministic function of the build output and nothing in a published package changes.

**Builds on.** The trial scripts under `wip/api-check-spike/`.

**Hands to.** A branch on which `pnpm api:check` passes after `pnpm build`, with measurements: run time, sizes, longest lines, and whether union ordering varies.

**Validation.** The slice's own `node --test` files; lint and typecheck for what `scripts/` falls under; `pnpm lint:deps`; `pnpm lint:ratchets` (new JavaScript outside a package); `pnpm check:clean-tree` after a build; `pnpm api:check`. No whole suites locally: CI runs them.

**Brief.** [dispatches/01-read-flatten-check.md](dispatches/01-read-flatten-check.md).

### 2. Fix what the reviews find

**Outcome.** Every finding of the in-loop review and of the full code review is fixed or answered.

**Builds on.** Dispatch 1 and `projects/public-api-check/reviews/code-review.md`.

## Calibration entries that apply

- Dispatch gates must mirror CI's `Lint` job, which runs lint separately from typecheck (failure mode F14).
- New JavaScript outside a package is covered by `pnpm lint:ratchets`.
- Before the pull request: merge `origin/main`, rebuild, and run `pnpm api:check` again, because any export change on `main` makes the committed lists stale.

## After the dispatches

Full code review (`/drive-code-review`, no walkthrough) on the tip, fixes, the contributor-path check recorded, the pull request description read by a fresh reviewer, then the pull request with `Fixes TML-3932`.
