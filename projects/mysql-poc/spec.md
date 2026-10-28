# Project spec — MySQL proof of concept

**Linear:** [MySQL proof of concept](https://linear.app/prisma-company/project/mysql-proof-of-concept-da2bc4144a89) · **GA plan:** stream 1, row 3, "Early MySQL attempt, to find shared code that assumes PostgreSQL"

## Purpose

Prisma 8 must support MySQL and MariaDB. The SQL family was built against Postgres and then SQLite, so its shared code is likely to assume things MySQL does not do. Release candidates may still break APIs; 8.0.0 final may not. This project builds a narrow MySQL target now so that every such assumption is found while it can still be fixed.

The code this project writes is the start of production MySQL support, not a throwaway. The scope is narrow, but what is built is built properly.

The project also fixes a layout problem. Each SQL database is spread across three folders by role (`3-targets/3-targets/postgres`, `3-targets/6-adapters/postgres`, `3-targets/7-drivers/postgres`). Every target moves to one folder per database before any MySQL code lands.

## At a glance

A MySQL 8 database, a contract written in PSL, and the commands a new user runs:

```prisma
model User {
  id    Int    @id @default(autoincrement())
  email String @unique
  role  Role
  posts Post[]
}

model Post {
  id       Int    @id @default(autoincrement())
  title    String
  author   User   @relation(fields: [authorId], references: [id])
  authorId Int
}

enum Role {
  USER
  ADMIN
}
```

```text
$ prisma contract emit
$ prisma migration plan --name init
$ prisma db migrate
$ prisma db verify
✔ Database matches the contract
```

```ts
const db = mysql({ contract: contractFromJson<Contract>(contractJson), url })
const user = await db.orm.User.create({ email: 'a@example.com', role: 'USER' })
const withPosts = await db.orm.User.include('posts').first({ id: user.id })
await db.orm.User.where({ id: user.id }).update({ role: 'ADMIN' })
await db.orm.User.upsert({
  create: { email: 'a@example.com', role: 'USER' },
  update: { role: 'ADMIN' },
  conflictOn: { email: 'a@example.com' },
})
await db.orm.User.where({ id: user.id }).delete()
```

The same runs against MariaDB through the `mariadb` target.

On disk, every database looks the same:

```text
packages/
  2-sql-family/                   was 2-sql
  2-mongo-family/
  3-targets/
    postgres/  { 1-target, 2-adapter, 3-driver, 4-codec-testkit, 9-facade }
    sqlite/    { 1-target, 2-adapter, 3-driver, 4-codec-testkit, 9-facade }
    mongo/     { 1-target, 2-adapter, 3-driver, 9-facade }
    mysql/     { 1-target, 2-adapter, 3-driver, 4-codec-testkit, 9-facade }
    mariadb/   { 1-target, 2-adapter, 9-facade }
  3-extensions/                   extension packs only
```

## Decisions settled in discussion (2026-10-22)

The reasoning and the alternatives rejected are in [`design-notes.md`](./design-notes.md).

1. **One folder per database.** Every target, adapter, driver, codec testkit and facade lives in `packages/3-targets/<db>/`, numbered by dependency order. Mongo moves out of `3-mongo-target/` into the same layout. `2-sql` becomes `2-sql-family`. Extension packs, including the Postgres-only ones, stay in `3-extensions/`. Package names do not change.
2. **The move is its own pull request, before any MySQL code.**
3. **One path through the system, not a broad MySQL.** A small contract, migrations, `db verify`, `db sign`, and ORM create, read with include, update, delete and upsert, on MySQL 8.4.
4. **MariaDB is its own target, `mariadb`, that extends the MySQL target.** It subclasses MySQL's classes and overrides what differs. It is built after MySQL.
5. **Writes return rows on a target without `RETURNING`.** The ORM already reads written rows back by their identity, in the same transaction. A target without `RETURNING` for a statement gets the identity another way: the key values the client generated or the insert id the driver reports for `create`; the keys selected and locked before an `update`; the snapshot `delete` already reads first. Will, 2026-10-22: this is consistent with the principles, because the user asked the ORM for the rows.
6. **What a failed migration leaves is stated by the target's runner.** The SQL family's promise that a failure rolls back every contract space only holds where DDL is transactional; each runner now reports, per run, whether the database is unchanged. MySQL commits on every DDL statement, so its runner applies and verifies one space at a time and writes each space's marker only after it verifies, as the Mongo runner does. Re-running converges.

## Non-goals

- No codec beyond the handful the contract above needs: integers, text, boolean, a date-time, an enum, JSON. The full type matrix is follow-up work.
- No `contract infer`, no Prisma 7 reader for MySQL schemas, no `contract print`.
- No extension packs on MySQL.
- No `prisma init` template for MySQL.
- No MySQL older than 8.4 and no MariaDB older than 10.11.
- No row locking, isolation levels, `distinctOn`, partial indexes or expression indexes on MySQL. Each is refused through a capability the target does not report.
- No change to Postgres or SQLite behaviour beyond what a shared-code fix requires.

**Added 2026-10-23 (Will): an example app, built first, and the public packages are in scope.** `examples/prisma-8-demo-mysql` imports only the public `@prisma/orm-mysql` facade, so the public `@prisma/orm-mysql` and `@prisma/orm-target-mysql` packages are built in this project. The example is built in slice 2c, right after migrations work, and every later slice extends it: a slice is done only when the example runs what it delivered, in CI. The MariaDB slice runs the same example against MariaDB.

## Place in the larger world

- **Target interfaces.** A SQL target supplies a control target descriptor (`packages/2-sql/9-family/src/core/control-target-descriptor.ts`), a control adapter (`.../control-adapter.ts`), a runtime target and adapter descriptor (`packages/2-sql/5-runtime/src/sql-context.ts`), a driver (`packages/2-sql/4-lanes/relational-core/src/ast/driver-types.ts`) and a facade. SQLite is the nearest precedent; the descriptor carries `defaultNamespaceId` and `supportsNamespaces` ([ADR 223](../../docs/architecture%20docs/adrs/ADR%20223%20-%20Target-owned%20default%20namespace.md)).
- **Cross-target inheritance.** The Adapters & Targets subsystem doc describes a target that extends another by subclassing one SPI at a time (its example is Cockroach extending Postgres). `mariadb` is the first real use.
- **Capabilities.** The adapter reports capabilities, the contract records them at emit, and the ORM checks them ([ADR 065](../../docs/architecture%20docs/adrs/ADR%20065%20-%20Adapter%20capability%20schema%20&%20negotiation%20v1.md), `.agents/rules/capabilities-ownership.mdc`).
- **Value space ownership.** The target owns its data types, codecs and codec descriptors ([ADR 254](../../docs/architecture%20docs/adrs/ADR%20254%20-%20Data%20types%20and%20casts.md)). The driver hands codecs the server's text form ([ADR 155](../../docs/architecture%20docs/adrs/ADR%20155%20-%20Driver%20Codec%20Boundary%20and%20Lowering%20Responsibilities.md)).
- **Contract spaces.** [ADR 212](../../docs/architecture%20docs/adrs/ADR%20212%20-%20Contract%20spaces.md) records that the SQL family applies every space in one outer transaction. Decision 6 changes that from a family promise to a target fact. The Mongo family's per-space model (MongoDB Family subsystem doc, "Per-space atomicity model") is the precedent.
- **Transactional DDL fallback.** [ADR 037](../../docs/architecture%20docs/adrs/ADR%20037%20-%20Transactional%20DDL%20Fallback.md) designed commit groups and compensation for targets without transactional DDL. It was never built.
- **Package layout.** [ADR 140](../../docs/architecture%20docs/adrs/ADR%20140%20-%20Package%20Layering%20&%20Target-Family%20Namespacing.md), `docs/architecture docs/Package-Layering.md`, `docs/onboarding/Repo-Map-and-Layering.md` and `.agents/rules/directory-layout.mdc` describe the current layout and name `packages/3-targets/**` (by role) as the home for SQL targets. Decision 1 replaces that. Folder paths are hard-coded in `architecture.config.json`, `packages/0-shared/publish-surface/src/shells.ts`, `coverage.config.json`, `tsconfig.base.json` and three lint scripts.
- **No target branches.** `.agents/rules/no-target-branches.mdc` forbids naming a target in shared code. The coupling register lists the places that do.
- **Concurrent work.** The project "Mongo authoring follows the Postgres structure" (merged in prisma/orm#30832 and prisma/orm#30846) edits `2-mongo-family/2-authoring`. The layout move touches its paths only in config files.

## Cross-cutting requirements

1. **Every coupling found is recorded.** [`coupling.md`](./coupling.md) lists each place where shared code assumes Postgres or SQLite: what it assumes, what MySQL or MariaDB needs, whether fixing it breaks a public API, and its outcome. An entry ends fixed in a slice, or as a Linear issue in this project.
2. **A breaking fix lands before GA.** A coupling whose fix changes a public API is fixed in this project, not filed. A coupling whose fix is additive may be filed.
3. **No target is named in shared code.** Each shared-code fix reads a fact from the target descriptor or a capability; none adds a target name.
4. **Every target registers the same way.** Each package under `3-targets/<db>/` registers in `architecture.config.json` with the recipe in `docs/onboarding/Repo-Map-and-Layering.md`, and each target has the layering test that stops it importing its own adapter or driver.
5. **MySQL behaviour is proven against a real server.** Lowering has golden SQL tests; migrations, verification, signing and ORM calls have tests against MySQL 8.4 and MariaDB 10.11.

## Transitional-shape constraints

- Between the layout slice and the MySQL slices, no target has half its packages moved.
- While `mariadb` does not exist, the MySQL target reports the capabilities of MySQL only. Nothing in the MySQL target branches on the server being MariaDB.

## Project DoD

- The commands and calls in "At a glance" succeed against MySQL 8.4 and MariaDB 10.11 in CI.
- Every entry in `coupling.md` is fixed or filed as a Linear issue in this project, and every breaking one is fixed.
- No package outside `3-targets/<db>/` holds target, adapter, driver or facade code, and the docs describe the new layout.
- `examples/prisma-8-demo-mysql` runs in CI against MySQL 8.4 and MariaDB 10.11, through the public `@prisma/orm-mysql` package.
- An ADR records the layout, and ADR 212 and the Migration System doc say that each runner states what a failed migration left behind.
- The GA plan's stream 1 row 3 is marked done, and the follow-up issues are listed for the full MySQL target.

## Open questions

None.

**Settled 2026-10-22: how CI gets a MySQL server.** MySQL has no in-process equivalent of PGlite. CI gets a `mysql:8.4` and a `mariadb:10.11` service container in the jobs that run MySQL tests, as the e2e jobs already run Postgres, and `docker-compose.yaml` gets matching services for local runs (Will approved the CI change).

## References

- GA planning branch `planning/prisma-8-ga`: `plan.md` (stream 1 row 3), `context.md` ("The MySQL attempt"), `decisions.md` ("Databases").
- [ADR 005](../../docs/architecture%20docs/adrs/ADR%20005%20-%20Thin%20Core%20Fat%20Targets.md), [ADR 037](../../docs/architecture%20docs/adrs/ADR%20037%20-%20Transactional%20DDL%20Fallback.md), [ADR 140](../../docs/architecture%20docs/adrs/ADR%20140%20-%20Package%20Layering%20&%20Target-Family%20Namespacing.md), [ADR 212](../../docs/architecture%20docs/adrs/ADR%20212%20-%20Contract%20spaces.md), [ADR 223](../../docs/architecture%20docs/adrs/ADR%20223%20-%20Target-owned%20default%20namespace.md), [ADR 242](../../docs/architecture%20docs/adrs/ADR%20242%20-%20Public%20npm%20surface%20-%20single%20@prisma%20scope%20with%20consolidated%20publish%20packages.md), [ADR 254](../../docs/architecture%20docs/adrs/ADR%20254%20-%20Data%20types%20and%20casts.md).
- Subsystem docs: Adapters & Targets, Migration System, MongoDB Family.
