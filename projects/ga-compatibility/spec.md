# Prisma 8 GA: compatibility policy

Status: draft. This document holds only decisions that are locked in. It records what we agreed, with the reason for each. Open questions, and anything proposed and not yet decided, are in [open-questions.md](open-questions.md). Facts about the code today are in [analysis.md](analysis.md).

## 1. Goal

From `8.0.0`, an application built on Prisma 8 upgrades to any later `8.x` release with no changes: none to its code, its generated files or its database.

The purpose is to make upgrading routine. A user who can upgrade without risk stays on the latest release and receives fixes, and we maintain one release line for each major. Each rule below is evaluated against one criterion: would it make a user hesitate before upgrading?

The guarantee starts at `8.0.0`. Until then every release is `8.0.0-rc.N` and may contain breaking changes. It must be crystal clear to a user what they can rely on and what they cannot. The rule that tells them must be simple and predictable.

We provide upgrade instructions from the last release candidate to `8.0.0`.

This project defines the policy and prepares the repository for it. It does not set the GA date.

## 2. Definitions

Terms follow `docs/glossary.md`, except **Extension**, which this policy uses more broadly: it includes a target and a family.

- **Major**: all releases that share a major version number, such as every `8.x`.
- **Application developer**: builds an application on Prisma. **Extension author**: builds an extension. **Extension**: anything built on the platform packages for applications to use: a target, a family, middleware, or support for a database feature. **Extension package**: a published package that contains an extension, such as `@prisma/orm-extension-pgvector`. **User**: an application developer or an extension author.
- **Facade**: the package an application installs for its database, such as `@prisma/orm-postgres`.
- **Platform packages**: the packages extension authors build against: `@prisma/orm-framework`, `@prisma/orm-toolchain`, `@prisma/orm-family-*` and `@prisma/orm-target-*`. The target and family packages we publish are platform packages, not extension packages.
- **Internal**: not exported by any published package.
- **GA**: Generally Available, the highest maturity level. **Below GA**: Preview or Early Access. See [Maturity levels](maturity-levels.md).
- **Reference documentation**: the precise description of each API, command, file format and error code (section 8). Behaviour is **specified** when the reference documentation states it.
- **Contract**: `contract.json` plus generated types. It is emitted from the **contract source**, which the user writes in PSL or TypeScript.
- **Contract space**: one owner's contract, migrations and marker. The application has one, and so does each extension that owns tables.
- **Storage hash**: a hash computed from a contract's target, family and `storage` section. It identifies which contract a database matches. A contract also has a **profile hash** (over the capabilities it requires) and may have an **execution hash** (over its execution defaults).
- **Migration hash**: a hash of one migration's recorded content.
- **Ref file**: a named pointer to a contract hash, stored in the repository, such as `production`.
- **Marker**: the record in the user's database of the contract it matches, one per contract space. **Ledger**: the record of applied migrations. **Signing** a database (`db sign`) writes the marker.
- **Framework**: the part of Prisma 8 that is independent of any database. Its code, `packages/1-framework`, is the **framework domain**. **Target**: one database, such as PostgreSQL. **Family**: the layer shared by related targets, such as all SQL targets.
- **Control plane**: the APIs that plan and apply migrations, as opposed to those that run queries.

## 3. What an application depends on

An application depends on more than an API. Prisma also writes state that outlives the release that wrote it: files committed to the user's repository, records in the user's database, and contracts and migrations shipped inside other packages. A later release must read all of it.

The policy covers each of the following. Section 5 states the exceptions to these rules. Each row will have its own design document.

| Surface | Rule within a major | Section |
| --- | --- | --- |
| TypeScript API: types and import paths | Code that compiles against one release compiles against every later release | 5 |
| Runtime behaviour and error codes | Specified behaviour does not change | 5 |
| Contract source: PSL and the TypeScript builder | A source one release accepts, every later release accepts | 5 |
| CLI commands, machine-readable output, config file | A command or config that works on one release works on every later release, and its machine-readable output stays compatible | 5 |
| Contract: `contract.json` and generated types | Read by every later release, with no re-emit required | 6 |
| Migrations on disk: migration files, contract snapshots, ref files | Read and applied by every later release | 6 |
| Database records: marker and ledger | Read by every later release | 6 |
| Platform: Node.js, TypeScript, database server, driver | Covered. A minimum rises only in a new major, or in a minor when its maker ends support | 5.5 |
| The platform packages' APIs, which extensions are built on | Covered, under the same rules: a release does not break an extension | 4, 5.1 |

## 4. Maturity and what is covered

The policy covers what is GA. This section says what that is.

### 4.1 How a user tells what is covered

Everything that is GA is covered. A user tells from two things in their own code: the package's version number, and the API's name. [Maturity levels](maturity-levels.md), section 4, says how.

### 4.2 Maturity levels

There is one scale, for packages and for single APIs: Early Access, Preview and Generally Available. The levels, what has one, how one is written and what it means for compatibility are in [Maturity levels](maturity-levels.md).

### 4.3 Who each package is for

