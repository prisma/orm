---
name: record-upgrade-instructions
description: >-
  Record upgrade instructions alongside a Prisma Next breaking-change
  PR, so downstream consumers (users of `@internal/*` and authors
  of Prisma Next extensions) can apply the matching code translation
  automatically via the published upgrade skills. Use when you have
  refactored framework code and the test suite went red in
  `examples/` or `packages/3-extensions/`, when you fixed those
  red tests by editing the substrate, when you are told to "record
  upgrade instructions for this PR", or when you made a breaking
  change to Prisma Next that downstream consumers will need help
  migrating across.
---

# Record upgrade instructions

This skill fires on PRs **inside this repo** that make a breaking change to Prisma Next. It walks you through adding a per-transition upgrade-instructions entry in the right published skill package(s) — so downstream users and extension authors can run the matching agent flow to migrate their code automatically.

The published skills you will be authoring entries into:

- `skills/prisma-8/upgrading/app/` — the upgrading branch of the `prisma-8` skill, shipped inside the `@prisma/orm-*` tarballs. **Audience: users of Prisma Next** (consumers of the public package API: `@internal/postgres`, `@internal/mongo`, the contract files in `prisma/`, on-disk migration shape).
- `skills/prisma-8/upgrading/extension/` — the extension-author half of the same branch. **Audience: authors of Prisma Next extensions** (consumers of the framework SPI: `@internal/contract`, `@internal/framework-components`, `@internal/migration-tools`, etc.).

The two skill clusters are independent (no shared content). Cross-audience breaking changes — where the same on-disk transformation applies to both substrates — are recorded *separately* in each cluster, including duplicated colocated scripts.

## When to use

Fire this skill on any PR where:

- You refactored framework code, then
- the test suite went red in `examples/` and/or `packages/3-extensions/`, and
- you fixed those red tests by editing the substrate (not by reverting the framework change).

Those edits to `examples/` or `packages/3-extensions/` *are* the signal. The matching test suite would have been red for downstream consumers without an upgrade-instructions entry; the entry's effect on the substrate is the same code translation a downstream consumer will run via the published skill.

If both substrates are touched, both packages need entries (see *Cross-audience entries*).

Even consumer-invisible-looking diffs need an entry. A change to the format of `contract.json` / `contract.d.ts` (or any other emitted artefact) is itself an upgrade instruction — consumers will need to either run a codemod or re-emit. Where the substrate diff is genuinely no-op for consumers (incidental regeneration with no behavioural change), the entry can ship with `changes: []` to record that explicitly. There is no carve-out for "generated paths"; any substrate diff requires a record.

## Detection signals & routing

Two mechanical signals, each tied to one destination package:

| Substrate touched by the PR    | Destination skill                                              |
| ------------------------------ | -------------------------------------------------------------- |
| `examples/`                    | `skills/prisma-8/upgrading/app/`                          |
| `packages/3-extensions/`       | `skills/prisma-8/upgrading/extension/`       |
| Both                           | Both — duplicated entries (see below)                          |

The substrate diff is the signal that an entry is required. The agent fixing the red tests in those substrates sees the signal directly; the reviewer sees the same diff. The release-pipeline check (`pnpm check:upgrade-coverage`) enforces the outcome — a substrate diff without the matching directory fails the PR.

**Stacked PRs.** The coverage gate diffs each PR against the branch it targets, not against `main`. Each PR in a stack therefore declares the entries for its own substrate diff, in its own commits. Do not pool a stack's entries in the bottom PR: pooled entries break self-containment (a partial merge ships instructions for changes that did not land), and under per-base diffing the upper PRs fail the gate anyway. Sequential commits appending entries to the same `instructions.md` are the normal shape.

Throughout the steps below, **`<target>`** is the branch the PR targets: `main`, unless the PR is stacked, in which case it is the PR below it in the stack.

## Authoring workflow

For each PR that hits one or both signals, walk these steps in order.

