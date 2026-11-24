# GA compatibility: plan

This is the plan for stream 7 of the Prisma 8 GA plan. The policy it implements is in [spec.md](spec.md) and [maturity-levels.md](maturity-levels.md). The order of the projects and what GA requires are also listed in the GA plan, `planning/plan.md` on the branch `planning/prisma-8-ga`; the two lists must name the same projects.

## Goal

From `8.0.0`, an application built on Prisma 8 upgrades to any later `8.x` release with no changes to its code, its generated files or its database.

Upgrading becomes routine, so users stay on the latest release and we maintain one release line for each major. It is always clear to a user what they can rely on. A project belongs in this stream when it removes a reason for a user to hesitate before upgrading.

## How this plan is organised

The work is a stream of 12 projects. Each is sized for one to four pull requests and is run through the Drive process. When a project starts it gets its own folder under `projects/` and its own Linear project, and its design is written then, by whoever takes it. This plan does not hold those designs.

Each project below states:

- **Purpose:** why it exists, in the user's terms. New work joins a project only when it serves this purpose. Work that serves the goal above and fits no project becomes a new project. Work that serves neither belongs in another stream.
- **What it achieves:** what is true when the project is done.
- **How, where we know:** the work we expect. The numbers in brackets are the task numbers this plan used before 2026-11-24; the research reports under [research/](research/) and [handover.md](handover.md) refer to tasks by those numbers.
- **To decide when it starts:** what is not settled.

**What GA requires.** Projects 1 to 6 are Must, 7, 9 and 12 are Aim, and 8, 10 and 11 are Later. This is proposed and not yet confirmed. A project is Must when its changes would break the promise if made after `8.0.0`: a change to a stored format, a hash, an import path or a published type.

**Order.** Project 1 first. Project 4 before project 3, which needs its list of each package's exports.

The facts below about the code were read on 2026-11-23 at `8.0.0-rc.24` and nothing was run. Each project rechecks them when it starts.

## Projects that GA requires

### 1. Document the compatibility policy in the repository

**Purpose.** A contributor or agent who changes Prisma 8 learns the compatibility rules from the repository's own docs. Today the policy is only in this folder, and docs on `main` say the opposite in places.

**What it achieves.**

- The policy and the maturity levels are recorded on `main` as decision records.
- No doc, rule or decision record on `main` contradicts them. Each one that did is corrected, or is superseded where it is a decision record.
- The docs say when the rules start to apply. Until `8.0.0` a release candidate may still contain breaking changes.

**How, where we know.**

- The records to correct are listed in [analysis.md](analysis.md), under "Existing records the decided policy contradicts": the no-backward-compatibility rules in `CONTRIBUTING.md`, the architecture overview and the repository rules; decision records that handle a format or hash change by telling users to emit and sign again; the record that lists the format version as a storage hash input; the marker record's statement that the runtime refuses to execute on a mismatch; `docs/oss/versioning.md` and `SECURITY.md`; the rule that a renamed PSL name is removed after "one release line".
- Project 1 corrects what a contributor reads as a rule today. A record that describes behaviour another project changes, such as the hash inputs or the marker check, is corrected by that project when the behaviour changes.
- Revise the decision record on version support (`docs/architecture docs/adrs/ADR 222 - Version support policy.md`), which says "We raise floors freely", the project intent, which repeats it, and the header of `scripts/validate-typescript-peer.mjs` (part of task 6).

**To decide when it starts.** Whether the policy is one decision record or several. The wording point in [open-questions.md](open-questions.md): whether the end of exact version pins at `8.0.0` covers the pins between our own packages.

### 2. Make later releases read the files and database records of earlier releases

**Purpose.** After an upgrade, what Prisma wrote into a user's repository and database works as it is. The user regenerates nothing and runs no repair command. An application never stops serving queries because of those records.

**What it achieves.**

- Every stored file records the version of its format, and every reader checks it before interpreting the file. A reader that meets a version it does not know says so, and a command that would change the database or the user's files from such a record stops and changes nothing.
- The same stored content produces the same hash in every release of the major.
- The check that compares a running application's contract with the database's marker only warns.
- Samples of everything `8.0.0` writes are saved, and every later release is tested against them.