The package states its audience. These terms and this split come from the decision record on the published packages ([ADR 242](../../docs/architecture%20docs/adrs/ADR%20242%20-%20Public%20npm%20surface%20-%20single%20%40prisma%20scope%20with%20consolidated%20publish%20packages.md)).

- An application depends on one facade, on the extension packages it installs, and on the `prisma` command-line tool. It depends on nothing else from us. The facade re-exports everything an application reaches.
- Extension authors build against the platform packages. An application reaches them through its facade. The exception is an application that replaces the facade's wiring: it depends on the platform packages directly, in place of the facade.
- Both audiences are covered by this policy, under identical rules. A release does not break an application or an extension. A package's audience is information for the reader; no rule depends on it.
- Every published package exports as little as possible. Before `8.0.0` we remove each export we do not intend to cover, from the facades as well as from the platform packages.
- File formats and machine-readable command output are covered.
- Nothing we publish is named "internal". No published import path contains the word: the ones that do today are renamed before `8.0.0`.
- Our own products that build on the ORM, such as Composer, the `prisma` command-line tool and the control plane, follow the same rules as any user. They use only what is covered and get no special access.
- The command-line tool and the library in one project have the same major version. When they do not, the tool stops and says so.
- The release candidates force anything that depends on the ORM to pin an exact version. That requirement ends at `8.0.0`.

### 4.4 No feature flags

Prisma 8 has no feature flags. Functionality that is not ready for GA ships in its own package below GA, or as an API whose name carries its level ([Maturity levels](maturity-levels.md), section 3). A change that cannot be an extension, such as a different default in the core, ships as a new API beside the old one or waits for the next major.

## 5. API and behaviour compatibility

### 5.1 Additions

A release may add features, APIs and framework abstractions at any time. An addition must not affect an application that does not use it. Some additions can break existing code without removing anything.

**New members on interfaces that users implement.** Most code only calls our APIs. Some code implements our interfaces: an extension, including middleware an application writes for itself. A new required member would stop every such implementation compiling. A new member on such an interface is therefore optional, and where it is missing our code behaves as it did before the member existed. The one exception is an interface whose type has a member that user code cannot write, such as a `#private` field, so that it can only be implemented by extending a base class we export or by calling a factory we export. There the new member may be required, provided the base class or factory implements it. This follows the rule in Rust's compatibility guidelines for traits: a new method comes with a default body, except on a trait that outside code cannot implement. One case remains: an implementation that already has a member with the new member's name and a different type stops compiling. We accept this, as Rust does.

**New cases in a set that user code handles exhaustively.** Example: a new error code, when a user's `switch` handles every error code. Each such set is declared open or closed in `8.0.0`. An open set may gain cases in any release, and its type carries a catch-all member, so the compiler makes the user write a default branch from the start. Adding a case to a closed set is a breaking change. Error codes are an open set: new error conditions may appear later, existing codes remain stable, and the generated reference documentation lists them. This is how Rust, Kubernetes and Stripe treat sets that grow, and the catch-all member is how the AWS SDK and Relay express it in TypeScript.

**New built-in names.** The principle: adding a built-in name never changes the meaning of what a user has already written. Example: PSL gains a type named `Duration`, and a user already has a model named `Duration`. The rule that achieves it: the user's own name takes precedence over a built-in name, and there is a way to refer to each.

PSL already satisfies this. It resolves a name in the user's own declarations first, in the enclosing namespace and then in the rest of the schema, and only then among the types the target and extensions provide (`packages/1-framework/2-authoring/psl-parser/src/scope.ts`). A provided type can also be written with a qualified name under its namespace.

### 5.2 Changes to existing behaviour

Every change to existing behaviour belongs to one of four classes:

| Class | Permitted in a minor or patch |
| --- | --- |
| Fix to behaviour that was wrong: it contradicts the reference documentation, or it is a defect the reference does not address, such as a crash | Yes |
| Change to specified behaviour | No. Only in a new major, or as a new API the user adopts explicitly |
| Change to unspecified detail: SQL text, row order without `orderBy`, error message wording, human-readable output, timing | Yes |
| Security fix | Yes, with a published notice, even when it changes specified behaviour |

An application that depended on a bug, on unspecified detail, on behaviour a security fix removed, or on a version of something Prisma runs on whose maker has ended support for it (section 5.5), may need changes after an upgrade. These are the only exceptions to the goal in section 1.

### 5.3 Rejecting input that was previously accepted

A release may reject input that an earlier release accepted, when the reference never specified that input as accepted. Such a change is a fix or a change to unspecified detail. Because a new error stops an application, it:

1. warns in an earlier release before it fails, where that is possible;
2. fails at compile time or emit time in preference to run time;
3. is listed in the release notes.

Rejecting input that the reference specifies as accepted is a change to specified behaviour.

### 5.4 Replaced APIs

When a GA API is replaced, the replacement arrives beside the old form. The old form is deprecated: it is marked so that an editor shows it, it names its replacement, and it keeps working until the next major. Nothing that is GA is removed within a major. None of this applies to an API below GA.

A change to a type that stops a user's code compiling is a break like any other, and is not made to a GA API. The helper types we export are covered like every other export.

