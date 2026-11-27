# Releasing

This page is for maintainers. It says who can publish Prisma ORM, how a release is published, and how to cut one. What users are promised is on [Versions and support](./versioning.md); the reasons behind the version numbers are in [ADR 330](../architecture%20docs/adrs/ADR%20330%20-%20A%20maturity%20level%20is%20written%20in%20a%20package's%20version%20and%20an%20API's%20name.md).

## Who can publish

- **Only maintainers.** Pushing to `main` and merging a release pull request are restricted to the [maintainer team](./governance.md).
- **Only the [`Publish to npm`](../../.github/workflows/publish.yml) workflow publishes, and only from `main`.** It uses [npm trusted publishing](https://docs.npmjs.com/generating-provenance-statements), so the repository holds no npm token that could leak. Every published package carries a provenance attestation that ties it to this repository and to the workflow run that built it.

## The root version decides what is published

The `version` field of the root [`package.json`](../../package.json) is the **root version**. It names the release that a commit belongs to, and it is the only place the release is written down. There is no workflow input that overrides it and no separate release file. The workflow reads the npm registry for two smaller things only: the number of the next development build, and which versions of each package are already published.

| Stage | Root version |
| --- | --- |
| Until release 8.0 | `8.0.0-rc.N` |
| Release 8.0 | `8.0.1` |
| Any later release, such as 8.3 | `8.3.0` |

Two other places a version could live were rejected:

- **The newest version on the npm registry.** A removed version, a tag someone moved by hand, or a slow registry would silently change what the next build calls itself.
- **A separate file, such as `versions.json`.** Tools that read only `package.json` would disagree with it.

## The release plan

From the root version and each package's declared level, one function, `planRelease` in [`packages/0-shared/publish-surface/src/release-plan.ts`](../../packages/0-shared/publish-surface/src/release-plan.ts), computes for every published package:

- its version,
- the range it puts on each other package of ours that it needs,
- the npm tag it is published under.

Each package's level is declared in [`levels.ts`](../../packages/0-shared/publish-surface/src/levels.ts). To change a level, change it there.

```bash
node scripts/print-release-plan.ts            # the plan for the current root version
node scripts/print-release-plan.ts 8.1.0      # the plan for another root version
```

The command reads the workspace and writes nothing. Its option `--ever-ga <name,...>` names the packages that have already had a GA version, which decides the tag of a version below GA. The publish workflow works that list out from the npm registry: a package has had a GA version if a plain version, with no suffix, is published there. `0.x` versions do not count. [`scripts/fixtures/release-plan/`](../../scripts/fixtures/release-plan/) holds the expected output for the current root version, for `8.0.1` and for `8.1.0`, and `pnpm test:scripts` compares the real output with them.

[`scripts/set-version.ts`](../../scripts/set-version.ts) writes the plan into the `package.json` files. Nobody writes a version or a range between our packages by hand.

Three things about the plan are worth knowing:

- **Until release 8.0 it gives every package the same `8.0.0-rc.N`,** and each package lists the others at that exact version.
- **`@prisma/orm-extension-paradedb` is not in the shared numbering.** Its first version, `0.18.0`, is declared in `levels.ts`; after that its version is whatever its own `package.json` says. At a release where that version is already on npm, the publish script skips the package and says so.
- **The plan refuses what the policy forbids:** a root version of `8.0.0`, a GA package that depends on one of ours below GA, a level that goes down within a minor, and a GA package that goes below GA within a major.

## Versions inside the repository

Published packages get their versions from the release plan. Everything else carries the root version: the private `@internal/*` packages, the examples, the apps and the root itself. `set-version.ts` writes both.

Some published code contains a version number: the `prisma orm` commands report one, and so do the three places below. In all of them the number comes from an `@internal/*` package, so it is the root version, and not the version of the published package the code ships in. None of the three below is compared with a package's version:

- **`contractFromJson`,** the function that checks a `contract.json`, marks a contract it has checked with a key that contains the version. The mark is used inside one running process only.
- **The MongoDB driver** sends the version to the server when it connects, as `driverInfo`. It appears in the server's logs.
- **The Supabase extension** writes its version into every `contract.json` that uses it. It was the root version before packages had versions of their own, and it stays the root version so that existing contracts keep the form they have.

The `prisma-8` agent skill ships inside the five packages that applications import from: `@prisma/orm-postgres`, `@prisma/orm-sqlite`, `@prisma/orm-mysql`, `@prisma/orm-mariadb` and `@prisma/orm-mongo`. The copy in this repository is marked with the root version. The copy inside each published package is marked with that package's version, so a user can compare the skill they have with the packages they installed.

## What the publish workflow does

The workflow runs on every push to `main`.

1. **It always publishes a development build** under the npm tag `dev`. Until release 8.0 every package is `<root version>-dev.N`. From release 8.0 each package is its own planned version with `-dev.N` added, such as `8.3.0-ea.0-dev.4`.
2. **When the push changed the root version, it first publishes the release:** each package at the version and under the tag the release plan gives, and a GitHub Release whose text is the committed release notes. It then publishes the development build of the same commit, so that `dev` is never older than the newest release.

So merging a release pull request is what publishes a release. There is no separate step to start.

Before it publishes, the workflow runs four checks:

- **Conformance** ([`pnpm check:conformance`](../../scripts/check-conformance.mjs)).
- **Dependencies** ([`pnpm check:publish-deps`](../../scripts/check-publish-deps.mjs)). It fails if a packed `package.json` still contains a `workspace:` or `catalog:` entry, if a range on one of our packages differs from the release plan, or if one of our packages is listed as an ordinary dependency of another.
- **Release notes** ([`pnpm check:release-notes`](../../scripts/check-release-notes.mjs)). A release must have a committed [`docs/releases/v<version>.md`](../releases/README.md), which becomes the text of the GitHub Release. Nothing generates notes when the file is missing. The same check runs on a release pull request, so a missing file is caught at review.
- **Upgrade instructions** ([`pnpm check:upgrade-coverage`](../../scripts/check-upgrade-coverage.mjs)). A pull request that changes what users or extension authors must do carries its own upgrade fragment. A release must have its assembled upgrade guides and no pending fragments left. Development builds may have pending fragments. See the [upgrade instruction lifecycle](../../upgrade-instructions/README.md).

### npm tags

| Tag | What is published under it |
| --- | --- |
| `latest` | Until release 8.0, the newest `8.0.0-rc.N` of every package. From release 8.0, what the release plan gives; see [the user page](./versioning.md#installing-a-version-that-is-not-the-newest-stable-one). |
| `ea`, `preview`, `rc` | From release 8.0, a version below GA of a package that has already had a GA version. |
| `dev` | The development build of every push to `main`. |
| `beta` | Nothing by default. A maintainer can publish a build under it by hand; see [Publishing again](#publishing-again-or-under-beta). |

The old `pr` tag is no longer used. A pull request's preview is published to [pkg.pr.new](https://pkg.pr.new) by [`preview-publish.yml`](../../.github/workflows/preview-publish.yml).

The `prisma` command-line tool is not published from this repository. It comes from [prisma/prisma-cli](https://github.com/prisma/prisma-cli), which publishes its Prisma 8 versions under `latest`.

## Procedure: cut the next release candidate

This is the procedure until release 8.0. Each release candidate is one pull request.

1. **Run the [`publish-npm-version`](../../skills-contrib/publish-npm-version/SKILL.md) skill.** It makes a fresh worktree from `origin/main`, runs `pnpm bump-version`, which raises `8.0.0-rc.N` to the next number, and opens a pull request in your name. The pull request has to be yours, and not a workflow's, because CI does not run on a pull request that a workflow opens.
2. **Let the skill assemble the upgrade guides and draft the release notes.** It gathers the pending upgrade fragments into the application and extension guides and archives the fragments. It then runs the [`draft-release-notes`](../../skills-contrib/draft-release-notes/SKILL.md) skill, which writes `docs/releases/v<version>.md` and the matching `CHANGELOG.md` entry.
3. **Review the guides and the notes, and merge.** If new upgrade fragments arrive before the merge, refresh the guides first. The merge publishes the release under `latest`, creates the GitHub Release, marked as a pre-release, and publishes the matching development build.

A version number is used once. If a publish fails part-way and leaves a number on npm, skip that number.

## Procedure: release 8.0, and every release after it

Release 8.0 is published as `8.0.1`, never `8.0.0`. Every later release starts at patch 0: `8.1.0`, `8.2.0`.

1. Set the root version with `node scripts/set-version.ts 8.0.1`. From `8.0.0-rc.N`, `pnpm bump-version` only raises the release-candidate number, so it cannot do this step. For a later release, `pnpm bump-version` raises the minor, from `8.0.1` to `8.1.0`.
2. Assemble the upgrade guides and commit the release notes, `docs/releases/v8.0.1.md`, as for a release candidate.
3. Merge. The git tag and the GitHub Release are `v8.0.1`. From release 8.0 on, a GitHub Release is not marked as a pre-release, whatever the levels of the packages in it.

Anything on `main` can be released at any time. A fix therefore ships in the next release, which is cut early when the fix cannot wait. The scripts publish no fix to one package alone and no release from a branch other than `main`. If `main` ever stops being releasable at any time, that is the moment to add them.

## Publishing again, or under `beta`

If a publish fails for a temporary reason, such as a registry error, run the `Publish to npm` workflow by hand from `main` with `dist-tag=latest` and `dry-run=false`. It publishes the root version at the current commit again, with the development build.

The same manual run with `dist-tag=beta` publishes a build under `beta`, with no development build. It publishes the root version, so it does nothing for a package whose version is already on npm.

## Procedure: check a change to the release tooling

After changing `publish.yml`, `set-version.ts`, `determine-version.ts` (which works out the development build's version), the publish script, the release plan or a build script, run the `Publish to npm` workflow by hand on your branch with `dry-run` left on, which is the default. It runs `pnpm publish --dry-run` for every package, including `@prisma/orm-extension-paradedb`, and every check except the release-notes check. It publishes nothing, and creates no tag and no GitHub Release.
