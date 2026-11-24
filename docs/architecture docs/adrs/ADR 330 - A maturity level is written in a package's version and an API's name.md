# ADR 330 — A maturity level is written in a package's version and an API's name

**Status:** Accepted
**Date:** 2026-11-24
**Related:** [ADR 329 — An application built on Prisma 8 upgrades within the major without changes](ADR%20329%20-%20An%20application%20built%20on%20Prisma%208%20upgrades%20within%20the%20major%20without%20changes.md), which covers what is Generally Available

---

A user reads two things in their own project to learn whether the compatibility promise covers what they use:

```jsonc
// package.json
"@prisma/orm-postgres": "8.1.0",          // Generally Available
"@prisma/orm-mysql": "8.1.0-preview.3"    // Preview
```

```ts
db.orm.user.find(...)          // Generally Available: a plain name in a GA package
db.orm.user.preview_foo(...)   // Preview: the name says so, inside a GA package
```

The package and API names in these samples only show the form. Which packages are at which level is not part of this record.

## Decision

Prisma 8 has one scale of maturity with three levels: Early Access, Preview and Generally Available (GA). "Below GA" means Preview or Early Access. The scale applies to a package and to a single API. A level is written in a package's version number and at the start of an API's name, and nowhere else.

### What a level tells a user

A maturity level tells a user two things about a package or an API:

- how far they can rely on it to work, and
- whether the compatibility promise ([ADR 329](ADR%20329%20-%20An%20application%20built%20on%20Prisma%208%20upgrades%20within%20the%20major%20without%20changes.md)) covers it, so that a later release will not break their use of it.

### The scale

There is one scale, so a user learns one set of words. Kubernetes uses alpha, beta and GA for both features and API versions. Angular uses Developer Preview and Experimental for both features and single APIs. The three names are the ones Prisma already uses.

A level is defined by what we do for the package or API, not by a description of its quality. These are working definitions; see [Not decided by this record](#not-decided-by-this-record).

| Level | What we do |
| --- | --- |
| Generally Available | Its tests run on every release and a failure blocks the release. A package passes the full test suite against its database. The compatibility promise covers it. |
| Preview | The same tests run and block the release for what it supports. Its reference documentation lists what it does not yet support. The compatibility promise does not cover it. |
| Early Access | Released so that people can try it. A failing test does not block a release. The compatibility promise does not cover it. |

### What has a level

- **A package.** Every published package has a level. The framework and each target have their own, so each database reaches GA on its own date.
- **An API.** An API is an export, or a member of one, such as a method, a property or an option. An API has the level of its package unless its name starts with the word for a lower level. Example: `preview_foo` in a GA package, a new framework API that must be able to change after extensions have used it. A member of an API below GA has at least that API's level.

A name can only lower a level. A GA API cannot exist inside a package below GA, because the package's version already says that nothing in it is covered.

Nothing else has a level. In particular an entrypoint (a path inside a package that code imports from, such as `@prisma/orm-toolchain/config-loader`) has none: everything it exports has the level of the package, or the lower level in its own name.

Functionality that is not ready for GA therefore ships in one of two ways: in its own package below GA, or inside a GA package under a name that carries its level. AWS CDK does both; it marks the single API with a suffix, such as `Beta1`, where we use a prefix.

### How a level is written

A level is written in two places, both visible in the user's own code. The same word is used in both.

| Level | In a package's version number | At the start of an API's name |
| --- | --- | --- |
| Generally Available | Plain version: `8.1.0` | Nothing: `foo` |
| Preview | `8.1.0-preview.3` | `preview_foo` |
| Early Access | `8.1.0-ea.1` | `ea_foo` |

A user therefore needs two facts to know whether something is GA: the package's version, and the API's name. An extension author tells what they can depend on in the same two ways as an application developer.

The version number uses the meaning Semantic Versioning gives a pre-release version, and package managers follow it when they match a range. A range such as `^8.0.0` never selects a pre-release, so a user gets a release below GA only by asking for it. A GA release is published under the `latest` tag and a release below GA under another tag, so a plain install of a package that has a GA release gives a GA version. The words also sort in the right order: `ea`, then `preview`, then the plain version.

### What a level means for compatibility

- The compatibility promise covers everything that is GA: every API of a GA package whose name carries no lower level.
- A package or API below GA may change in any release.
- Such a change never affects an application that does not use it.
- The reference documentation covers GA and Preview packages ([ADR 329](ADR%20329%20-%20An%20application%20built%20on%20Prisma%208%20upgrades%20within%20the%20major%20without%20changes.md#the-reference-documentation-is-the-specification)).

### Until `8.0.0`

Until `8.0.0` every release of every package is a release candidate, `8.0.0-rc.N`, and the compatibility promise covers none of them. The levels are written this way from `8.0.0`.

## Consequences

- No file in the repository, no documentation page and no import path is the place a user learns what is covered. A doc may describe a level; the version and the name decide it.
- Prisma 8 has no feature flags and no second word, such as "unstable", for what is not covered. A contributor who needs to ship something that may still change puts it in a package below GA or gives it a name that starts with `preview_` or `ea_`.
- A package below GA has a version different from a GA package released on the same day, so the packages no longer all share one version.
- Moving an API to GA changes its name.

## Not decided by this record

Each of these is recorded in a later record when it is decided.

- **The full definition of each level.** The table above is a working version. Unanswered: what level the framework package has when it has no database of its own; which release a failing test blocks while all packages are released together; who decides what a Preview package supports; which level `8.0.0-rc.N` has.
- **Version numbers while packages are at different levels.** Unanswered: what a Preview package's version is at each release; that a range on a pre-release, such as `^8.1.0-preview.3`, does not select the pre-releases of the next minor, so a user edits it by hand; which tag a package gets that has never had a GA release; and which package carries a database's level (the facade, the target package or both).
- **How an API moves to GA.** Its name changes, from `preview_foo` to `foo`. Whether the old name keeps working, and for how long, is not decided.
- **How the word is written where the name is not a TypeScript identifier**: a command-line flag, a config option, an attribute in a contract source, an error code, and a type whose name starts with a capital letter.
- **How the levels relate to the scale First-Class, Supported and Unofficial** that describes where the maintainers spend effort, not how finished a package is.

## Alternatives considered

- **A separate word, such as `unstable_`, for an API that is not covered.** Rejected: it gives users two scales that say almost the same thing, and "unstable" suggests the behaviour is unreliable when we mean only that the API may change. React, for example, marks APIs with `unstable_` and `experimental_`, separately from its release channels, which it names Canary and Experimental.
- **A maturity level on an entrypoint, written in the import path**, such as `@prisma/orm-toolchain/preview/config-loader`. Rejected: an entrypoint's exports already get their level from the package's version and from their own names. A third place to write a level adds a third thing to learn, and every import of the entrypoint would have to change when it reached GA.
- **A file in the repository as the place a user learns what is covered.** Rejected: the package's version number and the API's name tell them.
- **Feature flags for functionality that is not ready.** Rejected: see [ADR 329](ADR%20329%20-%20An%20application%20built%20on%20Prisma%208%20upgrades%20within%20the%20major%20without%20changes.md#no-feature-flags).
