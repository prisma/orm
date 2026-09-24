---
name: record-upgrade-instructions
description: >-
  Record upgrade instructions alongside a Prisma 8 breaking-change
  PR, so downstream consumers (users of `@internal/*` and authors
  of Prisma 8 extensions) can apply the matching code translation
  automatically via the published upgrade skills. Use when you have
  refactored framework code and the test suite went red in
  `examples/` or `packages/3-extensions/`, when you fixed those
  red tests by updating example or extension code, when you are told to "record
  upgrade instructions for this PR", or when you made a breaking
  change to Prisma 8 that downstream consumers will need help
  migrating across.
---

# Record upgrade instructions

Contribute an independent fragment on the PR that changes Prisma 8. Release preparation combines fragments into the published app and extension guides; **feature PRs do not edit shared transition guides or choose a release number**. Read the canonical [upgrade instruction lifecycle](../../upgrade-instructions/README.md) for storage, release assembly, and checker modes.

## Detection signals and routing

Use this skill when a framework change makes tests red in `examples/` or `packages/3-extensions/` and you fix them by updating the example or extension code rather than reverting the framework change. Those edits are the same translation downstream consumers need.

| Directory changed by the PR | Fragment audience | Consumers |
| --- | --- | --- |
| `examples/` | `app` | Public package API, contract files, on-disk migrations |
| `packages/3-extensions/` | `extension` | Framework SPI and extension authors |
| Both | Both, independently | Both audiences |

Changes in these directories require a declaration, subject to existing coverage-check exclusions. Generated artefacts are not generally exempt: contract format changes require a codemod or re-emission instructions. Genuinely consumer-invisible changes still get an explicit `changes: []` declaration, with no prose.

**Stacked PRs:** compare against the branch the PR actually targets, not always `main`. Each PR adds its own declaration in its own commits; inherited fragments do not cover a new PR. Do not pool a stack's instructions in its bottom PR.

Throughout this skill, `<target>` is the target branch (`main` unless stacked), `<base>` is its pinned comparison commit, and `<head>` is the PR head commit.

## Authoring workflow

