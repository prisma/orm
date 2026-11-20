# Welcome to Contributing to Prisma ORM!

Welcome! You've arrived at our Contributing page and are now one step away from joining our quest to make databases easy. We're thankful for all your contributions, whether it's helping us find issues in our code, highlighting features we're missing, or contributing to the codebase. If you've found your way here, you'll soon be ready to join in the fun of building features and fixing bugs directly with us - and we're thrilled to have you on board!

To get you started on a good foot, we've created an easy overview of the most important things to get you started contributing code to Prisma below as well as a [Code of Conduct](https://github.com/prisma/prisma/blob/v7/CODE_OF_CONDUCT.md) for contributing to the development of Prisma.

We also encourage you to join our sprawling [community](https://www.prisma.io/community) online, where you can discuss ideas, ask questions and get inspiration for what to build next.

## Contributing Code

Welcome to the monorepo for our TypeScript code for the Prisma ORM. (for the Engines' code written in Rust [it's there](https://github.com/prisma/prisma-engines))

## Contributing via comments

### Signal interest without noise

To help maintainers triage efficiently:

- Use GitHub reactions (👍) on the top post or relevant comments to show support.
- Only add a comment if you bring _new, actionable information_ (e.g., reproducible steps, environment details, impact/severity, or a concrete use case).
- Comments that only say “+1”, “same here”, or “any update?” create notification noise and may be marked as off-topic. Please use reactions instead on the main post.

## General Prerequisites

1. Install Node.js `>=20.19` minimum, [latest LTS is recommended](https://nodejs.org/en/about/releases/)
   - Recommended: use [`nvm`](https://github.com/nvm-sh/nvm) for managing Node.js versions

1. Install [`pnpm`](https://pnpm.io/) (for installing npm dependencies, using pnpm workspaces)
1. Install [`docker`](https://www.docker.com/products/docker-desktop) (for managing databases for our tests)
1. Install [`ts-node`](https://github.com/TypeStrong/ts-node) (for running Node.js scripts written in TypeScript)

Copy paste these commands to install the global dependencies:

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.5/install.sh | bash
nvm install 18
npm install --global pnpm@10 ts-node
```

### For Windows Users

The Prisma repository is configured for Unix-like environments (Linux/macOS). Commands, scripts, and configurations in this repo assume a POSIX-compliant shell and filesystem, meaning that Windows environments are not natively supported. If you’re developing on Windows, you’ll need to configure your environment accordingly, as commands and tooling may not work as expected without adjustments.

We recommend one of the following approaches:

1. [Windows Subsystem for Linux (WSL)](https://learn.microsoft.com/en-us/windows/wsl/install): WSL allows you to run a Linux distribution alongside your Windows installation, providing a native-like development environment
2. [Visual Studio Code with Dev Containers](https://code.visualstudio.com/docs/devcontainers/containers): Utilizing Visual Studio Code’s Dev Containers feature allows you to develop inside a Docker container, ensuring a consistent environment across different systems

## General Setup

To set up and build all the packages, follow these steps:

```bash
git clone https://github.com/prisma/prisma.git
cd prisma
pnpm i
pnpm -r run dev
```

> 💡 For Windows users: use the latest version of [Git Bash](https://gitforwindows.org/).

## Building packages when you make changes

In the root directory:

- `pnpm -r run build` (-r for recursive) will build all the packages.
- `pnpm -r run dev` (-r for recursive) will build all the packages, without running `tsc`.
- `pnpm run watch` will continuously build any packages that have been modified, without running `tsc` (Fastest).

In a package directory, like `packages/client`:

- `pnpm run build` will build the package.
- `pnpm run dev` will build the package without running `tsc` (Fastest).

> 💡 Our builder is built on top of `esbuild`

## Prisma Client

### First contribution

Create a reproduction folder for developing, trying a new feature, or a fix.

#### Setting up a locally-linked development folder

Set up a local project that will be linked to the local packages.

```sh
cd sandbox
# Copy a template from the reproduction folder
cp -r basic-sqlite my-repro && cd my-repro
# Install dependencies
pnpm install
# Ensure that the db and the schema are synced
pnpm dbpush
# Do some code changes, always re-generate the client, then try it out
pnpm generate && pnpm start
```

To run the `index.ts` under debugger, do the following steps:

1. Run `pnpm debug` from a reproduction folder
2. In Google Chrome or any Chromium-based browser open `chrome://inspect` page.
3. Press "Open dedicated dev tools for Node.js" button
4. To resume the script go to the "Sources" tab and press "Resume script execution" button (F8).

To add breakpoints use either DevTools UI or add [`debugger`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Statements/debugger) statements to the source code.

> 💡 This works best when compiling with `pnpm run watch` in the background.

> 💡 In any successful setup `pnpm prisma -v` should return version `0.0.0`.

<details>
  <summary><b>Alternatives</b></summary>

#### Detailed steps for a manually creating a locally-linked sandbox

```sh
cd sandbox
mkdir my-repro
cd my-repro
pnpm init
pnpm add ../../packages/client
pnpm add -D ../../packages/cli
pnpm add -D typescript ts-node
pnpm add -D @types/node
touch index.ts
pnpm tsc --init
pnpm prisma init
# > Manually populate the schema.prisma
# > Manually add 👇 to the generator block
#   output = "../node_modules/.prisma/client"
# > Manually populate the index.ts
pnpm prisma db push --skip-generate
pnpm prisma generate && pnpm ts-node index.ts # Try it out
```

#### Developing and working in the fixture folder

```sh
cd packages/client
ts-node fixtures/generate.ts ./fixtures/blog/
cd fixtures/blog
npx prisma db push --skip-generate
ts-node main.ts # Try it out
```

</details>

### Tests

For an overview, adding, running tests & guidelines see [TESTING.md](./TESTING.md).

#### Integration tests

We have two kinds of integration tests:

##### Prisma Client folder-based integration tests (`./client`)

The integration tests consisting of mini projects are located in [`src/client/src/__tests__/integration`](./packages/client/src/__tests__/integration)

Run the tests:

```sh
cd packages/client
pnpm run test integration
```

###### Creating a new folder-based integration test

If you want to create a new one, we recommend to copy over the [minimal test](https://github.com/prisma/prisma/tree/v7/packages/client/src/__tests__/integration/happy/minimal) and adjust it to your needs.
It will give you an in-memory Prisma Client instance to use in the test. It utilizes the `getTestClient`) helper method.

Sometimes you need an actual generated Client, that has been generated to the filesystem. In that case use `generateTestClient`. An example that uses this helper is the [blog example](https://github.com/prisma/prisma/tree/v7/packages/client/src/__tests__/integration/happy/blog)

##### General Client integration tests (`./integration-tests`)

The integration tests consisting of mini project are located in [`packages/integration-tests/src/__tests__/integration`](./packages/integration-tests/src/__tests__/integration)

Run the tests:

```sh
cd packages/integration-tests
pnpm run test
```

## Prisma Migrate

### First contribution

The entrypoint for the Migrate CLI is the [`bin.ts`](./packages/migrate/src/bin.ts) file.

1. `cd packages/migrate/fixtures/blog` - it's a minimal project that can be used to try things out
2. Then modify some code
3. `../../src/bin.ts migrate dev` for running `prisma migrate dev` command. (It will use `tsx`)

> 💡 You can also test your changes in a reproduction project via the [CLI](#developing-prisma-cli).

### Tests

For an overview, adding, running tests & guidelines see [TESTING.md](./TESTING.md).

Tests fixtures are located in [`./packages/migrate/src/__tests__/fixtures`](./packages/migrate/src/__tests__/fixtures)

## Additional Resources

- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [TESTING.md](./TESTING.md)
- [Prisma Docs](https://www.prisma.io/docs/)
- [TablePlus](https://tableplus.com/) is a great GUI for databases, useful for managing sqlite database fixtures for example.

## Prisma CLI

For the list of commands and parameters, you can check out the [documentation](https://www.prisma.io/docs/reference/api-reference/command-reference).

We also maintain a [completion spec](https://github.com/withfig/autocomplete/blob/master/src/prisma.ts).
It is consumed by the following tools: [Warp terminal (macOS only)](https://www.warp.dev/), [Fig terminal (macOS only)](https://fig.io/), [inshellisense (all OS)](https://github.com/microsoft/inshellisense)

The CLI entrypoint is the [`bin.ts`](./packages/cli/src/bin.ts) file.

This is a list of the top level commands:

- [(no command)](./packages/cli/src/CLI.ts)
- [`db`](./packages/migrate/src/commands/DbCommand.ts) -> it's a namespace
- [`debug`](./packages/cli/src/DebugInfo.ts)
- [`format`](./packages/cli/src/Format.ts)
- [`generate`](./packages/cli/src/Generate.ts)
- [`init`](./packages/cli/src/Init.ts)
- [`introspect`](./packages/migrate/src/commands/DbPull.ts) (deprecated and renamed to `db pull`)
- [`migrate`](./packages/migrate/src/commands/MigrateCommand.ts) -> it's a namespace
- [`studio`](./packages/cli/src/Studio.ts)
- [`telemetry`](./packages/cli/src/Telemetry.ts) (internal only)
- [`validate`](./packages/cli/src/Validate.ts)
- [`version`](./packages/cli/src/Version.ts)

Some top level commands are namespaces, they do not execute an action without a subcommand (e.g. `db`, `migrate`).
Each command, namespaces included, and subcommand provides help output via `-h`/`--help` flags.

Note that the Prisma CLI bundles all its dependencies. If you happen to make changes to dependencies in the monorepo (e.g. `@prisma/internals`), you must run at the root level, `pnpm -r run dev` or `pnpm run watch` to make the changes available to the CLI.

### First contribution

Create a reproduction folder for developing, trying a new feature, or a fix.

#### Open a Pull Request

When opening a PR these are the expectations before it can be merged:

- There is a description explaining the changes, optimally linking the tracking issue that will be closed when merged.
  - If you are a Prismanaut, you can add `/integration` in the description to get a version released to npm to the `integration` tag, see [TESTING.md](./TESTING.md) for more details.
- Tests are written and cover the changes.
- `Lint` & `CLI commands` & `All pkgs (win+mac)` GitHub Actions workflows should be successful.
- The reported bundle size of `packages/cli/build/index.js` in the `size-limit report 📦` comment in the PR needs to stay below ~6MB. (The comment will be posted by the [bundle-size GitHub Action workflow](https://github.com/prisma/prisma/actions/workflows/bundle-size.yml) automatically.
  - Later once a dev version is published, the unpacked size of the CLI stays below ~16MB on [npm](https://www.npmjs.com/package/prisma).
- There is a tracking issue or/and an open PR to update the [documentation](https://www.prisma.io/docs), especially the [Prisma CLI reference](https://www.prisma.io/docs/reference/api-reference/command-reference).

#### Setting up a locally-linked development directory

Set up a local project that will be linked to the local packages.

> 💡 This works best when compiling with `pnpm run watch` in the background.

```sh
cd sandbox

# Copy a template from the sandbox directory
cp -r basic-sqlite my-project
cd my-project

pnpm install

pnpm prisma -v
# 💡 In any successful setup `pnpm prisma -v` should return
# prisma                  : 0.0.0
# @prisma/client          : 0.0.0
# ...

pnpm prisma generate
```

<details>
  <summary><b>Alternatives</b></summary>

```sh
cd packages/cli
./src/bin.ts -v # should return the version `prisma: 0.0.0` in the output
./src/bin.ts generate # for `prisma generate`
```

</details>

### Tests

For an overview, adding, running tests & guidelines see [TESTING.md](./TESTING.md).

Tests are located under [`./packages/cli/src/__tests__/`](./packages/cli/src/__tests__/)

- Commands are tested in [`./packages/cli/src/__tests__/commands/`](./packages/cli/src/__tests__/commands/)
- Fixtures are in [`./packages/cli/src/__tests__/fixtures/`](./packages/cli/src/__tests__/fixtures/)

## Conventions

### Git Commit Messages

We structure our messages like this:

```
<type>(<package>): <subject>
<BLANK LINE>
<body>
```

Example

```
feat(client): new awesome feature

Closes #111
```

List of types:

- feat: A new feature
- fix: A bug fix
- docs: Documentation only changes
- style: Changes that do not affect the meaning of the code (white-space, formatting, missing semi-colons, etc)
- refactor: A code change that neither fixes a bug nor adds a feature
- perf: A code change that improves performance
- test: Adding missing or correcting existing tests
- chore: Changes to the build process or auxiliary tools and libraries such as documentation generation

## Legal

Pull Request authors must sign the [Prisma CLA](https://cla-assistant.io/prisma/prisma), it will show up in an automated comment after you create a PR.

If you cannot or do not want to sign this CLA (e.g. your employment contract for your employer may not allow this), you should not submit a PR.
Open an issue and someone else can do the work.
