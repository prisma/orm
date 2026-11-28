# Rollout of Prisma 8.0: the checklist

Everything that has to happen to move from the release candidates (`8.0.0-rc.N`) to release 8.0, which is published as `8.0.1`. It is one ordered list so that nothing scattered across the projects' plans is missed. Each item has an owner and a check that shows it is done.

Release 8.0 is not cut until every item in part 1 is checked. Part 2 is the day of the cut.

**How to add an item.** A project that creates work which must happen at or before 8.0 adds its item here when it creates the work, with an owner and a check. Then it says so in its own plan. If the owner is a session, name the session and the project. Keep each item to what must be done and how anyone can tell it is done; the details stay in the project's plan.

This file is a first version, recorded on 2026-11-28 from the projects' plans. Where it will live for the release (a file on `main` that the release 8.0 procedure in `docs/oss/releasing.md` opens with) is not settled yet. Until then it is kept here on the planning branch.

## 1. Before 8.0 is cut

| # | Item | Owner | Check |
| --- | --- | --- | --- |
| 1 | Remove the release-candidate stopgap of capabilities by database version: every declaration whose doc comment says "Prisma 8.0 removes", its tests and fixtures, and the docs sections that describe it. Add an upgrade instruction that the `requiredCapabilities` list is now required, and that a contract a release candidate emitted must be emitted again. | heathcliff-78, capabilities by database version (stream 6, row 10). The full list is in `projects/capabilities-by-database-version/plan.md`, "Before 8.0: remove the release candidate stopgap" | A search for "Prisma 8.0 removes" finds nothing |
| 2 | Delete the readers of format version 0, the files a release candidate wrote without a `formatVersion`. | alexvanhalen-55, stream 7 project 2 | The test that fails while a version 0 unit exists and the release is not a pre-release passes on the release commit |
| 3 | Save the samples of every stored file and database record that 8.0 writes, for PostgreSQL and MongoDB, so every later release is tested against them. | alexvanhalen-55, stream 7 project 2 (part 4, "Saved samples") | The samples are in the repository, written by the release commit's code, and their test runs in CI |
| 4 | Squash the release candidates' migrations of Prisma's own tables (the `_prisma` contract space) into the fewest migrations possible, so 8.0 does not ship obsolete steps. A database a release candidate set up records the hash of the last of these migrations it ran, so 8.0 must still recognise every hash a release candidate could have recorded, and treat it as "run the first migration again; each step skips what already holds". Otherwise 8.0 refuses that database. | laozi-26, stream 7 project 7, which designs the list of hashes when the step is due | A database set up by each release candidate that shipped these migrations is brought up to date by 8.0's `db migrate`, shown against a real PostgreSQL database |
| 5 | A Prisma Studio release that reads `_prisma` and falls back to `prisma_contract` is published before the ORM release that renames the schema. Console (`prisma/pdp-control-plane`) moves to that Studio release. | laozi-26, stream 7 project 7, with Studio's maintainers | The Studio version is published, and the upgrade instructions name it |
| 6 | Update the upgrade skills. Today they describe moving from one release candidate to the next; from 8.0 an upgrade within the major needs no change. | keithrichards-58, stream 7 project 6 | The shipped skills say nothing that contradicts `docs/oss/versioning.md` § "What stays compatible" |
| 7 | The API compatibility job in CI finds each package's last release at that package's own version, such as `8.0.1-ea.0` (TML-3987). Without it the job fails on every pull request after 8.0.1. | keithrichards-58, stream 7 project 6 | TML-3987 merged |
| 8 | The versioning and compatibility policy, and the ORM's page, are published on prisma.io. | Stream 7 project 12, no session yet | The pages are live, and `docs/oss/versioning.md` links to them |
| 9 | The one-time hash change and every other change to hashes or stored files land in the release candidates, so release-candidate users rewrite their files and sign their databases at most once before 8.0. Known today: format versions (prisma/orm#31200), the hash change (prisma/orm#31203), and the capabilities rename (`requiredCapabilities` with `db.` and `conn.` keys), in that order, with no release in between. | alexvanhalen-55 and heathcliff-78 | All three merged and in one release candidate |
| 10 | Prisma's own tables: the `_prisma` schema and the split of the marker into signatures and config ship in one release, before 8.0. | laozi-26, stream 7 project 7 | Slices 1 and 2 merged together |
| 11 | `@prisma/cli-engine` has a GA release, with the compatibility promise for `definePrismaConfig` and the config types, which applications import from it (TML-3986). | prisma/prisma-cli maintainers; tracked by gilderoy-93, stream 7 project 3 | A version of `@prisma/cli-engine` that is not `0.x` is published on the registry |
| 12 | The control plane (`prisma/pdp-control-plane`) changes its four imports from `@prisma/orm-postgres` (`adapter/control`, `driver/control`, `target/control`, `driver/runtime`), which project 3's facade slice removes. | gilderoy-93, stream 7 project 3, with a pull request or ticket there | Merged before the release that carries the facade slice |
| 13 | Composer changes its one import, `@prisma/orm-postgres/family-contract/canonicalization-hooks`, to `@prisma/orm-family-sql/contract/canonicalization-hooks`. | gilderoy-93, stream 7 project 3 | Merged before the release that carries the facade slice |
| 14 | The SQL family's GA class `SqlRuntimeBase` uses Early Access names for its prepared-statement members (from prisma/orm#31241). Either those members are marked Early Access, or the names are promoted to GA. | gilderoy-93, stream 7 project 3, slice 3 | Decided and merged |

## 2. The day of the cut

| # | Item | Owner | Check |
| --- | --- | --- | --- |
| 15 | Follow `docs/oss/releasing.md` § "Procedure: release 8.0": check the release plan, set the version to `8.0.1`, and run the release skill. | The maintainer who cuts the release | The release is published, and each package is at the version and tag the release plan printed |
| 16 | The release notes tell every user what to write in `package.json`, once, by hand. | The maintainer who cuts the release | The notes have the lines for a GA database and for an Early Access one |
| 17 | Rewrite the docs that stop being true once 8.0 ships, such as `docs/oss/versioning.md` § "Until release 8.0". The list of pages is to be written by stream 7 project 6. | keithrichards-58 writes the list; the maintainer applies it | Every page on the list is changed in the release pull request |
