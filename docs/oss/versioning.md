# Versions and support

This page is for people who use Prisma ORM, and for people who publish extensions for it. It says which versions are supported, what a version number tells you, what will not break when you upgrade, and how to upgrade. Maintainers will find the release procedures in [Releasing](./releasing.md).

## Supported versions

| Version | What it receives | Until |
| --- | --- | --- |
| Prisma 8 | New features and all fixes, in the newest release only | The current major |
| Prisma 7 | Fixes for bugs and security issues, and no new features from the maintainers | 18 months after release 8.0 is published |

- **Prisma 8** is where development happens. It has not reached release 8.0 yet; until it does, read [Until release 8.0](#until-release-80) first.
- **Prisma 7** is in maintenance. Its source is on the [`v7` branch](https://github.com/prisma/orm/tree/v7), and pull requests for it target that branch. The maintainers build no new features for it. A feature contributed by the community can still be accepted if it fits Prisma 7's design. [ADR 295](../architecture%20docs/adrs/ADR%20295%20-%20New%20features%20do%20not%20land%20on%20Prisma%207.md) has the details.

From Prisma 8 on, these rules apply to every major version:

- **Fixes go into the newest release.** To get a fix, upgrade to it. Within a major that is always safe for what is Generally Available; see [What stays compatible](#what-stays-compatible).
- **When a new major is published, the previous one receives critical fixes and security fixes for 12 more months.**
- **We aim for one new major a year.** That is an aim, not a promise.

[`SECURITY.md`](../../SECURITY.md#supported-versions) says how to report a vulnerability and which versions receive security fixes. [Supported versions of Node.js, TypeScript and each database](../Supported%20Versions.md) are on their own page.

## Until release 8.0

Prisma 8 has not had its first stable release. Today every package is published as `8.0.0-rc.1`, `8.0.0-rc.2` and so on, and all of them share that one version.

- **Any of these versions may contain breaking changes.** Nothing on the rest of this page applies yet.
- **Only the newest one is maintained.** A fix ships in the next one.
- **Each one comes with an upgrade guide,** which the `prisma-8` agent skill can apply for you.
- **List every Prisma package at the same exact version,** such as `8.0.0-rc.25`, with no `^` or `~`.

The `rc` in these versions is a leftover name. It is not the Release Candidate level described below: a package published as `8.0.0-rc.25` may be far from finished.

If your project cannot keep up with breaking changes, wait for release 8.0.

## Maturity levels

From release 8.0, every Prisma package has one of four maturity levels. The level tells you how far you can rely on the package.

| Level | Its version looks like | What you can rely on |
| --- | --- | --- |
| Generally Available (GA) | `8.3.0` | No later 8.x release breaks your code. Its tests pass on every release. |
| Release Candidate | `8.3.0-rc.0` | We believe it is finished. One more breaking change is possible before it becomes GA. |
| Preview | `8.3.0-preview.0` | It works and is tested for the features it supports, and its documentation lists what it does not support yet. Any new version may change it. |
| Early Access | `8.3.0-ea.0` | It is published so that you can try it. It may have known failures, and any new version may change it. |

"Below GA" means any of the last three. Only what is GA is covered by [What stays compatible](#what-stays-compatible).

### Which packages are at which level

At release 8.0:

| Level | Packages |
| --- | --- |
| Generally Available | PostgreSQL: `@prisma/orm-postgres` and the packages it is built from. The PostgreSQL extensions `@prisma/orm-extension-pgvector`, `@prisma/orm-extension-postgis`, `@prisma/orm-extension-arktype-json` and `@prisma/orm-postgres-contrib`. `@prisma/orm-extension-middleware-cache`. `@prisma/orm-better-auth`. |
| Early Access | MongoDB (`@prisma/orm-mongo`), MySQL (`@prisma/orm-mysql`), MariaDB (`@prisma/orm-mariadb`), SQLite (`@prisma/orm-sqlite`), and the packages each is built from. `@prisma/orm-extension-supabase`. |

No package is at Preview or Release Candidate yet. Each package's README states its level, and a check keeps the READMEs and this table's source, [`levels.ts`](../../packages/0-shared/publish-surface/src/levels.ts), in step.

One package has no level: `@prisma/orm-extension-paradedb` is maintained by another team and has its own version numbers, starting at `0.18.0`.

### A function can be below its package's level

A GA package can contain a function that is not finished. Its name starts with its level, so you can see it where you call it:

```ts
db.orm.users.where({ email }).first()   // GA
db.orm.users.preview_search('ada')      // Preview: may still change
```

The level words are `ea_`, `preview_` and `rc_`. A type or class is written `Preview_Search`.

When such a function moves up a level, it gets a new name, and the old name keeps working until the next major version:

```ts
db.orm.users.ea_search('ada')        // release 8.3: Early Access
db.orm.users.preview_search('ada')   // release 8.4: now Preview. ea_search still works.
db.orm.users.search('ada')           // release 8.6: now GA. Both older names still work.
```

So your code does not break when a function you use becomes more reliable. Your editor shows the old names as deprecated and tells you the new one. The one exception is a promotion that also changes how the function is called: then the old name is removed in that release.

## What stays compatible

**From release 8.0, an application built on what is GA upgrades to any later 8.x release with no changes:** none to its code, none to the files Prisma generated for it, and none to its database. The same holds for an extension built on the GA platform packages.

Within a major version, this covers:

| What | The promise |
| --- | --- |
| The TypeScript API: types and import paths | Code that compiles against one release compiles against every later one. |
| Behaviour and error codes | Behaviour that the reference documentation describes does not change. |
| The contract you write, in PSL or TypeScript | A contract that one release accepts, every later release accepts. |
| Commands, their machine-readable output, and the config file | What works on one release works on every later one. |
| `contract.json` and the generated types | Every later release reads them. You do not have to generate them again. |
| Migrations on disk | Every later release reads and applies them. |
| Prisma's own records in your database | Every later release reads them. |

Nothing that is GA is removed within a major. When something is replaced, the replacement arrives beside it, and the old form is marked deprecated and keeps working until the next major.

A later release may still change four things. If your application depends on one of them, it may need a change after an upgrade:

- **A bug.** Behaviour that contradicts the reference documentation, or a defect such as a crash, is fixed.
- **Detail the reference documentation does not describe:** the text of the SQL Prisma sends, the order of rows when you gave no `orderBy`, the wording of an error message, output meant for people to read, and timing.
- **A security problem.** It is fixed even when that changes described behaviour, and the fix comes with a published notice.
- **A version of something Prisma runs on that its maker no longer supports,** such as an old Node.js version. A minor release may stop supporting it, and the release notes say so. Otherwise a minimum version rises only in a new major.

Every release's notes list each change to behaviour.

## Version numbers

A version has three parts: major, minor and patch, as in `8.3.1`.

- **The major and minor are the release.** Release `8.3` publishes every package at `8.3`. Two packages belong together when their first two numbers match.
- **The rest belongs to each package.** A fix to one GA package is published as that package's next patch, such as `8.3.1`. A package below GA has its level and a counter after the version, and a fix raises the counter: `8.3.0-ea.0`, then `8.3.0-ea.1`.
- **Release 8.0 starts at `8.0.1`.** Its first versions are `8.0.1` for a GA package and, for example, `8.0.1-ea.0` for an Early Access one. No package is published as `8.0.0`. The reason is that the older `8.0.0-rc.N` versions stay on npm, and a range on `8.0.0-ea.0` would have installed them. From `8.1` on, every release starts at patch 0.

[ADR 330](../architecture%20docs/adrs/ADR%20330%20-%20A%20maturity%20level%20is%20written%20in%20a%20package's%20version%20and%20an%20API's%20name.md) explains each of these rules in full.

## What an application writes

`prisma orm init` writes the Prisma lines in your `package.json`. You do not have to work them out. It writes one line for the package you import from, such as `@prisma/orm-postgres`, and one for each package that one is built from. They are listed so that your application has exactly one copy of each ([ADR 329](../architecture%20docs/adrs/ADR%20329%20-%20An%20application%20lists%20the%20platform%20packages%20and%20our%20packages%20name%20each%20other%20as%20peers.md)). You never import the others.

What you do at a new release depends on the level of your database's package.

### A GA database: update as usual

```jsonc
// a PostgreSQL application on release 8.3
"@prisma/orm-postgres":        "^8.3.0",
"@prisma/orm-framework":       "^8.3.0",
"@prisma/orm-family-sql":      "^8.3.0",
"@prisma/orm-target-postgres": "^8.3.0",
"@prisma/orm-toolchain":       "^8.3.0"
```

Every line has a caret (`^`), which accepts any later 8.x version. When release 8.4 is published, run your package manager's update command. Every line moves to 8.4 together, and you change nothing.

If you add an extension that is below GA, its line has a tilde on its own version, such as `~8.3.0-ea.0`. Your application keeps working after an update, but to get the extension's next release you edit that line yourself.

### A new minor below GA

```jsonc
// a SQLite application on release 8.3; SQLite is at Early Access
"@prisma/orm-sqlite":        "~8.3.0-ea.0",
"@prisma/orm-target-sqlite": "~8.3.0-ea.0",
"@prisma/orm-framework":     "~8.3.0",
"@prisma/orm-family-sql":    "~8.3.0",
"@prisma/orm-toolchain":     "~8.3.0",
"prisma":                    "~8.3.0"
```

Every line has a tilde (`~`), which accepts fixes within 8.3 and nothing from 8.4. An update keeps you on 8.3.

To move to release 8.4, edit every line to the new release and install:

```jsonc
"@prisma/orm-sqlite":        "~8.4.0-ea.0",
"@prisma/orm-target-sqlite": "~8.4.0-ea.0",
"@prisma/orm-framework":     "~8.4.0",
"@prisma/orm-family-sql":    "~8.4.0",
"@prisma/orm-toolchain":     "~8.4.0",
"prisma":                    "~8.4.0"
```

Then read the release notes, because a package below GA may have changed.

Why the tilde, even on the packages that are GA: no version range can carry a package below GA from one release into the next, so an update can never move `@prisma/orm-sqlite` to 8.4. If the other lines had a caret, the same update would move them to 8.4 and leave SQLite on 8.3, and those two halves do not work together. With a tilde on every line, everything stays on one release until you move it. [ADR 330](../architecture%20docs/adrs/ADR%20330%20-%20A%20maturity%20level%20is%20written%20in%20a%20package's%20version%20and%20an%20API's%20name.md#what-goes-in-an-applications-packagejson) walks through this step by step.

Two things to know about package managers:

- **Do not use the update command to move a package below GA to a new release.** pnpm's `update` rewrites a tilde on such a version as an exact version, which then never moves. Yarn's update to the latest version writes a caret. Edit the lines by hand.
- **pnpm writes an exact version** when it adds a package below GA, such as `8.3.0-ea.0` with no tilde. To take a fix such as `8.3.0-ea.1`, change the line.

### The `prisma` command-line tool

The `prisma` tool must be on the same release as your application's Prisma packages. `init` installs it. Beside a GA database its line has a caret, so it moves with the others. Beside a database below GA its line has a tilde, as shown above, so that an update does not move the tool to the next release while your application stays behind.

## Installing a version that is not the newest stable one

Running `npm install @prisma/orm-postgres` with no version gives you the version under the npm tag `latest`.

| Tag | What it gives you |
| --- | --- |
| `latest` | The newest GA version of a package. For a package that has never been GA, the newest version, whatever its level. Until release 8.0, the newest `8.0.0-rc.N`. |
| `ea`, `preview`, `rc` | The newest version at that level, for a package that has already had a GA version. A plain install of such a package keeps giving you the last GA version. |
| `dev` | A build of the newest commit on `main`, published on every push. Use it to check whether a fix that is not released yet solves your problem. It may be removed at any time. |

To try the change in one pull request, install its preview from [pkg.pr.new](https://pkg.pr.new). Install the preview of every Prisma package in your `package.json` together. A preview of one package installed alone runs on the released versions of the others, so it does not test the pull request.

## For extension authors

- **Depend only on published packages:** `@prisma/orm-framework`, `@prisma/orm-toolchain`, `@prisma/orm-family-*` and `@prisma/orm-target-*`. List each one you use as a peer dependency, and again as a development dependency for your own build.
- **Until release 8.0,** list each at one exact `8.0.0-rc.N`.
- **From release 8.0,** list a GA package with a caret on the first release your extension works with, such as `^8.1.0`. Your extension then keeps working when an application moves to a later release.
- **If you use anything below GA,** a whole package or a single function such as `preview_search`, list that package with a tilde, such as `~8.1.0`. It may change in the next release, so you publish a new version of your extension for each release.
- **Version your own package** as you see fit. We recommend taking the major and minor of the first Prisma release it works with, and using the same level suffixes.

[ADR 330](../architecture%20docs/adrs/ADR%20330%20-%20A%20maturity%20level%20is%20written%20in%20a%20package's%20version%20and%20an%20API's%20name.md#packages-maintained-outside-this-repository) has the full convention, and the [extension-upgrade reference](../../skills/prisma-8/references/upgrade-extension.md) has the steps.

## Reporting a regression

If an upgrade within Prisma 8 breaks something that is GA, that is a bug. [Open an issue](https://github.com/prisma/orm/issues/new/choose) with the two versions and the smallest example that shows it. The fix is published in the newest release.
