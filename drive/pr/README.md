# drive/pr — project-context for PR-body and walkthrough authoring

Loaded by `drive-pr-description` and `drive-pr-walkthrough`. Holds prisma-next's PR conventions — title prefix, body shape, commit style, walkthrough placement, and Linear linkage.

> **Trial period in effect (ends 2026-06-02).** When any drive-* skill in this category produces a finding, record it in [`findings.md`](./findings.md). Quality bar, tags, and format live in [`drive/trial.md`](../trial.md).

## Calibration

PR authoring reads:

- [`drive/calibration/dod.md § Slice-DoD overlay (PR-side items)`](../calibration/dod.md#pr-side-items) — what the PR needs to satisfy as part of the slice DoD

## Branch identity must be settled before PR open

Symptom seen during the drive trial (project `orchestrator-role`): a PR-open specialist was dispatched before the orchestrator finalised the branch name. The specialist opened against the (about-to-be-renamed) branch — PR landed against a stale identifier, had to be closed and re-opened against the correct branch.

Pre-PR-open checklist for the orchestrator:

1. Confirm the branch name reflects the final Linear ticket identifier (no pending rename from project restructuring, ticket merging, methodology shift).
2. Confirm the local branch is pushed and tracking the remote with the final name.
3. State both — branch name + Linear ticket — in the first heartbeat of the PR-open dispatch brief so any drift since brief authoring is caught before `gh pr create` fires.

A PR open against the wrong branch is recoverable but visible; this gate costs nothing and the recovery costs an issue close + a PR re-open.

## Merge queue needs every review thread resolved

The `main` ruleset requires conversation resolution. A PR with auto-merge enabled and every check green still sits at `BLOCKED` while any review thread is unresolved, including CodeRabbit's. Before enabling auto-merge, list unresolved threads: `reviewThreads` takes no `isResolved` filter, so query `reviewThreads(first: 100) { pageInfo { hasNextPage endCursor } nodes { id isResolved } }` through the GraphQL API, page with `after:` while `hasNextPage` is true, and keep the nodes whose `isResolved` is false. Then reply to each with the fix commit or the reason for no change, and resolve them. Seen on #30350 and #30380 (2026-09-22/23).

## PR title convention

- Conventional-commit prefix: `feat:` / `fix:` / `chore:` / `docs:` / `refactor:` / `test:` / `build:` / `ci:`.
- Linear ticket identifier included as `(TML-NNNN)` suffix OR in the description as `Refs: TML-NNNN` — GitHub integration auto-transitions Linear on merge if either is present.
- One-line summary, present tense, imperative mood.

Examples:

- `feat(sql): add returning() to insert operations (TML-2549)`
- `fix(emitter): handle null defaults in column codecs (TML-2487)`

## PR body conventions (full mode)

The canonical `drive-pr-description` structure applies. Additional repo conventions:

- **Reference linked Linear ticket** explicitly in the overview paragraph when the ticket carries context the PR description doesn't repeat.
- **Call out package-layer changes** in `## Changes`: which packages, which layer (Core / Authoring / Tooling / Lane / Runtime / Adapters per `architecture.config.json`).
- **Note fixture regen** if the PR includes regenerated fixtures (so the reviewer knows the diff sprawl is from regen, not code change).
- **No reference to transient project artefacts** in the PR body — per `.cursor/rules/doc-maintenance.mdc`, ADR numbers + Linear tickets are durable references; `projects/<x>/...` paths are not.

## Direct-change mode conventions

For PRs routed as **direct change** by `drive-start-workflow`:

- Title: conventional-commit prefix; ≤ 60 chars; Linear ticket in title.
- Body: 4-line structure (intent / Linear / scope / verification) per `drive-pr-description` § Direct-change mode.
- No `## Changes` section needed (the diff is the change).
- No `## Why` section needed (the intent paragraph carries why).

## Commit-style rules

- Per `.agents/skills/commit-as-you-go/SKILL.md` (canonical): small logical commits; intent-focused messages; no WIP / temp messages.
- This repo's preference: commits within a PR can stay separate (no squash) when each commit is a coherent step. Maintainers may squash on merge based on the PR's shape.
- **Every commit on the branch must carry a `Signed-off-by` trailer (DCO).** Use `git commit -s` (or `git commit --signoff`) for every commit. When rebasing, use `git rebase --signoff` so re-played commits get re-signed.

## Reviewer pre-merge check — Signed-off-by on every commit

DCO is a required check; commits without `Signed-off-by` block the merge. The reviewer verifies sign-off as a pre-merge gate, regardless of CI status (CI catches it but failures land late and are expensive to fix after threads are anchored to SHAs).

Reviewer command (run from the branch root):

```bash
git log --format='%h %s%n  signed: %(trailers:key=Signed-off-by,valueonly,separator=%x20)' origin/main..HEAD
```

Every commit must show a non-empty `signed:` line. If any commit lacks one, surface to the implementer **before** triggering CI re-run — the fix (rebase + sign + force-push) changes SHAs and re-anchoring review threads is costly. In practice the simplest recovery is `git rebase --signoff <merge-base>` then `git push --force-with-lease`.

This check fires on every PR, regardless of authoring path. Cheap to run, expensive to skip — the cost of fixing unsigned commits *after* the review surface lands compounds with the number of resolved review threads anchored to SHAs that the rebase will rewrite.

## Walkthrough conventions

`drive-pr-walkthrough` generates walkthroughs at PR-open time. Repo-specific overlays:

- Walkthrough goes under `## Walkthrough` heading in the PR body for slice PRs.
- For project-spanning PRs (close-out PRs that migrate `projects/<project>/` to `docs/`), the walkthrough is in `projects/<project>/walkthroughs/` and referenced from the PR body.
- Link to specific test files as evidence; per the `walkthrough.mdc` user rule, prefer repo-relative links (`path/to/file.ts (L12-L34)`) that editors can open.

## Linear-issue conventions

- Each slice maps to a Linear Issue.
- Issue description links back to `projects/<project>/slices/<slice>/` (in-project) or to the orphan-slice PR description path (orphan).
- PR title follows the convention above: conventional-commit prefix + one-line summary + `(TML-NNNN)` suffix.
- PR description references the Linear issue (`Refs: TML-XXXX` line OR included in the title — either is enough for auto-close).

## Linear state conventions

- The team's terminal-before-merge state is **`Ready to be merged`** (not `Done`). The GitHub integration auto-transitions to the team's completed state on merge.
- Do not manually transition issues to a completed state; the integration handles it.
- Manual transitions before merge are fine (e.g. moving to `In review` when the PR opens).

## When this file changes

Append when a new operational convention emerges (e.g. a new conventional-commit scope is adopted, a new PR-body section is standardised). For PR-side slice-DoD changes: edit [`drive/calibration/dod.md`](../calibration/dod.md) — never duplicate DoD items here.