**How, where we know.**

- Add a format version to `migration.json` and to ref files, and decide how `ops.json` is covered. A reader reports an unknown version as such, before it validates the shape. Rename the contract's `schemaVersion` field to a name without "schema", and give existing files a path to the new name. Decide which unknown fields an earlier release may ignore: today a contract reader and the `migration.json` reader reject any unknown field (task 10).
- Remove the contract's format version from the inputs of the storage hash, and provide the move for existing projects and databases, since every storage hash changes. Save a fixed set of contracts with their hashes and test that the current code reproduces them (task 11).
- Turn each failure to read or decode the marker into a warning. Today such a failure fails the query (task 13). prisma/orm#30537, open since October, changes the same code.
- When the formats are fixed at `8.0.0`, save one sample of each stored file and each database record, and a set of migrations with their snapshots. Test on every release that the current code reads the samples and applies the migrations, for PostgreSQL and MongoDB (task 12).

**To decide when it starts.** Whether the format version also leaves the profile hash and the execution hash; the policy names only the storage hash. How an existing database moves to its new hash: `db sign`, or a migration with no operations. Whether the MongoDB runtime, which has no marker check today, gains one.

### 3. Minimize the exported TS APIs of GA packages and guarantee them until the next major version

**Purpose.** Everything a user can import from a GA package keeps working until Prisma 9. So before `8.0.0` we export only what we mean to keep.

**What it achieves.**

- Each published package exports only what we intend to support for the whole major. This holds for the facades and for the platform packages.
- No published import path and no exported name contains "internal".
- An application depends on its facade, its extension packages and the `prisma` tool, and on nothing else from us.
- Our own products use only what any user can: the Supabase extension, Composer, the `prisma` tool and the control plane.

**How, where we know.**

- Remove every export we do not intend to cover. The 21 published packages have 1,036 export paths; `@prisma/orm-postgres` has 164, including general helpers such as `./utils/array-equal` (task 3).
- Rename every published import path that contains `internal`: 15 paths in 7 packages, such as the facade's `./internal/options`. Each export in them gets a proper entrypoint, a name that carries its level, or is removed. Exported names such as `InternalError` are renamed too (task 8).
- Fix the Supabase extension. It depends on the facade `@prisma/orm-postgres` and imports four of its `internal` entrypoints, where every other extension package depends only on platform packages (task 7).
- Resolve where `definePrismaConfig` comes from. Every application imports it from `@prisma/cli-engine`, a `0.x` package the policy does not list (task 18).
- Keep or replace each entrypoint that Composer, the `prisma` tool and the control plane import, and change their imports. What each imports is in [analysis.md](analysis.md) (task 22).

**To decide when it starts.** Two decisions are Will's: what the Supabase extension's relationship to the PostgreSQL facade should be, and whether the facade or `prisma` provides `definePrismaConfig` or the policy's list names `@prisma/cli-engine`. This project may prove to be two once its pull requests are counted.

### 4. Catch breaking changes and accidental new exports in CI, by comparing each package's API with the last release

**Purpose.** We find out before a release, not from a user, that a change breaks code written against an earlier release. We also find out when something became importable that we did not mean to support, because an API we expose by accident is one we are then bound to keep.

**What it achieves.**

- A check in CI compares each package's exported API with the last release. It fails on a removal or an incompatible change to anything GA.
- It reports every added API, and an addition is merged only when the reviewer approves it as intended.

**How, where we know.**

- The approaches other projects use are in [research/public-api-compatibility.md](research/public-api-compatibility.md). The check needs its own design document (task 5).
- A comparison of exported declarations does not see a change to a query's result type, which is computed from the user's input. Type tests written against the published packages cover that.
- The check treats a new required member on an interface that users implement as a break. Project 5 records which interfaces those are.

**To decide when it starts.** Which tool, and where the previous release's API is kept.

### 5. Prevent new error codes, built-in names and builder methods from breaking user code

