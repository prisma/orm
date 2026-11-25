# Maturity levels, version numbers and dependencies between our packages

This is one project of the compatibility work for Prisma 8 general availability (GA). The compatibility work as a whole has one goal: from `8.0.0`, an application built on Prisma 8 upgrades to any later `8.x` release with no changes.

The design for this project was agreed on 2026-11-24. It is the authority, and this spec does not restate it. It is on the branch `ga-compatibility` (draft pull request prisma/orm#31193), under `projects/ga-compatibility/`:

- `designs/6-maturity-versions-and-dependencies.md`: the design.
- `maturity-levels.md`: the four levels.
- `spikes/2026-11-24-one-copy-installs.md`: the install trial behind the dependency arrangement.

To read them: `git fetch bot ga-compatibility`, then `git show FETCH_HEAD:projects/ga-compatibility/<file>`.

## Purpose

A user can tell from their own `package.json` and code which parts of Prisma 8 the compatibility promise covers. Each database reaches GA on its own date.

The packages are numbered, and depend on each other, so that three things hold:

- An application always has one copy of each platform package (the framework, the family, the target and the toolchain).
- An extension built on an earlier release works in an application on a later one.
- A correction to one package ships without a chain of releases across repositories.

## At a glance

Today every package has the same version, names the others at that exact version, and is published under the `latest` tag:

```json
{
  "dependencies": {
    "@prisma/orm-postgres": "8.0.0-rc.25",
    "@prisma/orm-extension-pgvector": "8.0.0-rc.25"
  }
}
```

After this project, at release `8.4`, a PostgreSQL application reads:

```json
{
  "dependencies": {
    "@prisma/orm-postgres": "^8.4.0",
    "@prisma/orm-framework": "^8.4.0",
    "@prisma/orm-family-sql": "^8.4.0",
    "@prisma/orm-target-postgres": "^8.4.0",
    "@prisma/orm-toolchain": "^8.4.0",
    "@prisma/orm-extension-pgvector": "^8.1.0"
  }
}
```

and a MySQL application reads `"@prisma/orm-mysql": "~8.4.0-ea.0"`, which tells its developer that the compatibility promise does not cover MySQL yet.

- The application lists the facade (the package it installs for its database) and every platform package it uses.
- The facade and the extensions name the platform packages as peer dependencies, so they bring no copy of their own.
- A version with no suffix is GA. A suffix says the level: `rc` (Release Candidate), `preview` (Preview) or `ea` (Early Access).
- The major and minor are the release number, shared by every package. The patch number of a GA package, and the counter after the suffix of a package below GA, are that package's own.

## Non-goals

- **The command-line tool's rules.** The design's section 4 (the tool runs with its own copy, accepts what crosses from the project's config by its shape, stops when its major and minor differ from the library's, and reports newer versions) is proposed as a project of its own, also required for GA. See [plan.md](plan.md), "Proposed split". This project changes what the tool's `init` command writes into a new application, and makes sure a package that carries its own toolchain still loads.
- **Checking that a name such as `preview_foo` is used correctly.** Another project of the compatibility work adds a CI check that compares each package's exports with the last release, and that check reads names. This project defines what the name means and documents it.
- **Reducing what the packages export**, and renaming import paths that contain "internal". Another project of the compatibility work does that before any package is GA.
- **What the Supabase extension should be.** The design says an extension is never tied to a facade. The Supabase extension imports the PostgreSQL facade today, and what it should be instead is an open point of the export-reduction project. Here it follows the mechanical rule: the facade becomes a peer of it, and the decision record names it as the one exception. It is Preview, so this can change.
- **A run-time check that reports a value from one copy handed to another.** A ticket for it exists (the design's section 6). The second install trial makes it more useful: see the monorepo limit in [plan.md](plan.md).
- **The page that states the whole compatibility policy for users.** It is written last in the compatibility work, once every part is built.
- **Handing the ParadeDB extension to its team.** The design says it is deleted from this repository before GA. This project numbers it `0.x` while it is here and puts its removal on the `8.0.0` release checklist. Agreeing the handover with the ParadeDB team is not work an agent can do.
- **Changing how Prisma Composer and the control plane depend on these packages**, beyond the one line slice 1 needs. They follow the same rules as any user, in their own repositories.

## Place in the larger world

- **Decision records this project changes.** The record on the published packages (ADR 242) says an application lists one facade and nothing else from us. It rejected listing the platform packages because the user would have to keep the combination right by hand, and getting it wrong gave two copies silently. Under this design the facade's own peer ranges make the package manager check the combination. The record on library integrations (ADR 328) and the record on database drivers (ADR 219) already use a peer dependency for the same reason: the package is visible in the user's own list, and a conflict shows at install time. `docs/oss/versioning.md` lists "independent per-package versioning" as a non-goal, because one version everywhere let one read of the root `package.json` answer "what version is this code?". After this project that read still answers the release number; the level and patch are each package's own.
- **Projects beside this one.** The CI check of each package's exports relies on each package having a level: it fails only on changes to what is GA. A rule agreed in that project on 2026-11-24 applies here: a GA package depends only on GA packages. The export-reduction project reduces exports before any package is GA.
- **Other repositories.** `prisma/web` holds the Prisma 8 docs site. `prisma/prisma-cli` publishes the `prisma` command, which carries its own copy of `@prisma/orm-toolchain`. `prisma/composer` publishes a package that does the same.
- **How the policy comes into force.** Each pull request brings the code change, the check that enforces it and its documentation together, including any decision record. Nothing that describes a part of the policy merges before the code conforms. A part is in force from the first release candidate after it merges. Until `8.0.0` it can still be changed by a deliberate decision.

## Requirements that hold across every slice

1. **One copy for one application, under every package manager.** For every arrangement this project ships, an application installed with npm, pnpm, Yarn (Plug'n'Play and `node_modules`) or Bun has one copy of each platform package, and its facade and an extension receive the same framework object. A packaging test in CI keeps this true under pnpm, which is what the repository's packaging tests use. For the other package managers, each slice that changes a manifest or a range repeats the install trial with the real packed packages, as manual QA, before its pull request is opened.
2. **A GA package of ours depends only on GA packages of ours.** The build fails otherwise. The rule covers the `@prisma/orm-*` packages. The toolchain's peer on `@prisma/cli-engine`, which another repository publishes at `0.x`, is outside it; what that package's status should be is an open point of the export-reduction project.
3. **A level is declared once for each package**, in this repository, and the version, the dependency ranges and the tag all follow from it and from the release number. Nobody writes a range between our packages by hand.
4. **Every pull request passes the same checks a user would hit.** What `prisma orm init` writes, the examples, the package READMEs, the `prisma-8` skill and the upgrade instructions agree with the manifests in the same pull request.
5. **Until `8.0.0` the packages stay at `8.0.0-rc.N` and name each other exactly.** A release candidate may break, so a range between release candidates would promise something false. The ranges are written from `8.0.0`.

## Constraints on the intermediate states

- Between slice 1 and `8.0.0`, the arrangement of who lists whom is the final one, and the versions are still exact. An application on a release candidate after slice 1 lists the platform packages at the same exact version as its facade.
- The release scripts must be able to produce every release candidate between now and `8.0.0` at every commit on `main`. No slice leaves the publish workflow unable to run.
- A package that carries its own toolchain (`prisma`, Composer's package, and this repository's test command) lists the framework before the toolchain stops bringing it.
- Slices 2 and 3 change how versions are computed and not what is published, until the release that cuts `8.0.0`.

## Levels at `8.0.0`

Decided on 2026-11-24:

| Level | Packages |
| --- | --- |
| GA | `@prisma/orm-postgres`, and what it depends on: `orm-framework`, `orm-toolchain`, `orm-family-sql`, `orm-target-postgres`. `orm-extension-pgvector`, `orm-extension-postgis`, `orm-postgres-contrib` (citext), `orm-extension-arktype-json` |
| Preview | `orm-mongo`, `orm-family-mongo`, `orm-target-mongo`, `orm-extension-supabase` |
| Early Access | `orm-mysql`, `orm-target-mysql`, `orm-mariadb`, `orm-target-mariadb`, `orm-sqlite`, `orm-target-sqlite` |
| Numbered `0.x` | `orm-extension-paradedb`, until it is removed from this repository |

Two packages were not named in that decision: `orm-extension-middleware-cache` and `orm-better-auth`. Which level each has at `8.0.0` is the operator's decision and is asked. Until it is answered the project assumes **Preview** for both, the level that claims least: nobody has said that either is finished, which Release Candidate would claim, and GA would put both under the compatibility promise. Changing the answer is a one-line change in slice 2.

MariaDB's packages depend on MySQL's, so MariaDB can never be at a higher level than MySQL.

## Contract impact

None. No contract entity, file format or hash changes.

## Target and adapter impact

No adapter code changes. Every target's published package changes its `package.json`: the platform packages it uses become peer dependencies.

## Decision records

- A new record: how the published packages depend on each other. It amends ADR 242 and updates ADR 328.
- A new record: a maturity level is written in a package's version and an API's name, with one release number. It starts from the draft `ADR 330` on the branch `docs/compatibility-policy-records`, which has three levels and leaves the version numbers undecided; the agreed design has four levels and decides them. It also takes the "No feature flags" section of the draft `ADR 329` on that branch.
- A new record, or a section of the one above: releases and how long a major receives fixes, from the same draft.
- Notes on ADR 017 (its version matrix was never built) and ADR 016 (no feature flags).

## Done when

- A new application made with `prisma orm init`, on each of npm, pnpm, Yarn and Bun, lists the platform packages, installs with no peer warning, and runs a query.
- An application on release `N` with an extension built for release `N-1` installs with one copy of each platform package. Shown with real packed packages at two versions, in CI.
- A dry run of the publish workflow for `8.0.0` prints, for each published package, the version, the ranges and the tag this spec gives it, and prints which earlier release candidates it would mark as deprecated, with the message.
- A dry run for a fix to one GA package publishes that package alone. A dry run for a release on an older major shows that major's own tag and not `latest`.
- The build fails when a GA package is made to name a package below GA. Shown by a test.
- Every label for maturity in this repository's docs and in the Prisma 8 docs site is one of the four levels, and each page that introduces a package says its level.
- The `prisma-8` skill tells a user of `8.0.0` or later that an upgrade within Prisma 8 needs no change, and how to move a package below GA to its next release.
- The docs for extension authors say how to number a package maintained outside this repository, what range to declare, and how an API below GA is named and later renamed.
- `docs/oss/versioning.md` has the procedure for releasing `8.0.0`, including the removal of the ParadeDB extension, and it, `SECURITY.md` and the docs site state how long a major receives fixes.

The command-line tool's rules are not in this list. They are required for GA and belong to the proposed project.

## Open questions

One for the operator: the level of `orm-extension-middleware-cache` and `orm-better-auth` at `8.0.0` (see "Levels at `8.0.0`").

Points the design left to this project, and how each was decided, are in [plan.md](plan.md) under "Decisions made in this project". Two of them are told to the operator when the first pull request is handed over, because they limit what the design promises: the monorepo limit, and that an extension released at a later minor cannot be installed alone into an application on an earlier one.

## References

- The design, the levels and the first trial's record: see the top of this file.
- The policy: `spec.md` on the same branch, sections 4 and 11.
- The second install trial, for packages below GA and for a monorepo: [spikes/2026-11-24-below-ga-and-monorepo-installs.md](spikes/2026-11-24-below-ga-and-monorepo-installs.md).
