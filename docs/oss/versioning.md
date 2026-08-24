# Versioning

This page covers the **version contract** Prisma Next offers to its users and ecosystem, and the **mechanism** that delivers it. The first half is the policy you can rely on; the second half is the procedure maintainers follow to honour it.

## Pre-1.0: deliberately unstable

> **Note:** releases now ship on the v8 RC line (`8.0.0-rc.N`) rather than as `0.x` minors — see [The v8 RC line](#the-v8-rc-line) below. The latitude described here carries over: RC respins may include breaking changes until `8.0.0` final ships.

Prisma Next is in early access and is deliberately pre-`1.0`. Per [SemVer §4](https://semver.org/#spec-item-4), the `0.x` range carries no backwards-compatibility promise, and we use that latitude. Concretely:

- **Breaking changes ship in regular minor bumps.** A `0.7.0` to `0.8.0` upgrade may include API removals, semantic changes to existing APIs, or contract-format changes.
- **Releases are frequent.** The cadence is "ship a minor whenever the next batch of work is cohesive enough to warrant one", not a fixed weekly/monthly schedule. Expect minors more often than you would expect them from a 1.x project.
- **There are no patch releases of older minors.** Once `0.8.0` ships, `0.7.x` receives no further updates — no security patches, no regression fixes, no cherry-picks. If you hit a regression in the latest `latest` we may cut a `0.8.1`, but you are expected to keep up rather than pin and wait.
- **The agent-driven upgrade skill is the long-run answer to keeping consumers current with minimal churn.** Each minor will ship with a machine-readable upgrade recipe that the skill applies; the upgrade contract — what the recipes are allowed to assume, what they're allowed to change — will be documented separately in `docs/oss/upgrade-policy.md` once that work lands. Until then, breaking changes are surfaced through release notes only.

If your project cannot tolerate this cadence today, Prisma Next is not the right choice yet. The promise we make instead is that you can always read a single number — the root `package.json` `version` of any commit — and know exactly what you have.

## Lockstep across the workspace

Every workspace package — publishable, private, the workspace root, and example apps — carries the same `version`. One read of root `package.json` answers "what version is this code?" for the entire repository.

This invariant has consequences that ecosystem participants need to plan for:

- **Agent skills, the upgrade instructions, and any other tooling we ship alongside the framework version in lockstep with it.** A skill installed at the same time as `@internal/postgres@0.8.0` is a `0.8.0` skill and reasons about a `0.8.0` contract. There is no separate skill-version axis to track. This is now physical rather than conventional: the `prisma-8` skill ships inside the `@prisma/orm-postgres`, `@prisma/orm-sqlite` and `@prisma/orm-mongo` tarballs (copied in by each package's `prepack`), and `scripts/set-version.ts` stamps its `metadata.library_version` frontmatter with the version being published. Getting the skill and getting the code are one install, and a consumer can compare the stamp on its synced copy against its installed packages.
- **Extension authors that depend on internal framework packages must pin those dependencies to the framework version their consumers will use.** If your extension depends on `@internal/sql-core` (an internal framework package), publish each version of your extension targeting one specific Prisma Next minor and pin to it exactly (`"@internal/sql-core": "0.8.0"`, not `"^0.8.0"`). Internal packages do not promise inter-minor compatibility — `0.8.x` and `0.9.x` may have incompatible internals even when the user-visible surface looks similar. The extension's published version range communicates which framework minor it targets.
- **Internal packages are never published, but they still version in lockstep** so a contributor cloning the repo at any commit sees one consistent answer to "what version is this code?" The `private: true` flag means `pnpm publish` skips them.

If lockstep ever broke — if a private package or example carried a different version — the "one read of root tells you everything" invariant would be silently violated. Every CI gate that checks the root version on publish (today: pre-publish dependency-specifier validation; tomorrow: the upgrade-skill recipe-presence check that fires on root version changes) is built on this assumption.

## The v8 RC line

Prisma 8 ships as a release-candidate line ahead of `8.0.0` final: releases are versioned `8.0.0-rc.1`, `8.0.0-rc.2`, … with the counter advancing on every release publish. "The v8 RC" is the product name; the version number underneath iterates freely, and there is no promise that the final RC is literally numbered `rc.1`. Versions are immutable on npm — a botched publish burns a counter value, which is fine; skip it and never reuse a number.

For every package this repository publishes, **`latest` tracks the newest release — RC or stable**. These package names have no pre-v8 stable audience to protect: a bare `npm install` of any of them is an early-access install, and early-access users are expected to keep up (see the pre-1.0 policy above). Existing installs are unaffected — lockfiles pin resolved versions, and `^0.x` ranges can never resolve to an RC (pre-releases don't match stable ranges), so nobody is moved onto the RC line by `npm update`; new installs simply get the newest RC.

The frozen-`latest` concern — never surprising an existing stable audience — applies to the bare `prisma` package, which this repository does not publish. Its v8 bin shim lives in [prisma/prisma-cli](https://github.com/prisma/prisma-cli); that repository publishes v8 builds under `next` while `latest` stays on Prisma 7 (published from the `v7` branch's pipeline) until `8.0.0` final.

The transition onto the RC line is a one-time bump from the last `0.x` stable to `8.0.0-rc.1`; `pnpm bump-version` encodes it (a pre-8 stable base advances to `8.0.0-rc.1`, an RC base advances its counter). There are no further `0.x` minors.

## Dist-tag convention

The npm registry exposes Prisma Next under these dist-tags:

- **`latest`** — the most recent release, RC or stable (`8.0.0-rc.N` on the RC line). Default for any bare `npm install`. New `latest` releases happen automatically when a release PR merges (see procedure below).
- **`dev`** — every push to `main` that doesn't change the root `version` produces a `<base>-dev.N` tarball under this tag (on the RC line: `8.0.0-rc.X-dev.N`). Use these to pin reproductions, install internal CI runs, or hand someone a "try `@dev` to get the bleeding edge" link. **No stability promise** — they may be yanked freely.
- **`beta`** — reserved for hand-cut previews ahead of significant changes. Routine releases do not use this tag.

The `pr` dist-tag was used historically to publish per-PR previews; PR previews now go through [`pkg.pr.new`](https://pkg.pr.new) ([`.github/workflows/preview-publish.yml`](../../.github/workflows/preview-publish.yml)) instead. The legacy `pr` tag is left as-is on the registry.

## Who can publish

Publishing requires:

- **Membership in the maintainer team** (see [Governance](./governance.md)) — pushing to `main` or merging a release PR is restricted to maintainers.
- **A green run of the [`Publish to npm`](../../.github/workflows/publish.yml) workflow.** The workflow uses [npm OIDC trusted publishing](https://docs.npmjs.com/generating-provenance-statements) — no long-lived `NPM_TOKEN` exists in repository secrets, so a leaked secret cannot be used to publish out-of-band. Each published tarball carries an [npm provenance attestation](https://docs.npmjs.com/generating-provenance-statements) tying it to this repository and the workflow run that produced it.
- The workflow only publishes from `main`. Dry-runs are permitted from any branch (see "validating publish changes" below); every step that would mutate external state is independently guarded.

## Mechanism: how we deliver the contract

The version Prisma Next ships is the **`version` field of the root [`package.json`](../../package.json)**. The publish workflow ([`.github/workflows/publish.yml`](../../.github/workflows/publish.yml)) reads this value at the workflow's git ref and refuses to publish anything else. There is no `workflow_dispatch` input to override the version, no per-package `version` drift, and no separate "release manifest" file. Anyone — human or agent — can answer "what version are we on?" by reading a single file under git.

This is by design. Two of the three other places a version *could* live cause silent problems:

- **Querying the npm registry for the latest tag** (the previous behaviour) makes the next minor implicit. A yanked release, a manually-rewritten dist-tag, or registry latency all silently shift what the next CI build calls itself.
- **A separate `versions.json` or `release.toml`** would diverge from the per-package `version` in tooling that only inspects `package.json` (npm, dependency analyzers, supply-chain scanners, downstream consumers). Keeping the source in `package.json` means there is nothing to keep in sync.

[`scripts/set-version.ts`](../../scripts/set-version.ts) is what enforces lockstep: a single invocation walks every workspace `package.json` and writes the requested version. The publish workflow uses the same script, so per-package and root values cannot diverge through the publish path.

The publish workflow is **triggered by a change to the root `version`**: a push to `main` whose root `package.json` carries a different `version` than the previous tip is recognised as a release bump and ships the new version under dist-tag `latest` — on the RC line that means `latest` moves to the new `8.0.0-rc.N`, and the accompanying GitHub Release is marked pre-release. Pushes that don't change the root `version` produce `<base>-dev.N` tarballs under dist-tag `dev` instead. This is what makes "merge the release PR" the publish trigger — there is no separate dispatch step.

A growing set of pre-publish gates run as part of the workflow:

- **Dependency-specifier check** ([`pnpm check:publish-deps`](../../scripts/check-publish-deps.mjs)) — fails the publish if any resolved `package.json` would carry an unrewritten `workspace:*` or `catalog:` specifier into the registry.
- **Release-notes presence check** ([`pnpm check:release-notes`](../../scripts/check-release-notes.mjs)) — fires for `latest` publishes only. The Release body is the committed [`docs/releases/v<version>.md`](../releases/README.md), published via `gh release create --notes-file`; this check fails the publish when that file is missing. There is **no `--generate-notes` fallback**. A PR-mode variant runs in CI ([`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)) and fails a release PR that bumps the root `version` without committing the matching notes file, so the omission is caught in review rather than at publish.
- More gates will accumulate here as the upgrade-skill machinery lands (recipe-presence check fired on root version changes, etc.). The root-version-as-trigger model is the hook these checks plug into.

## Procedure: cut the next release

The release cadence is one PR per release (on the RC line: one PR per `rc.N`). A maintainer:

1. **Runs the `publish-npm-version` skill** (see [`publish-npm-version`](../../skills-contrib/publish-npm-version/SKILL.md)). The skill creates a fresh worktree off `origin/main`, drives `pnpm bump-version`, and opens a PR in the maintainer's name. Using a skill rather than a GitHub workflow ensures the PR carries real maintainer credentials so CI runs on it normally.
2. **Authors the release notes.** The release PR must include a committed [`docs/releases/v<version>.md`](../releases/README.md); its contents become the GitHub Release body verbatim (`gh release create --notes-file`), so there is no auto-generated PR-title summary to fall back on. The PR-mode release-notes gate fails the PR if the file is missing, making notes authoring part of preparing the release. The `publish-npm-version` skill drafts this file automatically before opening the PR by running the [`draft-release-notes`](../../skills-contrib/draft-release-notes/SKILL.md) skill, which enumerates the release's merged PRs, triages them, and writes the categorized notes (breaking changes first) plus a matching `CHANGELOG.md` entry — the maintainer reviews the result in the PR rather than authoring from scratch.
3. **Reviews and merges the PR.** This is the point where humans verify there are no in-flight breaking changes that need release-notes attention. The merge itself is the publish trigger: the resulting push to `main` carries the bumped root `version`, the publish workflow detects the change, and publishes `<version>` under dist-tag `latest` plus a matching GitHub Release (marked pre-release on the RC line) whose body is the committed notes file. No separate dispatch step is required.

If the publish needs to be re-run (transient registry failure, etc.), a maintainer can dispatch the [`Publish to npm`](../../.github/workflows/publish.yml) workflow from `main` with `dist-tag=latest` and `dry-run=false`; the workflow re-publishes the version currently committed at HEAD. This is the same path used to cut a hand-rolled `beta` (`dist-tag=beta`).

## Procedure: patch the current minor

**On the RC line there are no patch releases** — a fix ships as the next `rc.N` via the routine procedure above. This section applies only while releases are stable versions (before the RC transition, or after `8.0.0` final). Patches are not part of the routine cadence and only apply to the **current** minor (per the pre-1.0 policy above — older minors are not maintained). If a freshly-published `latest` ships a regression that must be addressed before the next minor:

1. Land the fix as a small PR.
2. On a follow-up PR, run `node scripts/set-version.ts <major>.<minor>.<patch+1>` to advance every workspace package to the patch version.
3. On that same PR, author `docs/releases/v<major>.<minor>.<patch+1>.md`. The release-notes gate enforces a committed notes file for every `latest` release, patches included — a patch with no notes file fails the publish. A patch entry is usually short (a single **Fixes** item), but it is still the Release body.
4. Merge to `main`. The merge changes the root `version` and auto-publishes `latest` via the same path as a minor bump.

The skill is not used for patches because the bump shape is different (`patch+1`, not `minor+1`); the explicit `set-version.ts` invocation is the procedure.

## Procedure: validate publish changes

The publish workflow's `dry-run` mode (the input default) can be invoked from any branch to validate that the publish pipeline still works after touching `publish.yml`, `set-version.ts`, `determine-version.ts`, the publish script, or any of the build scripts. A dry-run exercises `pnpm publish --dry-run` against every publishable workspace package, runs the pre-publish gates, and skips the registry publish + GitHub Release.

## Non-goals

- **Maintenance of older minors.** Stated above as policy: in the `0.x` range, you upgrade. There is no tooling for cutting a `0.7.x` patch after `0.8.0` ships, and that is intentional.
- **A scripted `beta` cadence.** The `beta` dist-tag exists but cutting beta builds is a manual `workflow_dispatch`. (The RC cadence, by contrast, *is* the routine scripted path — see the RC-line section above.)
- **Independent per-package versioning.** Lockstep is the invariant the rest of the contract is built on; per-package versions would require redesigning `set-version.ts`, the publish flow, and the upgrade-skill recipe model.
