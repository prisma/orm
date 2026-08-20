---
name: publish-npm-version
description: >-
  Cuts the next release of Prisma Next: bumps the root package.json
  version (on the v8 RC line: 8.0.0-rc.N → rc.N+1), propagates it to every
  workspace package, and opens a PR titled "chore(release): bump to
  <next-version>". When the maintainer merges the PR, the `Publish to npm`
  workflow runs automatically and ships the new version to npm under the
  dist-tag its shape implies (`latest`; RC releases get a pre-release GitHub Release),
  plus a matching GitHub Release. Use when a maintainer asks to "cut the
  next RC", "cut the next release", "bump to the next version", "open a
  release PR", or "prepare a publish PR".
---

# Publish next npm version

## Audience

Maintainers of Prisma Next who have permission to push branches and open PRs in the repository. The skill is invoked locally by the maintainer; it does **not** run as a GitHub Action. Running locally is what makes the resulting PR trigger CI normally — PRs opened by a workflow's `GITHUB_TOKEN` do not, which defeats the point of cutting a reviewable release.

## Background reading

Read [`docs/oss/versioning.md`](../../docs/oss/versioning.md) before running this skill. It covers:

- The source-of-truth model (root `package.json` `version`).
- The lockstep guarantee (every workspace package matches the root).
- The v8 RC line (`8.0.0-rc.N`, `latest` frozen until `8.0.0` final).
- The dist-tag convention (`latest` / `dev` / `beta`).
- The full release procedure (this skill covers steps 1-2 of 3; merging the PR is the publish trigger — there is no separate dispatch step).
- The emergency-patch path (this skill does **not** handle patches).

This SKILL.md covers steps 1-2 — opening the bump PR and driving the release notes. Merging (step 3) stays the human gate.

## Pre-flight

The skill does **not** require the maintainer to be on `main` or to have a clean working tree — it does all the work in a fresh worktree off `origin/main`, so the maintainer's current worktree (typically a feature branch in `worktrees/<feature>/`) is left undisturbed.

Before invoking this skill, confirm:

1. The maintainer can fetch from `origin` (`git fetch origin main` succeeds).
2. You are ready to draft the release notes for this bump. The [`draft-release-notes`](../draft-release-notes/SKILL.md) skill (invoked in step 7 below) enumerates the merged PRs since the previous stable tag and surfaces the release-notes-worthy changes — including any breaking changes — so this no longer rests on the maintainer's unaided recollection. If you already know of an in-flight breaking change that must be called out, note it so the authoring step gives it prominence.

If either precondition is unmet, stop and surface the issue. Do **not** try to auto-resolve.

## Procedure

1. **Fetch and determine the target version.** Run `git fetch origin main`, then read the current root `version` from `origin/main`. The next version follows the release-bump rules in [`scripts/determine-version-utils.ts`](../../scripts/determine-version-utils.ts): an RC base advances its counter (`8.0.0-rc.1` → `8.0.0-rc.2`), a pre-8 stable base transitions onto the RC line (`0.17.0` → `8.0.0-rc.1`), a stable 8.x base advances the minor.

   ```bash
   git fetch origin main
   CURRENT=$(git show origin/main:package.json | node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(0,"utf8")).version)')
   NEXT=$(node -e "import('./scripts/determine-version-utils.ts').then(m => process.stdout.write(m.computeNextReleaseVersion(process.argv[1])))" "$CURRENT")
   echo "$CURRENT → $NEXT"
   ```

   (`$NEXT` is only for naming the branch and PR — the authoritative bump in step 3 recomputes it inside the fresh `origin/main` worktree. The command above runs the helper from *your* checkout, which may be older than `origin/main`; step 3 therefore ends by verifying the two agree.)

2. **Create a fresh worktree off `origin/main`.** Use the convention `release/<version>` for both the branch and the sibling worktree path:

   ```bash
   git worktree add -b "release/$NEXT" "../release-$NEXT" origin/main
   cd "../release-$NEXT"
   ```

   This is what makes the skill safe to invoke from any worktree: the bump happens against a fresh checkout of `origin/main`, not against the maintainer's current branch. The branch name encodes the target version so reviewers can tell at a glance what the PR ships.

