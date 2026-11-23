# Better Auth with Prisma 8 and Next.js

A small Next.js application (App Router) that signs users up and in with [Better Auth](https://www.better-auth.com) email and password. Better Auth stores its users, sessions, accounts and verification tokens in Postgres through a Prisma 8 client and [`@prisma/orm-better-auth`](../../packages/9-public/@prisma/orm-better-auth/README.md).

| File | What it holds |
| --- | --- |
| `prisma/contract.prisma` | Better Auth's four models: `User`, `Session`, `Account` and `Verification` |
| `prisma/contract.json`, `prisma/contract.d.ts` | The emitted contract |
| `src/lib/db.ts` | The Prisma client, connected with `DATABASE_URL` |
| `src/lib/auth.ts` | The Better Auth instance, with `prismaAdapter(db)` and email and password sign-in |
| `src/lib/auth-client.ts` | Better Auth's client for the browser |
| `app/api/auth/[...all]/route.ts` | Better Auth's route handler |
| `app/page.tsx` | The home page: the signed-in user's name and email and a sign-out button, or links to sign in and sign up |
| `app/sign-up/page.tsx`, `app/sign-in/page.tsx` | The sign-up and sign-in forms |

## Run it

You need Node.js 24 or later and a Postgres database that holds only this application's tables, such as a new, empty database. These steps run the example inside this repository; to use it in your own project, see the next section first.

1. At the root of the repository, install the dependencies and build the packages: `pnpm install`, then `pnpm build`.
2. In `examples/better-auth`, copy `.env.example` to `.env`. Set `DATABASE_URL` to your database's connection string and `BETTER_AUTH_SECRET` to at least 32 random characters, for example the output of `pnpm auth secret`.
3. Emit the contract: `pnpm emit`. This writes `prisma/contract.json` and `prisma/contract.d.ts`. They are committed here, so you need this step only after you change `prisma/contract.prisma`.
4. Create the tables: `pnpm db:init`, which runs `prisma db init`.
5. Start the application: `pnpm dev`, then open <http://localhost:3000> and sign up.

Without `DATABASE_URL`, the application builds and starts, and the first request that reads the database fails with `Postgres driver not connected`.

## Using this outside the repository

The application code names only published packages. `package.json` and `tsconfig.json` use this repository's workspace, so in a copy:

- Replace each `workspace:` version (`@prisma/orm-postgres`, `@prisma/orm-better-auth`) with one published version, the same for both.
- Replace each `catalog:` version with a version from the registry.
- Replace `@repo/prisma-bin`, which provides the `prisma` command here, with the `prisma` package. Keep `@prisma/cli-engine`, at the version `prisma` names. These two are what `prisma orm init` installs.
- Replace `"extends": ["@repo/tsconfig/base"]` in `tsconfig.json` with your own compiler options, for example the ones `create-next-app` writes, and remove the `@repo/tsconfig` dependency.
- Remove `@repo/test-utils`, `@prisma/dev`, `vitest`, `pathe`, `test/` and `vitest.config.ts`, which only the smoke test uses.
- Remove `biome.jsonc`, the `lint` script and `turbo.json`, which belong to this repository's tooling.
- Remove `migrations/` and `AGENTS.md` from `.gitignore`. `prisma db init` writes the folder and `next dev` writes the file, and your project should commit both; this repository leaves them out so that running the example changes no tracked file.

## Add a Better Auth plugin

Plugins add models and fields to Better Auth. After you add a plugin to `src/lib/auth.ts`, run `pnpm auth generate`: it prints the models and fields your contract lacks and writes nothing. Add them to `prisma/contract.prisma`, run `pnpm emit` and `pnpm prisma db update`, and `pnpm auth generate` then prints `Your schema is already up to date.`. `prisma db update` makes the database match the contract, so it plans to drop any table the contract has no model for and asks you to confirm each one; in a database that holds only this application's tables there is none to drop. The [adapter's README](../../packages/9-public/@prisma/orm-better-auth/README.md#when-the-contract-is-missing-something) explains the message and the options.

## Test

`pnpm test` starts a development Postgres database, creates the tables, starts the application, and then over HTTP signs up, signs in, reads the session, checks that the home page shows the user, signs out and checks that the session is gone.
