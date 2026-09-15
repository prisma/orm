---
name: publish-npm-version
description: >-
  Cuts the next release of Prisma 8: bumps the root package.json
  version (on the v8 RC line: 8.0.0-rc.N → rc.N+1), propagates it to every
  workspace package, and opens a PR titled "chore(release): bump to
  <next-version>". When the maintainer merges the PR, the `Publish to npm`
  workflow runs automatically and ships the new version to npm under the
  dist-tag its shape implies (`latest`; RC releases get a pre-release GitHub Release),
  plus a matching GitHub Release. Also prepares the matching prisma/web
  docs-site PR from the same release notes, to merge once the release is
  published. Use when a maintainer asks to "cut the
  next RC", "cut the next release", "bump to the next version", "open a
  release PR", or "prepare a publish PR".
---

# Publish next npm version

## Audience

Maintainers of Prisma 8 who have permission to push branches and open PRs in the repository. The skill is invoked locally by the maintainer; it does **not** run as a GitHub Action. Running locally is what makes the resulting PR trigger CI normally — PRs opened by a workflow's `GITHUB_TOKEN` do not, which defeats the point of cutting a reviewable release.

## Background reading

Read [`docs/oss/versioning.md`](../../docs/oss/versioning.md) before running this skill. It covers:

- The source-of-truth model (root `package.json` `version`).
- The lockstep guarantee (every workspace package matches the root).
- The v8 RC line (`8.0.0-rc.N`, with `latest` tracking the newest RC or stable release).
- The dist-tag convention (`latest` / `dev` / `beta`).
- The full release procedure (this skill covers steps 1-2 of 3; merging the PR is the publish trigger — there is no separate dispatch step).
- The emergency-patch path (this skill does **not** handle patches).

This SKILL.md covers steps 1-2 — opening the bump PR, assembling upgrade guides, and driving the release notes. Merging (step 3) stays the human gate. Read the canonical [upgrade instruction lifecycle](../../upgrade-instructions/README.md) for fragment storage, synthesis, archives, and coverage-check modes.

## Pre-flight

The skill does **not** require the maintainer to be on `main` or to have a clean working tree — it does all the work in a fresh worktree off `origin/main`, so the maintainer's current worktree (typically a feature branch in `worktrees/<feature>/`) is left undisturbed.

Before invoking this skill, confirm:

1. The maintainer can fetch from `origin` (`git fetch origin main` succeeds).
2. You are ready to draft the release notes for this bump. The [`draft-release-notes`](../draft-release-notes/SKILL.md) skill (invoked in step 8 below) enumerates the merged PRs since the previous actual published stable/RC tag and surfaces the release-notes-worthy changes — including any breaking changes — so this no longer rests on the maintainer's unaided recollection. If you already know of an in-flight breaking change that must be called out, note it so the authoring step gives it prominence.

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

   - Every modified file is a `package.json`, `pnpm-lock.yaml`, `skills/prisma-8/SKILL.md`, or one of the version-stamped `contract.json` / `contract.d.ts` artefacts named below.
   - The `package.json` diffs are exactly `version` field changes plus internal `workspace:<old> → workspace:<new>` specifier bumps (no other fields).
   - The `pnpm-lock.yaml` diff is exactly `specifier: workspace:<old> → workspace:<new>` lines (no resolution churn for external packages).
   - `skills/prisma-8/SKILL.md` changed only its `library_version` stamp (the bump script writes it).
   - The tracked `contract.json` / `contract.d.ts` artefacts that carry an extension pack's version stamp (today: `examples/supabase/src/` and the fixtures under `packages/3-extensions/supabase/test/fixtures/`) changed only that stamp. The bump script restamps them because the extension writes its own package version into every contract it emits; `fixtures:check` would otherwise diff them, and `check:upgrade-coverage` treats a stamp-only artefact change as part of the release sweep, so no upgrade-recipe entry is needed for it.

6. **Assemble and review upgrade guides before notes.** Resolve the previous **actual published stable/RC release ref** (`$PREV_TAG`) and the target version from step 3. Exclude dev/beta builds; an in-tree version that never shipped is not a release boundary. Use this same lower bound for the notes. Stable transition endpoints use `major.minor`; RC endpoints retain the full version.

   Follow the [canonical lifecycle](../../upgrade-instructions/README.md): read every pending fragment and any originals already archived for this current unmerged release; do not replay older archives. At cutover, include existing unshipped guidance and assets as input, preserving originals rather than dropping or duplicating them. Synthesize one `instructions.md` per audience at `skills/prisma-8/upgrading/<audience>/upgrades/<from>-to-<to>/`, resolving ordering and overlap. Copy required assets into `scripts/<fragment-name>/`, rewriting relative references so each audience is self-contained, and move unchanged originals to `upgrade-instructions/releases/<transition>/sources/<name>/<audience>/...` without overwriting another contribution.

   Produce both audience guides even when one or both are empty: use `changes: []` without no-op consumer prose. Review the guides and scripts against all source fragments and the release PR diff before drafting notes. Review owns omissions and synthesis correctness; there is no release-wide migration execution gate.

7. **Commit the release preparation.** Include every file from step 5 (`package.json` files, `pnpm-lock.yaml`, `skills/prisma-8/SKILL.md`, and the restamped contract artefacts), the reviewed guides/assets, and the pending-to-archive moves from step 6:

   ```text
   chore(release): bump to <version>
   ```

   No body is required — the PR description will explain the bump in detail.

   Check the committed preparation with `pnpm check:upgrade-coverage --mode publish --prev "$PREV_TAG" --head HEAD`. `$PREV_TAG` must be the actual prior release, not merely the PR base. This checks committed trees, not uncommitted working files.