3. **Bump.** From the new worktree, run `pnpm bump-version`. The script reads the root `package.json` `version` from `git show HEAD:package.json` (in this worktree, HEAD is `origin/main`), computes the next release version, and writes it to every workspace `package.json` via `scripts/set-version.ts`.

   Note: `bump-version` requires `node_modules` to resolve its dependencies (e.g. `pathe`). If the fresh worktree has no `node_modules`, run `pnpm install --frozen-lockfile --ignore-scripts` first.

   Then confirm the version it wrote matches `$NEXT` from step 1. A mismatch means the helper in your original checkout has diverged from `origin/main` (step 1 ran the local copy); the worktree's value is authoritative — remove the worktree and branch, and restart from step 1 using the value the bump printed.

4. **Refresh the lockfile.** Workspace-internal dependencies in this repo are pinned as `workspace:<version>` (not `workspace:*`), so the bump changes their specifiers in `pnpm-lock.yaml`. Run:

   ```bash
   pnpm install --lockfile-only
   ```

   to update `pnpm-lock.yaml` in lockstep. Without this step, CI fails with `ERR_PNPM_OUTDATED_LOCKFILE` on the release PR.

5. **Sanity-check the diff.** Confirm:

   - Every modified file is either a `package.json` or `pnpm-lock.yaml`.
   - The `package.json` diffs are exactly `version` field changes plus internal `workspace:<old> → workspace:<new>` specifier bumps (no other fields).
   - The `pnpm-lock.yaml` diff is exactly `specifier: workspace:<old> → workspace:<new>` lines (no resolution churn for external packages).

6. **Commit.** Stage `package.json` files and `pnpm-lock.yaml` together in a single commit:

   ```text
   chore(release): bump to <version>
   ```

   No body is required — the PR description will explain the bump in detail.

7. **Draft the release notes.** From inside this `release/<version>` worktree, run the [`draft-release-notes`](../draft-release-notes/SKILL.md) skill for `<version>`. It enumerates the merged PRs since the previous stable `v*` tag, triages which are user-facing, categorizes them (breaking changes first), writes `docs/releases/v<version>.md`, and prepends a matching `CHANGELOG.md` entry — committing both on the release branch as their own commit. Committing the notes here is what lands them in the bump PR diff, so the PR-mode `check:release-notes` gate passes and the maintainer reviews the notes as part of the release PR.

8. **Push the branch** to `origin`.

9. **Open the PR** with `gh pr create`. Use the title:

   ```text
   chore(release): bump to <version>
   ```

   The body should:

   - State the previous and new version (`<previous> → <new>`).
   - Link to [`docs/oss/versioning.md`](../../docs/oss/versioning.md) for context.
   - Point reviewers at the committed `docs/releases/v<version>.md` (authored by the `draft-release-notes` skill in step 7) as the human-review surface for the release's user-facing changes.
   - Note that **merging this PR ships the release**: the resulting push to `main` carries the bumped root `version`, the `Publish to npm` workflow detects the change and publishes `<new>` under dist-tag `latest`, and a matching GitHub Release (marked pre-release on the RC line) is created automatically.

10. **Stop and report** the PR URL **and the worktree path** to the maintainer. The maintainer can `git worktree remove ../release-<version>` after the PR merges. Do not merge the PR yourself; the merge is a human gate where someone confirms the release notes are acceptable. (Merging triggers the publish — there is no separate dispatch step.)

## Idempotency

`pnpm bump-version` is idempotent because it reads the root version from `git show HEAD:package.json` rather than from the working tree: running it twice in the same worktree without committing produces the same target version, not a double-bump. The skill as a whole is not — step 2's `git worktree add -b "release/$NEXT" …` fails if the branch or sibling worktree already exists from an earlier run. To rerun from scratch, remove them first (`git worktree remove ../release-$NEXT` and `git branch -D release/$NEXT`), or skip straight to step 3 inside the existing worktree. Do not stack bumps.

## Out of scope

- **Merging the PR.** The skill stops at "PR opened" so a human can confirm the release notes. Merging is what triggers the actual publish, but it remains a human gate by design.
- **Patch releases.** On the RC line there are none (a fix is just the next `rc.N`, which this skill handles). For stable-line patches (`patch+1`), the manual procedure in `docs/oss/versioning.md` applies.
- **Beta tags.** The `beta` dist-tag is hand-cut via a manual `workflow_dispatch` of `Publish to npm`; this skill always advances to the next release version.
