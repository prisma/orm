# Hand-over: what the public docs on prisma.io must say (from project 6: maturity levels, versions, dependencies)

Written by keithrichards-58 on 2026-11-27. Project 6 no longer writes these docs. Two other owners do: project 12 of the compatibility stream (the versioning and compatibility policy on prisma.io) and stream 5 of the GA plan (the ORM's product docs in prisma/web).

Every statement below has its source on `main` of prisma/orm. Take the wording from the source, not from this note. This note is a list of what must be covered and where to read it.

## Part A: what an application installs (stream 5, the product docs)

Applies from the first release that contains prisma/orm#31204. Every page that tells a user what to install or what their `package.json` looks like is affected: the install step, the quick start, the upgrade guide from Prisma 7, and any `package.json` sample.

1. An application's `package.json` lists the package for its database (for example `@prisma/orm-postgres`) and also each platform package that one is built from: `@prisma/orm-framework`, a family package (`@prisma/orm-family-sql` or `@prisma/orm-family-mongo`), a target package (`@prisma/orm-target-<database>`) and `@prisma/orm-toolchain`.
   Source: `docs/oss/versioning.md`, section "What an application writes"; decision record `docs/architecture docs/adrs/ADR 329 - An application lists the platform packages and our packages name each other as peers.md`.
2. Why: so the application has exactly one copy of each. With two copies Prisma fails at run time with the error `RUNTIME.MULTIPLE_ORM_COPIES`.
   Source: ADR 329, the sections on why two copies break; `docs/reference/error-reference.md`, the entry for that error.
3. `prisma orm init` writes those lines. A user does not work them out by hand. A user who installs by hand must add them, because Yarn installs no peer dependencies and pnpm writes an exact version for a pre-release.
   Source: `docs/oss/versioning.md`, "What an application writes"; the CLI README's "Required peers" section (`packages/1-framework/3-tooling/cli/README.md`).
4. An application imports only from the package for its database. It never imports a platform package in a file it owns.
   Source: `skills/DEVELOPING.md`, the principle on import paths.
5. The `prisma` command-line tool has its own version numbers and is not part of the ORM's release number.
   Source: `docs/oss/versioning.md`, "The `prisma` command-line tool"; ADR 329, the section on the tool.
6. A monorepo whose applications are on different Prisma releases can still get two copies under the workspaces of Node's default package manager and under Bun's hoisted linker.
   Source: ADR 329, "Consequences".

## Part B: maturity levels and versions (project 12, the policy page), to publish with release 8.0

`docs/oss/versioning.md` is written as a user page and is the authority. Its sections map one to one onto what the public page needs:

1. Supported versions, and how long a major gets fixes (the previous major: critical and security fixes for 12 months after a new major; Prisma 7: 18 months after release 8.0). Section "Supported versions". `SECURITY.md` does not say this yet.
2. Until release 8.0 every release candidate may break. Section "Until release 8.0".
3. Version numbers: the major and minor are the release; the patch belongs to each package; release 8.0 is published as `8.0.1`. Section "Version numbers". Reason for `8.0.1`: decision record ADR 330, section "Release 8.0 starts at patch 1".
4. The four maturity levels (Early Access, Preview, Release Candidate, Generally Available) and what each promises. Section "Maturity levels".
5. Which package is at which level at release 8.0. Section "Which packages are at which level". The source of truth in code is `packages/0-shared/publish-surface/src/levels.ts`; check the page against it on the day, because levels change there first. No package is Preview at release 8.0.
6. A single function can be below its package's level, shown by its name (`preview_search`, `ea_search`, `rc_search`). Section "A function can be below its package's level"; ADR 330, the sections on names.
7. What stays compatible within a major, and the four exceptions. Section "What stays compatible".
8. What a user does at a new release: a GA database updates as usual (carets); a database below GA has a tilde on every line and the user edits the lines by hand at each minor, because package managers' update commands get this wrong. Sections "A GA database: update as usual", "A new minor below GA", "An extension below GA in a GA application".
9. Registry tags: `latest`, and `ea`, `preview`, `rc` for a version below GA of a package that has had a GA version; `dev` for builds of `main`. Section "Installing a version that is not the newest stable one".
10. For extension authors: how to number a package and which ranges to declare. Section "For extension authors"; `skills/prisma-8/references/upgrade-extension.md`, its last section.
11. A fix ships in the next release; no fix is published to one package alone. This is decided (2026-11-27) and is on the branch `tml-3937-cut-release-8-0-1` of prisma/orm, not yet on `main`. Until it lands, `versioning.md` on `main` still says a fix raises a package's patch number.

## Not decided here

How a command of the `prisma` tool shows that it is unfinished belongs to the CLI's own design, not to these pages.
