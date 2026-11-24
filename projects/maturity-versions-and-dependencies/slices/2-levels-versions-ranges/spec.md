# Slice 2: each package declares its level, and its version, ranges and tag follow from it

Linear: [TML-3936](https://linear.app/prisma-company/issue/TML-3936). Project: [spec](../../spec.md), [plan](../../plan.md). Builds on slice 1, on a branch stacked on it.

"Our packages" means the packages this repository publishes under `@prisma/orm-*`.

## At a glance

One function answers, for a release, what each package is published as. For release `8.1`, with the levels decided for `8.0.0`:

```text
package                          level     version           tag      names @prisma/orm-framework as
@prisma/orm-framework            ga        8.1.0             latest   -
@prisma/orm-postgres             ga        8.1.0             latest   ~8.1.0
@prisma/orm-extension-pgvector   ga        8.1.0             latest   ^8.1.0
@prisma/orm-mongo                preview   8.1.0-preview.0   latest   ~8.1.0
@prisma/orm-mysql                ea        8.1.0-ea.0        latest   ~8.1.0
@prisma/orm-extension-paradedb   own       0.1.0             latest   ^8.1.0
```

and `@prisma/orm-mysql` names its own target, which is below GA, as `~8.1.0-ea.0`.

While the root version is an `8.0.0-rc.N`, the same function gives what is published today: every package at `8.0.0-rc.N`, every range that exact version, every tag `latest`. So this slice changes how the answer is computed and not what is published.

## Behaviour

1. **Levels are declared in one place.** A module in `packages/0-shared/publish-surface` maps every published package name to `ga`, `rc`, `preview` or `ea`, or to `own-version` for a package numbered outside the release number (ParadeDB). A test fails when a published package has no entry, or an entry names a package that is not published.
2. **A GA package of ours names only GA packages of ours.** Checked by a test over the declaration and the manifests, and by the build. A package may name a package at its own level or a higher one: so MariaDB cannot be above MySQL, and a facade cannot be above its target.
3. **One pure function plans a release.** Input: the release number (`major.minor`), each package's current version, the levels, and whether the release line is still the `8.0.0` release candidates. Output for each package: its version, its tag, and the range it writes on each of our packages it names.
   - **Version.** GA: `X.Y.Z`. A new minor resets the patch to 0; within a minor the package keeps its own patch. Below GA: `X.Y.0-<level>.<n>`, the counter starting at 0 in each minor. `own-version`: the package's own version, untouched.
   - **Range on a package inside the set** (a facade or a platform package naming a platform package or a facade): a tilde on the minor, `~X.Y.0`. When the named package is below GA: a tilde on that package's first version of the minor, `~X.Y.0-<level>.0`.
   - **Range from an extension or a library integration** to anything of ours: a caret, `^X.Y.0`, or `^X.Y.0-<level>.0` when the named package is below GA.
   - **Tag.** A GA release: `latest`. A release below GA: `latest` when the package has never had a GA release, and the level's own name (`rc`, `preview`, `ea`) otherwise. `own-version`: `latest`.
   - **On the release-candidate line** (root version `8.0.0-rc.N`): every package `8.0.0-rc.N`, every range exactly that, every tag `latest`.
   - **A development build** (`-dev.N`): every package's planned version followed by `-dev.N`, every range exact, tag `dev`.
4. **The scripts use the plan.** `scripts/set-version.ts` writes each package's version and each `workspace:` specifier from the plan (`workspace:~8.1.0`, `workspace:^8.1.0`, `workspace:8.0.0-rc.26`), which pnpm publishes as written. `validateShellManifest` and `scripts/check-publish-deps.mjs` require the specifier the plan gives. `scripts/publish-packages.mjs` publishes each package under its own tag. Private workspace packages, examples and apps keep following the root version.
5. **Everything that parses a version understands the four suffixes**: `determine-version` and its dev-build counter, `check-upgrade-coverage`, `check-release-notes`, the release-tag patterns, the `--prerelease` flag of the GitHub Release.
6. **`prisma orm init` writes a range that suits the level.** When the target package's installed version is a plain version, a caret on every `@prisma/orm-*` line. When it has a `-rc`, `-preview` or `-ea` suffix other than the `8.0.0-rc.N` line, a tilde on every line. On the `8.0.0-rc.N` line, the version as today.
7. **Docs and the decision record** (see the project plan, slice 2): the record on maturity levels; `docs/oss/versioning.md`; the glossary; every maturity label; the extension-author docs; the five corrections.

## Checks

- Unit tests of the plan for: `8.0.0-rc.26` (today's output), `8.0.0` (the first release with levels, including the packages that move down from `rc`), `8.1.0`, a fix to one GA package within `8.1`, a fix to one package below GA, a package that becomes GA at `8.2` after being Preview at `8.1`, and a development build of each.
- A test that runs the scripts in dry-run mode against the real workspace and compares the printed table (package, version, tag, each range) with a committed expectation for `8.0.0-rc.26`, `8.0.0` and `8.1.0`.
- A test that the plan for the current root version equals what is in the committed manifests, so the scripts and the manifests cannot drift.
- `init` tests for a GA, a Preview and a release-candidate-line target package.

## Out of scope

- Cutting `8.0.0`, releasing one package alone, deprecating the old release candidates, an older major's tag: slice 3. The plan function can express them; the commands and the workflow steps come then.
- The command-line tool's version check.

## Edge cases

| Case | Required behaviour |
| --- | --- |
| The root version is `8.0.0-rc.N` | Output identical to today's, byte for byte in every published manifest |
| A below-GA package names a GA package | `~X.Y.0`, as a GA package would |
| An extension below GA | Caret ranges, like a GA extension |
| `orm-mariadb` (Early Access) names `orm-mysql` (Early Access) | `~X.Y.0-ea.0` |
| The Supabase extension (Preview) names `orm-postgres` (GA) | `^X.Y.0` |
| A level is declared for a package that names a lower-level package | The build fails and says which pair |
| A version with an unknown suffix reaches a script | The script stops and names the version, as it does today for an unknown release line |

## Done when

- The checks above pass, with `pnpm build`, `pnpm test:scripts`, `pnpm check:publish-deps` and `pnpm check:conformance`.
- A dry run of the publish workflow's steps on the branch, for the current root version, prints today's versions, ranges and tags.
