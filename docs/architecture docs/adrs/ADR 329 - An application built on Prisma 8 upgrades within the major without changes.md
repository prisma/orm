# ADR 329 — An application built on Prisma 8 upgrades within the major without changes

**Status:** Accepted
**Date:** 2026-11-24
**Supersedes:** the rule in [ADR 222](ADR%20222%20-%20Version%20support%20policy.md) that a minimum supported version is raised freely, and parts of ADRs 010, 016, 017, 140, 219, 234, 252, 257, 316 and 322, as [Earlier records](#earlier-records) lists
**Related:** [ADR 330 — Maturity levels](ADR%20330%20-%20A%20maturity%20level%20is%20written%20in%20a%20package's%20version%20and%20an%20API's%20name.md), which says what is Generally Available

---

An application is on `8.0.0`. Its developer changes one line and installs:

```diff
 "dependencies": {
-  "@prisma/orm-postgres": "8.0.0"
+  "@prisma/orm-postgres": "8.3.0"
 }
```

Nothing else changes. The application's code compiles and behaves as it did. Its `contract.json`, generated types and migration files are read as they are, with no re-emit. Its database is used as it is: the developer signs nothing again and repairs nothing.

## Decision

From `8.0.0`, an application built on Prisma 8 upgrades to any later `8.x` release with no changes: none to its code, its generated files or its database. An extension gets the same promise.

The purpose is to make upgrading routine. A user who can upgrade without risk stays on the latest release and receives fixes, and we maintain one release line for each major. Each rule in this record is judged by one question: would it make a user hesitate before upgrading?

It must be clear to a user what they can rely on and what they cannot, and the rule that tells them must be simple and predictable.

### When the rules start

The promise starts at `8.0.0`. Until then every release is a release candidate, `8.0.0-rc.N`, and may contain breaking changes: to an API, to behaviour, and to any stored format. Each release ships upgrade instructions, and we provide upgrade instructions from the last release candidate to `8.0.0`.

A choice that cannot be changed after `8.0.0` without breaking this promise is made before `8.0.0`: what each package exports, what each stored file records, and what each hash covers.

### Terms

Terms follow the [glossary](../../glossary.md), with two departures. This record uses **extension** more broadly than the glossary: here it includes a target and a family. It calls the package an application installs for its database the **facade**, the word [ADR 242](ADR%20242%20-%20Public%20npm%20surface%20-%20single%20%40prisma%20scope%20with%20consolidated%20publish%20packages.md) uses, where the glossary says *target package*, to keep it apart from the `@prisma/orm-target-*` packages.

- **Major**: all releases that share a major version number, such as every `8.x`.
- **User**: an application developer, who builds an application on Prisma, or an extension author, who builds an extension.
- **Extension**: anything built on the platform packages for applications to use: a target, a family, middleware, or support for a database feature. An **extension package** is a published package that contains one, such as `@prisma/orm-extension-pgvector`.
- **Facade**: the package an application installs for its database, such as `@prisma/orm-postgres`.
- **Platform packages**: the packages extension authors build against: `@prisma/orm-framework`, `@prisma/orm-toolchain`, `@prisma/orm-family-*` and `@prisma/orm-target-*`. The `@prisma/orm-target-*` and `@prisma/orm-family-*` packages we publish are platform packages, not extension packages.
- **Internal**: not exported by any published package.
- **GA**: Generally Available, the highest maturity level. **Below GA** means Preview or Early Access ([ADR 330](ADR%20330%20-%20A%20maturity%20level%20is%20written%20in%20a%20package's%20version%20and%20an%20API's%20name.md)).
- **Reference documentation**: the precise description of each API, command, file format and error code. Behaviour is **specified** when the reference documentation states it.
- **Stored data**: what Prisma writes that outlives the release that wrote it. That is the contract (`contract.json` and its generated types), the migration files, contract snapshots and ref files in the user's repository, and the marker and ledger in the user's database.

## What the promise covers

An application depends on more than an API. Prisma also writes state that outlives the release that wrote it: files committed to the user's repository, records in the user's database, and contracts and migrations shipped inside other packages. A later release must read all of it.

| What an application depends on | Rule within a major |
| --- | --- |
| TypeScript API: types and import paths | Code that compiles against one release compiles against every later release |
| Runtime behaviour and error codes | Specified behaviour does not change |
| Contract source: PSL and the TypeScript builder | A source one release accepts, every later release accepts |
| CLI commands, machine-readable output, config file | A command or config that works on one release works on every later release, and its machine-readable output stays compatible |
| Contract: `contract.json` and generated types | Read by every later release, with no re-emit required |
| Migrations on disk: migration files, contract snapshots, ref files | Read and applied by every later release |
| Database records: marker and ledger | Read by every later release |
| What Prisma runs on: Node.js, TypeScript, database server, driver | A minimum rises only in a new major, or in a minor when its maker ends support |
| The platform packages' APIs, which extensions are built on | Covered under the same rules: a release does not break an extension |

The exceptions are listed under [Changes to existing behaviour](#changes-to-existing-behaviour).

### Everything that is GA is covered

The promise covers what is Generally Available. A user tells whether something is GA from two things in their own code: the package's version number and the API's name. [ADR 330](ADR%20330%20-%20A%20maturity%20level%20is%20written%20in%20a%20package's%20version%20and%20an%20API's%20name.md) defines the levels and how they are written. A package or API below GA may change in any release.

### Both audiences get identical rules

Each package states who it is for. The terms and the split come from the record on the published packages ([ADR 242](ADR%20242%20-%20Public%20npm%20surface%20-%20single%20%40prisma%20scope%20with%20consolidated%20publish%20packages.md)).

- An application depends on one facade, on the extension packages it installs, and on the `prisma` command-line tool. It depends on nothing else from us. The facade re-exports everything an application reaches.
- Extension authors build against the platform packages. An application reaches them through its facade. The exception is an application that replaces the facade's wiring: it depends on the platform packages directly, in place of the facade.
- Both audiences are covered, under identical rules. A release does not break an application or an extension. A package's audience is information for the reader; no rule depends on it.
- Every published package exports as little as possible. `8.0.0` exports only what we intend to cover, from the facades as well as from the platform packages.
- File formats and machine-readable command output are covered.
- From `8.0.0` nothing we publish is named "internal": no published import path contains the word.
- Our own products that build on the ORM, such as Composer, the `prisma` command-line tool and Prisma's hosted control plane service (a product, not the control plane of this repository's architecture), follow the same rules as any user. They use only what is covered and get no special access.
- The command-line tool and the library in one project have the same major version. When they do not, the tool stops and says so.
- The release candidates force anything that depends on the ORM to pin an exact version. That requirement ends at `8.0.0`.

### No feature flags

Prisma 8 has no feature flags. Functionality that is not ready for GA ships in its own package below GA, or as an API whose name carries its level ([ADR 330](ADR%20330%20-%20A%20maturity%20level%20is%20written%20in%20a%20package's%20version%20and%20an%20API's%20name.md)). A change that cannot be an extension, such as a different default in the core, ships as a new API beside the old one or waits for the next major.

## API and behaviour

### Additions

A release may add features, APIs and framework abstractions at any time. An addition must not affect an application that does not use it. Some additions can break existing code without removing anything, and each has a rule.

**A new member on an interface that users implement.** Most code only calls our APIs. Some code implements our interfaces: an extension, including middleware an application writes for itself. A new required member would stop every such implementation compiling. A new member on such an interface is therefore optional, and where it is missing our code behaves as it did before the member existed.

The one exception is an interface whose type has a member that user code cannot write, such as a `#private` field, so that it can only be implemented by extending a base class we export or by calling a factory we export. There the new member may be required, provided the base class or factory implements it. This follows the rule in Rust's compatibility guidelines for traits: a new method comes with a default body, except on a trait that outside code cannot implement.

One case remains: an implementation that already has a member with the new member's name and a different type stops compiling. We accept this, as Rust does.

**A new case in a set that user code handles exhaustively.** Example: a new error code, when a user's `switch` handles every error code. Each such set is declared open or closed in `8.0.0`. An open set may gain cases in any release, and its type carries a catch-all member, so the compiler makes the user write a default branch from the start. Adding a case to a closed set is a breaking change. Error codes are an open set: new error conditions may appear later, existing codes remain stable, and the generated reference documentation lists them. This is how Rust, Kubernetes and Stripe treat sets that grow, and the catch-all member is how the AWS SDK and Relay express it in TypeScript.

**A new built-in name.** Adding a built-in name never changes the meaning of what a user has already written. Example: PSL gains a type named `Duration`, and a user already has a model named `Duration`. The rule that achieves this: the user's own name takes precedence over a built-in name, and there is a way to refer to each. PSL resolves a name this way: in the user's own declarations first, in the enclosing namespace and then in the rest of the document, and only then among the types the target and extensions provide. A provided type can also be written with a qualified name under its namespace.

### Changes to existing behaviour

Every change to existing behaviour belongs to one of four classes:

| Class | Permitted in a minor or patch |
| --- | --- |
| Fix to behaviour that was wrong: it contradicts the reference documentation, or it is a defect the reference does not address, such as a crash | Yes |
| Change to specified behaviour | No. Only in a new major, or as a new API the user adopts explicitly |
| Change to unspecified detail: SQL text, row order without `orderBy`, error message wording, human-readable output, timing | Yes |
| Security fix | Yes, with a published notice, even when it changes specified behaviour |

An application may need changes after an upgrade when it depended on one of these: a bug, unspecified detail, behaviour a security fix removed, or a version of something Prisma runs on whose maker has ended support for it. These are the only exceptions to the promise.

### Rejecting input that was previously accepted

A release may reject input that an earlier release accepted, when the reference never specified that input as accepted. Such a change is a fix or a change to unspecified detail. Because a new error stops an application, it:

1. warns in an earlier release before it fails, where that is possible;
2. fails at compile time or emit time in preference to run time;
3. is listed in the release notes.

Rejecting input that the reference specifies as accepted is a change to specified behaviour.

### Replaced APIs

When a GA API is replaced, the replacement arrives beside the old form. The old form is deprecated: it is marked so that an editor shows it, it names its replacement, and it keeps working until the next major. Nothing that is GA is removed within a major. None of this applies to an API below GA.

A change to a type that stops a user's code compiling is a break like any other, and is not made to a GA API. The helper types we export are covered like every other export.

### Supported versions of what Prisma runs on

This covers everything outside Prisma that an application needs: Node.js and the other runtimes, TypeScript, each database and each database driver.

- Our support for a version follows the lifetime its own maker gives it. We do not stop supporting a version by our own choice within a major.
- A minimum version therefore rises only in a new major, with one exception: when its maker ends support for a version, a minor release may stop supporting it. The release notes say so.
- A minor release adds support for a new version when its maker releases one.
- The makers do not all define the end of support the same way, and some define none. For each one we state which event counts.

TypeScript does not follow Semantic Versioning: any TypeScript release may break existing code. We support from the stated minimum to the newest release. We test the next TypeScript release before it ships and fix any break it causes in a patch release.

This replaces the rule in [ADR 222](ADR%20222%20-%20Version%20support%20policy.md) that a minimum is raised freely. Until `8.0.0` ADR 222's choice of each minimum stands: the latest release we test against, lowered when a user needs it. From `8.0.0` the minimums are the ones `8.0.0` declares, and the rules above govern every change to them. ADR 222's other rules stand: a declared minimum never claims more than our tests exercise, and each minimum has one source of truth.

## Stored data

### A later release reads what an earlier release stored

- A later release reads everything an earlier release in the major stored: every part of the contract, migration files, contract snapshots, ref files, the marker and the ledger.
- No stored format changes except in a way a later release can still read.
- The reverse is not guaranteed. An earlier release may fail on data a later release stored. It is also not prevented: an earlier release works with such data whenever it can interpret it.

### Format versions

- Each stored file records the version of its format: the contract, migration files and ref files. A reader checks the version before interpreting the file.
- A command that would modify the database or the user's files from a record it cannot interpret stops with an error, and modifies nothing.
- The contract's format version field, `schemaVersion` today, is renamed to a name that does not contain "schema".

### Hashes

- A hash is a predictable function of content. The same stored content produces the same hash in every release of the major.
- A release that writes different `storage` content for a contract produces a new storage hash. That is acceptable.
- A hash must never change while the content it covers has not.
- The contract's format version is not an input to the storage hash. It describes how the JSON is written, not what the database holds.
- The storage hash identifies a contract and connects one migration to the next. The migration hash protects a migration's files against unintended edits. The ledger is informational: nothing is applied or refused because of it.

### Database records

- Prisma's own tables are the marker, the ledger and the contract table. No upgrade fails with a database error because they are missing or are in the form an earlier release wrote. The ORM brings them up to date itself, or, for a change that is not additive, stops and names the one command that does.
- The marker and ledger change additively (they gain columns, rows or fields, and existing ones keep their meaning), or through a command the user runs that states it will change them.
- Either way, the release makes the change to an existing database: it applies an additive change itself, and any other change through that command. The user never edits or drops the marker or ledger by hand. Where possible they stay usable by the earlier release.
- The ledger has no version field of its own.

### Migrations across a major

- A migration written by an earlier release in the major still applies.
- At a new major, users are given a way to carry their migrations forward. They are not asked to delete migrations, and old formats are not read indefinitely.

### The runtime marker check only warns

The check that compares a running application's contract with the database's marker never stops the application. A hash mismatch, a marker that cannot be decoded, and a marker that cannot be read each produce a warning.

## How a user and a contributor apply the rules

### The reference documentation is the specification

The reference documentation alone determines what is specified.

- It is generated from the code or stored beside it.
- It ships inside each package as Markdown, so it matches the installed version.
- Where it is silent, behaviour is unspecified.
- Guides, the agent skill and the test suite do not define specified behaviour. The agent skill refers to the reference and does not restate it.
- It covers every export of a GA or Preview package, every CLI command, config option, error code and file format.

### Release notes

Every release lists each change to behaviour with its class from [Changes to existing behaviour](#changes-to-existing-behaviour).

### Upgrades that need a change are made by a tool

Where an upgrade requires a change, a deterministic tool makes it, such as a CLI command or a codemod that produces the same result on every run. This applies within a major, for the exceptions above, and to the move to a new major, including carrying migrations forward.

An upgrade guide applied by an agent does not meet this requirement: it removes the human without automating the upgrade.

Where the correct edit depends on what the user meant, the tool finds every affected location, changes none, and reports what must be decided. The decision and the edit are separate: once the user records a decision, the tool makes the edit deterministically. One acceptable form is a mark the user places at each usage.

### Releases and how long they are supported

- We aim for one new major a year. This is an aim, not a limit.
- Within the current major, fixes go to the latest minor release only.
- When a new major is released, the previous major receives critical and security fixes for 12 more months.

These rules apply to Prisma 8 and the majors after it. How long Prisma 7 is maintained is recorded separately, in [ADR 295](ADR%20295%20-%20New%20features%20do%20not%20land%20on%20Prisma%207.md).

### How a change is checked

- The author of a change states its class from [Changes to existing behaviour](#changes-to-existing-behaviour). The reviewer checks it.
- An automated check compares each package's exported API with the last release. It fails on a removal or an incompatible change to anything GA. It also reports every added API, and an addition is merged only when the reviewer approves it as intended. An API we expose by accident is one we are then bound to support.

## Consequences

- After `8.0.0` a contributor who changes a GA export, a stored format or specified behaviour keeps what an earlier release accepted or wrote working, and does not change what a hash covers. Code that no published package exports is not covered and changes freely in any release. The test is the export, not the package name: code in an `@internal/*` workspace package is covered when a GA `@prisma/orm-*` package exports it under a plain name.
- Until `8.0.0` a change may still be made directly, with no compatibility code, except where an earlier record asks for some, such as a deprecated alias for a renamed PSL type. From `8.0.0` that ends for everything this record covers.
- Whatever a GA package exports at `8.0.0` under a plain name, we support for the whole major. Reducing the exports is cheap before `8.0.0` and a breaking change after it.
- After `8.0.0` a change to a stored format or a hash can no longer be handled by telling users to emit the contract and sign the database again, as several earlier records do.
- This record states requirements, and a new design follows them. [Earlier records](#earlier-records) lists what it replaces and what is corrected when the code changes.

## Earlier records

Each of these records carries a note that names the part this record replaces. The parts of ADR 016 and ADR 017 no longer apply. The other parts hold as written until `8.0.0`.

| Record | What this record replaces |
| --- | --- |
| [ADR 222](ADR%20222%20-%20Version%20support%20policy.md) | A minimum supported version is raised freely, to the latest release we test against |
| [ADR 219](ADR%20219%20-%20Database%20driver%20coupling%20-%20framework%20owns%20user-facing%20types%20and%20driver%20is%20a%20single-major%20peer%20dependency.md) | Exactly one major of a database driver is supported at a time, and the next one arrives in a breaking release |
| [ADR 257](ADR%20257%20-%20Scalar%20types%20are%20named%20after%20the%20target%20on%20every%20surface.md), [ADR 316](ADR%20316%20-%20PostgreSQL%20scalars%20get%20convenience%20types.md), [ADR 322](ADR%20322%20-%20Each%20target%20declares%20the%20scalar%20convenience%20types%20over%20its%20own%20explicit%20types.md) | A renamed name is removed after one release line, and a changed codec id ends with users emitting and signing again |
| [ADR 010](ADR%20010%20-%20Canonicalization%20Rules.md), [ADR 234](ADR%20234%20-%20Content-addressed%20wire%20names%20for%20Postgres-normalized%20objects.md), [ADR 252](ADR%20252%20-%20An%20earlier%20Prisma%20version's%20schema%20is%20a%20contract%20source.md) | A change to canonicalization, to the normalizer or to the naming rule is handled by users emitting, signing or migrating again |
| [ADR 016](ADR%20016%20-%20Adapter%20SPI%20for%20Lowering.md) | A change to emitted SQL is a breaking change unless a feature flag guards it |
| [ADR 017](ADR%20017%20-%20Extension%20Compatibility%20Policy.md) | A separate version for each of the plan model, the hook interface and each adapter, which was not built |
| [ADR 140](ADR%20140%20-%20Package%20Layering%20%26%20Target-Family%20Namespacing.md) | No transitional code is kept because there are no external consumers |

Some earlier records describe code that does not yet meet a requirement of this record. Those records describe the code as it is, and each is corrected in the change that makes the code conform. They include:

- the contract's format version as an input to the storage hash ([ADR 004](ADR%20004%20-%20Storage%20Hash%20vs%20Profile%20Hash.md));
- a runtime that fails a query when it cannot read or decode the marker ([ADR 021](ADR%20021%20-%20Contract%20Marker%20Storage.md), [ADR 123](ADR%20123%20-%20Drift%20Detection%2C%20Recovery%20%26%20Reconciliation.md));
- Prisma's own tables in the database, which are created only if absent and never brought up to date (the note at the top of [ADR 042](ADR%20042%20-%20Contract%20Marker%20Evolution.md), whose own design does bring them up to date, [ADR 320](ADR%20320%20-%20Databases%20record%20a%20change%20policy%20and%20a%20data%20protection%20policy.md));
- a facade that re-exports whole internal modules, where this record asks each package to export as little as possible ([ADR 242](ADR%20242%20-%20Public%20npm%20surface%20-%20single%20%40prisma%20scope%20with%20consolidated%20publish%20packages.md));
- error code types with no catch-all member ([ADR 239](ADR%20239%20-%20Errors%20are%20structural%20envelopes%20with%20dotted%20namespace%20codes.md)).

## Alternatives considered

- **Guides or the agent skill as the definition of specified behaviour.** Rejected: they are written for convenience, not precision, and two sources of truth disagree.
- **Feature flags for new functionality.** Rejected in favour of extensions and of APIs whose names carry their level.
- **Asking users to delete applied migrations before a new major.** Rejected: users get a way to carry migrations forward.
- **A format version field on the ledger.** Rejected: nothing would ever halt because of it.
- **Applying a compatibility rule to some cases only.** Rejected: the rule that tells a user what they can rely on must be simple and predictable.
- **Saving a copy of an application for every release and testing all of them.** Rejected: there will be hundreds of releases in the major.
- **Raising a minimum supported version whenever we choose.** Rejected for the time after `8.0.0`: a user who must first upgrade their runtime or database hesitates before upgrading Prisma.
