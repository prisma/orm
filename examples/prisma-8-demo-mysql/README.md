# Prisma 8 Demo (MySQL)

A minimal demo showing how to use `@prisma/orm-mysql`, the one package a MySQL
application installs. It has a PSL contract with two models, a relation and an
enum, and a committed migration written by `prisma migration plan`.

MySQL support is early, and this example grows with it. Today it shows the
control plane and reads: the contract emits, the committed migration applies to
an empty MySQL database, `db verify` and `db sign` pass, planning again from the
unchanged contract writes nothing, and the ORM and the SQL builder read the
seeded rows, includes among them. Writes and MariaDB will be added here as each
lands, and each is done only when this example runs it in CI.

## Reading

`src/prisma/db.ts` builds the client from `@prisma/orm-mysql/runtime` and the
emitted contract, read with `contractFromJson` from `@prisma/orm-mysql/static`:

```ts
import mysql from '@prisma/orm-mysql/runtime';
import { contractFromJson } from '@prisma/orm-mysql/static';

const db = mysql({ contract: contractFromJson<Contract>(contractJson), url });
```

`src/orm-client/` holds the ORM reads and `src/queries/` the SQL builder read, one file each. Each read is one SQL statement:

```ts
// Admins ordered by email
await db.orm.User.where({ role: 'ADMIN' }).orderBy((u) => u.email.asc()).limit(2).all();
// A user with their posts, in the order the include asks for
await db.orm.User.include('posts', (posts) => posts.orderBy((p) => p.title.desc())).first({ id: 1 });
// Every post with its author
await db.orm.Post.include('author').all();
// The SQL builder
await db.query(db.sql.User.select('id', 'email').where((f, fns) => fns.eq(f.role, 'ADMIN')).build());
```

The ORM cannot write to MySQL yet, so `src/seed.ts` inserts the demo rows
through the raw SQL lane, `db.raw.sql`.

## Setup

You need a MySQL 8 server and an empty application database for the example.
The repository's `docker-compose.yaml` starts a server on port 3307; create the
`prisma_demo` database on it before running anything. `MYSQL_URL` must name
that database, never MySQL's own `mysql` system database, or the CLI creates
the example's tables inside it.

```bash
docker compose up -d mysql
docker compose exec mysql mysql -uroot -proot -e 'CREATE DATABASE prisma_demo'
pnpm install
pnpm emit                                   # generates src/prisma/contract.json + contract.d.ts
export MYSQL_URL=mysql://root:root@127.0.0.1:3307/prisma_demo
pnpm db:migrate                             # applies migrations/ to the database
pnpm db:verify                              # checks the database matches the contract
pnpm db:sign                                # records the contract the database now satisfies
```

`db sign` writes `migrations/app/refs/db.json`, the migration graph's record of
which contract the database is at.

## Commands

| Script | Runs | What it does |
| --- | --- | --- |
| `emit` | `prisma contract emit` | Writes `src/prisma/contract.json` and `contract.d.ts` from `prisma/contract.prisma` |
| `emit:check` | `emit`, then `git diff` | Fails when the committed contract is out of date |
| `migration:plan` | `prisma migration plan` | Writes a new migration under `migrations/app/` when the contract has changed; name it with `pnpm migration:plan --name <name>` |
| `db:migrate` | `prisma db migrate` | Applies the migrations the database does not have yet |
| `db:verify` | `prisma db verify` | Checks the database's marker and schema against the contract |
| `db:sign` | `prisma db sign` | Signs a database whose schema satisfies the contract |
| `test` | `vitest run` | The whole flow against fresh databases at `MYSQL_URL` |

`pnpm test` uses only the server part of `MYSQL_URL`. For each test file it
creates a uniquely named database on that server and drops it afterwards.
`test/migrations.test.ts` runs `db migrate`, `db verify`, `db sign` and
`migration plan` through the `prisma` CLI. `test/reads.test.ts` migrates with
`db migrate`, seeds the rows and checks the whole result of each read. Without `MYSQL_URL` the tests are skipped.

## What the migration creates

```sql
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

plus an index on `Post.authorId` and the foreign key to `User`. The PSL enum
`Role` becomes a native MySQL `enum` column, so the database enforces its
members. `String` becomes `varchar(191)`, because MySQL cannot put a unique
index on a `text` column without a key length.

## Key files

- `prisma/contract.prisma` — the contract (User, Post, Role)
- `prisma.config.ts` — CLI config; reads the connection from `MYSQL_URL`
- `migrations/` — the committed migration and its contract snapshot
- `src/prisma/db.ts` — the client
- `src/orm-client/` — the ORM reads, one file each
- `src/queries/` — the SQL builder read
- `src/seed.ts` — the demo rows
- `test/migrations.test.ts` — the migration flow
- `test/reads.test.ts` — the reads against a migrated, seeded database
- `test/cli.ts` — runs the `prisma` CLI on a copy of the example
- `test/database.ts` — creates and drops a database for each test file
