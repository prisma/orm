# GA compatibility: plan

The plan for stream 7 of the Prisma 8 GA plan (`planning/plan.md` on the branch `planning/prisma-8-ga`), which lists the same projects. The policy is in [spec.md](spec.md) and [maturity-levels.md](maturity-levels.md).

## Goal

From `8.0.0`, an application built on Prisma 8 upgrades to any later `8.x` release with no changes to its code, its generated files or its database.

Upgrading becomes routine, so users stay on the latest release and we maintain one release line for each major. It is always clear to a user what they can rely on. A project belongs in this stream when it removes a reason for a user to hesitate before upgrading.

## How the policy comes into force

Each project brings three things together, in the same pull requests: the code changed to conform to its part of the policy, the checks that enforce it, and the documentation of it, including any decision record. Nothing that describes a part of the policy is merged to `main` before the code conforms. What is on `main` is therefore what is in force.

A part is in force from the first release after its project merges. Until `8.0.0` that means we follow it by default and the checks enforce it, and we can still break it by a deliberate decision, with upgrade instructions. At `8.0.0` it becomes the promise to users.

Some parts can only start at `8.0.0`. Nothing can be promised about exports until they are reduced, which project 3 does, and no package is GA before then.

### Drafts to start the documentation from

Drafts exist for most of the documentation: decision records for the policy and for the maturity levels, and corrections to the docs, rules and skills that contradict them. They come from the pull request prisma/orm#31194, which was closed without merging because it documented the whole policy ahead of the code. A project starts its documentation from these drafts and takes only its own part.

- **Where they are:** the branch `docs/compatibility-policy-records`, at commit `126f6d2d40`.
- **If the branch is ever deleted:** the drafts stay on GitHub as `refs/pull/31194/head`, at commit `6b840b95f6`. Fetch them with `git fetch bot refs/pull/31194/head`.
- **Which project takes what:** [documentation-drafts.md](documentation-drafts.md) in this folder. It is a copy of the list the drafts' author wrote, kept here so that it does not depend on that branch.
- **To read a draft:** `git fetch bot docs/compatibility-policy-records`, then `git show FETCH_HEAD:<path>`.

## How to read this plan

Each project is sized for one to four pull requests. Its design is written when it starts.

New work joins a project only when it serves that project's purpose. Work that serves the goal and fits no project becomes a new project.

Projects 2 to 7 and 13 are Must for GA, 9 and 12 are Aim, and 8, 10 and 11 are Later. Will confirmed this on 2026-11-24; it is updated as we go. Project 4 comes before project 3. There is no project 1: it was to document the whole policy on `main` ahead of the code, and each project now documents its own part.

"Task N" is the number a piece of work had before 2026-11-24. The reports under [research/](research/) use those numbers. The facts about the code were read on 2026-11-23 and are rechecked when a project starts.

## Projects that GA requires

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
- Take along five small corrections that are true of the code today and listed in that handover file: remove a stability scheme for capabilities that was never built from the Ecosystem subsystem doc and `docs/reference/capabilities.md`, note that the per-component version matrix in the decision record on versioning was never built, and three wording fixes in `docs/oss/versioning.md`, the decision record index and `AGENTS.md`.
- From the next release candidate, publish "How to upgrade" in each GitHub Release: numbered steps a person can follow, in the release's own text. Today a release links to recipes written for an agent and lists about 160 lines of breaking changes, with nothing that says what to do. The steps, the agent's recipe and the list of changes are generated from one source, the fragments each pull request adds under `upgrade-instructions/pending/`, and the check on release notes requires the section. Starting now also puts pressure on each release candidate to carry few changes that a user must make by hand. The release it matters most for is `8.0.0`, which asks the most of release-candidate users.
- Update the upgrade skills before GA. Today they describe moving from one release candidate to the next. From `8.0.0` an upgrade within the major needs no change, so skills that still describe release-candidate upgrades would tell users the opposite of the promise.
- Write the procedure for releasing `8.0.0`, with the list of docs to rewrite on that day. A draft is in prisma/orm#31194, which was not merged.
- Make the `prisma` tool or the toolchain read the installed library's version and stop on a different major. Nothing compares them today (task 17).
- Make create-prisma list the platform packages in the apps it generates, in its first release on an ORM version that contains prisma/orm#31204. That pull request makes the database packages name the platform packages (framework, family, target, toolchain) as peers, and `prisma orm init` writes them and every required peer they declare, such as `@prisma/cli-engine` and `temporal-polyfill`, into the app's `package.json`. create-prisma writes that file itself and does not run `init`, so its Yarn apps would get none of them, and npm, pnpm and Bun apps would fail the same way where installing peers is turned off. Generated apps list the same packages at the database package's version, for every package manager, for example by copying the database package's `peerDependencies` and adding the toolchain's required peers. The code is `writePrismaDependenciesEffect` in create-prisma's `src/tasks/install.ts`, and `src/constants/dependencies.ts`. create-prisma 0.14.10 lists only `@prisma/cli-engine`, for Yarn apps. Its CI builds one Yarn MongoDB app and no Yarn PostgreSQL app; add one.