**Purpose.** A release may add features at any time, and an addition must not affect an application that does not use it. In three places today an addition would break existing code. Two of the fixes change published types, so they cannot wait until after `8.0.0`.

**What it achieves.**

- Every exported set that a user's code may handle case by case is declared open or closed. An open set's type has a catch-all member, so the compiler makes the user write a default branch from the start.
- A user's name never puts a built-in name on the ORM client out of reach.
- An extension's name is never taken away by a method we add later.

**How, where we know (all task 19).**

- List the exported sets, such as `SqlMigrationRunnerErrorCode`, `EmitFailureCode` and the `kind` values of query-tree nodes. Declare each open or closed and add the catch-all member to the open ones.
- Give each built-in name on the ORM client a way to be reached when a user's name hides it. Today a user namespace named `fragment` hides `db.orm.fragment`.
- Stop refusing an extension's aggregate operation whose name matches a collection builder method (`ORM.AGGREGATE_OPERATION_RESERVED`). Today, adding a builder method would make a working extension throw.
- Add a check that fails when an error code disappears.
- Record which exported interfaces users implement, for project 4.

**To decide when it starts.** How a hidden built-in name is reached, and which name wins for an aggregate operation.

### 6. Show whether something is GA in a package's version and an API's name, and release each package at its own level

**Purpose.** A user can tell from their own `package.json` and code which parts of Prisma 8 the promise covers. Each database reaches GA on its own date: PostgreSQL can be GA while MySQL is a preview.

**What it achieves.**

- The three levels, Early Access, Preview and GA, are defined in full and published in the Prisma 8 docs, in place of the five undefined labels used there today.
- Each of the 21 packages has a level, written in its version. An API below GA inside a GA package has its level at the start of its name.
- The release process publishes each package at its own version and tag, and can cut `8.0.0` and a later major.
- The command-line tool stops when its major version differs from the library's.

**How, where we know.**

- Turn the working definitions in [maturity-levels.md](maturity-levels.md) into exact requirements for a package to enter each level, and settle every point in its section 6: version numbers while packages are at different levels, what happens to the name `preview_foo` when the API reaches GA, and how a level is written where the name is not a TypeScript identifier. State how the levels relate to the support categories in prisma/orm#25843 (task 1).
- Change the release scripts and workflow. Today they give every package one version, publish everything under `latest`, and cannot produce `8.0.0` without a hand edit. Decide the version ranges between our own packages from `8.0.0`, which are exact pins today, and change the publish step to write them. State the 12 months of fixes for the previous major in `SECURITY.md`, `docs/oss/versioning.md` and the docs (task 16).
- Make the `prisma` tool or the toolchain read the installed library's version and stop on a different major. Nothing compares them today (task 17).

**To decide when it starts.** One decision is Will's: which packages are GA at `8.0.0`. The points in section 6 of [maturity-levels.md](maturity-levels.md) are details for whoever takes the project. This project replaces stream 6, row 4 of the GA plan, "Maturity per package".

## Projects that can follow GA

### 7. Bring Prisma's own database tables up to date in each release, so no upgrade fails on them

**Purpose.** An upgrade never fails because the tables Prisma keeps for itself in a user's database were created by an earlier release.

**What it achieves.** The requirement in section 6.4 of the spec: the ORM brings the marker, ledger and contract tables up to date itself, or, for a change that is not additive, stops and names the one command that does. The user never edits or drops them by hand.

**How, where we know.** On PostgreSQL today the tables are created only if absent and never changed afterwards, and a real database has already failed this way; see [analysis.md](analysis.md). The preferred design is to describe these tables as a contract and change them with Prisma's own migration system. MongoDB has its own code for these records and the requirement applies to it too. It needs its own design document (task 4).

**Until it is built.** Any release that changes these tables must still meet section 6.4 by other means.

### 8. Define promised behaviour in reference documentation shipped inside each package

**Purpose.** A user can look up exactly which behaviour we promise not to change. The reference documentation is the specification: where it is silent, behaviour is unspecified.

