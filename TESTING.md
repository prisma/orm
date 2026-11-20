# Testing

## Local databases for tests

To run tests requiring a database, start the test databases using Docker, see [Docker](./docker/README.md).

## Environment variables

These are located in the [.db.env](./.db.env) file which is loaded automatically by the test commands.

Optionally, if you want the environment variables to always be accessible, you can install [direnv](https://github.com/direnv/direnv/blob/master/docs/installation.md).

## Jest tips

1. Install/update the dependencies, run the following command in the root directory:

   ```sh
   pnpm i
   ```

1. We use the [Jest test framework](https://jestjs.io/). Its CLI is powerful and removes the need for npm scripts mostly. For most cases this is what you need to know:

   Note: the following command `pnpm run test` can be used inside the packages folders like [`packages/client/`](./packages/client/). In the base folder you can only run `pnpm run test` without extra arguments.

   ```sh
   pnpm run test <fileNamePattern> -t <testNamePattern>
   ```

   and to update snapshots use the -u option

   ```sh
   pnpm run test <fileNamePattern> -u
   ```

1. In [`packages/integration-tests/`](./packages/integration-tests/) [Jest's `each` feature](https://jestjs.io/docs/en/api#testeachtablename-fn-timeout) is used. If you only want to run a subset of the test cases, simply leverage the `-t` flag on the command line (see above point). Here is an example to run only the `findOne where PK` cases for SQLite:

   ```sh
   pnpm run jest integration.sqlite -t 'findOne where PK'
   ```

## Where should I find and write tests?

Something is broken? You built a new feature? It's time to write a test! But where?

Everything related to working with specific frameworks like Next.js or using external resources like deploying to Netlify should be covered by an [Ecosystem Test](https://github.com/prisma/ecosystem-tests).

Everything that is more basic functionality like a specific query or feature, that doesn't need a platform specific test (yet) should get a test in the `prisma/prisma` repo.

Rule of thumb: If you can write a test in `prisma/prisma`, prefer that over a test in `prisma/ecosystem-tests`.

In the `prisma/prisma` repository we have a few places where you can write tests:

- **`cli`**
  - [`./packages/cli/src/__tests__/`](./packages/cli/src/__tests__/) - Tests for `prisma studio`, `prisma version`, `prisma format`, `prisma generate`, `prisma generate`, loading `.env` file loading...
- **`client`**
  - [`./packages/client/tests/functional/`](./packages/client/tests/functional/) - The functional test setup, current default place where to add tests, tests are fully isolated and can easily be ran on all supported databases.
    - Check out the example test: [`./packages/client/tests/functional/_example/`](./packages/client/tests/functional/_example/)
  - [`./packages/client/src/__tests__/*.test.ts`](./packages/client/src/__tests__/) - Unit tests
  - [`./packages/client/src/__tests__/integration/happy/**`](./packages/client/src/__tests__/integration/happy/) - Legacy integration tests for the happy path. Please, write functional tests instead.
  - [`./packages/client/src/__tests__/integration/errors/**`](./packages/client/src/__tests__/integration/errors/) - Legacy integration tests for error cases. Please write functional tests instead.
  - [`./packages/client/src/__tests__/types/**`](./packages/client/src/__tests__/types/) - Tests for generated Client TS Types
- **`debug`**
  - Unit tests for `debug` package
- **`generator-helper`**
  - Integration tests for generator interface implementation
- **`migrate`**
  - Unit and integration tests for `migrate` and `db` commands
- **`internals`**
  - Convert credentials to connection string and back
  - Engine commands (`getDMMF`, `getConfig`) (snapshots)
  - getGenerators (central function for generation)
  - introspection (snapshots)
- **`integration-tests`** (Prisma Client & Introspection)
  - Integration tests for basic query and mutation functionality
  - All databases that we support are covered here:
    - mariadb
    - mssql (SQL Server)
    - mysql
    - postgresql
    - sqlite
  - While these tests also test the client itself, they're rather only a base to make sure that basic query engine functionality actually works in the Prisma Client
  - When you want to test very specific queries for a new feature, you can write a functional test in the `client` package, as that's usually easier

## Prisma CLI

### Testing a namespace

See how `db` namespace is tested in [`DbCommand.test.ts`](./packages/migrate/src/__tests__/DbCommand.test.ts)
When creating a new namespace, a `<command>Command.test.ts` file must be created and filled with unit tests.

### Testing a command

See how the `init` command is tested in [`Init.test.ts`](./packages/cli/src/__tests__/commands/Init.test.ts)
When creating a new command, a `<command>.test.ts` file must be created and filled with unit tests.

### Running tests using Jest

If the tests you want to run require a database, see [Docker](./docker/README.md).

For running all tests

```
pnpm run test
```

For running tests for a single command use `pnpm run test <name>`

```
pnpm run test init
```

## Prisma Client: functional tests

Functional tests in the client package are testing that all aspects of client and query engine work correctly. They strive to be as close as possible to the way client will be used in real project: they generate an actual client, talk to a real database, perform the type checks and generally test the client through its public API.

### Creating a new functional test

To create new test, run following command

```
pnpm new-test
```

You'll then be asked for the name of your test and list of providers you want to run this test on. If you opt out of testing any of the providers, you'll also have to specify the reason. New test will be created under `test/functional/<name of the test>` directory.

### Structure of the functional test setup

Test consists of the 3 files:

- test matrix `_matrix.ts`
- schema template `prisma/_schema.ts`
- test suite `tests.ts`

#### Nesting tests

If you have related tests but different schemas, you can nest directories. For example, composite indexes have the following file structure:

`composite-index/`

1.  `list/`
    - `test.ts`
    - `_matrix.ts`
    - `prisma/`
      - `_schema.ts`

2.  `named/`
    - `test.ts`
    - `_matrix.ts`
    - `prisma/`
      - ` _schema.ts`

#### Test matrix

`_matrix.ts` file defines parameters for generating test suites. It can have as many parameters as necessary, but at minimum, it should define at least one provider.

This example matrix defines 2 test suites: one for the SQLite provider and one for MongoDB, while also providing some test data to use later for both providers:

```ts
import { defineMatrix } from '../_utils/defineMatrix'

export default defineMatrix(() => [
  [
    {
      provider: Providers.SQLITE
      testEmail: 'sqlite-user@example.com',
    },
    {
      provider: Providers.MONGODB
      testEmail: 'mongo-user@example.com',
    },
  ],
])
```

If the matrix has multiple dimensions, test suites will be generated for all permutations of the parameters. For example, the following matrix:

```ts
import { defineMatrix } from '../_utils/defineMatrix'

export default defineMatrix(() => [
  [
    {
      provider: Providers.SQLITE,
    },
    {
      provider: Providers.POSTGRESQL,
    },
  ],
  [
    {
      previewFeatures: '',
    },

    {
      previewFeatures: 'improvedQueryRaw',
    },
  ],
])
```

Will generate following test suites:

- `{ provider: Providers.SQLITE, previewFeatures: '' }`
- `{ provider: Providers.SQLITE, previewFeatures: 'improvedQueryRaw' }`
- `{ provider: Providers.POSTGRESQL, previewFeatures: '' }`
- `{ provider: Providers.POSTGRESQL, previewFeatures: 'improvedQueryRaw' }`

You can also optionally exclude certain combinations from matrix by using second argument of `defineMatrix` function:

```ts
import { defineMatrix } from '../_utils/defineMatrix'

export default defineMatrix(
  () => [
    [
      {
        provider: Providers.SQLITE,
      },
      {
        provider: Providers.POSTGRESQL,
      },
    ],
    [
      {
        previewFeatures: '',
      },

      {
        previewFeatures: 'improvedQueryRaw',
      },
    ],
  ],
  {
    exclude: ({ provider, previewFeatures }) => provider === Providers.SQLITE && previewFeatures === 'improvedQueryRaw',
  },
)
```

This will generate the same test suites as the previous example, except `sqlite`/`improvedQuery` combination

#### Schema template

`prisma/_schema.ts` will be used for generating an actual schema for the test suite:

```ts
import { idForProvider } from '../../_utils/idForProvider'
import testMatrix from '../_matrix'

export default testMatrix.setupSchema(({ provider }) => {
  return /* Prisma */ `
    generator client {
      provider = "prisma-client-js"
    }

  datasource db {
    provider = "${provider}"
  }

    model User {
      id ${idForProvider(provider)}
    }
  `
})
```

`setupSchema` callback receives all parameters from the matrix for a particular test suite as an argument.
`idForProvider` is a helper function which returns a correct primary key definition for each of the supported providers.
Datasource connection strings are configured via the Prisma config helpers (for example
`ctx.setDatasource`) rather than inlining them into the schema snippet.

#### Test suite

`tests.ts` contains actual tests for the suite:

```ts
import { Providers } from '../_utils/providers'
import testMatrix from './_matrix'

// @ts-ignore at the moment this is necessary for typechecks
declare let prisma: import('./generated/prisma/client').PrismaClient

testMatrix.setupTestSuite(
  (suiteConfig, suiteMeta) => {
    test('create', async () => {
      await prisma.user.create({
        data: {
          // `testEmail` was defined in the example matrix before
          // you can also use a constant here if you don't need
          // unique email per provider
          email: suiteConfig.testEmail,
        },
      })
    })
  },
  {
    optOut: {
      // if you are skipping tests for certain providers, you
      // have to list them here and specify the reason
      from: [Providers.MONGODB],
      reason: 'The test is for SQL databases only',
    },
  },
)
```

This test will run for every permutation of the parameters from the matrix. Currently used combination is available via `suiteConfig` parameter. Each suite will start with a clean already set up database, generated and initialized client, available via `prisma` global. After suite is finished, database will be dropped and client instance will disconnect automatically.

### Running functional tests

- `pnpm test:functional:code` generates and runs the test suites, defined by test matrix. It does no typechecking, but prepares all necessary files for it.
- `pnpm test:functional:types` runs typechecking on all the suites, generated by `pnpm test:functional:code` command. If it reports any errors, you might want to examine generated test suite under `tests/functional/<your test name>/.generated` directory to get a better diagnostic.
- `pnpm test:functional` will run tests and then perform type checks.

### Conditionally skipping type tests

Sometimes different test matrix parameters will generate different TS types so, and as a result,
correct code for one suite config won't pass type checks for a different one. In that case, you
can use `@ts-test-if` magical comment to conditionally skip type checks. For example:

```ts
// @ts-test-if: provider !== Providers.MONGODB
prisma.$queryRaw`...`
```

If JS expression, following `@ts-test-if:` evaluates to truthy value, `@ts-expect-error` will be
inserted in its place during the generation. All parameters from the test matrix can be used within that
expression.

## How to use custom engines

By default, you get the engines that are downloaded on postinstall in `@prisma/engines` thanks to `@prisma/engines-version`.

However, you may want to use a custom engine via from a branch in [`prisma/prisma-engines`](https://github.com/prisma/prisma-engines), or one that you've built locally.

### Prerequisites

You will need to have installed the Rust toolchain and a few extra dependencies. See [Building Prisma Engines](https://github.com/prisma/prisma-engines#building-prisma-engines).

### Using custom engines

1. Edit [`./packages/fetch-engine/package.json`](./packages/fetch-engine/package.json)

- **Either, add a `branch` property to `enginesOverride`**

  This will `git pull` the [branch](https://github.com/prisma/prisma-engines) and build the engines from there.

  ```diff
    "enginesOverride": {
  +    "branch": "feat/column-comparison",
    }
  ```

- **Or, add a `folder` property to `enginesOverride`**

  This will copy the engines from the folder where you've built them.

  ```diff
    "enginesOverride": {
  +    "folder": "/home/john/dev/prisma/prisma-engines/target/release"
    }
  ```

2. Run `pnpm install` again to propagate the new engines.

### On CI

For open pull request, can also add `/engine-branch branchName` command into PR body and re-run
the pipeline. Engine from corresponding branch will be checked out and built before running any tests
on CI.

## CI - Continuous Integration

By creating a Pull Request the following pipelines will be triggered

- [GitHub Action `CI`](https://github.com/prisma/prisma/blob/v7/.github/workflows/test.yml)
- [GitHub Action `Benchmark`](https://github.com/prisma/prisma/blob/v7/.github/workflows/benchmark.yml)

`CI` will need to be successful before merging ("flaky" tests might show up and might be ignored).

By default, some tests are tested only during daily builds. If you need to run all of them for your PR leave a `ci test all` comment on the PR and re-run the workflow.

### Publishing all the packages to npm on the `integration` tag

If a branch name starts with `integration/` like `integration/fix-all-the-things` the [GitHub Actions - v7 - npm - release](https://github.com/prisma/prisma/blob/v7/.github/workflows/publish.yml) pipeline will be triggered.
This workflow will directly publish (without running tests) the packages to npm on the `integration` tag with a version like `5.3.0-integration-fix-all-the-things.1` (where `5.3.0-` is the current dev version prefix, `integration-` is statically added, `fix-all-the-things` is from the branch name and `.1` indicates the first version published from this branch)

To make a Pull Request which will release a version to the `integration` tag automatically, the name of the branch of the PR would need to start with `integration/`.
Alternatively, add `/integration` in the Pull Request description:

- If this is added before opening the Pull Request, a release will happen automatically.
- If this is added after the creation of the PR, the `Detect jobs to run` job from the `CI` workflow needs to be re-triggered to get a release.

The [GitHub Actions - v7 - npm - release](https://github.com/prisma/prisma/blob/v7/.github/workflows/publish.yml) workflow can also be manually triggered to run on any branch.
Example:

- Go to https://github.com/prisma/prisma/actions/workflows/publish.yml?query=branch%3Ajoel%2Fdotenv
- Click "Run workflow"
- Change "Use workflow from" to match the branch you want to release, here `joel/dotenv`
- Check the box for "Check to force an integration release for any given branch name"
- Wait for the workflow to finish

Once published to npm the version will need to be installed with the exact version like:

```
npm install -D prisma@5.3.0-fix-all-the-things.1

# or executed with npx like
npx prisma@5.3.0-fix-all-the-things.1
```

(Note that npm version upgrades or the update notifier in Prisma CLI might behave weird and unexpectedly with these integration versions.)

Internal note: You can check the #feed-prisma-releases channel on our private Slack to get notified when versions are published.

#### About [ecosystem-tests](https://github.com/prisma/ecosystem-tests/)

Once the integration version is published on npm:

- The `check-for-update` workflow, which runs continuously, will find the new version, update the package.json and do a commit on the [`integration` branch](https://github.com/prisma/ecosystem-tests/tree/integration)
- The tests workflows will then run for that commit and will be visible [here](https://github.com/prisma/ecosystem-tests/actions?query=branch%3Aintegration)

## How to trigger artificial panics for our engines

Sometimes it may be useful to trigger a panic in the Rust binaries or libraries used by Prisma under the hood.

### Setup

- `mkdir artificial-panics && cd artificial-panics`
- `npx prisma init --datasource-provider sqlite`

### Trigger panic in Schema Engine

- run `FORCE_PANIC_SCHEMA_ENGINE=1 npx prisma migrate dev`

### Trigger panic in Formatter

- run `FORCE_PANIC_PRISMA_SCHEMA=1 npx prisma format`

### Trigger panic in Get DMMF

- run `FORCE_PANIC_GET_DMMF=1 npx prisma validate`

### Trigger panic in Get Config

- run `FORCE_PANIC_GET_CONFIG=1 npx prisma validate`
