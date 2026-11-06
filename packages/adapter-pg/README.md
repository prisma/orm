# @prisma/adapter-pg

This package contains the driver adapter for Prisma ORM that enables usage of the [`node-postgres`](https://node-postgres.com/) (`pg`) database driver for PostgreSQL. You can learn more in the [documentation](https://pris.ly/d/adapter-pg).

`pg` is one of the most popular drivers in the JavaScript ecosystem for PostgreSQL databases. It can be used with any PostgreSQL database that's accessed via TCP.

> **Note:**: Support for the `pg` driver is available from Prisma versions [5.4.2](https://github.com/prisma/prisma/releases/tag/5.4.2) and later.

## Usage

This section explains how you can use it with Prisma ORM and the `@prisma/adapter-pg` driver adapter. Be sure that the `DATABASE_URL` environment variable is set to your PostgreSQL connection string (e.g. loaded using `dotenv` from a `.env` file).

### 1. Install the dependencies

Install the Prisma ORM's driver adapter for pg:

```
npm install @prisma/adapter-pg
```

### 2. Instantiate Prisma Client using the driver adapter

Finally, when you instantiate Prisma Client, you need to pass an instance of Prisma ORM's driver adapter to the `PrismaClient` constructor:

```ts
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'

const connectionString = `${process.env.DATABASE_URL}`

const adapter = new PrismaPg({ connectionString })
const prisma = new PrismaClient({ adapter })
```

### Schema selection

The `schema` option determines the PostgreSQL schema used in generated queries and, for pools managed by the adapter, the `search_path` of its connections:

```ts
const adapter = new PrismaPg({ connectionString }, { schema: 'myschema' })
```

When the option is not set and the adapter is constructed from a connection string or a config containing one, the `?schema=` parameter of the connection URL is used as a fallback.

When you pass a pre-constructed `pg.Pool` instance instead, its configuration is left untouched: the connection URL fallback does not apply and `search_path` is not modified, but an explicit `schema` option still determines the schema used in generated queries. Because the `search_path` is not adjusted in this case, the `schema` option only affects generated queries; raw queries (`$queryRaw`, `$executeRaw`) continue to use the pool's existing `search_path` and may fail for non-`public` schemas. Configure the pool or its connection string (for example, via `options: '-csearch_path=myschema'`) if you need raw queries to resolve unqualified names in a non-`public` schema.

## Feedback

We encourage you to create an issue if you find something missing or run into a bug.

If you have any feedback, leave a comment in [this GitHub discussion](https://github.com/prisma/prisma/discussions/22899).