1. **Identify affected audiences.** Inspect `git diff <base>..<head> -- examples/ packages/3-extensions/`. If neither directory has relevant changes, the coverage check does not require a declaration.
2. **Choose a descriptive pending name.** Add `upgrade-instructions/pending/<descriptive-name>/<audience>/instructions.md` for each affected audience. Avoid collisions with pending work; no random suffix, global registry, historical-name reservation, or shared index is required. Never append to another PR's fragment. A release landing during your PR does not change this unversioned destination.
3. **Write the instructions.** Retain the existing YAML frontmatter `changes[]` and Markdown prose format. Each change has a kebab-case `id` unique within the guide, a one-line `summary`, optional `detection` (glob and content predicate), and an optional `script` path relative to `instructions.md`. Prose-only transformations omit `script`; the consumer's agent follows the body.

   **Make detection predicates token-precise.** Test against both a true positive and the nearest false positive. A moved tag must not match an unchanged tag; excluding an unchanged spelling needs a token boundary:

   ```text
   matches:      .raw`
   must not fire on: fns.raw`
   too broad:    (?<!fns)\.raw`        also suppresses myfns.raw`
   shipped:      (?<!(?<![\w$])fns)\.raw`
   ```

   The inner lookbehind restricts the exclusion to the exact `fns` token.

   **Only describe consumer action.** Omit narrative about internal renames, dev-only dependency bumps, and incidental generated churn. If this PR's audience needs no action, use only:

   ```md
   ---
   changes: []
   ---
   ```

   No "consumers need not do anything" body prose. Both audiences declare independently, including real-change/no-op combinations.

4. **Author optional colocated scripts/assets.** TypeScript (`pnpm exec tsx`), shell, or codemods are appropriate. Require no network, environment variables, or input beyond the consumer filesystem and bundled assets. Keep relative references inside the fragment's audience directory. For cross-audience changes, copy scripts into both audience directories; do not symlink or import from the other audience. The published clusters remain independently installable.
5. **Validate by execution** using the unchanged concrete procedure below. An entry updates consumer code, not the example or extension tests. Do not introduce a separate testing system.
6. **Include the fragment and updated example or extension code in the PR.** Commit working changes before running the Git-ref check:

   ```bash
   pnpm check:upgrade-coverage --mode pr --prev <base> --head <head>
   ```

   `<head>` must include the committed declaration; the check does not inspect uncommitted edits. Link each new fragment directory in the PR description. Review must verify that the instructions actually describe the PR's changes; the gate checks added declarations, readable change lists, and relative script references, not semantic correctness.

## Validation by execution

Before merging, run every new entry against the corresponding example or extension code in this repository, starting from its pre-PR state and ending with passing tests. This is the existing per-PR quality bar, not a release-wide migration test.

Workflow per entry (both flows apply for cross-audience entries):

- **Open PR:** `<head>` is the PR branch head; `<base>` is the actual target branch's comparison commit.
- **Merged PR:** `<head>` is the merge commit; `<base>` is its mainline parent. `git log --first-parent` names both.

Use a disposable checkout for the restoration steps so unrelated working changes are not overwritten. The PR author updates example and extension tests; the upgrade instructions must not change them. The equality check excludes `test/` directories; the companion check confirms the entry left those directories exactly as it found them.

### App entry (against `examples/`)

1. Check out `<head>`, which has the framework change applied.
2. Revert `examples/` to its pre-PR state (`git restore --source=<base> -- examples/`).
3. Run the fragment against the restored example code: invoke colocated scripts per `script:` references, then walk the prose body for additional instructions.
4. Verify `examples/` matches `<head>` outside test directories:

   ```bash
   git status --porcelain -- examples/ ':(exclude)examples/*/test/**'
   ```

   It must print nothing, including no newly created files. The entry must reproduce `git diff <base>..<head> -- examples/ ':(exclude)examples/*/test/**'`.
5. Verify the entry left tests at `<base>`; the source equality check cannot detect test changes:

   ```bash
   git diff --exit-code <base> -- 'examples/*/test/**'
   git ls-files --others --exclude-standard -- 'examples/*/test/**'
   ```

   The first command must exit 0 and the second print nothing. An entry must not mutate or create tests to make the next step pass.
6. Run `pnpm --filter <example-package> test` for each touched example. The repo-wide `pnpm test:examples` also runs examples needing a database and `.env` (`pnpm db:up`, then copy `.env.example`); run it only with those in place.

### Extension entry (against `packages/3-extensions/`)

1. Check out `<head>`, which has the framework change applied.
2. Revert `packages/3-extensions/` to its pre-PR state (`git restore --source=<base> -- packages/3-extensions/`).
3. Run the fragment against the restored extension code, including referenced scripts and prose.
4. Verify the non-test paths match `<head>`:

   ```bash
   git status --porcelain -- packages/3-extensions/ ':(exclude)packages/3-extensions/*/test/**'
   ```

   It must print nothing. The entry reproduces `git diff <base>..<head> -- packages/3-extensions/ ':(exclude)packages/3-extensions/*/test/**'`.
5. Verify test paths remain at `<base>`:

   ```bash
   git diff --exit-code <base> -- 'packages/3-extensions/*/test/**'
   git ls-files --others --exclude-standard -- 'packages/3-extensions/*/test/**'
   ```

   The first command must exit 0; the second must print nothing.
6. Verify the matching test suite is green: `pnpm test --filter='./packages/3-extensions/*'`.

If any check fails, iterate on the entry; do not merge. Classify failures before changing anything, per [CI failure classification](../../.agents/rules/ci-failure-classification.mdc). A timeout or connection error makes the environment a candidate cause, not a verdict.

## PR commit shape

Include:

- Each new `upgrade-instructions/pending/<name>/<audience>/instructions.md` and any colocated scripts/assets.
- The updated example and extension code, matching the result of applying the instructions outside test directories. The entry neither writes nor updates those tests.
- PR-description references naming the fragment directories, for example `upgrade-instructions/pending/migration-metadata-shape/app/` and `upgrade-instructions/pending/migration-metadata-shape/extension/`.

Both audience copies may share IDs, summaries, or detection predicates; they are independent records. Fixes to either copy use normal PR review. Historical published guidance can also be corrected through normal reviewed PRs, but edits to old guides do not replace a new PR's required pending declaration.

## Out of scope

Fragments describe code translation only. Do not add the general bump/install/instructions/validate/commit loop to their bodies: the published [app](../../skills/prisma-8/references/upgrade-app.md) and [extension](../../skills/prisma-8/references/upgrade-extension.md) flows own it. Extension exact-pin enforcement remains `prisma-8-check-pins` from `@internal/extension-author-tools`.

Release synthesis, archives, skipped unpublished bumps, and release completeness belong to the [canonical lifecycle](../../upgrade-instructions/README.md), not feature-PR authoring. No release-wide migration rehearsal is required.