**What it achieves.** A reference exists for every export of a GA or Preview package and for every CLI command, config option, error code and file format. It is generated from the code or stored beside it, and ships inside each package as Markdown, so it matches the installed version.

**How, where we know.** Name the reference for each kind of thing, write what is missing, generated where possible, and add a check for each kind that fails when something has no entry, as exists today for error codes. Rewrite the agent skill to refer to the reference where it restates behaviour today (task 14).

### 9. Classify every change to behaviour in its pull request, and list it by class in the release notes

**Purpose.** A user reads, in the release notes, every change in behaviour and why it was allowed. A change made for a package below GA never affects an application that does not use that package.

**What it achieves.** The author of a change states its class and the reviewer checks it. The four classes are in section 5.2 of the spec: a fix to wrong behaviour, a change to specified behaviour, a change to unspecified detail, and a security fix. Every release lists each change to behaviour with its class.

**How, where we know.**

- The pull request template and the review skills ask for the class, and a check rejects a pull request without one. The release notes group changes by class, always list a new rejection of input, and mark security fixes. `SECURITY.md` states that every security fix gets a published notice. Config, CLI and builder input gain a way to warn before a later release rejects, as schema files have today (task 15).
- MySQL, MariaDB and SQLite share the SQL family package and the framework with PostgreSQL. Either changes for a package below GA stay out of shared packages, or tests show they do not affect a GA target (task 21).

### 10. Make the changes an upgrade needs with a deterministic tool, not a guide

**Purpose.** When an upgrade needs a change to a user's project, a tool makes it, with the same result on every run. A guide applied by an agent does not count.

**What it achieves.** The requirement in section 10 of the spec, within a major and for the move to a new major, including carrying migrations forward. Where the correct edit depends on what the user meant, the tool finds every affected place, changes none, and reports what must be decided.

**How, where we know.** The project defines what the tool is, how a change that needs one gets its part of the tool, and how the tool replaces today's per-release upgrade guides (task 9).

### 11. Follow each maker's lifetime for supported versions of Node.js, TypeScript and databases, and test them in CI

**Purpose.** A user knows which versions of Node.js, TypeScript, each database and each driver we support, and until when. We do not drop a version by our own choice within a major.

**What it achieves.** For each thing Prisma runs on, the docs state which event ends our support for a version. CI tests every supported version. A declared minimum cannot rise within the major unnoticed.

**How, where we know.**

- State the event for Node.js, Bun, Deno, TypeScript, PostgreSQL, MongoDB, the other databases and each driver, and publish it on the supported-versions page (the rest of task 6; project 1 revises the decision record).
- CI runs against each supported version of Node.js, each database and each driver, and against the newest and the next TypeScript release. Each package declares its Node.js minimum, and a check fails when a declared minimum rises (task 20). prisma/orm#30669, open since October, declares one Node.js range on every package.

### 12. Publish the compatibility policy in the user docs

**Purpose.** A user can read the promise itself.

**What it achieves.** A page in the Prisma 8 docs tells an application developer and an extension author what a release will never break, what may change and how they will be told, and how long Prisma 8 receives fixes.

**How, where we know.** It is the spec rewritten for users, not a new design. It is written last, once the other projects are complete, so that it states what was built and includes what we learned on the way (task 23).

## Moved out of this stream

Finishing the rename of "extension pack" to "extension" (task 2) is terminology clean-up and not part of the compatibility promise. It is row 15 of stream 6 in the GA plan. On 2026-11-23 the old term appeared in 74 files under `docs/`, 136 under `packages/`, 9 under `examples/`, 5 rules, 2 skills, and 29 Prisma 8 pages in prisma/web. It is done when a search for "extension pack" finds nothing outside release notes and other historical records.

## Done

On 2026-11-23 every rule in the spec was checked against the repository: 135 rules, 19 already true. The reports are [research/gap-packages-and-api.md](research/gap-packages-and-api.md), [research/gap-stored-data.md](research/gap-stored-data.md) and [research/gap-docs-releases-tooling.md](research/gap-docs-releases-tooling.md). Tasks 10 to 22 came from them.