1. **Determine the in-flight transition.** Read the `version` field from the root `package.json` on the PR branch. That value is the *currently published* version (the source-of-truth `pnpm bump-version` reads when preparing the next release). The in-flight transition is the step from it to whatever ships next, and both sides are named the way transition directories name versions: a stable version by its minor, a release candidate by its full version.

   - `"0.7.0"` → the next release is `0.8`, so you author into `upgrades/0.7-to-0.8/`.
   - `"8.0.0-rc.1"` → the next release is the next release candidate, so you author into `upgrades/8.0.0-rc.1-to-8.0.0-rc.2/`. An RC line lives inside a single minor and each RC may carry breaking changes of its own, so on an RC line a step is one RC rather than one minor.

   The branch's `package.json` is the source-of-truth — do **not** consult `npm view`. If there is no substrate diff at all, no entry is needed — skip to step 7.

2. **Identify the touched substrate(s).** Compute `git diff origin/<target>..HEAD` restricted to `examples/` and to `packages/3-extensions/`. Each non-empty substrate corresponds to one destination package per the routing table above. The "both" case is normal — the rare PR (e.g. a structural on-disk migration shape change) touches both.

3. **Find or create the directory in each destination.** For each destination, the directory is `<destination>/upgrades/<in-flight transition>/` from step 1 (so e.g. `skills/prisma-8/upgrading/app/upgrades/0.7-to-0.8/` for the user-skill). If the directory already exists (an earlier PR on the same transition created it, or the placeholder shipped with the initial mechanism PR is still there), **do not create a duplicate** — append a new entry to the existing `instructions.md`'s `changes[]` array.

