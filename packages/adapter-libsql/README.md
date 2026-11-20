# Prisma driver adapter for libSQL

Prisma driver adapter for Turso and libSQL. Refer to the [announcement blog post](https://prisma.io/turso) and our [docs](https://www.prisma.io/docs/guides/database/turso) for more details.

> **Note**: Support for Turso is available in [Early Access](https://www.prisma.io/docs/about/prisma/releases#early-access) from Prisma versions [5.4.2](https://github.com/prisma/prisma/releases/tag/5.4.2) and later.

## Getting started

To get started, install the libSQL database client and Prisma driver adapter for libSQL packages:

```sh
npm install @prisma/adapter-libsql
npm install @libsql/client
```

Update your Prisma Client instance to use the libSQL database Client:

```ts
// Import needed packages
import { PrismaClient } from '@prisma/client'
import { PrismaLibSql } from '@prisma/adapter-libsql'
// You can alternatively use the web version of the client if you're running in
// a constrained environment where the standard libsql client doesn't work:
// import { PrismaLibSql } from '@prisma/adapter-libsql/web'

// Setup
const connectionString = `${process.env.TURSO_DATABASE_URL}`
const authToken = `${process.env.TURSO_AUTH_TOKEN}`

// Init prisma client
const adapter = new PrismaLibSql({
  url: connectionString,
  authToken,
})
const prisma = new PrismaClient({ adapter })
```

The above setup uses a **single** remote Turso database. You can take this a step further by setting up [remote replicas](https://docs.turso.tech/concepts#replica) and [embedded replicas](https://blog.turso.tech/introducing-embedded-replicas-deploy-turso-anywhere-2085aa0dc242) with Turso.

Refer to our [docs](https://www.prisma.io/docs/guides/database/turso#how-to-manage-schema-changes) to learn how to manage schema changes when using Prisma and Turso.

## Feedback

We encourage you to create an issue if you find something missing or run into a bug.

If you have any feedback, leave a comment in [this GitHub discussion](https://github.com/prisma/prisma/discussions/21345).
