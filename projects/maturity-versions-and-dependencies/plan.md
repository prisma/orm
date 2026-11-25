# Maturity levels, version numbers and dependencies: plan

**Spec:** [spec.md](spec.md). Linear project: [Prisma 8 packages: maturity level in the version, one copy of each package](https://linear.app/prisma-company/project/prisma-8-packages-maturity-level-in-the-version-one-copy-of-each-e45eac38628d). The design it implements is on the branch `ga-compatibility`, in `projects/ga-compatibility/designs/6-maturity-versions-and-dependencies.md`.

In this plan, "our packages" means the 22 packages this repository publishes under `@prisma/orm-*`.

## Slices

Four slices, in the order of what cannot be changed after `8.0.0`.

- Who lists whom comes first. Once applications exist that list only a facade, moving the platform packages to peers would break every one of them.
- The suffixes in a version come second. `-ea.0` and `-preview.0` cannot be renamed once a package has been published with them.

| # | Slice | Repository | Builds on | Must merge before |
| --- | --- | --- | --- | --- |
| 1, [TML-3935](https://linear.app/prisma-company/issue/TML-3935) | The application lists the platform packages, and our packages name each other as peers | prisma/orm, with small changes in prisma/prisma-cli, prisma/composer and prisma/web | nothing | the last release candidate |
| 2, [TML-3936](https://linear.app/prisma-company/issue/TML-3936) | Each package declares its level, and its version, ranges and tag follow from it | prisma/orm | 1 | the last release candidate |
| 3, [TML-3937](https://linear.app/prisma-company/issue/TML-3937) | Releasing `8.0.0`, one package alone, and an older major | prisma/orm | 2 | `8.0.0` |
| 4, [TML-3938](https://linear.app/prisma-company/issue/TML-3938) | The levels and each package's level in the Prisma 8 docs site | prisma/web | 2 for the text | published with `8.0.0` |

Slices 1 and 2 are a stack. Slice 4's draft can be written while slice 3 is built.

### 1. The application lists the platform packages, and our packages name each other as peers

**After this slice:** a new application's `package.json` lists the facade and every platform package the facade needs. None of our packages brings a copy of another: each names the others as peer dependencies. Versions are still `8.0.0-rc.N`, written exactly.

**First, in the other repositories.** Three packages carry their own `@prisma/orm-toolchain`: `prisma` (prisma/prisma-cli), `@prisma/composer-prisma-cloud` (prisma/composer) and this repository's test command (`test/prisma-bin`). Today the toolchain brings the framework with it. Once the framework is a peer of the toolchain, each of the three must list `@prisma/orm-framework` itself, or it cannot load under Yarn, which installs no peers. Adding the line is harmless today. So it is added, and released, in prisma/prisma-cli and prisma/composer **before** this slice merges. This matters because a release of this repository starts a `prisma` release automatically.

**Then, in this repository:**

- **Manifests.** Every dependency between two of our packages becomes a peer dependency. The list of who names whom is computed from `packages/0-shared/publish-surface/src/shells.ts`, and `validateShellManifest` in `packages/0-config/tsdown/shell-build.ts` fails the build when a manifest disagrees. That check changes from "one dependency per sibling" to "one peer per sibling, and no dependency on a sibling".
- **`prisma orm init`.** It adds each platform package by name, with the version written out. It reads the names from the peer dependencies of the facade it installed, and follows them until no new `@prisma/orm-*` name appears, so the manifests stay the one list. MariaDB shows why it follows them: its facade names the MySQL facade and the MySQL target, so a MariaDB application lists those too.
- **What follows the manifests.** The examples and apps, the test applications, `test/prisma-bin`, the packaging tests (`facade-tarball`, `extension-tarball`, `orm-better-auth-tarball`, `standin-target`, and the init journey's harness), each package's README, `docs/reference/Package Naming Conventions.md`, the `prisma-8` skill (`quickstart.md`, `build.md`, `upgrade-app.md`, `upgrade-extension.md`, `build-a-target-package.md`), `skills/DEVELOPING.md`, and the sentence in `.agents/rules/use-timeouts-helper-in-tests.mdc` that says an example depends on one facade and nothing else.
- **The check.** A packaging test installs packed packages in an application that lists the facade, the platform packages and an extension, and requires one copy of each platform package. A second case packs one platform package at a different version from the facade and requires the install to report the mismatch. The existing tests of that kind for extensions and for Better Auth stay.
- **Upgrade instructions** for applications (add the platform packages to `package.json`) and for extension authors (move the framework, family and toolchain from dependencies to peers).
- **Decision record.** A new record on how our packages depend on each other. It amends the record on the published packages (ADR 242), whose rule that an application lists one facade it replaces, and the record on library integrations (ADR 328). It names the Supabase extension's peer on the PostgreSQL facade as the one exception to "an extension is never tied to a facade", and records the monorepo limit below.

**With the release candidate that carries it, in prisma/web:** the install instructions of the Prisma 8 docs list the platform packages. The release procedure already opens a prisma/web pull request for each release.

### 2. Each package declares its level, and its version, ranges and tag follow from it

**After this slice:** the release number is `major.minor`. Each of our packages declares its level in one place. One function gives each package its version, the range it writes on each other package, and its tag. Until `8.0.0` is cut the result is what is published today: `8.0.0-rc.N`, exact, under `latest`.

- **Level declaration,** and a build failure when a GA package of ours names a package of ours below GA.
- **Versions.** GA: `X.Y.Z`, with its own patch number. Below GA: `X.Y.0-<level>.<n>`, with its own counter. ParadeDB: `0.x`. A development build, published on every push to `main` under the `dev` tag, keeps today's form: the package's version followed by `-dev.N`, with every package of one build naming the others exactly.
- **Ranges,** written when a package is packed and never by hand: `~X.Y.0` between a facade and the platform packages and among the platform packages; `^X.Y.0` from an extension or a library integration to the platform packages; a tilde on the dependency's own version when the dependency is below GA.
- **Tags.** A GA release goes under `latest`. A release below GA goes under `latest` when the package has never had a GA release, as the design's section 5 says, and under a tag named after its level otherwise.
- **`prisma orm init`** writes a caret for a GA facade and a tilde on every line for a facade below GA.
- **Scripts and checks that assume one version:** `set-version.ts` and its helpers, `determine-version.ts` and its helpers, `bump-version.ts`, `publish-packages.mjs`, `publish.yml`, `check-publish-deps.mjs` (which gains the rule for ranges between our packages), `check-upgrade-coverage.mjs`, `check-release-notes.mjs`, `check-conformance.mjs`, the skill's version stamp, the Supabase extension's version stamp in contracts, and the tests of each.
- **The check.** A dry run of the publish scripts prints a table of package, version, ranges and tag, and a test compares it with a committed expectation for three releases: the next release candidate, `8.0.0` and `8.1.0`.
- **Decision record.** A new record: a maturity level is written in a package's version and an API's name. It holds:
  - the four levels, each defined by the least we do for a package at it (see "Decisions made in this project" for the points the working definitions left open);
  - one release number, the suffix, and each package's own patch number or counter;
  - how a level is written on an API, a command-line flag and a config option, and what happens to the name when the API reaches GA (the design's section 5);
  - no feature flags;
  - how the levels relate to the support categories of prisma/orm#25843: that scale says where the maintainers spend effort on each database, and a level says how finished a package is. Neither decides the other.
  - Notes on the record on extension compatibility (ADR 017, whose version matrix was never built) and on SQL lowering (ADR 016, no feature flags).
- **Docs.**
  - `docs/oss/versioning.md` rewritten for the release number and levels.
  - The glossary gains the levels, "facade" and "platform package".
  - Every maturity label in the repository becomes one of the four levels: "experimental" (ParadeDB and Supabase in `README.md`), "first-class" and "proof of concept" (`README.md`, the skill's migrations reference), "support is early" (six MySQL and MariaDB files), "release candidate" as a label for one package (Better Auth).
  - For extension authors, in the `prisma-8` skill and the extension docs: how to number a package maintained outside this repository and what range to declare (the design's section 1.2), and that a package using an API below GA declares a range within one minor.
  - The capability docs say a capability has the level of the package that publishes it.
- **Five corrections that are true today** ride along: the capability stability scheme that was never built comes out of the Ecosystem subsystem doc and `docs/reference/capabilities.md`; the note on ADR 017; "early-access install" in `docs/oss/versioning.md`; the pin bullet that names an unpublished package; "prototype" in the decision record index and `AGENTS.md`.

### 3. Releasing `8.0.0`, one package alone, and an older major

**After this slice:** a maintainer can cut `8.0.0`, release a fix to one package, and release a fix to an older major, each with one command and a dry run that shows what will be published.

- **Cutting `8.0.0`** and any later minor or major, from the release skill.
- **Packages that move down from `rc`** (the design's section 2.1): at `8.0.0` each is published at its level, and every earlier release candidate of it is marked deprecated on the registry with a message that says where the package went. The trial showed that Yarn and Bun do not print that message, so the release notes and the upgrade instructions say it too.
- **A fix to one package:** its patch number or counter rises, it alone is published, and the release notes say which package.
- **A release of an older major always names its own tag,** so it cannot take `latest` back.
- **Upgrade skills.** From `8.0.0`, the `prisma-8` skill says an upgrade within Prisma 8 needs no change, keeps the per-release instructions for the release candidates only, and says how a user of a package below GA moves to the next minor, including what their lines should read after their package manager has rewritten them. `check-upgrade-coverage.mjs` stops requiring a guide for every release after `8.0.0`.
- **The procedure for releasing `8.0.0`** in `docs/oss/versioning.md`, with the list of docs to rewrite on that day and the removal of the ParadeDB extension from the repository. A draft exists on the branch `docs/compatibility-policy-records`.
- **How long a major receives fixes:** fixes go to the latest minor; the previous major receives critical and security fixes for 12 months after a new major. Recorded in a decision record, from the draft on the same branch, and stated in `SECURITY.md` and `docs/oss/versioning.md`. Prisma 7 keeps the 18 months already promised for it; the 12 months apply from Prisma 8 on.
- **The check.** Dry runs, in CI, of: `8.0.0`; a fix to one GA package; a fix to one package below GA; a release on an older major.

### 4. The levels and each package's level in the Prisma 8 docs site

**After this slice:** the Prisma 8 docs have a page that defines the four levels and says how to read one from a version and a name. Every page that introduces a database or an extension says its level. The five undefined labels used there today are gone. A short section says what a user of a package below GA does at each new minor, and that a monorepo keeps its applications on one minor unless its package manager keeps each workspace's packages apart. The page also states how long a major receives fixes.

It is a pull request in prisma/web. It is written from the decision records of slices 1 and 2 and published with `8.0.0`.

## Proposed split: the command-line tool's rules as their own project

The design's section 4 is the size of a project and is better run as one:

- **In prisma/orm:** the tool compares its own major and minor with the library installed in the project and stops when they differ. What crosses from the project's config file into the tool is accepted by its shape. Today some values are recognised by which copy of the framework made them: a literal default value carries a private field, and a release candidate once failed on exactly this. The docs currently tell users the tool and the application must share one copy. Finding every such value and changing how it is recognised is an investigation of its own.
- **In prisma/prisma-cli:** the `prisma` package takes the release number's major and minor, names the toolchain with a same-minor range, and reports newer versions within the ranges the user has written. Today a `prisma` release follows only a release of the toolchain, so the project also decides what follows a fix to another package.

It is required for GA. Once packages have their own patch numbers, the tool and the library will often be different copies. And the number `prisma` takes at `8.0.0` cannot be changed once published. It builds on slice 2 of this project, and touches the same line of the `prisma` manifest as slice 1's change there.

## Other repositories

- **prisma/prisma-cli:** the framework line before slice 1, and the proposed project above.
- **prisma/composer:** the framework line before slice 1. Composer can move from exact versions to ranges after `8.0.0`; a ticket records it, and it is not part of this project.
- **prisma/web:** the install instructions with slice 1, and slice 4.

## Releases this depends on

- A `prisma` release and a Composer release that list the framework, before slice 1 merges.
- Slice 1 reaches users in the first release candidate after it merges.
- Slices 2 and 3 change nothing a user sees until `8.0.0`.

## Decisions made in this project

The design left these to the project. Each is recorded in the pull request of the slice that builds it.

| Point | Decision | Why |
| --- | --- | --- |
| How the platform packages name each other | As peers | The trial: as ordinary dependencies they gave two copies under Bun and Yarn |
| How an application on a facade below GA writes its lines | A tilde on every line | The trial: the only form that stayed consistent under every package manager |
| Who writes the ranges in a new application | `prisma orm init`, explicitly | The trial: pnpm writes an exact version for a pre-release, and Yarn installs no peers |
| Ranges before `8.0.0` | Exact, as today | A release candidate may break, so a range between release candidates would promise something false |
| Which package carries a database's level | Both the facade and the target package, at the same level | A GA package depends only on GA packages, so a facade cannot be above its target |
| The framework's level | GA, with the PostgreSQL facade | It is what the PostgreSQL facade depends on |
| Which release a failing test blocks | While our packages are released together, a failing test of a GA, Release Candidate or Preview package blocks the release of all of them. Early Access is the one level at which we may release with a failing test; CI does not have to allow it | A level is the least we do. Today every test blocks, which meets every level |
| Who decides what a Preview package supports | The maintainers, in the list its reference documentation carries | The working definition already requires that list |
| Release Candidate for a single API | `rc_foo`, by the same rule as `preview_foo` | One scale and one way of writing it |
| The Supabase extension's dependency on the PostgreSQL facade | Becomes a peer, named as an exception | See the spec's non-goals |
| Prisma 7's support period | Stays at 18 months after `8.0.0` | Already promised in `SECURITY.md` and the record on Prisma 7. The 12 months are the rule from Prisma 8 on |

Two findings of the trial limit what the design promises. Both are told to the operator when slice 1 is handed over:

- **A monorepo with applications on different minors.** Under npm workspaces and Bun's hoisted linker, an extension that both applications use is placed once, beside one application's platform packages, and the other application then has two copies with no warning. No arrangement of ranges changes where a package manager places a package. The docs say to keep the applications of a monorepo on one minor, or to use a package manager that keeps each workspace's packages apart. The run-time check the design's section 6 mentions would turn the silent case into an error.
- **An extension released at a later minor.** Our own extensions are released with every release, so `orm-extension-pgvector@8.5.0` declares `^8.5.0`. An application on `8.4` that updates that extension alone gets a refused install under npm and a warning elsewhere. The user updates the platform packages too.

## Close-out

- [ ] Check every "Done when" condition in [spec.md](spec.md) with fresh evidence.
- [ ] The decision records are in `docs/architecture docs/adrs/` (they merge with their slices).
- [ ] Move the trial record's lasting findings into `docs/oss/versioning.md` and the extension-author docs.
- [ ] Remove references to `projects/maturity-versions-and-dependencies/`, then delete the folder.
