# Prisma 8 Demo (MariaDB)

A minimal demo showing how to use `@prisma/orm-mariadb`, the one package a MariaDB application installs. It has the same PSL contract as the MySQL example, with four models, a relation, an enum, the convenience date and time types and the scalar convenience types, and two committed migrations written by `prisma migration plan` against MariaDB 10.11.

MariaDB support is early, and this example grows with it. Today it shows the control plane, reads and writes: the contract emits, the committed migration applies to an empty MariaDB database, `db verify` and `db sign` pass, planning again from the unchanged contract writes nothing, the ORM writes the seed rows, and the ORM and the SQL builder read them, includes among them. The reads and writes are the MySQL example's, run with `mariadb()`.

MariaDB has its own target, `mariadb`, built on MySQL's. The target id is part of `contract.json`, its hashes and every migration, so the MariaDB example keeps its own contract and migrations instead of sharing the MySQL example's.

## Reading and writing

`src/prisma/db.ts` builds the client from `@prisma/orm-mariadb/runtime` and the emitted contract, read with `contractFromJson` from `@prisma/orm-mariadb/static`:

```ts
import mariadb from '@prisma/orm-mariadb/runtime';
import { contractFromJson } from '@prisma/orm-mariadb/static';

const db = mariadb({ contract: contractFromJson<Contract>(contractJson), url });
```

`src/orm-client/` holds the ORM reads and writes, `src/queries/` the SQL builder read, `src/raw/` a raw SQL insert and `src/seed.ts` the seed rows, one file each, as in the MySQL example. They return what they return on MySQL. Two things differ in the SQL MariaDB is sent:

- An include is read with a query of its own after the parent rows, since MariaDB cannot read a related row from inside the subquery MySQL's one-query include uses.
- An upsert writes no row alias, and reads the proposed row's column as `VALUES(column)`, since MariaDB has no `INSERT … AS new`.

## Scalar types

`Product` uses the scalar convenience types:

```prisma
model Product {
  id        Int                              @id @default(autoincrement())
  name      String                           // varchar(191)
  price     Decimal(precision: 10, scale: 2) // decimal(10,2), read as decimal text such as "19.90"
  rating    Float                            // double
  sold      BigInt(as: number)               @default(0) // bigint, read as a number
  inStock   Boolean                          @default(true) // tinyint(1), 0 or 1
  thumbnail Bytes                            // longblob, read as a Uint8Array
  details   Json                             // json: longtext with a json_valid check
  notes     String(storage: text)?           // text
}
```

`src/orm-client/products.ts` creates products, updates their stock and reads the products in stock at a price. A `Decimal` reads as the server prints it, padded to the column's scale, so `"19.9"` is read back as `"19.90"`, and a filter on `"19.9"` finds it. See [Scalar types](../../docs/reference/scalar-types.md#mysql-and-mariadb) for what each type reads, filters and refuses.

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

`pnpm test` uses only the server part of `MARIADB_URL`. It creates a uniquely named database on that server and drops it afterwards. `test/migrations.test.ts` runs `db migrate`, `db verify`, `db sign` and `migration plan` through the `prisma` CLI; `test/reads.test.ts`, `test/writes.test.ts`, `test/events.test.ts` and `test/products.test.ts` migrate a database and read and write it through `mariadb()`. Without `MARIADB_URL` the tests are skipped, except in CI, where they fail.

## What the migrations create

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

plus an index on `Post.authorId` and the foreign key to `User`. The second migration creates `Product`, with the same SQL as the MySQL example's; MariaDB makes its `json` column `longtext` with a `json_valid` check, which `db verify` reads as `json`. The SQL is MySQL's; MariaDB runs it unchanged. MariaDB reports the columns back as `int(11)` and `current_timestamp(3)`, and `db verify` reads them as the `int` and `CURRENT_TIMESTAMP(3)` the contract asks for.

## Key files

- `prisma/contract.prisma` — the contract (User, Post, Event, Product, Role)
- `prisma.config.ts` — CLI config; reads the connection from `MARIADB_URL`
- `migrations/` — the committed migrations and their contract snapshots
- `src/prisma/db.ts` — the `mariadb()` client
- `src/orm-client/`, `src/queries/`, `src/raw/`, `src/seed.ts` — the reads and writes
- `test/migrations.test.ts` — the migration flow
- `test/reads.test.ts`, `test/writes.test.ts`, `test/events.test.ts`, `test/products.test.ts` — the reads and writes against a migrated database
- `test/cli.ts` — runs the `prisma` CLI on a copy of the example
- `test/database.ts` — creates and drops a database for the test file, and reads `MARIADB_URL`
