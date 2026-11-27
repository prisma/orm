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

## Procedure: a release after release 8.0

From release 8.1 on, a release is one pull request.

1. **Run the [`publish-npm-version`](../../skills-contrib/publish-npm-version/SKILL.md) skill.** It makes a fresh worktree from `origin/main`, runs `pnpm bump-version`, which raises the minor, from `8.0.1` to `8.1.0`, and opens a pull request in your name. It has to be yours, and not a workflow's, because CI does not run on a pull request that a workflow opens. The packages that share the release's numbering are published at patch 0.
2. **Let the skill assemble the upgrade guides and draft the release notes.** It gathers the pending upgrade fragments into the guide for application authors and the guide for extension authors, and writes `docs/releases/v<version>.md`, where `<version>` is the root version. When a release has no fragments, the skill still writes both guides, each with an empty list of changes. The upgrade flow that users' agents follow reads its steps from the guide folders, so every release needs one.
3. **Review the guides and the notes, and merge.** If new upgrade fragments arrive before the merge, refresh the guides first. The merge publishes the release and creates the git tag and the GitHub Release, both `v<version>`.
4. **If the publish fails part-way, run it again,** as [Publishing again](#publishing-again-or-under-beta) describes. A package that is already on npm at its version is left alone. Do it before anything else merges to `main`: the run publishes from the newest commit of `main`, so a later change would go out in the packages that were still missing. Do not move to another version number.

Anything on `main` can be released at any time. A fix therefore ships in the next release, which is cut early when the fix cannot wait. The scripts publish no fix to one package alone and no release from a branch other than `main`. If `main` can no longer be released at any time, that is the moment to add such scripts.

## Procedure: release 8.0

Release 8.0 is cut once. It differs from every other release in three ways:

- **It is published as `8.0.1`, and no package is ever `8.0.0`.** The packages that are not finished get a version such as `8.0.1-ea.0`. With `8.0.0-ea.0` they would sort below the `8.0.0-rc.N` versions already on npm, and package managers would keep installing an old release candidate. All packages of a release share its first two numbers and its starting patch, so the finished ones are `8.0.1` too. [ADR 330](../architecture%20docs/adrs/ADR%20330%20-%20A%20maturity%20level%20is%20written%20in%20a%20package's%20version%20and%20an%20API's%20name.md#release-80-starts-at-patch-1) has the details.
- **The packages stop sharing one version.** Each gets the version of its maturity level: `8.0.1` for a package that is Generally Available (GA), and `8.0.1-ea.0` for one at Early Access. [The user page](./versioning.md#maturity-levels) says what the levels mean.
- **An update does not get a user there.** Until release 8.0, users are told to list every Prisma package at one exact version, such as `8.0.0-rc.25`. An exact entry in `package.json` never moves. A user whose entries have a caret, which is what npm writes, is worse off: an update moves the GA packages to `8.0.1` and leaves an Early Access package on its release candidate, because `^8.0.0-rc.25` does not accept `8.0.1-ea.0`. So every user edits their entries by hand, once, and the release notes tell them what to write.

Do the steps in this order.

**Before the release pull request**

1. **Check what will be published.** Run `node scripts/print-release-plan.ts 8.0.1`. It prints a table with one row per package: its level, its version, its npm tag, and the ranges it writes on our other packages. That table is what the release publishes. No package has had a GA version yet, so the command needs no `--ever-ga` option.
2. **Be sure of every level, because GA cannot be taken back.** A package published as GA stays GA for all of Prisma 8: the release plan refuses to lower it. The levels in `levels.ts` are the ones decided so far. If the maintainers decide that one is wrong, change it in a pull request of its own, and merge that first. Lowering a package can force others down, because a GA package may not depend on one of ours that is below GA. The pull request changes:
   - the package's entry in [`levels.ts`](../../packages/0-shared/publish-surface/src/levels.ts);
   - the level and the install commands in the package's README, which `pnpm lint:docs` checks against `levels.ts`;
   - the table under [Which packages are at which level](./versioning.md#which-packages-are-at-which-level), and "Supported databases" or "For extension authors" in the root [`README.md`](../../README.md);
   - the expected tables in `scripts/fixtures/release-plan/`: `root.txt`, `8.0.1.txt` and `8.1.0.txt`. A test compares each with the command's output, so paste the new output in;
   - the levels pinned in `packages/0-shared/publish-surface/test/levels.test.ts`.

   Then run step 1 again.
3. **Note what happens to `@prisma/orm-extension-paradedb`,** for the release notes of step 5. It has version numbers of its own, and the table shows it as `0.18.0`, under `latest`. That is lower than the `8.0.0-rc.N` versions it has on npm today, so no update reaches it: its users change their entry to `^0.18.0`. If the package has been removed from this repository by then, it is not in the table, and the notes say who publishes it now.

**The release pull request**

4. **Run the [`publish-npm-version`](../../skills-contrib/publish-npm-version/SKILL.md) skill.** Its steps 1 and 3 say what is different for release 8.0: the target version is `8.0.1`, set by hand, and `node scripts/set-version.ts 8.0.1` replaces `pnpm bump-version`, which from `8.0.0-rc.N` can only raise the release-candidate number. The rest of the skill is unchanged. It assembles both upgrade guides for the step from the last release candidate to release 8.0, drafts `docs/releases/v8.0.1.md`, and opens the pull request in your name.
5. **Put the new `package.json` entries in the release notes, for every user.** An application lists the package for its database, its extensions, and the platform packages its database package is built from: `@prisma/orm-framework`, `@prisma/orm-toolchain`, a family package and a target package. [The user page](./versioning.md#what-an-application-writes) shows the full set. The notes say what each entry becomes, using each package's real level from the table of step 1; the levels in the examples below are today's:
   - with a GA database, a caret on every GA package: `"@prisma/orm-postgres": "^8.0.1"`;
   - with a database at Early Access, a tilde on every entry: `"@prisma/orm-mysql": "~8.0.1-ea.0"` for the Early Access packages and `"@prisma/orm-framework": "~8.0.1"` for the GA ones, as [the user page](./versioning.md#a-new-minor-below-ga) explains;
   - an Early Access extension in an application with a GA database gets a tilde, `"@prisma/orm-extension-supabase": "~8.0.1-ea.0"`, and the other entries keep their carets;
   - `"@prisma/orm-extension-paradedb": "^0.18.0"`.

   Name the packages that are at Early Access. The notes are where every user learns this. The message of step 8 reaches fewer: npm and pnpm print it, and in our trials Yarn and Bun printed nothing.
6. **Rewrite the pages that say Prisma 8 is a release candidate.** Search the repository for `release candidate`, `8.0.0-rc`, `8.0.0 final`, `until release 8.0` and `from release 8.0`, ignoring case, and correct every page a user or a contributor reads. Leave these as they are: the old release notes under `docs/releases/`, `CHANGELOG.md`, the upgrade guides under `skills/prisma-8/upgrading/`, the decision records, and this page, which step 9 deals with. The pages below are the main ones; the search finds more, among them the references of the `prisma-8` skill, which ship inside the packages.

   | File | What to change |
   | --- | --- |
   | [`README.md`](../../README.md) | Remove the "Prisma 8 is a release candidate" note. Under "Supported databases" and "For extension authors", say what each level is now, not what it will be "from release 8.0". |
   | [`docs/oss/versioning.md`](./versioning.md) | Remove the section "Until release 8.0" and the link to it under "Supported versions". Rewrite every "until release 8.0" and "from release 8.0" as what is true now. Keep the headings that other pages link to. |
   | [`SECURITY.md`](../../SECURITY.md) | Rewrite "Supported versions": remove the release-candidate paragraphs and state what [the user page](./versioning.md#supported-versions) states. |
   | [`CONTRIBUTING.md`](../../CONTRIBUTING.md) | Rewrite "Status — please read first" and the later mention of the release-candidate line. |
   | [`docs/oss/governance.md`](./governance.md) | Remove or rewrite "Release-candidate status". |
   | [`.github/ISSUE_TEMPLATE/bug_report.yml`](../../.github/ISSUE_TEMPLATE/bug_report.yml) | It asks for "the latest release candidate", mentions "`8.0.0` final", and its example version is `8.0.0-rc.1`. |
   | The README of every package under `packages/9-public/@prisma/` | The note at the top says how the package is published "until release 8.0". The five database packages also give the install rule for release candidates. |
   | The [`publish-npm-version`](../../skills-contrib/publish-npm-version/SKILL.md) and [`draft-release-notes`](../../skills-contrib/draft-release-notes/SKILL.md) skills | Their introductions describe release candidates only. Say that a release is now a minor of Prisma 8. |

7. **Do a dry run, then merge.** First commit and push the edits of steps 5 and 6, so that the branch on GitHub is what will be merged. Then run the `Publish to npm` workflow by hand on the release branch with its inputs left as they are: `dist-tag` is `latest` and `dry-run` is on. It publishes nothing. In its log, the step that sets the versions lists every package with its version. The publish step prints the tag once at its start, and prints a package's own tag only when it is a different one. Check that the versions are those of the table from step 1, and that no package shows a tag of its own: every tag in that table is `latest`. Then merge the pull request, which publishes the release. If the publish fails part-way, run it again as [Publishing again](#publishing-again-or-under-beta) describes, before anything else merges to `main`: a package that is already on npm at its version is left alone. Release 8.0 stays `8.0.1`.

**After the publish**

8. **Mark the old release candidates as deprecated,** so that a user who is still on one is sent to the release notes. Nothing depends on this step: `8.0.1` and `8.0.1-ea.0` already sort above every `8.0.0-rc.N`. The publish workflow does not do it. Someone with rights on the `@prisma` packages on npm runs this once for each package in the table of step 1, with the same message every time:

   ```bash
   npm deprecate "@prisma/orm-mysql@>=8.0.0-rc.0 <8.0.0" "Prisma 8.0 is released, and this release candidate is no longer maintained. The release notes say what to write in package.json: https://github.com/prisma/orm/releases/tag/v8.0.1"
   ```

   The range matches every `8.0.0-rc.N` and the development builds made from them, and no other version.
9. **In the next pull request, remove this procedure** and "Procedure: cut the next release candidate" from this page, and the "until release 8.0" half of each of this page's other sections. Remove the two sentences about release 8.0 from steps 1 and 3 of the `publish-npm-version` skill in the same pull request, because one of them links to this procedure.

## Publishing again, or under `beta`

If a publish fails for a temporary reason, such as a registry error, run the `Publish to npm` workflow by hand from `main` with `dist-tag=latest` and `dry-run=false`. It publishes the root version at the current commit again, with the development build. Run it before anything else merges to `main`. The run uses the newest commit of `main`, and a package that is already on npm is left alone, so after a later merge the packages that were still missing would be published from different code than the rest.

The same manual run with `dist-tag=beta` publishes a build under `beta`, with no development build. It publishes the root version, so it does nothing for a package whose version is already on npm.

## Procedure: check a change to the release tooling

After changing `publish.yml`, `set-version.ts`, `determine-version.ts` (which works out the development build's version), the publish script, the release plan or a build script, run the `Publish to npm` workflow by hand on your branch with `dry-run` left on, which is the default. It runs `pnpm publish --dry-run` for every package, including `@prisma/orm-extension-paradedb`, and every check except the release-notes check. It publishes nothing, and creates no tag and no GitHub Release.
