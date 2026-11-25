# Versioning

This page says which versions of Prisma ORM are maintained and what each one receives, then how Prisma 8 packages are versioned, how mature each one is, and how they are published. The procedures at the end are for maintainers.

## Supported versions

| Version | Branch | Status | Maintained until |
| --- | --- | --- | --- |
| Prisma 8 | `main` | Release candidate | Not yet announced |
| Prisma 7 | `v7` | Maintenance | 18 months after Prisma `8.0.0` is released |

**Prisma 8** is where all new development happens. Until `8.0.0`, its releases are release candidates, described [below](#release-candidates).

**Prisma 7** is in maintenance. The Prisma maintainers fix bugs and security issues in it, and do not build new features for it. A feature contributed by the community can still be accepted, if it fits Prisma 7's design and meets the project's quality standards. It also takes corrections to, improvements to, and maintenance of the tooling that builds, tests and releases it, such as its test runner, CI workflows, build scripts and dependencies. Prisma 7 has to stay buildable, testable and releasable for the whole support period, and every later fix is cheaper and safer to land when that tooling is healthy. This work changes nothing users run, so the design-fit question that features raise does not apply to it. A [maintainer](./governance.md#maintainer-team) decides whether a contribution does; passing the [mechanical requirements](./pr-triage.md#step-4--mechanical-requirements) in PR triage is required but is not enough on its own. Pull requests for Prisma 7 target the `v7` branch.

[`SECURITY.md`](../../SECURITY.md#supported-versions) says which releases receive security fixes. The decision is recorded in [ADR 295](../architecture%20docs/adrs/ADR%20295%20-%20New%20features%20do%20not%20land%20on%20Prisma%207.md).

## Release candidates

Until `8.0.0` is released, Prisma 8 ships as release candidates: `8.0.0-rc.1`, `8.0.0-rc.2`, and so on. Every package is published at the same `8.0.0-rc.N`, whatever its real state, and each names the others at that exact version. A release candidate carries no backwards-compatibility promise. Concretely:

- **Any release candidate may contain breaking changes:** API removals, changes to how an existing API behaves, or changes to the contract format.
- **Releases are frequent.** A new release candidate ships whenever the next batch of work is ready, not on a fixed schedule.
- **Only the latest release candidate is maintained.** A fix ships in the next release candidate; older ones get no patches, including security patches.
- **Upgrade guides help you keep current.** Each release ships with an upgrade guide, which the `prisma-8` skill can apply for you. See the [upgrade instruction lifecycle](../../upgrade-instructions/README.md).

If your project cannot keep up with this, wait for `8.0.0`. Before the release candidates, Prisma 8 shipped as `0.x` minors under the same terms.

The rest of this page, from [Maturity levels](#maturity-levels) to [What an application writes](#what-an-application-writes), takes effect at `8.0.0`. The release scripts already compute both the release candidates and the rules below from one function, and the [release plan](#printing-the-release-plan) prints either.

## Maturity levels

Every published package but one has one of four maturity levels; `@prisma/orm-extension-paradedb` has its own version instead, [below](#version-numbers). A level is defined by the least the maintainers do for a package at it. [ADR 330](../architecture%20docs/adrs/ADR%20330%20-%20A%20maturity%20level%20is%20written%20in%20a%20package's%20version%20and%20an%20API's%20name.md) records the decision.

| Level | What the maintainers do, at least |
| --- | --- |
| Generally Available (GA) | Its tests run on every release and a failure blocks the release. A package for a database passes the full test suite against that database. A later release in the same major version does not break its users. |
| Release Candidate | As for GA, and no further change that breaks its users is expected. It may still change before it is GA. |
| Preview | Its tests run and a failure blocks the release, for what it supports. Its reference documentation lists what it does not yet support. It may change in any release. |
| Early Access | Released so that people can try it. It may be released with a failing test. It may change in any release. |

"Below GA" means any of the last three. Only what is GA is kept compatible within a major version.

A level is written in two places, and nowhere else: in a package's version number, and at the start of an API's name.

| Level | In a package's version number | At the start of an API's name |
| --- | --- | --- |
| Generally Available | Plain version: `8.3.0` | Nothing: `foo` |
| Release Candidate | `8.3.0-rc.0` | `rc_foo` |
| Preview | `8.3.0-preview.0` | `preview_foo` |
| Early Access | `8.3.0-ea.0` | `ea_foo` |

An API has the level of its package unless its name starts with the word for a lower level. A capability has the level of the package that publishes it. A GA package of ours names only GA packages of ours. There are no feature flags: functionality that is not ready ships in its own package below GA, or under a name that carries its level.

Each package's level is declared in [`packages/0-shared/publish-surface/src/levels.ts`](../../packages/0-shared/publish-surface/src/levels.ts). A package's level may go up at any release; within a minor it can only go up, because its version can only move forward. It may go down at a new minor only if the package has never been GA. Whether a GA package may go below GA again is not decided, and the release scripts refuse it.

## Version numbers

- **The major and minor are the release number.** Release `8.3` publishes every package at `8.3`, except `@prisma/orm-extension-paradedb`. The root `package.json` `version` is the release number with a zero patch, such as `8.3.0`; on the release candidates it is `8.0.0-rc.N`.
- **A GA package has its own patch number.** A fix to one GA package raises that package's patch number, to `8.3.1`, and no other package's. The commands that release such a fix are not written yet.
- **A package below GA carries its level as a suffix, with its own counter.** A fix to it raises the counter, `8.3.0-preview.1`, and not the patch number, so that a user's range can select it.
- **At release `8.0`, a package at Release Candidate continues the release candidates' counter**, above the last `8.0.0-rc.N`, so its version sorts above every release candidate already published; the other levels start at `8.0.0` and `8.0.0-<level>.0`. One function in the release plan, `firstVersionOfMinor`, gives the first version of every minor.
- **The suffix is what Semantic Versioning calls a pre-release.** A range such as `^8.0.0` never selects one, so a user gets a release below GA only by asking for it. The words sort in the right order: `ea`, `preview`, `rc`, then the plain version.

`@prisma/orm-extension-paradedb` has no level and is numbered on its own from `8.0.0`: it takes `0.1.0` at `8.0.0`, then keeps its version at each release until it gets a fix, which raises its patch number. Its first version is declared in `levels.ts`; after that its version is in its manifest. At a release where its version is already on the registry, the publish script skips it and says so. It names our packages as an extension does ([ADR 330](../architecture%20docs/adrs/ADR%20330%20-%20A%20maturity%20level%20is%20written%20in%20a%20package's%20version%20and%20an%20API's%20name.md)).

## Ranges between our packages

`scripts/set-version.ts` writes the ranges into the manifests from the release plan, and the build refuses a manifest that disagrees. Nobody writes one by hand.

| From | To | Range |
| --- | --- | --- |
| A database package, such as `@prisma/orm-postgres`, or a platform package | A GA package | Same minor, any patch: `~8.3.0` |
| A database package or a platform package | A package below GA | The same, from that package's first version of the minor: `~8.3.0-ea.0` |
| An extension or a library integration | A GA package | That release or any later one in the major version: `^8.3.0` |
| An extension or a library integration | A package below GA | Within the minor, from that package's first version of it: `~8.3.0-ea.0` |

The packages of one release are tested together, so among themselves they accept only that release. An extension built on release `8.1` has to work in an application on `8.4`, so it accepts any later release of a GA package. A package below GA may change in the next minor, so nothing accepts more than one minor of it.

## Tags

- A GA release is published under the `latest` dist-tag.
- A release below GA is published under `latest` when the package has never had a GA release in any major version, so that a plain install works and the version shows the level. Otherwise it is published under a tag named after its level, such as `preview`. A `0.x` version does not count as a GA release: it is Semantic Versioning's initial development, and the `0.x` minors these packages had before the release candidates were not GA.
- Every push to `main` publishes a development build under `dev`; see [Dist-tag convention](#dist-tag-convention).

## What an application writes

- On a GA database package: a caret on every `@prisma/orm-*` line, `^8.3.0`. An update moves all of them to the next release together.
- On a database package below GA: a tilde on every line, `~8.3.0-ea.0` on the packages below GA and `~8.3.0` on the GA ones, and the database package at a tilde on its own version, such as `~8.3.0-ea.1`. A caret on a pre-release never selects the next minor's pre-release, so at each new minor the user edits the lines; see [below](#a-new-minor-below-ga).

`prisma orm init` writes the lines this way when it adds the database package itself. When the project already lists the database package, `init` leaves that line as the user wrote it and writes each platform package at the range the installed database package declares for it, so that it never installs a platform package the user's database package does not accept.

On the release candidates `init` writes the exact `8.0.0-rc.N` on every line.

Under pnpm a line on a package below GA is exact: pnpm writes `8.1.0-ea.0` even when it is given `~8.1.0-ea.0`, and `pnpm update` rewrites such a line to an exact version. That is pnpm's behaviour, which `init` does not change. To take a fix to that package, such as `8.1.0-ea.1`, change the line or add the package again.

### A new minor below GA

At each new minor, an application on a database package below GA edits every `@prisma/orm-*` line by hand to the new minor, `~X.Y.0-<level>.0` for the packages below GA and `~X.Y.0` for the GA ones, then runs its package manager's install. For SQLite going from `8.1` to `8.2`:

```jsonc
// before
"@prisma/orm-sqlite": "~8.1.0-ea.0",
"@prisma/orm-target-sqlite": "~8.1.0-ea.0",
"@prisma/orm-framework": "~8.1.0",
"@prisma/orm-family-sql": "~8.1.0",
"@prisma/orm-toolchain": "~8.1.0"
// after
"@prisma/orm-sqlite": "~8.2.0-ea.0",
"@prisma/orm-target-sqlite": "~8.2.0-ea.0",
"@prisma/orm-framework": "~8.2.0",
"@prisma/orm-family-sql": "~8.2.0",
"@prisma/orm-toolchain": "~8.2.0"
```

A package manager's command that updates to the latest version is not a substitute: npm and Yarn rewrite every tilde line as a caret, and the next ordinary update then moves the GA lines to the following minor without the database package, which does not accept it.

## Printing the release plan

`node scripts/print-release-plan.ts [<root version>] [--ever-ga <name,...>]` prints, for each published package, its level, the version and tag it is published with, and the range it writes on each package of ours it names. With no version it plans the root `package.json`'s version. `--ever-ga` names the packages that have had a GA release, which decides their tag below GA. It reads the workspace and writes nothing. [`scripts/fixtures/release-plan/`](../../scripts/fixtures/release-plan/) holds the expected output for the root version, `8.0.0` and `8.1.0`, and `pnpm test:scripts` compares them.

## Versions in the workspace

The published packages follow the release plan. Everything else follows the root version, which is the release number: the private `@internal/*` packages, the examples, the apps and the root itself. A contributor reads the release number from the root `package.json`; a published package's own version is in its manifest, and the release plan prints all of them.

- **The `prisma-8` skill is stamped with the version it ships in.** The skill ships inside the `@prisma/orm-postgres`, `@prisma/orm-sqlite`, `@prisma/orm-mysql`, `@prisma/orm-mariadb` and `@prisma/orm-mongo` tarballs (copied in by each package's `prepack`). The copy in the source tree carries the root version in its `metadata.library_version` frontmatter, and each packed copy carries the version of the package it ships in. Getting the skill and getting the code are one install, and a consumer can compare the stamp on its synced copy against its installed packages.
- **Extension authors name our published packages, never an `@internal/*` package**, which is never published. Until `8.0.0`, an extension names every `@prisma/orm-*` package it uses as a peer dependency at one exact `8.0.0-rc.N`. From `8.0.0` it declares a caret on the first release it works with on a GA package, and a tilde within that minor on a package below GA, as [Ranges between our packages](#ranges-between-our-packages) gives. The [extension-upgrade skill](../../skills/prisma-8/references/upgrade-extension.md#exact-pin-rule) has the details.

[`scripts/set-version.ts`](../../scripts/set-version.ts) writes the versions: each published package's from the release plan, and the root version everywhere else.

Published code that reports a version reads it from its private `@internal/*` package, which follows the root version, so it reports the release number, not its published package's own version:

- **The database packages' `contractFromJson` key** (`<targetId>@<version>`) only marks a contract value as checked by that function, within one process, and is compared with nothing else.
- **The MongoDB driver's `driverInfo`** is sent to the MongoDB server when it connects, for the server's logs, and is compared with nothing.
- **The Supabase extension's version in `contract.json`** is written into every contract that uses it. It is the release number from `8.0.0` too, not the extension's own version; changing it would change emitted contracts, which is decided outside this work.

## The `8.0.0` release candidates in detail

Releases are versioned `8.0.0-rc.1`, `8.0.0-rc.2`, … with the counter advancing on every release publish. The version number iterates freely. Versions are immutable on npm: a botched publish burns a counter value, which is fine; skip it and never reuse a number.

For every package this repository publishes, `latest` tracks the newest release candidate. These package names have no earlier stable audience to protect: a bare `npm install` of any of them is a release-candidate install, and its users are expected to keep up (see [Release candidates](#release-candidates)). Existing installs are unaffected: lockfiles pin resolved versions, and `^0.x` ranges can never resolve to a release candidate (a pre-release does not match a stable range).

The bare `prisma` package is published from [prisma/prisma-cli](https://github.com/prisma/prisma-cli), not from this repository. That repository publishes v8 builds under `next` while `latest` stays on Prisma 7 (published from the `v7` branch's pipeline) until `8.0.0`.

The transition onto the release candidates was a one-time bump from the last `0.x` stable to `8.0.0-rc.1`; `pnpm bump-version` encodes it (a pre-8 stable base advances to `8.0.0-rc.1`, a release-candidate base advances its counter). There are no further `0.x` minors.

## Dist-tag convention

The npm registry exposes Prisma 8 under these dist-tags:

- **`latest`**: on the release candidates, the newest `8.0.0-rc.N`, for every package. From `8.0.0`, each package's tag follows [Tags](#tags). New `latest` releases happen automatically when a release PR merges (see procedure below).
- **`preview`, `ea`, `rc`**: from `8.0.0`, a release below GA of a package that has had a GA release.
- **`dev`**: every push to `main` produces a `<version>-dev.N` tarball under this tag (on the release candidates: `8.0.0-rc.X-dev.N`). Release pushes publish theirs after the release itself, so `dev` always tracks a build of the current base and never falls behind `latest`. Use these to pin reproductions, install internal CI runs, or hand someone a "try `@dev` to get the bleeding edge" link. They may be yanked freely.
- **`beta`**: reserved for hand-cut builds ahead of significant changes. Routine releases do not use this tag.

The `pr` dist-tag was used historically to publish per-PR previews; PR previews now go through [`pkg.pr.new`](https://pkg.pr.new) ([`.github/workflows/preview-publish.yml`](../../.github/workflows/preview-publish.yml)) instead. The legacy `pr` tag is left as-is on the registry.

A `pkg.pr.new` preview rewrites a package's dependencies on its siblings to the previews' own addresses, but not its peer dependencies, and every package of ours names its siblings as peers ([ADR 329](../architecture%20docs/adrs/ADR%20329%20-%20An%20application%20lists%20the%20platform%20packages%20and%20our%20packages%20name%20each%20other%20as%20peers.md)). So install the preview of a package together with the previews of every package it names as a peer, each by its preview address: the preview of `@prisma/orm-postgres` with those of `@prisma/orm-framework`, `@prisma/orm-family-sql`, `@prisma/orm-target-postgres` and `@prisma/orm-toolchain`. A preview installed alone gets the released versions of those packages from the registry, and tests the pull request's change on top of old code.

## Who can publish

Publishing requires:

- **Membership in the maintainer team** (see [Governance](./governance.md)): pushing to `main` or merging a release PR is restricted to maintainers.
- **A green run of the [`Publish to npm`](../../.github/workflows/publish.yml) workflow.** The workflow uses [npm OIDC trusted publishing](https://docs.npmjs.com/generating-provenance-statements): no long-lived `NPM_TOKEN` exists in repository secrets, so a leaked secret cannot be used to publish out-of-band. Each published tarball carries an [npm provenance attestation](https://docs.npmjs.com/generating-provenance-statements) tying it to this repository and the workflow run that produced it.
- The workflow only publishes from `main`. Dry-runs are permitted from any branch (see "validate publish changes" below); every step that would mutate external state is independently guarded.

## Mechanism: how a release is published

The release number is the **`version` field of the root [`package.json`](../../package.json)**. The publish workflow ([`.github/workflows/publish.yml`](../../.github/workflows/publish.yml)) reads this value at the workflow's git ref, computes the release plan from it and the declared levels, and publishes nothing else. There is no `workflow_dispatch` input to override the version and no separate "release manifest" file. Anyone, human or agent, can answer "which release is this?" by reading a single file under git, and "what version is each package?" by printing the release plan.

This is by design. Two other places a version could live cause silent problems:

- **Querying the npm registry for the latest tag** (the previous behaviour) makes the next minor implicit. A yanked release, a manually-rewritten dist-tag, or registry latency all silently shift what the next CI build calls itself.
- **A separate `versions.json` or `release.toml`** would diverge from the per-package `version` in tooling that only inspects `package.json` (npm, dependency analyzers, supply-chain scanners, downstream consumers).

The publish workflow runs on **every push to `main`**, and every run publishes a `<version>-dev.N` tarball under dist-tag `dev`. A push whose root `package.json` carries a different `version` than the previous tip is recognised as a release bump and *additionally* publishes the release: each package under the tag the release plan gives it, and a GitHub Release, marked pre-release on the release candidates. From `8.0.0` the root version is a plain release number, so a GitHub Release is not marked pre-release, whatever the levels of the packages in it. It then publishes the dev build of the same commit. The two publishes are not alternatives: the dev leg of a release push is what keeps `dev` from sitting on the previous base until the next routine push (a staleness that broke prisma-cli's dev channel on 2026-08-25). This model is adopted from [prisma/composer#241](https://github.com/prisma/composer/pull/241). The release-on-version-change behaviour is what makes "merge the release PR" the publish trigger; there is no separate dispatch step.

The workflow runs these checks before it publishes:

- **Dependency-specifier check** ([`pnpm check:publish-deps`](../../scripts/check-publish-deps.mjs)): fails the publish if any packed `package.json` would carry an unrewritten `workspace:` or `catalog:` specifier into the registry, or a range on a package of ours that is not the release plan's.
- **Release-notes presence check** ([`pnpm check:release-notes`](../../scripts/check-release-notes.mjs)): runs for `latest` publishes only. The Release body is the committed [`docs/releases/v<version>.md`](../releases/README.md), published via `gh release create --notes-file`; this check fails the publish when that file is missing. There is **no `--generate-notes` fallback**. A PR-mode variant runs in CI ([`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)) and fails a release PR that bumps the root `version` without committing the matching notes file, so the omission is caught in review rather than at publish.
- **Upgrade coverage** ([`pnpm check:upgrade-coverage`](../../scripts/check-upgrade-coverage.mjs)): feature PRs require their own pending declarations for affected audiences. Releases require assembled app and extension guides and no remaining pending fragments, including late arrivals. Dev and beta builds allow pending work. The check verifies structure and script references; human review checks the synthesized guidance against its originals.

## Procedure: cut the next release candidate

This procedure is for the `8.0.0` release candidates. Releasing `8.0.0`, a fix to one package and the support period are not written yet.

The release cadence is one PR per `rc.N`. A maintainer:

1. **Runs the `publish-npm-version` skill** (see [`publish-npm-version`](../../skills-contrib/publish-npm-version/SKILL.md)). The skill creates a fresh worktree off `origin/main`, drives `pnpm bump-version`, and opens a PR in the maintainer's name. Using a skill rather than a GitHub workflow ensures the PR carries real maintainer credentials so CI runs on it normally.
2. **Assembles upgrade guides and authors the release notes.** The skill first gathers pending fragments, synthesizes and reviews the app and extension guides, and moves original fragments into the repository-only archive following the [upgrade instruction lifecycle](../../upgrade-instructions/README.md). It then drafts notes linking those assembled guides. The release PR must include a committed [`docs/releases/v<version>.md`](../releases/README.md); its contents become the GitHub Release body verbatim (`gh release create --notes-file`). The PR-mode release-notes check fails the PR if the file is missing. The `publish-npm-version` skill drafts this file before opening the PR by running the [`draft-release-notes`](../../skills-contrib/draft-release-notes/SKILL.md) skill, which enumerates the release's merged PRs, triages them, and writes the categorized notes (breaking changes first) plus a matching `CHANGELOG.md` entry; the maintainer reviews the result in the PR.
3. **Reviews and merges the PR.** Humans review both the guides and release notes. If new fragments arrive before merge, refresh the guides and archive those inputs first; CI checks completeness on the effective merged release tree, and publication checks it independently. The merge is the publish trigger: the resulting push to `main` carries the bumped root `version`, and the publish workflow publishes `<version>` under dist-tag `latest` plus a matching GitHub Release, marked pre-release, whose body is the committed notes file. The same run then publishes `<version>-dev.1` under `dev`.

If the publish needs to be re-run (transient registry failure, etc.), a maintainer can dispatch the [`Publish to npm`](../../.github/workflows/publish.yml) workflow from `main` with `dist-tag=latest` and `dry-run=false`; the workflow re-publishes the version currently committed at HEAD, including the `dev` follow-up, so recovering a failed release also recovers the `dev` dist-tag. This is the same path used to cut a hand-rolled `beta` (`dist-tag=beta`), which carries no dev follow-up.

On the release candidates there are no patch releases: a fix ships as the next `rc.N`.

## Procedure: validate publish changes

The publish workflow's `dry-run` mode (the input default) can be invoked from any branch to validate that the publish pipeline still works after touching `publish.yml`, `set-version.ts`, `determine-version.ts`, the publish script, the release plan, or any of the build scripts. A dry-run exercises `pnpm publish --dry-run` against every publishable workspace package, runs the checks, and skips the registry publish and the GitHub Release.

## Non-goals

- **Maintenance of older Prisma 8 release candidates.** You upgrade to the latest. There is no tooling for patching an older release candidate, and that is intentional. Prisma 7 is the one older line that is maintained (see [Supported versions](#supported-versions)).
- **A scripted `beta` cadence.** The `beta` dist-tag exists but cutting beta builds is a manual `workflow_dispatch`.