8. **Draft the release notes.** From inside this `release/<version>` worktree, run the [`draft-release-notes`](../draft-release-notes/SKILL.md) skill for `<version>`, using the previous published stable/RC ref resolved in step 6. It enumerates merged PRs, triages user-facing changes, and writes `docs/releases/v<version>.md` plus the matching `CHANGELOG.md` entry as their own commit. Breaking-change links point to the reviewed, assembled consumer guides, never pending fragments or archives. The notes ride in the bump PR diff for human review and the PR-mode `check:release-notes` gate.

9. **Recheck and push the branch** to `origin`. After committing the notes and any fixes, rerun `pnpm check:upgrade-coverage --mode publish --prev "$PREV_TAG" --head HEAD` against the candidate commit. If new fragments arrive before merge, incorporate them using pending inputs plus this release's archived originals, refresh and review the guides, update notes as needed, commit, and rerun the check. No pending fragments may remain. CI checks the effective merged release tree, including merge groups; publication independently checks the actual candidate commit before registry side effects, not just a stale branch snapshot. Ordinary dev builds allow pending work and do not assemble it.

10. **Open the PR** with `gh pr create`. Use the title:

    ```text
    chore(release): bump to <version>
    ```

    The body should:

    - State the previous and new version (`<previous> → <new>`).
    - Link to [`docs/oss/versioning.md`](../../docs/oss/versioning.md) for context.
    - Point reviewers at the committed `docs/releases/v<version>.md` (authored by the `draft-release-notes` skill in step 8) as the human-review surface for the release's user-facing changes.
    - Note that **merging this PR ships the release**: the resulting push to `main` carries the bumped root `version`, the `Publish to npm` workflow detects the change and publishes `<new>` under dist-tag `latest`, and a matching GitHub Release (marked pre-release on the RC line) is created automatically.

11. **Update the docs site.** The public docs live in [prisma/web](https://github.com/prisma/web) (`apps/docs/content/docs/`), and every release changes what they should say. Prepare that PR now, from the same release notes, so it is ready when the release is published:

    1. Clone `prisma/web` into a gitignored path inside the release worktree (`wip/web`) and branch from `main` as `docs/orm8-<version>`. Run `pnpm install --frozen-lockfile` there; the linters below need it.
    2. Move the version numbers first. `(index)/prisma-orm/release-status.mdx` carries a version table and a `Versions were checked on <date>` line; `guides/upgrade-prisma-orm/postgresql.mdx` and `mongodb.mdx` each name the `@prisma/orm-*` version they target. Grep the tree for the previous version string to catch any page added since.
    3. Walk `docs/releases/v<version>.md` entry by entry and find every page that states the old behaviour. Breaking changes and renames usually live in code samples and tables across many pages (grep for the old identifier, excluding the `v6/` and `v7/` trees, which document older versions and must not change). New CLI flags go in the command's page under `cli/`. New client or type surface goes in the matching page under `orm/reference/`, with a short section, and in `orm/coming-from-prisma-orm-7.mdx` if the feature replaces a Prisma ORM 7 one. A fix that removes a workaround means finding the guide that taught the workaround; the migration guides under `guides/upgrade-prisma-orm/` and the pages under `orm/migrations/` are the usual places.
    4. Follow `apps/docs/AGENTS.md` for page kinds and placement, and write in plain English. From `apps/docs`, run `pnpm lint:links`, `pnpm lint:spellcheck`, and `pnpm lint:code`.
    5. Commit as `docs(docs): update the Prisma ORM 8 pages for <version>` and open the PR against `main` with `gh pr create -R prisma/web`. The body lists each release-notes entry and the pages that now reflect it, names anything from the notes that has no page to land on, and says that the PR must merge only after the ORM release PR is published, because until then the site would describe a version that is not on the registry. Link the two PRs to each other.

12. **Stop and report** both PR URLs **and the worktree path** to the maintainer. The maintainer can `git worktree remove ../release-<version>` after the PRs merge. Do not merge either PR yourself; the release PR merge is a human gate where someone confirms the release notes are acceptable, and the docs PR waits for the publish. (Merging the release PR triggers the publish — there is no separate dispatch step.)

    If the maintainer asks you to merge, the order is: release PR first, wait for the `Publish to npm` run on `main` to succeed and for `pnpm view @prisma/orm-postgres dist-tags.latest` to report `<version>`, then merge the docs PR and confirm its Vercel `docs` deployment succeeds. On `prisma/orm` the merge queue refuses a PR with any unresolved review thread, even with green checks; CodeRabbit routinely flags the tag-pinned recipe links in the notes as dead, which is expected (the tag is created by the publish), so answer and resolve that thread rather than change the links.

## Idempotency

`pnpm bump-version` reads the root version from `git show HEAD:package.json`: repeating it before committing produces the same target, but running it after the bump commit would advance again. Do not stack bumps.

If the release branch/worktree already exists, inspect its Git status and diff before resuming instead of recreating it or blindly bumping again. For interrupted assembly, inspect pending fragments, this unmerged release's archived originals, and the current output guides. Resume from those ordinary working-copy inputs; do not replay older archives or add an assembly command, staging protocol, ledger, hashes, or historical deletion scan. See the [lifecycle](../../upgrade-instructions/README.md).

## Out of scope

- **Merging the PRs.** The skill stops at "PRs opened" so a human can confirm the release notes. Merging the release PR is what triggers the actual publish, but it remains a human gate by design; the docs PR follows once the publish has succeeded.
- **Patch releases.** On the RC line there are none (a fix is just the next `rc.N`, which this skill handles). For stable-line patches (`patch+1`), the manual procedure in `docs/oss/versioning.md` applies.
- **Beta tags.** The `beta` dist-tag is hand-cut via a manual `workflow_dispatch` of `Publish to npm`; this skill always advances to the next release version.