4. **Write the entry into `instructions.md`.** Each `changes[]` entry carries an `id` (kebab-case, unique within the transition), a one-line `summary`, an optional `detection` block (glob + content predicate the consumer's agent runs to know whether the change applies to that consumer's project), and an optional `script:` reference (relative path to a colocated script next to `instructions.md`). For changes that need agent reasoning across the codebase rather than a deterministic script, the entry omits `script:` and the agent follows the prose body of `instructions.md` instead.

   **Make detection predicates token-precise.** A broad substring regex fires on call sites the change does not touch and sends consumers hunting for migrations they do not need. Test the predicate against both a true positive and the nearest false positive before shipping it. Matching a moved tag must not fire on an unchanged one, and excluding the unchanged spelling needs a token boundary — a bare lookbehind also suppresses an unrelated receiver that merely ends in those letters:

   ```text
   matches:      .raw`
   must not fire on: fns.raw`
   too broad:    (?<!fns)\.raw`        also suppresses myfns.raw`
   shipped:      (?<!(?<![\w$])fns)\.raw`
   ```

   The inner lookbehind makes the exclusion apply only to the exact `fns` token.

   **Only record changes that require consumer action.** Every `changes[]` entry — and every paragraph in the prose body — must describe something the consumer has to *do*. Do not include narrative about substrate diffs that need no consumer response (e.g. dev-only dep bumps inside `examples/`, internal-only renames, generated-artefact churn that round-trips on re-emit). The absence of an entry already communicates "do nothing" — saying it explicitly is noise, and it dilutes the signal of the entries that *do* require action. If the entire in-flight transition is genuinely no-op for consumers, ship `changes: []` with no body prose; the `changes: []` array is the record. The reviewer treats any "consumers do not need to take any action" sentence in the body as a defect.

5. **Author any colocated scripts.** Scripts are portable — TypeScript (run via `pnpm exec tsx`), shell (`*.sh`), codemods (`jscodeshift`-style `*.codemod.cjs`), whichever fits the change. Scripts must not require network access, environment variables, or any input beyond the consumer's filesystem and the script's bundled assets. If the same script applies to both substrates (cross-audience case), **copy** it into both packages' directories — symlinks do not survive npm publish, and a hard dependency between the two packages is forbidden.

6. **Validate the entry by execution** (see *Validation by execution* below for the concrete recipe). The acceptance criterion is the matching substrate's test suite green after the entry application, and the resulting substrate state matching `<head>` outside the substrate's test directories.

7. **Commit on the PR branch** (see *PR commit shape* below for what the commit must include).

## Validation by execution

Before merging, every new entry runs against the corresponding in-repo substrate, starting from the substrate's pre-PR state and ending with green tests. This is the quality bar — the human reviewer does not have to vouch for entries on cases they didn't run.

Workflow per entry (one of the two flows; both apply for cross-audience entries):

Two placeholders name the revisions the flow compares:

- **Open PR** — `<head>` is the PR branch head, `<base>` is `origin/<target>`, where `<target>` is the branch the PR targets.
- **Merged PR** — `<head>` is the merge commit, `<base>` is its mainline parent. `git log --first-parent` names both.

The substrate's own tests are the PR author's work, not the entry's. An entry translates consumer code; it neither writes nor updates the tests this repo keeps beside that code. So the equality check below excludes the substrate's `test/` directories — what it measures is whether the entry reproduces every source change — and a companion check confirms the entry left those directories exactly as it found them.

### User-skill entry (against `examples/`)

1. Check out `<head>`, which has the framework change applied.
2. Revert `examples/` to its pre-PR state (`git restore --source=<base> -- examples/`).
3. Run the entry against the reverted substrate — invoke any colocated script(s) per the entry's `script:` reference, then walk the prose body of `instructions.md` if the entry has additional instructions.
4. Verify the resulting `examples/` directory matches the `<head>` state outside the substrate's test directories: `git status --porcelain -- examples/ ':(exclude)examples/*/test/**'` prints nothing. The entry has reproduced the patch `git diff <base>..<head> -- examples/ ':(exclude)examples/*/test/**'` describes, so those paths are back at `<head>` and the check is that nothing is left over — no modification, and no file the entry created along the way.
5. Verify the entry left the test paths alone. Step 2 put them at `<base>` and a correct entry never touches them, so they must still be at `<base>`. Step 4 excludes those paths and cannot see a change there, so without this check an entry could mutate the tests to make step 6 pass:

   ```bash
   git diff --exit-code <base> -- 'examples/*/test/**'
   git ls-files --others --exclude-standard -- 'examples/*/test/**'
   ```

   The first command must exit 0 (no tracked test file changed), the second must print nothing (the entry created no new test file).

6. Verify the touched example's test suite is green — `pnpm --filter <example-package> test` for each example the entry changed. The repo-wide `pnpm test:examples` also runs examples that need a database and a `.env` (`pnpm db:up`, then copy `.env.example`); run it only with those in place.

If any of those checks fail, iterate on the entry. Do not merge. Classify a failure before you change anything, per `.agents/rules/ci-failure-classification.mdc`. A timeout or a connection error makes the environment a *candidate*, not a verdict — confirm that classification against the rule before you leave the entry alone.

### Extension-skill entry (against `packages/3-extensions/`)

1. Check out `<head>`, which has the framework change applied.
2. Revert `packages/3-extensions/` to its pre-PR state (`git restore --source=<base> -- packages/3-extensions/`).
3. Run the entry against the reverted substrate.
4. Verify the resulting `packages/3-extensions/` directory matches the `<head>` state outside the substrate's test directories: `git status --porcelain -- packages/3-extensions/ ':(exclude)packages/3-extensions/*/test/**'` prints nothing, the same check the user-skill flow makes against `examples/`. The patch the entry reproduces is `git diff <base>..<head> -- packages/3-extensions/ ':(exclude)packages/3-extensions/*/test/**'`.
5. Verify the entry left the test paths alone, the same companion check the user-skill flow makes, for the same reason:

   ```bash
   git diff --exit-code <base> -- 'packages/3-extensions/*/test/**'
   git ls-files --others --exclude-standard -- 'packages/3-extensions/*/test/**'
   ```

6. Verify the matching test suite is green: `pnpm test --filter='./packages/3-extensions/*'`.

If any of those checks fail, iterate on the entry. Do not merge. Classify a failure before you change anything, as above.

This flow was last executed end to end on 2026-08-20, against the `8.0.0-rc.3-to-8.0.0-rc.4` raw-lane entries in both skills.

## PR commit shape

The PR that introduces the breaking change must contain, in addition to the framework change itself:

- **The new entry directory in each affected skill** — `<destination>/upgrades/<in-flight transition>/instructions.md` plus any colocated scripts (the in-flight transition being the one determined in step 1 of the authoring workflow).
- **The post-instructions state of every affected substrate** — these substrates would have been left broken without the entry; the entry's effect on the substrate *is* the diff that brings them back to green. The `<head>` substrate state and the validation-by-execution output state must be identical outside the substrate's `test/` directories, which the entry neither writes nor updates.
- **A reference in the PR description naming each entry directory** (e.g. *"Adds entries to `skills/prisma-8/upgrading/app/upgrades/0.7-to-0.8/` and `skills/prisma-8/upgrading/extension/upgrades/0.7-to-0.8/`."*).

The human reviewer + the CI gate (`pnpm check:upgrade-coverage`) both check this shape, but the gate is **necessary-but-not-sufficient** — it only asserts that the in-flight transition *directory* exists, not that *this PR's* substrate diff has a matching `changes[]` entry. So a PR can have a real substrate diff, contribute no entry, and still pass the gate green whenever an earlier PR already created the transition directory. (This is exactly how a breaking change can ship undocumented: the directory was already there, so the gate stayed green.) The gap is load-bearing for the reviewer: **the human reviewer must verify that every substrate diff in the PR has a corresponding entry** — the gate will not catch a missing entry once the directory exists. The reviewer also catches the semantic case (entry exists but its prose / scripts don't match the framework change).

## Cross-audience entries (duplication)

When a breaking change affects both substrates, the same on-disk transformation may apply to both `examples/` and `packages/3-extensions/`. Author entries in **both** packages:

- Append a `changes[]` entry to each skill's `instructions.md`. The two entries may have the same `id`, `summary`, and `detection` — that is fine; they are independent records in independent skill clusters.
- Copy the colocated script into both directories. Do **not** symlink (the GitHub-URL `pnpm dlx skills add` flow discards symlinks); do **not** import one from the other (the two clusters have no cross-dep).

Bug fixes to either copy land via normal PRs. Yes, duplication carries small ongoing maintenance cost. The trade-off is deliberate — the two skill clusters must remain independent so a consumer can install either, both, or neither without one transitively pulling in the other.

## Skipped publishes

If a minor was bumped in-tree but never actually shipped to npm — `package.json` advanced from `M` to `M+1` on `main` but no `vM+1.0` tag landed, so the next publish crosses two minor steps in one release — keep authoring per single-step transition. The coverage gate accepts the **chain** of consecutive transition directories spanning the unreleased range: a 0.7 → 0.9 publish is satisfied by both `upgrades/0.7-to-0.8/` and `upgrades/0.8-to-0.9/` existing, not by a synthetic `upgrades/0.7-to-0.9/`. New entries added on a branch that publishes across a skip may land in any chain step (or the in-flight directory for the cycle after head); the per-version-step authoring model is the source of truth, the gate aggregates.

Chaining is a property of the stable minor line only. On a release-candidate line the gate never composes a chain across RC counters — an `rc.1 → rc.4` range is the single step `upgrades/8.0.0-rc.1-to-8.0.0-rc.4/`.

## Rebase scenario

If a release PR lands on `main` mid-flight (advancing the currently-published version, whether that is a minor or a release candidate), your topic branch's next rebase brings the new `package.json` value with it:

1. Re-run step 1 of the authoring workflow. The in-flight transition has moved one release forward.
2. Author any **new** entries (changes added on this rebase) in the new in-flight directory. The new-entries check (part of `pnpm check:upgrade-coverage`) blocks file *adds* in stale transition directories.
3. **Existing entries** your branch added before the rebase to the previous in-flight directory may be left in place — they describe the transition that just shipped, and modifications / removals of any transition directory are allowed (the new-entries check only enforces *added* paths).

Decide per-entry whether each prior add belongs in the just-shipped transition directory or should be relocated. The rule of thumb: if the entry fixes a substrate diff that already shipped in the release that just landed, leave it in the previous directory; if the entry fixes a substrate diff introduced by the further refactoring you did after the rebase, move it to the new in-flight directory.

Two corollaries of a release cut:

- **A just-shipped transition directory is history.** Restore it to the released content byte-for-byte if your branch had modified it; only entries describing changes that actually shipped in that release may remain there. An entry left in a shipped directory for a change that missed the release is a false instruction.
- **The new in-flight directory may not exist yet.** If your PR touches a substrate and the directory for the new transition is missing, create it. When the PR's substrate diff needs no consumer action (purely additive features included), ship it with `changes: []` and no body prose — that satisfies the gate and records the no-op explicitly.

## Out of scope

This skill records **upgrade instructions** — code-translation entries the published skills will replay against consumer projects. It does **not** add the per-step bump-install-instructions-validate-commit loop to entry bodies. That flow is general content carried in the published `SKILL.md` files (`skills/prisma-8/references/upgrade-app.md` and `skills/prisma-8/references/upgrade-extension.md`) and runs around your entry. Your entry only contains the code-translation work specific to the transition.

This skill also does not enforce the exact-pin rule for extensions — that is `prisma-8-check-pins` (a `bin` of `@internal/extension-author-tools`), and it runs in extension authors' own CI plus in the extension-upgrade skill's per-step flow.

## Worked example

A PR refactors types in `@internal/migration-tools`. After running `pnpm typecheck`:

- `packages/3-extensions/pgvector` is red — the extension consumes `MigrationMetadata` and the type shape changed. You fix the extension's source until tests are green.
- `examples/multi-extension-monorepo` is red as a downstream consequence of the extension change. You fix the example until tests are green.

Both substrates are touched → both skill packages need entries.

1. Read root `package.json` on the PR branch → `version: "0.7.0"`. Currently-published minor is `0.7`, so the in-flight transition is `0.7 → 0.8`. Directory is `upgrades/0.7-to-0.8/` in each skill package.
2. Both substrates touched.
3. `skills/prisma-8/upgrading/app/upgrades/0.7-to-0.8/instructions.md` already exists (placeholder shipped with the initial mechanism PR). Append a `changes[]` entry — call it `migration-metadata-shape-update`. Same for `skills/prisma-8/upgrading/extension/upgrades/0.7-to-0.8/instructions.md`.
4. The user-skill entry may be prose-only (e.g. "rename the imported type from `MigrationMetadata` to `MigrationManifest` in any consumer code"), since the user-facing fix is a simple rename.
5. The extension-skill entry needs more work — the SPI changed shape, not just name. Author `skills/prisma-8/upgrading/extension/upgrades/0.7-to-0.8/update-migration-tools-imports.ts` and reference it from the entry's `script:` field. If the same transformation also applies to the example, copy the script into the user-skill cluster's directory too.
6. Validate by execution: revert `packages/3-extensions/` to pre-PR → run the extension-skill entry → verify `pnpm test --filter='./packages/3-extensions/*'` green, the non-test paths matching `<head>`, and the test paths still at `<base>`. Then revert `examples/` to pre-PR → run the user-skill entry → verify `pnpm --filter <example-package> test` green for the touched example, with the same two path checks.
7. Commit on the PR branch with both entry directories, the colocated script(s), and the matching substrate post-state.

## Reference

- Mechanism Linear ticket: [TML-2519](https://linear.app/prisma-company/issue/TML-2519).
- Coverage gate script: `scripts/check-upgrade-coverage.mjs` (invoked as `pnpm check:upgrade-coverage`).
- Published skills whose entries you are authoring: `skills/prisma-8/upgrading/app/`, `skills/prisma-8/upgrading/extension/`.