**To decide when it starts.** One decision is Will's: which packages are GA at `8.0.0`. The points in section 6 of [maturity-levels.md](maturity-levels.md) are details for whoever takes the project. This project replaces stream 6, row 4 of the GA plan, "Maturity per package".

### 7. Bring Prisma's own database tables up to date in each release, so no upgrade fails on them

**Purpose.** An upgrade never fails because the tables Prisma keeps for itself in a user's database were created by an earlier release.

**What it achieves.** The requirement in section 6.4 of the spec: the ORM brings the marker, ledger and contract tables up to date itself, or, for a change that is not additive, stops and names the one command that does. The user never edits or drops them by hand.

**How.** The agreed design is in [designs/7-prismas-own-tables.md](designs/7-prismas-own-tables.md): the tables are a contract space the framework owns, read from the installed package and applied when migrations are executed. `8.0.0` writes the marker row for that space, which is why this project is needed for GA. On PostgreSQL today the tables are created only if absent and never changed afterwards, and a real database has already failed this way; see [analysis.md](analysis.md) (task 4).

**To decide when it starts.** The points listed as not yet discussed in the design.

## Projects that can follow GA

### 8. Define promised behaviour in reference documentation shipped inside each package

**Purpose.** A user can look up exactly which behaviour we promise not to change. The reference documentation is the specification: where it is silent, behaviour is unspecified.

**What it achieves.** A reference exists for every export of a GA or Preview package and for every CLI command, config option, error code and file format. It is generated from the code or stored beside it, and ships inside each package as Markdown, so it matches the installed version.

**How, where we know.** Name the reference for each kind of thing, write what is missing, generated where possible, and add a check for each kind that fails when something has no entry, as exists today for error codes. Rewrite the agent skill to refer to the reference where it restates behaviour today (task 14).

### 9. Classify every change to behaviour in its pull request, and list it by class in the release notes

**Purpose.** A user reads, in the release notes, every change in behaviour and why it was allowed. A change made for a package below GA never affects an application that does not use that package.

**What it achieves.** The author of a change states its class and the reviewer checks it. The four classes are in section 5.2 of the spec: a fix to wrong behaviour, a change to specified behaviour, a change to unspecified detail, and a security fix. Every release lists each change to behaviour with its class.

**How, where we know.**

- The pull request template and the review skills ask for the class, and a check rejects a pull request without one. The release notes group changes by class, always list a new rejection of input, and mark security fixes. `SECURITY.md` states that every security fix gets a published notice. Config, CLI and builder input gain a way to warn before a later release rejects, as schema files have today (task 15).
- Every `8.x` release keeps the "How to upgrade" section that project 6 starts. For a release within the major it says there is nothing to do beyond updating the packages, unless one of the exceptions the policy allows applies, and then it lists the step. It is generated from the same single source as the list of changes.
- MySQL, MariaDB and SQLite share the SQL family package and the framework with PostgreSQL. Either changes for a package below GA stay out of shared packages, or tests show they do not affect a GA target (task 21).

### 10. Make the changes an upgrade needs with a deterministic tool, not a guide

**Purpose.** When an upgrade needs a change to a user's project, a tool makes it, with the same result on every run. A guide applied by an agent does not count.