### 5.5 Supported versions of what Prisma runs on

This covers everything outside Prisma that an application needs: Node.js and the other runtimes, TypeScript, each database and each database driver.

- Our support for a version follows the lifetime its own maker gives it. We do not stop supporting a version by our own choice within a major.
- A minimum version therefore rises only in a new major, with one exception: when its maker ends support for a version, a minor release may stop supporting it. The release notes say so.
- A minor release adds support for a new version when its maker releases one.
- The makers do not all define the end of support the same way, and some define none. For each one we state which event counts. That list is a task in the plan.

TypeScript does not follow Semantic Versioning: any TypeScript release may break existing code. We support from the stated minimum to the newest release. We test the next TypeScript release before it ships and fix any break it causes in a patch release.

## 6. Stored data compatibility

### 6.1 Reading across releases

- A later release reads everything an earlier release in the major stored: every part of the contract, migration files, contract snapshots, ref files, the marker and the ledger.
- No stored format changes except in a way a later release can still read.
- The reverse is not guaranteed. An earlier release may fail on data a later release stored. It is also not prevented: an earlier release works with such data whenever it can interpret it.

### 6.2 Format versions

- Each stored file records the version of its format: the contract, migration files and ref files. A reader checks the version before interpreting the file.
- A command that would modify the database or the user's files from a record it cannot interpret stops with an error, and modifies nothing.
- The contract's format version field, `schemaVersion` today, is renamed to a name that does not contain "schema".

### 6.3 Hashes

- A hash is a predictable function of content. The same stored content produces the same hash in every release of the major.
- A release that writes different `storage` content for a contract produces a new storage hash. That is acceptable.
- A hash must never change while the content it covers has not.
- The contract's format version is not an input to the storage hash. It describes how the JSON is written, not what the database holds.
- The storage hash identifies a contract and connects one migration to the next. The migration hash protects a migration's files against unintended edits. The ledger is informational: nothing is applied or refused because of it.

### 6.4 Database records

- Prisma's own tables are the marker, the ledger and the contract table. No upgrade fails with a database error because they are missing or are in the form an earlier release wrote. The ORM brings them up to date itself, or, for a change that is not additive, stops and names the one command that does.
- The marker and ledger change additively (they gain columns, rows or fields, and existing ones keep their meaning), or through a command the user runs that states it will change them.
- Either way, the release makes the change to an existing database: it applies an additive change itself, and any other change through that command. The user never edits or drops the marker or ledger by hand. Where possible they stay usable by the earlier release.

The ledger gets no version field of its own.

### 6.5 Migrations across a major

- A migration written by an earlier release in the major still applies.
- At a new major, users are given a way to carry their migrations forward. They are not asked to delete migrations, and old formats are not read indefinitely.

## 7. Runtime marker check

The check that compares a running application's contract with the database's marker never stops the application. A hash mismatch, a marker that cannot be decoded, and a marker that cannot be read each produce a warning.

## 8. Reference documentation

The reference documentation is the specification. It alone determines what is specified.

- It is generated from the code or stored beside it.
- It ships inside each package as Markdown, so it matches the installed version.
- Where it is silent, behaviour is unspecified.
- Guides, the agent skill and the test suite do not define specified behaviour. The agent skill refers to the reference and does not restate it.
- It covers every export of a GA or Preview package, every CLI command, config option, error code and file format.

## 9. Release notes

Every release lists each change to behaviour with its class from section 5.2.

## 10. Upgrade tooling

The guiding principle: where an upgrade requires a change, a deterministic tool makes it, such as a CLI command or a codemod that produces the same result on every run. This applies within a major, for the exceptions in section 5.2, and to the move to a new major, including carrying migrations forward.

An upgrade guide applied by an agent does not meet this requirement: it removes the human without automating the upgrade.

Where the correct edit depends on what the user meant, the tool finds every affected location, changes none, and reports what must be decided. The decision and the edit are separate: once the user records a decision, the tool makes the edit deterministically. One acceptable form is a mark the user places at each usage.

## 11. Releases and how long they are supported

- We aim for one new major a year. This is an aim, not a limit.
- Within the current major, fixes go to the latest minor release only.
- When a new major is released, the previous major receives critical and security fixes for 12 more months.

## 12. How the policy is applied to a change

- The author of a change states its class from section 5.2. The reviewer checks it.
- An automated check compares each package's exported API with the last release. It fails on a removal or an incompatible change to anything GA. It also reports every added API, and an addition is merged only when the reviewer approves it as intended. An API we expose by accident is one we are then bound to support.

## 13. Alternatives rejected

- **Guides or the agent skill as the definition of specified behaviour.** Rejected: they are written for convenience, not precision, and two sources of truth disagree.
- **Feature flags for new functionality.** Rejected in favour of extensions.
- **Asking users to delete applied migrations before a new major.** Rejected: users get a way to carry migrations forward.
- **A format version field on the ledger.** Rejected: nothing would ever halt because of it.
- **Applying a compatibility rule to some cases only.** Rejected.
- **Saving a copy of an application for every release and testing all of them.** Rejected: there will be hundreds of releases in the major.
