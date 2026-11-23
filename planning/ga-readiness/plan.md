# GA readiness: plan

Tasks agreed so far. The spec ([spec.md](spec.md)) records the decisions each task implements.

## Tasks

Not in priority order. Each must be done by the end of the project.

1. **Specify the three maturity levels in full and document them for users.** The `maturity-levels.md` (section 2) holds working definitions: each level is defined by what we test for the package and whether a failure blocks a release. This task turns them into exact requirements for a package to enter each level, and publishes them as a maturity page for Prisma 8 in the docs (prisma/web). Today the only ORM definitions are in the Prisma 7 section (`/orm/v7/more/releases`), and the Prisma 8 pages use five labels without defining any: release candidate, early access, early preview, experimental, coming soon. The page replaces those five. It also states how the levels relate to the support categories for databases, runtimes and frameworks in [prisma/orm#25843](https://github.com/prisma/orm/issues/25843) (First-Class, Supported, Unofficial), which is a separate scale about where we spend effort.

   The task also settles every point in section 6 of `maturity-levels.md`: version numbers while packages are at different levels, what happens to an API's old name when it reaches GA, and how a level is written where the name is not a TypeScript identifier.

   Points the working definitions leave unanswered, found in review:
   - The framework package has a level but no database, so "the full test suite against its database" does not describe it.
   - Which release a failing test blocks, while every package is released together.
   - Who decides which features a Preview package has, and what "missing" is measured against.
   - Which level the `8.0.0-rc.N` releases have.

2. **Finish renaming "extension pack" to "extension".** The glossary (`docs/glossary.md`, "Terminology Alignment Tracker") records the user-facing term as "extension" and marks the rename done, but the old term is still in use: on 2026-11-23 it appeared in 74 files under `docs/`, 136 under `packages/`, 9 under `examples/`, 5 rules, 2 skills, and 29 Prisma 8 pages in prisma/web. "Pack" named a publishing mechanism we no longer use. Done when a search for "extension pack" finds nothing outside release notes and other historical records.

3. **Reduce what each published package exports.** Before `8.0.0`, remove every export we do not intend to cover, from the facades and the platform packages (spec 4.3).

4. **Make the ORM keep its own tables up to date.** The requirement is in the spec (section 6.4): no upgrade fails because the marker or ledger tables are missing or in an older form. On PostgreSQL today the tables are created only if absent and never changed afterwards (`packages/3-targets/postgres/1-target/src/contract-free/control-bootstrap.ts`), and a real database has already failed this way (see `analysis.md`). The preferred design is to describe these tables as a contract and change them with Prisma's own migration system. It needs its own design document. It may be built after `8.0.0`. Whatever the mechanism, any release that changes these tables must meet section 6.4. MongoDB has its own code for these records (`packages/3-targets/mongo/2-adapter/src/core/marker-ledger.ts`) and the requirement applies to it too.

5. **Build the check that compares each package's exported API with the last release** (spec section 12). It fails on a removal or an incompatible change to anything GA, and it reports every addition so that none is exposed by accident. The research is in `research/public-api-compatibility.md`. It needs its own document.

6. **State, for each thing Prisma runs on, which event ends our support for a version** (spec section 5.5): Node.js, Bun, Deno, TypeScript, PostgreSQL, MongoDB, the other databases and each driver. Some makers publish an end date for each version and some publish none. Publish the result on the supported-versions page in the docs. Revise the recorded decision on version support (`docs/architecture docs/adrs/ADR 222 - Version support policy.md`), which today says "We raise floors freely", and the header of `scripts/validate-typescript-peer.mjs`, which repeats it.

7. **Fix the relationship between the Supabase extension and the PostgreSQL facade.** Facts on 2026-11-23: `@prisma/orm-extension-supabase` lists the facade `@prisma/orm-postgres` as a direct dependency, where every other extension package depends only on platform packages. Its runtime imports four of the facade's `internal` entrypoints (`options`, `static-context`, `transaction-members`, `validate-contract`; see `packages/3-extensions/supabase/src/runtime/supabase.ts`). That is special access, which the spec (section 4.3) rules out, and task 8 renames those entrypoints. An application that uses it creates its client with `supabase({ pg })` from this package and not with the facade. What the relationship should be is not yet decided.

8. **Rename every published import path that contains `internal`** (spec section 4.3), such as the facade's `./internal/options` and `./family-runtime/internal/prepared-query`, and every exported name that contains "Internal". Part of task 3: each export in them is given a proper entrypoint, a name that carries its level, or is removed.

9. **Build the upgrade tool** (spec section 10). Where an upgrade needs a change to a user's project, a deterministic tool makes it. The task defines what the tool is, how a change that needs one gets its part of the tool, and how the tool replaces today's per-release upgrade guides. Its scope includes the move to a new major and carrying migrations forward.

## Tasks from checking each rule against the code

On 2026-11-23 every rule in the spec was checked against the repository. The evidence for each task below is in `research/gap-packages-and-api.md`, `research/gap-stored-data.md` and `research/gap-docs-releases-tooling.md`. Tasks 1 to 9 above cover the rest of what those reports found.

10. **Give every stored file a format version, and make every reader check it first** (spec 6.2). Add a version to `migration.json` and to ref files, and decide how `ops.json` is covered. A reader reports an unknown version as such, before it validates the shape. Rename the contract's `schemaVersion` field and give existing files a path to the new name. Decide which unknown fields an earlier release may ignore.

11. **Make hashes stable for the major** (spec 6.3). Remove the contract's format version from the inputs of the storage hash, and provide the move for existing projects and databases. Save a fixed set of contracts with their hashes and test that the current code reproduces them.

12. **Test that each release reads what `8.0.0` wrote** (spec 6.1, 6.5). When the formats are fixed at `8.0.0`, save one sample of each stored file and each database record, and a set of migrations with their snapshots. Test on every release that the current code reads the samples and applies the migrations, for PostgreSQL and MongoDB.

13. **The runtime marker check never stops an application** (spec 7). Today a failure to read or decode the marker throws. Turn each such failure into a warning.

14. **Produce the reference documentation** (spec 8). Name the reference for each kind of thing we cover: exports, CLI commands, config options, error codes and file formats. Write what is missing, generated where possible, and ship it inside the packages as Markdown. Add a check for each kind that fails when something has no entry, as exists today for error codes. Rewrite the agent skill to refer to the reference where it restates behaviour today.

15. **State each change's class, from the pull request to the release notes** (spec 5.2, 5.3, 9, 12). The pull request template and the review skills ask for the class, and a check rejects a pull request without one. The release notes group changes by class, always list a new rejection of input, and mark security fixes. `SECURITY.md` states that every security fix gets a published notice. Config, CLI and builder input gain a way to warn before a later release rejects, as schema files have today.

16. **Change the release process for packages at different levels** (maturity levels 4; spec 4.3, 11). The scripts and workflow publish each package at its own version and tag, and can cut `8.0.0` and a later major; today they give every package one version. Assign a level to each of the 21 packages. Decide the version ranges between our own packages from `8.0.0`, which are exact pins today, and change the publish step to write them. State the 12 months of fixes for the previous major in `SECURITY.md`, `docs/oss/versioning.md` and the docs.

17. **The command-line tool stops when its major differs from the library's** (spec 4.3). Nothing compares them today.

18. **Resolve where `definePrismaConfig` comes from** (spec 4.3). Every application imports it from `@prisma/cli-engine`, which `prisma orm init` installs. The spec says an application depends on a facade, extension packages and the `prisma` tool, and on nothing else. Either the facade or `prisma` provides the function, or the spec's list names this package.

19. **Make additions safe in the places they are not today** (spec 5.1). List every exported set a user may handle case by case, declare each open or closed, and give the open ones a catch-all member. Give each built-in name on the ORM client a way to be reached when a user's name hides it; today a user namespace named `fragment` hides `db.orm.fragment`. Stop refusing an extension's aggregate operation when a later release adds a builder member with the same name. Record which interfaces users implement, so that the API check (task 5) treats a new required member on them as a break. Add a check that fails when an error code disappears.

20. **Test every supported version** (spec 5.5). CI runs against each supported version of Node.js, each database and each driver, and against the newest and the next TypeScript release. Each package declares its Node.js minimum, and a check fails when a declared minimum rises within the major.

21. **Keep changes for a package below GA from reaching GA packages** (maturity levels 5). MySQL, MariaDB and SQLite share the SQL family package and the framework with PostgreSQL, and every package is released together. Either such changes stay out of shared packages, or tests show they do not affect a GA target.

22. **Move our own products onto covered APIs** (spec 4.3). Composer, the `prisma` tool and the control plane import ORM entrypoints that task 3 may remove or rename. Task 3 keeps or replaces each one they use, and each product changes its imports.

23. **Publish the policy for users.** A page in the Prisma 8 docs that tells an application developer and an extension author what a release will never break, what may change and how they will be told, and how long Prisma 8 receives fixes. It is the spec rewritten for users, not a new design. Write it last, once the other tasks are complete, so that it states what was built and includes what we learned on the way.