**What it achieves.** The requirement in section 10 of the spec, within a major and for the move to a new major, including carrying migrations forward. Where the correct edit depends on what the user meant, the tool finds every affected place, changes none, and reports what must be decided.

**How, where we know.** The project defines what the tool is, how a change that needs one gets its part of the tool, and how the tool replaces today's per-release upgrade guides (task 9).

**Also in this project.** Probably retire the system of upgrade scripts under `upgrade-instructions/` with its coverage check. It exists for releases that may break, and from `8.0.0` a release within the major may not. Updating the upgrade skills is not here: it must happen before GA, and is in project 6.

### 11. Follow each maker's lifetime for supported versions of Node.js, TypeScript and databases, and test them in CI

**Purpose.** A user knows which versions of Node.js, TypeScript, each database and each driver we support, and until when. We do not drop a version by our own choice within a major.

**What it achieves.** For each thing Prisma runs on, the docs state which event ends our support for a version. CI tests every supported version. A declared minimum cannot rise within the major unnoticed.

**How, where we know.**

- State the event for Node.js, Bun, Deno, TypeScript, PostgreSQL, MongoDB, the other databases and each driver, and publish it on the supported-versions page (task 6), and revise the decision record on version support, which says "We raise floors freely".
- CI runs against each supported version of Node.js, each database and each driver, and against the newest and the next TypeScript release. Each package declares its Node.js minimum, and a check fails when a declared minimum rises (task 20). prisma/orm#30669, open since October, declares one Node.js range on every package.

### 12. Publish one versioning and compatibility policy for Prisma's open-source products, and a page for each product that applies it

**Purpose.** A user can read the promise itself, and the ORM, the `prisma` command-line tool and Composer make the same promise in the same words.

**Why a general policy.** Project 13 brings every command of the `prisma` tool under the policy, Composer's included, and its work runs in the prisma-cli repository and in Composer's command-line package as well as here. Those repositories need a policy written for any product, not one written for the ORM. Other Prisma products can adopt it later without changing it.

**What it achieves.**

- One general policy, published on prisma.io from prisma/web. It names no product. It says what each part of a version number means; defines the three maturity levels and how a user sees each one (a version suffix on a package, the level in an API's name, the level in a command's help text); says what is promised for each kind of thing a product exposes (code APIs, data it stores, commands and their machine-readable output, configuration); how a change is classified and announced; and how long the previous major receives fixes.
- A short page for each product: the ORM, the `prisma` tool and Composer. It lists what the product exposes (its packages, its commands, what it stores) and any exception to the general policy.
- Each repository's own versioning document links to the general policy, and its checks and release scripts apply it.

**How, where we know.**

- Split [spec.md](spec.md) into the general policy and the ORM's page. Section 13 of the spec says which part goes where.
- Publish it as soon as it is written, not after the other projects. It sets the requirements for each maturity level, and project 6 is setting every ORM package to its real level now, so what we publish matches what we ship. Where something does not yet match, we say so and say that it is being worked on.
- Prior art to verify before citing: Google Cloud's single page of launch stages, which every product refers to, and the Kubernetes deprecation policy, which covers its API, its command-line flags and its feature flags with rules for each maturity level.

### 13. Keep scripts and agents that drive the `prisma` command-line tool working, by designing every command's flags, exit codes and machine-readable output before `8.0.0` and checking them in CI

**Purpose.** A script or an agent that calls a command and reads its result keeps working across every `8.x` release, and can tell what each field of the output means.

**Why it is a project of its own.** The policy promises three surfaces: the TypeScript API, what Prisma stores, and the command-line tool. Projects 3 and 4 decide and check the first, and project 2 the second. No project did either for the third. Its intent is different from theirs, it needs its own design, and its work is spread over every command. It covers the whole `prisma` tool, the commands of every product in it, Composer's included. `prisma` takes the ORM's major and minor version (project 6), and a user who sees `prisma` 8.4 reads that number as one promise for every command in it. The config file is not here: its options are TypeScript types, which projects 3 and 4 cover.

**What it achieves.**

