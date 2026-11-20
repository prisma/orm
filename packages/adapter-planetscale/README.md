# Prisma driver adapter for PlanetScale serverless driver

Prisma driver adapter for [PlanetScale Serverless Driver](https://github.com/planetscale/database-js). Refer to the [announcement blog post](https://www.prisma.io/blog/serverless-database-drivers-KML1ehXORxZV) and our [docs](https://www.prisma.io/docs/guides/database/planetscale#how-to-use-the-planetscale-serverless-driver-with-prisma-preview) for more details.

> **Note:**: Support for PlanetScale's serverless driver is available from Prisma versions [5.4.2](https://github.com/prisma/prisma/releases/tag/5.4.2) and later.

PlanetScale's serverless driver provides a way of communicating with your PlanetScale database over HTTP which can improve [connection reliability and performance](https://planetscale.com/blog/faster-mysql-with-http3)

## Getting started

> **Note**: Ensure you update the host value in your connection string to `aws.connect.psdb.cloud`. You can learn more about this [here](https://planetscale.com/docs/tutorials/planetscale-serverless-driver#add-and-use-the-planetscale-serverless-driver-for-javascript-to-your-project).
>
> ```bash
> DATABASE_URL="mysql://user:password@aws.connect.psdb.cloud/database_name?sslaccept=strict"
> ```

To get started, install the Prisma adapter for PlanetScale and `undici` packages:

```sh
npm install @prisma/adapter-planetscale
npm install undici
```

> **Note**: When using a Node.js version below 18, you must provide a custom fetch function implementation. We recommend the `undici` package on which Node's built-in fetch is based. Node.js versions 18 and later include a built-in global `fetch` function, so you don't have to install an extra package.

Update your Prisma Client instance to use the PlanetsScale serverless driver:

```ts
// Import needed packages
import { PrismaPlanetScale } from '@prisma/adapter-planetscale'
import { PrismaClient } from '@prisma/client'
import { fetch as undiciFetch } from 'undici'

// Setup
const connectionString = `${process.env.DATABASE_URL}`

// Init prisma client
const adapter = new PrismaPlanetScale({ url: connectionString, fetch: undiciFetch })
const prisma = new PrismaClient({ adapter })

// Use Prisma Client as normal
```

You can now use Prisma Client as you normally would with full type-safety. Your Prisma Client instance now uses PlanetScale's serverless driver to connect to your database.

## Feedback

We encourage you to create an issue if you find something missing or run into a bug.

If you have any feedback, leave a comment in [this GitHub discussion](https://github.com/prisma/prisma/discussions/21347).
