# Prisma 8: maturity levels

This document belongs to the [compatibility policy](spec.md). It holds only what has been agreed. Section 6 lists what is not yet decided.

## 1. What a level tells a user

A maturity level tells a user two things about a package or an API:

- how far they can rely on it to work, and
- whether the compatibility policy covers it, so that a later release will not break their use of it.

## 2. The scale

There is one scale. It applies to a package and to a single API, so a user learns one set of words. Kubernetes uses alpha, beta and GA for both features and API versions. Angular uses Developer Preview and Experimental for both features and single APIs.

There are four levels: Early Access, Preview, Release Candidate and Generally Available (GA). Three are the names Prisma already uses. Release Candidate is the step before GA: Preview says the thing may still change, and Release Candidate says we believe it is finished and only fixes will go in. "Below GA" means Release Candidate, Preview or Early Access.

A level is defined by what we do for the package or API, not by a description of its quality. These are working definitions (section 6):

| Level | What we do |
| --- | --- |
| Generally Available | Its tests run on every release and a failure blocks the release. A package passes the full test suite against its database. The compatibility policy covers it. |
| Release Candidate | As for GA, and we expect to make no further change that breaks its users. The compatibility policy does not cover it until it is GA. |
| Preview | The same tests run and block the release for what it supports. Its reference documentation lists what it does not yet support. The compatibility policy does not cover it. |
| Early Access | Released so that people can try it. A failing test does not block a release. The compatibility policy does not cover it. |

## 3. What has a level

- **A package.** Every published package has a level. The framework and each target have their own, so each database reaches GA on its own date.
- **An API.** An API is an export, or a member of one, such as a method, a property or an option. An API has the level of its package unless its name starts with the word for a lower level. Example: `preview_foo` in a GA package, a new framework API that must be able to change after extensions have used it. A member of an API below GA has at least that API's level.

A name can only lower a level. A GA API cannot exist inside a package below GA, because the package's version already says that nothing in it is covered.

Nothing else has a level. In particular an entrypoint (a path inside a package that code imports from, such as `@prisma/orm-toolchain/config-loader`) has none: everything it exports has the level of the package, or the lower level in its own name.

Functionality that is not ready for GA therefore ships in one of two ways: in its own package below GA, or inside a GA package under a name that carries its level. AWS CDK does both; it marks the single API with a suffix, such as `Beta1`, where we use a prefix.

## 4. How a level is written

A level is written in two places, both visible in the user's own code. The same word is used in both.

| Level | In a package's version number | At the start of an API's name |
| --- | --- | --- |
| Generally Available | Plain version: `8.1.0` | Nothing: `foo` |
| Release Candidate | `8.1.0-rc.1` | Not decided (section 6) |
| Preview | `8.1.0-preview.3` | `preview_foo` |
| Early Access | `8.1.0-ea.1` | `ea_foo` |

A user therefore needs two facts to know whether something is GA: the package's version, and the API's name.

The version number uses the meaning Semantic Versioning gives a pre-release version, and package managers follow it when they match a range. A range such as `^8.0.0` never selects a pre-release, so a user gets a release below GA only by asking for it. A GA release is published under the `latest` tag and a release below GA under another tag, so a plain install of a package that has a GA release gives a GA version. The words also sort in the right order: `ea`, then `preview`, then `rc`, then the plain version.

An extension author tells what they can depend on in the same two ways as an application developer.

## 5. What a level means for compatibility

- The compatibility policy covers everything that is GA: every API of a GA package whose name carries no lower level.
- A package or API below GA may change in any release.
- Such a change never affects an application that does not use it.
- **A promotion never removes a name.** When `ea_foo` becomes `preview_foo`, or `preview_foo` becomes `foo`, the release adds the new name. The old name stays as another name for the same thing, marked deprecated, and is removed at the next major version. Code written against the old name keeps working through every promotion. A name can therefore say less than is true for a while: `ea_foo` may be GA. That errs on the safe side.
- A promotion that comes with a change of form is a change like any other below GA: the new name has the new form, and the old name is removed in that release, since it cannot stand for both.
- Which levels the reference documentation covers is in the [spec](spec.md), section 8.

## 6. Not yet decided

- **The full definition of each level.** The table in section 2 is a working version. Unanswered: what level the framework package has when it has no database of its own; which release a failing test blocks while all packages are released together; who decides what a Preview package supports. The [plan](plan.md) has a task for this, and for a page that explains the levels to users.
- **Version numbers while packages are at different levels.** Today every package has the same version and they are released together. Once one package is GA and another is Preview, their versions differ. Unanswered: what the Preview package's version is at each release; that a range on a pre-release, such as `^8.1.0-preview.3`, does not select the pre-releases of the next minor, so a user edits it by hand; which tag a package gets that has never had a GA release; and which package carries a database's level (the facade, the target package or both).
- **Release Candidate for a single API.** Whether an API inside a GA package can be a release candidate, and how its name would say so.
- **How the word is written where the name is not a TypeScript identifier.** A command-line flag, a config option, an attribute in a schema file, an error code, and a type whose name starts with a capital letter.
- **How the levels relate to the scale First-Class, Supported and Unofficial** in [prisma/orm#25843](https://github.com/prisma/orm/issues/25843), which says where we spend effort and not how finished a package is.

## 7. Alternatives rejected

- **A separate word, such as `unstable_`, for an API that is not covered.** Rejected: it gives users two scales that say almost the same thing, and "unstable" suggests the behaviour is unreliable when we mean only that the API may change. React, for example, marks APIs with `unstable_` and `experimental_`, separately from its release channels, which it names Canary and Experimental.
- **A maturity level on an entrypoint, written in the import path**, such as `@prisma/orm-toolchain/preview/config-loader`. Rejected: an entrypoint's exports already get their level from the package's version and from their own names. A third place to write a level adds a third thing to learn, and every import of the entrypoint would have to change when it reached GA.
- **A file in the ORM repository as the place a user learns what is covered.** Rejected: the package's version number and the API's name tell them.
- **Feature flags for functionality that is not ready.** Rejected: see the [spec](spec.md), section 4.4.