- What a script may depend on is written down: each command's name, flags, exit codes and every output a program reads. That is all output not written for a person: the `--json` documents, the data lines a command prints to stdout, the Markdown output, which agents read, and any file a command writes for a program to read, such as a report.
- Each of those outputs follows one set of principles, and the ones that do not are corrected before `8.0.0`, because a format cannot change after it.
- A check in CI fails when any of these changes incompatibly, as project 4's does for exports.

**How, where we know.**

- Survey every command: its flags, its exit codes and each machine-readable output it has. The `--json` output is the largest part. Today nobody has designed it: each command's document is whatever was chosen when the command was written. The data lines already have a rule in the CLI Style Guide (tab-separated fields, new fields only appended). The Markdown output is produced by `@prisma/cli-engine`, which renders every command, and has no written rule yet. So part of this project's work is in the engine, and the survey decides what in that output a reader can depend on.
- Settle the principles in a decision record, for every machine-readable format: what a document reports (the result, or the input given back), stable names, one meaning for each field, how an error is shaped, what a reader must ignore so that an added field does not break it, how a format is versioned, and which maturity level it has. The "JSON semantics" section of the CLI Style Guide is the starting point.
- Each command's help and usage text states its maturity level when it is below GA. A command that is GA carries the full promise, including any file it writes. No other form is added to mark a level: no `alpha` or `beta` command groups, no change to the command's name.
- Bring each command into line, and add the check.
- Publish a schema for every machine-readable format, as `prisma orm init` already does with `@prisma/orm-toolchain/cli/init-output`, so that a program reading it can test against the real format. This includes `@prisma/composer-cli`'s `deploy --report` file. Whether it ships a schema or a sample report today is not checked.
- In create-prisma, test the deploy report parser (`src/tasks/composer/deploy-report.ts`) against the report the pinned `@prisma/composer-cli` writes, using that schema or by running the pinned version. Today its tests in `tests/telemetry.test.ts` use hand-written reports, so they pass whatever the pinned tool writes. That is how the move from format `1` to `2` went unnoticed. This is the consumer's own check and stays even after the tool's own check exists.
- The work and the checks run in three repositories: this one (the ORM's commands), prisma-cli (the `prisma` tool and `@prisma/cli-engine`), and Composer's command-line package (`@prisma/composer-cli`). The design is done in this stream. `@prisma/composer-cli`'s own version number becomes internal: users rely on the version of `prisma`.

**The example that raised it.** `prisma orm init --json`, whose schema is in `packages/1-framework/3-tooling/cli/src/commands/init/output.ts` and is published as `@prisma/orm-toolchain/cli/init-output`. Its `package` field is one string, the database package, although `init` installs many packages, which it reports separately under `packagesInstalled`. Its `target` field held `'postgres'` or `'mongodb'` until prisma/orm#31093; since then it holds a short name for a database in Prisma's list and a package name for any other, so a reader cannot tell which kind of value it has. Nothing documented reads either field.

**A second example.** create-prisma runs `prisma deploy --report <file>` and, on a failed deploy, reads `failure.code` from the file for telemetry. The file carries a format version, now `2`. create-prisma's parser accepted only `1`, so when the format moved to `2` the code was dropped with no error and no failing test. It was found by reading the code and fixed in create-prisma 0.14.10. Nothing yet would catch the next change.

**Already decided.** The input flag `--target` keeps its name. Project 6 changes no JSON format.

**GA waits for it.** `8.0.0` is not released until this work is complete. No output ships uncorrected under a lower maturity level.

**To decide when it starts.** Its design discussion has not been held. One question for it: project 6 puts a level in a flag's name (`--preview-foo`), while a command states its level only in its help text. Whether flags should follow commands, for one form across the tool.

## Moved out of this stream

Finishing the rename of "extension pack" to "extension" (task 2) is terminology clean-up and not part of the compatibility promise. It is row 15 of stream 6 in the GA plan. On 2026-11-23 the old term appeared in 74 files under `docs/`, 136 under `packages/`, 9 under `examples/`, 5 rules, 2 skills, and 29 Prisma 8 pages in prisma/web. It is done when a search for "extension pack" finds nothing outside release notes and other historical records.
