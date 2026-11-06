# Versioning

This page says which versions of Prisma ORM are maintained and what each one receives, then how Prisma 8 is versioned and published. The procedures at the end are for maintainers.

## Supported versions

| Version | Branch | Status | Maintained until |
| --- | --- | --- | --- |
| Prisma 8 | `main` | Release candidate | Not yet announced |
| Prisma 7 | `v7` | Maintenance | 18 months after Prisma `8.0.0` is released |

**Prisma 8** is where all new development happens. Until `8.0.0`, its releases are release candidates, described [below](#release-candidates).

**Prisma 7** is in maintenance. The Prisma maintainers fix bugs and security issues in it, and do not build new features for it. A feature contributed by the community can still be accepted, if it fits Prisma 7's design and meets the project's quality standards. A [maintainer](./governance.md#maintainer-team) decides whether a contribution does; passing the [mechanical requirements](./pr-triage.md#step-4--mechanical-requirements) in PR triage is required but is not enough on its own. Pull requests for Prisma 7 target the `v7` branch.

[`SECURITY.md`](../../SECURITY.md#supported-versions) says which releases receive security fixes. The decision is recorded in [ADR 295](../architecture%20docs/adrs/ADR%20295%20-%20New%20features%20do%20not%20land%20on%20Prisma%207.md).

## Release candidates

Until `8.0.0` is released, Prisma 8 ships as release candidates: `8.0.0-rc.1`, `8.0.0-rc.2`, and so on. A release candidate carries no backwards-compatibility promise. Concretely:

- **Any release candidate may contain breaking changes:** API removals, changes to how an existing API behaves, or changes to the contract format.
- **Releases are frequent.** A new release candidate ships whenever the next batch of work is ready, not on a fixed schedule.
- **Only the latest release candidate is maintained.** A fix ships in the next release candidate; older ones get no patches, including security patches.
- **Upgrade guides help you keep current.** Each release ships with an upgrade guide, which the `prisma-8` skill can apply for you. See the [upgrade instruction lifecycle](../../upgrade-instructions/README.md).

If your project cannot keep up with this, wait for `8.0.0`. What you can rely on: the root `package.json` `version` of any commit says exactly which release it is.

Before the release candidates, Prisma 8 shipped as `0.x` minors under the same terms. [The v8 RC line](#the-v8-rc-line) describes the version numbers in detail.

## Lockstep across the workspace

Every workspace package — publishable, private, the workspace root, and example apps — carries the same `version`. One read of root `package.json` answers "what version is this code?" for the entire repository.

This invariant has consequences that ecosystem participants need to plan for:

- **Agent skills, the upgrade instructions, and any other tooling we ship alongside the framework version in lockstep with it.** A skill installed at the same time as `@internal/postgres@0.8.0` is a `0.8.0` skill and reasons about a `0.8.0` contract. There is no separate skill-version axis to track. This is now physical rather than conventional: the `prisma-8` skill ships inside the `@prisma/orm-postgres`, `@prisma/orm-sqlite`, `@prisma/orm-mysql` and `@prisma/orm-mongo` tarballs (copied in by each package's `prepack`), and `scripts/set-version.ts` stamps its `metadata.library_version` frontmatter with the version being published. Getting the skill and getting the code are one install, and a consumer can compare the stamp on its synced copy against its installed packages.
- **Extension authors that depend on internal framework packages must pin those dependencies to the framework version their consumers will use.** If your extension depends on `@internal/sql-core` (an internal framework package), publish each version of your extension targeting one specific Prisma 8 minor and pin to it exactly (`"@internal/sql-core": "0.8.0"`, not `"^0.8.0"`). Internal packages do not promise inter-minor compatibility — `0.8.x` and `0.9.x` may have incompatible internals even when the user-visible surface looks similar. The extension's published version range communicates which framework minor it targets.
- **Internal packages are never published, but they still version in lockstep** so a contributor cloning the repo at any commit sees one consistent answer to "what version is this code?" The `private: true` flag means `pnpm publish` skips them.

If lockstep ever broke — if a private package or example carried a different version — the "one read of root tells you everything" invariant would be silently violated. The pre-publish dependency-specifier and upgrade-coverage checks rely on this invariant.

## The v8 RC line

Prisma 8 ships as a release-candidate line ahead of `8.0.0` final: releases are versioned `8.0.0-rc.1`, `8.0.0-rc.2`, … with the counter advancing on every release publish. "The v8 RC" is the product name; the version number underneath iterates freely, and there is no promise that the final RC is literally numbered `rc.1`. Versions are immutable on npm — a botched publish burns a counter value, which is fine; skip it and never reuse a number.

For every package this repository publishes, **`latest` tracks the newest release — RC or stable**. These package names have no pre-v8 stable audience to protect: a bare `npm install` of any of them is an early-access install, and early-access users are expected to keep up (see [Release candidates](#release-candidates)). Existing installs are unaffected — lockfiles pin resolved versions, and `^0.x` ranges can never resolve to an RC (pre-releases don't match stable ranges), so nobody is moved onto the RC line by `npm update`; new installs simply get the newest RC.

The frozen-`latest` concern — never surprising an existing stable audience — applies to the bare `prisma` package, which this repository does not publish. Its v8 bin shim lives in [prisma/prisma-cli](https://github.com/prisma/prisma-cli); that repository publishes v8 builds under `next` while `latest` stays on Prisma 7 (published from the `v7` branch's pipeline) until `8.0.0` final.

The transition onto the RC line is a one-time bump from the last `0.x` stable to `8.0.0-rc.1`; `pnpm bump-version` encodes it (a pre-8 stable base advances to `8.0.0-rc.1`, an RC base advances its counter). There are no further `0.x` minors.

## Dist-tag convention

The npm registry exposes Prisma 8 under these dist-tags:

- **`latest`** — the most recent release, RC or stable (`8.0.0-rc.N` on the RC line). Default for any bare `npm install`. New `latest` releases happen automatically when a release PR merges (see procedure below).
- **`dev`** — every push to `main` produces a `<base>-dev.N` tarball under this tag (on the RC line: `8.0.0-rc.X-dev.N`). Release pushes publish theirs after the release itself, so `dev` always tracks a build of the current base and never falls behind `latest`. Use these to pin reproductions, install internal CI runs, or hand someone a "try `@dev` to get the bleeding edge" link. **No stability promise** — they may be yanked freely.
- **`beta`** — reserved for hand-cut previews ahead of significant changes. Routine releases do not use this tag.

The `pr` dist-tag was used historically to publish per-PR previews; PR previews now go through [`pkg.pr.new`](https://pkg.pr.new) ([`.github/workflows/preview-publish.yml`](../../.github/workflows/preview-publish.yml)) instead. The legacy `pr` tag is left as-is on the registry.

## Who can publish

Publishing requires:

- **Membership in the maintainer team** (see [Governance](./governance.md)) — pushing to `main` or merging a release PR is restricted to maintainers.
- **A green run of the [`Publish to npm`](../../.github/workflows/publish.yml) workflow.** The workflow uses [npm OIDC trusted publishing](https://docs.npmjs.com/generating-provenance-statements) — no long-lived `NPM_TOKEN` exists in repository secrets, so a leaked secret cannot be used to publish out-of-band. Each published tarball carries an [npm provenance attestation](https://docs.npmjs.com/generating-provenance-statements) tying it to this repository and the workflow run that produced it.
- The workflow only publishes from `main`. Dry-runs are permitted from any branch (see "validating publish changes" below); every step that would mutate external state is independently guarded.

## Mechanism: how we deliver the contract

The version Prisma 8 ships is the **`version` field of the root [`package.json`](../../package.json)**. The publish workflow ([`.github/workflows/publish.yml`](../../.github/workflows/publish.yml)) reads this value at the workflow's git ref and refuses to publish anything else. There is no `workflow_dispatch` input to override the version, no per-package `version` drift, and no separate "release manifest" file. Anyone — human or agent — can answer "what version are we on?" by reading a single file under git.

This is by design. Two of the three other places a version *could* live cause silent problems:

- **Querying the npm registry for the latest tag** (the previous behaviour) makes the next minor implicit. A yanked release, a manually-rewritten dist-tag, or registry latency all silently shift what the next CI build calls itself.
- **A separate `versions.json` or `release.toml`** would diverge from the per-package `version` in tooling that only inspects `package.json` (npm, dependency analyzers, supply-chain scanners, downstream consumers). Keeping the source in `package.json` means there is nothing to keep in sync.

[`scripts/set-version.ts`](../../scripts/set-version.ts) is what enforces lockstep: a single invocation walks every workspace `package.json` and writes the requested version. The publish workflow uses the same script, so per-package and root values cannot diverge through the publish path.

The publish workflow runs on **every push to `main`**, and every run publishes a `<base>-dev.N` tarball under dist-tag `dev`. A push whose root `package.json` carries a different `version` than the previous tip is recognised as a release bump and *additionally* ships the new version under dist-tag `latest` — on the RC line that means `latest` moves to the new `8.0.0-rc.N`, and the accompanying GitHub Release is marked pre-release — before publishing the dev build of the same commit. The two publishes are not alternatives: the dev leg of a release push is what keeps `dev` from sitting on the previous base until the next routine push (a staleness that broke prisma-cli's dev channel on 2026-08-25). This model is adopted from [prisma/composer#241](https://github.com/prisma/composer/pull/241). The release-on-version-change behaviour is what makes "merge the release PR" the publish trigger — there is no separate dispatch step.

A growing set of pre-publish gates run as part of the workflow:

- **Dependency-specifier check** ([`pnpm check:publish-deps`](../../scripts/check-publish-deps.mjs)) — fails the publish if any resolved `package.json` would carry an unrewritten `workspace:*` or `catalog:` specifier into the registry.
- **Release-notes presence check** ([`pnpm check:release-notes`](../../scripts/check-release-notes.mjs)) — fires for `latest` publishes only. The Release body is the committed [`docs/releases/v<version>.md`](../releases/README.md), published via `gh release create --notes-file`; this check fails the publish when that file is missing. There is **no `--generate-notes` fallback**. A PR-mode variant runs in CI ([`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)) and fails a release PR that bumps the root `version` without committing the matching notes file, so the omission is caught in review rather than at publish.
- **Upgrade coverage** ([`pnpm check:upgrade-coverage`](../../scripts/check-upgrade-coverage.mjs)) — feature PRs require their own pending declarations for affected audiences. Releases require assembled app and extension guides and no remaining pending fragments, including late arrivals. Dev/beta builds allow pending work. The check verifies structure and script references; human review checks the synthesized guidance against its originals.

## Procedure: cut the next release

The release cadence is one PR per release (on the RC line: one PR per `rc.N`). A maintainer:

1. **Runs the `publish-npm-version` skill** (see [`publish-npm-version`](../../skills-contrib/publish-npm-version/SKILL.md)). The skill creates a fresh worktree off `origin/main`, drives `pnpm bump-version`, and opens a PR in the maintainer's name. Using a skill rather than a GitHub workflow ensures the PR carries real maintainer credentials so CI runs on it normally.
2. **Assembles upgrade guides and authors the release notes.** The skill first gathers pending fragments, synthesizes and reviews the app/extension guides, and moves original fragments into the repository-only archive following the [upgrade instruction lifecycle](../../upgrade-instructions/README.md). It then drafts notes linking those assembled guides. The release PR must include a committed [`docs/releases/v<version>.md`](../releases/README.md); its contents become the GitHub Release body verbatim (`gh release create --notes-file`), so there is no auto-generated PR-title summary to fall back on. The PR-mode release-notes gate fails the PR if the file is missing, making notes authoring part of preparing the release. The `publish-npm-version` skill drafts this file automatically before opening the PR by running the [`draft-release-notes`](../../skills-contrib/draft-release-notes/SKILL.md) skill, which enumerates the release's merged PRs, triages them, and writes the categorized notes (breaking changes first) plus a matching `CHANGELOG.md` entry — the maintainer reviews the result in the PR rather than authoring from scratch.
3. **Reviews and merges the PR.** Humans review both the guides and release notes. If new fragments arrive before merge, refresh the guides and archive those inputs first; CI checks completeness on the effective merged release tree, and publication checks it independently. The merge itself is the publish trigger: the resulting push to `main` carries the bumped root `version`, the publish workflow detects the change, and publishes `<version>` under dist-tag `latest` plus a matching GitHub Release (marked pre-release on the RC line) whose body is the committed notes file. The same run then publishes `<version>-dev.1` under `dev`. No separate dispatch step is required.

If the publish needs to be re-run (transient registry failure, etc.), a maintainer can dispatch the [`Publish to npm`](../../.github/workflows/publish.yml) workflow from `main` with `dist-tag=latest` and `dry-run=false`; the workflow re-publishes the version currently committed at HEAD, including the `dev` follow-up — so recovering a failed release also recovers the `dev` dist-tag. This is the same path used to cut a hand-rolled `beta` (`dist-tag=beta`), which carries no dev follow-up.

## Procedure: patch the current minor

**On the RC line there are no patch releases** — a fix ships as the next `rc.N` via the routine procedure above. This section applies only while releases are stable versions (before the RC transition, or after `8.0.0` final). Patches are not part of the routine cadence and only apply to the **current** minor; older minors are not maintained. If a freshly-published `latest` ships a regression that must be addressed before the next minor:

1. Land the fix as a small PR.
2. On a follow-up PR, run `node scripts/set-version.ts <major>.<minor>.<patch+1>` to advance every workspace package to the patch version.
3. On that same PR, author `docs/releases/v<major>.<minor>.<patch+1>.md`. The release-notes gate enforces a committed notes file for every `latest` release, patches included — a patch with no notes file fails the publish. A patch entry is usually short (a single **Fixes** item), but it is still the Release body.
4. Merge to `main`. The merge changes the root `version` and auto-publishes `latest` via the same path as a minor bump.

The skill is not used for patches because the bump shape is different (`patch+1`, not `minor+1`); the explicit `set-version.ts` invocation is the procedure.

## Procedure: validate publish changes

The publish workflow's `dry-run` mode (the input default) can be invoked from any branch to validate that the publish pipeline still works after touching `publish.yml`, `set-version.ts`, `determine-version.ts`, the publish script, or any of the build scripts. A dry-run exercises `pnpm publish --dry-run` against every publishable workspace package, runs the pre-publish gates, and skips the registry publish + GitHub Release.

## Non-goals

- **Maintenance of older Prisma 8 releases.** You upgrade to the latest. There is no tooling for patching an older release candidate, and that is intentional. Prisma 7 is the one older line that is maintained (see [Supported versions](#supported-versions)).
- **A scripted `beta` cadence.** The `beta` dist-tag exists but cutting beta builds is a manual `workflow_dispatch`. (The RC cadence, by contrast, *is* the routine scripted path — see the RC-line section above.)
- **Independent per-package versioning.** Lockstep is the invariant the rest of the contract is built on; per-package versions would require redesigning `set-version.ts`, the publish flow, and the upgrade-skill recipe model.
