# Reduce what the GA packages export

This is one project of the compatibility work for Prisma 8 general availability (GA). The compatibility work has one goal: from release `8.0`, an application built on Prisma 8 upgrades to any later `8.x` release with no changes.

The policy and the stream's plan are on the branch `ga-compatibility` (draft pull request prisma/orm#31193), under `projects/ga-compatibility/`: `spec.md` section 4.3 (who each package is for), `maturity-levels.md` (how a level is written in a name) and `plan.md`, the section for project 3. To read them: `git fetch bot ga-compatibility`, then `git show FETCH_HEAD:projects/ga-compatibility/<file>`.

## Purpose

The policy promises that everything a user can import from a GA package keeps working until Prisma 9. After release `8.0`, removing an export needs a major version. Adding one never does. So before `8.0` we export only what we mean to keep.

After this project:

- Every import path and every exported name of a GA package is one we mean to keep until Prisma 9, and [audit.md](audit.md) says why each path is there.
- No published import path and no exported name contains "internal".
- Application code imports from its facade (the package an application installs for its database, such as `@prisma/orm-postgres`), from its extensions and from `@prisma/cli-engine`.
- Our own products (the Supabase extension, Composer, the `prisma` tool, the control plane) import only what any user can.

## At a glance

Today `@prisma/orm-postgres` has 163 import paths. Fifteen are its own code. The other 148 pass a platform package on under the facade's name, whether or not an application has a use for it:

```ts
import { arrayEqual } from '@prisma/orm-postgres/utils/array-equal'
import { buildPostgresQueryMembers } from '@prisma/orm-postgres/internal/transaction-members'
import { planIssues } from '@prisma/orm-postgres/target/issue-planner'
```

All three would be promised until Prisma 9. After this project none of them exists. What remains is what an application writes, what our generators write into its files, and what the docs teach:

```ts
import { defineConfig } from '@prisma/orm-postgres/config'
import postgres from '@prisma/orm-postgres/runtime'
import type { Contract } from './contract.d.ts' // which imports '@prisma/orm-postgres/contract/types' and the like
```

## How a path earns its place

The audit applies these tests to each import path. The first that holds decides.

1. **A generator writes it.** A path that `contract.d.ts`, a migration file or a file from `prisma orm init` imports stays. Users keep those files without regenerating them.
2. **An application needs it to use its database.** Defining a contract, configuring, querying, running and writing migrations, handling errors. The evidence is the user documentation, the skills, and the source of the example applications.
3. **An extension or target author needs it.** This applies to the platform packages (the framework, the SQL family, the PostgreSQL target and the toolchain), which extension authors build against. The evidence is what our own extensions and targets import, because an outside target needs what ours need.
4. **Another package of ours imports it across a package boundary.** Each module is published from exactly one package, so such a path cannot be removed. It stays, and the audit marks it as kept for that reason.
5. **Otherwise it is removed.** A path whose only importers are the owning package's own tests is not published.

A name below GA inside a GA package carries its level at the start (`ea_foo`), as `maturity-levels.md` defines.

## Scope

The packages that are GA at release `8.0`: `@prisma/orm-postgres`, `@prisma/orm-framework`, `@prisma/orm-family-sql`, `@prisma/orm-target-postgres`, `@prisma/orm-toolchain`, `@prisma/orm-extension-pgvector`, `@prisma/orm-extension-postgis`, `@prisma/orm-extension-arktype-json`, `@prisma/orm-postgres-contrib`, `@prisma/orm-extension-middleware-cache` and `@prisma/orm-better-auth`.

The packages below GA (MySQL, MariaDB, SQLite, MongoDB and their platform packages, and the Supabase extension) are not covered by the promise, so their exports are not reduced one by one. Two things still reach them: the rule that nothing published is named "internal", and the list of platform paths every facade passes on, which is shared code.

## Decisions already made

Settled with the operator on 2026-11-26. This project does not reopen them without new evidence.

- **Nothing published is named "internal"**: no import path and no exported name.
- **`definePrismaConfig` stays in `@prisma/cli-engine`.** That package, in the prisma/prisma-cli repository, gets a GA release with the compatibility promise for `definePrismaConfig` and the config types. Importing from `prisma/config` was rejected: `prisma` is built from this repository's toolchain, so each repository would need the other's release first.
- **The Supabase extension builds on the PostgreSQL facade.** Its client is a variant of the facade's client, and its application already installs `@prisma/orm-postgres`. The facade's four `internal` paths are deleted. The parts Supabase uses are exported from `@prisma/orm-postgres/runtime` and `@prisma/orm-postgres/static` with the Early Access prefix. The runtime class it subclasses and `validatePostgresContract` move to `@prisma/orm-target-postgres` with the prefix. Supabase names the facade as a peer: the one stated exception to "an extension builds only on platform packages". The SQL family's `internal/prepared-query` path gets a proper Early Access name.
- **A promotion never removes a name.** When `ea_foo` is promoted, the new name is added and the old one stays, deprecated, until the next major.

## Non-goals

- **Changing behaviour.** This project removes, renames and moves exports. No function changes what it does.
- **The release of `@prisma/cli-engine`.** It is another repository's work. This project files the ticket.
- **Reference documentation for what remains.** That is project 8 of the stream.
- **The check that fails on a removed export.** That is project 4 (prisma/orm#31201, prisma/orm#31217). This project follows its contributor guide: every changed `api.txt` is explained in the pull request.

## Definition of done

- No published import path or exported name contains "internal".
- Every remaining import path of a GA package is in [audit.md](audit.md) as kept, with the test it passed.
- The example applications, the Supabase example included, build and pass in CI against the reduced exports.
- Composer, the `prisma` tool, the control plane and create-prisma each have a pull request or a ticket that stands alone for every path they import that this project removes or renames.
- prisma/prisma-cli has a ticket for the GA release of `@prisma/cli-engine`.
- The upgrade instructions and the upgrade skill say what a user's imports change to.
- The decision record on the published packages and the versions design each state the Supabase exception.
- Every pull request has passed a drive code review and merged, and carries the plan and status updates for its own work.
