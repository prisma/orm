# Prisma driver adapter for Prisma Postgres

Prisma driver adapter for [Prisma Postgres](https://www.prisma.io/postgres). This adapter enables Prisma ORM to connect to Prisma Postgres databases using the [@prisma/ppg](https://github.com/prisma/ppg-client) serverless driver.

> **Note**: Support for Prisma Postgres is available from Prisma versions [5.4.2](https://github.com/prisma/prisma/releases/tag/5.4.2) and later.

The [@prisma/ppg](https://github.com/prisma/ppg-client) driver is a modern, lightweight client for Prisma Postgres that allows you to query data from serverless and edge environments over HTTP and WebSocket connections.

## Getting started

> **Note**: Make sure you have your Prisma Postgres Direct TCP connection string in your `.env` file. You can find this connection string in the API Keys section of your Prisma Postgres dashboard.
>
> ```bash
> PRISMA_DIRECT_TCP_URL="postgres://identifier:key@db.prisma.io:5432/postgres?sslmode=require"
> ```

To get started, install the Prisma adapter for Prisma Postgres:

```sh
npm install @prisma/adapter-ppg
```

Update your Prisma Client instance to use the Prisma Postgres adapter:

```ts
// Import needed packages
import { PrismaClient } from '@prisma/client'
import { PrismaPostgresAdapter } from '@prisma/adapter-ppg'

// Setup
const connectionString = `${process.env.PRISMA_DIRECT_TCP_URL}`

// Init Prisma Client with adapter
const adapter = new PrismaPostgresAdapter({ connectionString })
const prisma = new PrismaClient({ adapter })

// Use Prisma Client as normal
```

You can now use Prisma Client as you normally would with full type-safety. Your Prisma Client instance now uses the Prisma Postgres serverless driver to connect to your database. This comes with benefits such as HTTP and WebSocket-based connections optimized for serverless and edge environments.

## Feedback

We encourage you to create an issue if you find something missing or run into a bug.
