![Prisma](https://i.imgur.com/h6UIYTu.png)

<div align="center">
  <h1>Prisma</h1>
  <a href="https://www.npmjs.com/package/prisma"><img src="https://img.shields.io/npm/v/prisma.svg?style=flat" /></a>
  <a href="https://github.com/prisma/prisma/blob/v7/CONTRIBUTING.md"><img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg" /></a>
  <a href="https://github.com/prisma/prisma/blob/v7/LICENSE"><img src="https://img.shields.io/badge/license-Apache%202-blue" /></a>
  <a href="https://pris.ly/discord"><img alt="Discord" src="https://img.shields.io/discord/937751382725886062?label=Discord"></a>
  <br />
  <br />
  <a href="https://www.prisma.io/docs/getting-started/prisma-orm/quickstart/prisma-postgres">Quickstart</a>
  <span>&nbsp;&nbsp;•&nbsp;&nbsp;</span>
  <a href="https://www.prisma.io/">Website</a>
  <span>&nbsp;&nbsp;•&nbsp;&nbsp;</span>
  <a href="https://www.prisma.io/docs/">Docs</a>
  <span>&nbsp;&nbsp;•&nbsp;&nbsp;</span>
  <a href="https://github.com/prisma/prisma-examples/">Examples</a>
  <span>&nbsp;&nbsp;•&nbsp;&nbsp;</span>
  <a href="https://www.prisma.io/blog">Blog</a>
  <span>&nbsp;&nbsp;•&nbsp;&nbsp;</span>
  <a href="https://pris.ly/discord?utm_source=github&utm_medium=prisma&utm_content=repo_readme">Discord</a>
  <span>&nbsp;&nbsp;•&nbsp;&nbsp;</span>
  <a href="https://pris.ly/x?utm_source=github&utm_medium=prisma&utm_content=repo_readme">Twitter</a>
  <span>&nbsp;&nbsp;•&nbsp;&nbsp;</span>
  <a href="https://pris.ly/youtube?utm_source=github&utm_medium=prisma&utm_content=repo_readme">Youtube</a>
  <br />
  <hr />
</div>

> **This is the Prisma ORM 7.x line, maintained on the `v7` branch.** The default branch of this repository now hosts [Prisma Next](https://github.com/prisma/prisma/tree/main), a TypeScript rewrite of Prisma ORM. The `prisma` and `@prisma/*` packages on npm are published from here.

## What is Prisma?

Prisma ORM is a **next-generation ORM** that consists of these tools:

- [**Prisma Client**](https://www.prisma.io/docs/orm/prisma-client): Auto-generated and type-safe query builder for Node.js & TypeScript
- [**Prisma Migrate**](https://www.prisma.io/docs/orm/prisma-migrate): Declarative data modeling & migration system
- [**Prisma Studio**](https://github.com/prisma/studio): GUI to view and edit data in your database

Prisma Client can be used in _any_ Node.js or TypeScript backend application (including serverless applications and microservices). This can be a [REST API](https://www.prisma.io/docs/concepts/overview/prisma-in-your-stack/rest), a [GraphQL API](https://www.prisma.io/docs/concepts/overview/prisma-in-your-stack/graphql), a gRPC API, or anything else that needs a database.

**If you need a database to use with Prisma ORM, check out [Prisma Postgres](https://www.prisma.io/docs/getting-started/prisma-orm/quickstart/prisma-postgres?utm_source=github&utm_medium=prisma-readme) or if you are looking for our MCP Server, head [here](https://github.com/prisma/mcp).**

## Getting started

### Quickstart (5min)

The fastest way to get started with Prisma is by following the quickstart guides. You can choose either of two databases:

- [Prisma Postgres](https://www.prisma.io/docs/getting-started/prisma-orm/quickstart/prisma-postgres)
- [SQLite](https://www.prisma.io/docs/getting-started/prisma-orm/quickstart/sqlite)

### Bring your own database

If you already have your own database, you can follow these guides:

- [Add Prisma to an existing project](https://www.prisma.io/docs/getting-started/prisma-orm/add-to-existing-project/postgresql)
- [Set up a new project with Prisma from scratch](https://www.prisma.io/docs/getting-started/setup-prisma/start-from-scratch/relational-databases-typescript-postgresql)

## How Prisma ORM works

This section provides a high-level overview of how Prisma ORM works and its most important technical components. For a more thorough introduction, visit the [Prisma documentation](https://www.prisma.io/docs/).

### The Prisma schema

Every project that uses a tool from the Prisma toolkit starts with a [Prisma schema file](https://www.prisma.io/docs/orm/prisma-schema). The Prisma schema allows developers to define their _application models_ in an intuitive data modeling language and configure _generators_.

```prisma
// Data source
datasource db {
  provider = "postgresql"
}

// Generator
generator client {
  provider = "prisma-client"
  output   = "../generated"
}

// Data model
model Post {
  id        Int     @id @default(autoincrement())
  title     String
  content   String?
  published Boolean @default(false)
  author    User?   @relation(fields:  [authorId], references: [id])
  authorId  Int?
}

model User {
  id    Int     @id @default(autoincrement())
  email String  @unique
  name  String?
  posts Post[]
}
```

In this schema, you configure three things:

- **Data source**: Specifies your database type and thus defines the features and data types you can use in the schema
- **Generator**: Indicates that you want to generate Prisma Client
- **Data model**: Defines your application models

### `prisma.config.ts`

Database connection details are defined via [`prisma.config.ts`](https://www.prisma.io/docs/orm/prisma-schema/prisma-config-reference).

```ts
import { defineConfig } from 'prisma/config'

export default defineConfig({
  datasource: {
    url: 'postgres://...',
  },
})
```

If you store the database connection string in `process.env`, an `env` function can help you access it in a type safe way and throw an error if it is missing at run time:

```ts
import { defineConfig, env } from 'prisma/config'

export default defineConfig({
  datasource: {
    url: env('DATABASE_URL'),
  },
})
```

Prisma ORM does not load the `.env` files for you automatically. If you want to populate the environment variables from a `.env` file, consider using a package such as [`dotenv`](https://www.npmjs.com/package/dotenv) or [`@dotenvx/dotenvx`](https://www.npmjs.com/package/@dotenvx/dotenvx).

The configuration file may look like this in that case:

```ts
import 'dotenv/config'
import { defineConfig, env } from 'prisma/config'

export default defineConfig({
  datasource: {
    url: env('DATABASE_URL'),
  },
})
```

To start a local PostgreSQL development server without using Docker and without any configuration, run `prisma dev`:

```sh
npx prisma dev
```

Alternatively, spin up an instant Prisma Postgres® database in the cloud:

```sh
npx create-db --interactive
```

---

### The Prisma data model

On this page, the focus is on the data model. You can learn more about [Data sources](https://www.prisma.io/docs/orm/prisma-schema/overview/data-sources) and [Generators](https://www.prisma.io/docs/orm/prisma-schema/overview/generators) on the respective docs pages.

#### Functions of Prisma models

The data model is a collection of [models](https://www.prisma.io/docs/orm/prisma-schema/data-model/models). A model has two major functions:

- Represent a table in the underlying database
- Provide the foundation for the queries in the Prisma Client API

#### Getting a data model

There are two major workflows for "getting" a data model into your Prisma schema:

- Generate the data model from [introspecting](https://www.prisma.io/docs/orm/prisma-schema/introspection) a database
- Manually writing the data model and mapping it to the database with [Prisma Migrate](https://www.prisma.io/docs/orm/prisma-migrate)

Once the data model is defined, you can [generate Prisma Client](https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/generating-prisma-client) which will expose CRUD and more queries for the defined models. If you're using TypeScript, you'll get full type-safety for all queries (even when only retrieving the subsets of a model's fields).

---

### Accessing your database with Prisma Client

#### Step 1: Install Prisma

First, install Prisma CLI as a development dependency and Prisma Client:

```
npm install prisma --save-dev
npm install @prisma/client
```

#### Step 2: Set up your Prisma schema

Ensure your Prisma schema includes a `generator` block with an `output` path specified:

```prisma
generator client {
  provider = "prisma-client"
  output   = "../generated"
}

datasource db {
  provider = "postgresql"  // mysql (incl. mariadb), sqlite, sqlserver, mongodb or cockroachdb
}
```

#### Step 3: Configure Prisma Config

Configure the Prisma CLI using a `prisma.config.ts` file. This file configures Prisma CLI subcommands like `migrate` and `studio`. Create a `prisma.config.ts` file in your project root:

```ts
import { defineConfig, env } from 'prisma/config'

type Env = {
  DATABASE_URL: string
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: env<Env>('DATABASE_URL'),
  },
})
```

**Note**: Environment variables from `.env` files are not automatically loaded when using `prisma.config.ts`. You can use `dotenv` by importing `dotenv/config` at the top of your config file. For Bun, `.env` files are automatically loaded.

Learn more about [Prisma Config](https://www.prisma.io/docs/orm/reference/prisma-config-reference) and all available configuration options.

#### Step 4: Generate Prisma Client

Generate Prisma Client with the following command:

```
npx prisma generate
```

This command reads your Prisma schema and _generates_ the Prisma Client code in the location specified by the `output` path in your generator configuration.

After you change your data model, you'll need to manually re-generate Prisma Client to ensure the generated code gets updated:

```
npx prisma generate
```

Refer to the documentation for more information about ["generating the Prisma client"](https://www.prisma.io/docs/orm/prisma-client/setup-and-configuration/generating-prisma-client).

#### Step 5: Use Prisma Client to send queries to your database

Once the Prisma Client is generated, you can import it in your code and send queries to your database.

##### Import and instantiate Prisma Client

You can import and instantiate Prisma Client from the output path specified in your generator configuration. When instantiating the Client, you need to provide a [driver adapter](https://www.prisma.io/docs/orm/core-concepts/supported-databases/database-drivers#how-to-use-driver-adapters) to its constructor. For example, when using PostgreSQL with a driver adapter:

```ts
import { PrismaClient } from './generated/client'
import { PrismaPg } from '@prisma/adapter-pg'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })
```

To load environment variables, you can use `dotenv` by importing `dotenv/config`, use `tsx --env-file=.env`, `node --env-file=.env`, or Bun (which loads `.env` automatically).

Now you can start sending queries via the generated Prisma Client API, here are a few sample queries. Note that all Prisma Client queries return _plain old JavaScript objects_.

Learn more about the available operations in the [Prisma Client docs](https://www.prisma.io/docs/orm/prisma-client) or watch this [demo video](https://www.youtube.com/watch?v=LggrE5kJ75I&list=PLn2e1F9Rfr6k9PnR_figWOcSHgc_erDr5&index=4) (2 min).

##### Retrieve all `User` records from the database

```ts
const allUsers = await prisma.user.findMany()
```

##### Include the `posts` relation on each returned `User` object

```ts
const allUsers = await prisma.user.findMany({
  include: { posts: true },
})
```

##### Filter all `Post` records that contain `"prisma"`

```ts
const filteredPosts = await prisma.post.findMany({
  where: {
    OR: [{ title: { contains: 'prisma' } }, { content: { contains: 'prisma' } }],
  },
})
```

##### Create a new `User` and a new `Post` record in the same query

```ts
const user = await prisma.user.create({
  data: {
    name: 'Alice',
    email: 'alice@prisma.io',
    posts: {
      create: { title: 'Join us for Prisma Day 2021' },
    },
  },
})
```

##### Update an existing `Post` record

```ts
const post = await prisma.post.update({
  where: { id: 42 },
  data: { published: true },
})
```

#### Usage with TypeScript

Note that when using TypeScript, the result of this query will be _statically typed_ so that you can't accidentally access a property that doesn't exist (and any typos are caught at compile-time). Learn more about leveraging Prisma Client's generated types on the [Advanced usage of generated types](https://www.prisma.io/docs/orm/prisma-client/type-safety/operating-against-partial-structures-of-model-types) page in the docs.

## Community

Prisma has a large and supportive [community](https://www.prisma.io/community) of enthusiastic application developers. You can join us on [Discord](https://pris.ly/discord) and here on [GitHub](https://github.com/prisma/prisma/discussions).

## Badges

[![Made with Prisma](https://made-with.prisma.io/dark.svg)](https://prisma.io) [![Made with Prisma](https://made-with.prisma.io/indigo.svg)](https://prisma.io)

Built something awesome with Prisma? 🌟 Show it off with these [badges](https://github.com/prisma/presskit?tab=readme-ov-file#badges), perfect for your readme or website.

```
[![Made with Prisma](https://made-with.prisma.io/dark.svg)](https://prisma.io)
```

```
[![Made with Prisma](https://made-with.prisma.io/indigo.svg)](https://prisma.io)
```

## Security

If you have a security issue to report, please contact us at [security@prisma.io](mailto:security@prisma.io?subject=[GitHub]%20Prisma%202%20Security%20Report%20).

## Support

### Ask a question about Prisma

You can ask questions and initiate [discussions](https://github.com/prisma/prisma/discussions/) about Prisma-related topics in the `prisma` repository on GitHub.

👉 [**Ask a question**](https://github.com/prisma/prisma/discussions/new)

### Create a bug report for Prisma

If you see an error message or run into an issue, please make sure to create a bug report! You can find [best practices for creating bug reports](https://www.prisma.io/docs/guides/other/troubleshooting-orm/creating-bug-reports) (like including additional debugging output) in the docs.

👉 [**Create bug report**](https://pris.ly/prisma-prisma-bug-report)

### Submit a feature request

If Prisma currently doesn't have a certain feature, be sure to check out the [roadmap](https://www.prisma.io/docs/more/roadmap) to see if this is already planned for the future.

If the feature on the roadmap is linked to a GitHub issue, please make sure to leave a 👍 reaction on the issue and ideally a comment with your thoughts about the feature!

👉 [**Submit feature request**](https://github.com/prisma/prisma/issues/new?assignees=&labels=&template=feature_request.md&title=)

## Contributing

Refer to our [contribution guidelines](https://github.com/prisma/prisma/blob/v7/CONTRIBUTING.md) and [Code of Conduct for contributors](https://github.com/prisma/prisma/blob/v7/CODE_OF_CONDUCT.md).

## Tests Status

- Prisma Tests Status:
  [![Prisma Tests Status](https://github.com/prisma/prisma/actions/workflows/test.yml/badge.svg?branch=v7)](https://github.com/prisma/prisma/actions/workflows/test.yml?query=branch%3Av7)

Scheduled CI is currently disabled across the ORM repos; test workflows run on push, pull request, and manual `workflow_dispatch`. See the [Actions tab](https://github.com/prisma/prisma/actions) for recent runs.
