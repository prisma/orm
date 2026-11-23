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

6. **State, for each thing Prisma runs on, which event ends our support for a version** (spec section 5.5): Node.js, Bun, Deno, TypeScript, PostgreSQL, MongoDB, the other databases and each driver. Some makers publish an end date for each version and some publish none. Publish the result on the supported-versions page in the docs.

7. **Fix the relationship between the Supabase extension and the PostgreSQL facade.** Facts on 2026-11-23: `@prisma/orm-extension-supabase` lists the facade `@prisma/orm-postgres` as a direct dependency, where every other extension package depends only on platform packages. Its runtime imports four of the facade's `internal` entrypoints (`options`, `static-context`, `transaction-members`, `validate-contract`; see `packages/3-extensions/supabase/src/runtime/supabase.ts`). That is special access, which the spec (section 4.3) rules out, and task 8 renames those entrypoints. An application that uses it creates its client with `supabase({ pg })` from this package and not with the facade. What the relationship should be is not yet decided.

8. **Rename every published import path that contains `internal`** (spec section 4.3), such as the facade's `./internal/options` and `./family-runtime/internal/prepared-query`. Part of task 3: each export in them is given a proper entrypoint, a name that carries its level, or is removed.

9. **Build the upgrade tool** (spec section 10). Where an upgrade needs a change to a user's project, a deterministic tool makes it. The task defines what the tool is, how a change that needs one gets its part of the tool, and how the tool replaces today's per-release upgrade guides.
