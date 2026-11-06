# Prisma 8 Demo (MariaDB)

A minimal demo showing how to use `@prisma/orm-mariadb`, the one package a MariaDB application installs. It has the same PSL contract as the MySQL example, with three models, a relation, an enum and the convenience date and time types, and a committed migration written by `prisma migration plan` against MariaDB 10.11.

MariaDB support is early, and this example grows with it. Today it shows the control plane: the contract emits, the committed migration applies to an empty MariaDB database, `db verify` and `db sign` pass, and planning again from the unchanged contract writes nothing. Reads and writes come in a later change, with the `mariadb()` client.

MariaDB has its own target, `mariadb`, built on MySQL's. The target id is part of `contract.json`, its hashes and every migration, so the MariaDB example keeps its own contract and migrations instead of sharing the MySQL example's.

## Setup

You need a MariaDB server and an empty application database for the example. The example is tested on MariaDB 10.11. The repository's `docker-compose.yaml` starts a server on port 3308 with an empty `root` password; create the `prisma_demo` database on it before running anything. `MARIADB_URL` must name that database, never the `mysql` system database, or the CLI creates the example's tables inside it.

```bash
docker compose up -d mariadb
docker compose exec mariadb mariadb -uroot -e 'CREATE DATABASE prisma_demo'
pnpm install
pnpm emit                                   # generates src/prisma/contract.json + contract.d.ts
export MARIADB_URL='mysql://root@127.0.0.1:3308/prisma_demo'
pnpm db:migrate                             # applies migrations/ to the database
pnpm db:verify                              # checks the database matches the contract
pnpm db:sign                                # records the contract the database now satisfies
```

`db sign` writes `migrations/app/refs/db.json`, the migration graph's record of which contract the database is at.

## Commands

| Script | Runs | What it does |
| --- | --- | --- |
| `emit` | `prisma contract emit` | Writes `src/prisma/contract.json` and `contract.d.ts` from `prisma/contract.prisma` |
| `emit:check` | `emit`, then `git diff` | Fails when the committed contract is out of date |
| `migration:plan` | `prisma migration plan` | Writes a new migration under `migrations/app/` when the contract has changed; name it with `pnpm migration:plan --name <name>` |
| `db:migrate` | `prisma db migrate` | Applies the migrations the database does not have yet |
| `db:verify` | `prisma db verify` | Checks the database's marker and schema against the contract |
| `db:sign` | `prisma db sign` | Signs a database whose schema satisfies the contract |
| `test` | `vitest run` | The whole flow against a fresh database at `MARIADB_URL` |

`pnpm test` uses only the server part of `MARIADB_URL`. It creates a uniquely named database on that server and drops it afterwards. `test/migrations.test.ts` runs `db migrate`, `db verify`, `db sign` and `migration plan` through the `prisma` CLI. Without `MARIADB_URL` the tests are skipped, except in CI, where they fail.

## What the migration creates

```sql
CREATE TABLE `Event` (
  `createdAt` datetime(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP(3)),
  `day` date NOT NULL,
  `id` int NOT NULL AUTO_INCREMENT,
  `opensAt` time(6) NOT NULL,
  `startsAt` datetime(3) NOT NULL,
  `title` varchar(191) NOT NULL,
  PRIMARY KEY (`id`)
);
CREATE TABLE `Post` (
  `authorId` int NOT NULL,
  `id` int NOT NULL AUTO_INCREMENT,
  `title` varchar(191) NOT NULL,
  PRIMARY KEY (`id`)
);
CREATE TABLE `User` (
  `email` varchar(191) NOT NULL,
  `id` int NOT NULL AUTO_INCREMENT,
  `role` enum('USER','ADMIN') NOT NULL,
  PRIMARY KEY (`id`),
  CONSTRAINT `User_email_key` UNIQUE (`email`)
);
```

plus an index on `Post.authorId` and the foreign key to `User`. The SQL is MySQL's; MariaDB runs it unchanged. MariaDB reports the columns back as `int(11)` and `current_timestamp(3)`, and `db verify` reads them as the `int` and `CURRENT_TIMESTAMP(3)` the contract asks for.

## Key files

- `prisma/contract.prisma` — the contract (User, Post, Event, Role)
- `prisma.config.ts` — CLI config; reads the connection from `MARIADB_URL`
- `migrations/` — the committed migration and its contract snapshot
- `test/migrations.test.ts` — the migration flow
- `test/cli.ts` — runs the `prisma` CLI on a copy of the example
- `test/database.ts` — creates and drops a database for the test file, and reads `MARIADB_URL`
