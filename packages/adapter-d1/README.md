# Prisma driver adapter for Cloudflare D1

Prisma driver adapter for [Cloudflare's D1 database](https://developers.cloudflare.com/d1/).

> [!NOTE]
> The adapter is currently in [Preview](https://www.prisma.io/docs/orm/more/releases#early-access), we are looking for feedback before moving to General Availability.

Refer to the [announcement blog post](https://prisma.io/cloudflare-d1) and our [docs](https://www.prisma.io/docs/orm/overview/databases/cloudflare-d1) for more details.

## Getting started

To get started, install Prisma CLI, Prisma Client, the Prisma adapter for Cloudflare D1, the TypeScript types for Cloudflare Workers, and Wrangler CLI packages:

```sh
npm install @prisma/client
npm install @prisma/adapter-d1
npm install --save-dev prisma
npm install --save-dev @cloudflare/workers-types
npm install --save-dev wrangler
```

Generate Prisma Client:

```sh
npx prisma generate
```

Update your Prisma Client instance to use `PrismaD1`:

```ts
// Import needed packages
import { PrismaClient } from '@prisma/client'
import { PrismaD1 } from '@prisma/adapter-d1'

export interface Env {
  // This must match the binding name defined in your wrangler.toml configuration
  MY_DATABASE: D1Database
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Initialize Prisma Client with the D1 adapter
    const adapter = new PrismaD1(env.MY_DATABASE)
    const prisma = new PrismaClient({ adapter })

    // Execute a Prisma Client query
    const usersCount = await prisma.user.count()

    // Return result
    return new Response(usersCount)
  },
}
```

<details>
  <summary>For JavaScript users</summary>

<!-- prettier-ignore -->
  ```js
  // Import needed packages
  import { PrismaClient } from '@prisma/client'
  import { PrismaD1 } from '@prisma/adapter-d1'

  export default {
    async fetch(request, env, ctx) {
      // Setup Prisma Client with the adapter
      const adapter = new PrismaD1(env.MY_DATABASE)
      const prisma = new PrismaClient({ adapter })

      // Execute a Prisma Client query
      const usersCount = await prisma.user.count()

      // Return result
      return new Response(usersCount)
    },
  }
  ```

</details>

> **Note**: Make sure your D1 database is setup in your `wrangler.toml`. Refer to [Cloudflare's docs](https://developers.cloudflare.com/d1/get-started/#3-create-a-database) to learn how to set up your database binding.
>
> ```toml
> [[d1_databases]]
> binding = "MY_DATABASE"    # i.e. available in the Worker on env.MY_DATABASE
> database_name = "database_name"
> database_id = "<unique-ID-for-your-database>"
> ```

## Migrations

Please refer to our [docs](https://www.prisma.io/docs/orm/overview/databases/cloudflare-d1#migration-workflows) to learn how to manage schema changes when using Prisma and Cloudflare D1.

## Feedback

We encourage you to create an issue if you find something missing or run into a bug.

If you have any feedback, leave a comment in [this GitHub discussion](https://github.com/prisma/prisma/discussions/23646).
