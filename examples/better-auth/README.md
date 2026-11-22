# Better Auth with Prisma 8 and Next.js

A small Next.js application (App Router) that signs users up and in with [Better Auth](https://www.better-auth.com) email and password. Better Auth stores its users, sessions, accounts and verification tokens in Postgres through a Prisma 8 client and [`@prisma/better-auth-adapter`](../../packages/9-public/@prisma/better-auth-adapter/README.md).

| File | What it holds |
| --- | --- |
| `prisma/contract.prisma` | Better Auth's four models: `User`, `Session`, `Account` and `Verification` |
| `src/prisma/` | The emitted contract, `contract.json` and `contract.d.ts` |
| `src/lib/db.ts` | The Prisma client, connected with `DATABASE_URL` |
| `src/lib/auth.ts` | The Better Auth instance, with `prismaAdapter(db)` and email and password sign-in |
| `src/lib/auth-client.ts` | Better Auth's client for the browser |
| `app/api/auth/[...all]/route.ts` | Better Auth's route handler |
| `app/page.tsx` | The home page: the signed-in user's name and email and a sign-out button, or links to sign in and sign up |
| `app/sign-up/page.tsx`, `app/sign-in/page.tsx` | The sign-up and sign-in forms |

## Run it

You need Node.js 24 or later and a Postgres database.

1. Install the dependencies: `pnpm install`.
2. Copy `.env.example` to `.env`. Set `DATABASE_URL` to your database's connection string and `BETTER_AUTH_SECRET` to at least 32 random characters, for example the output of `pnpm auth secret`.
3. Emit the contract: `pnpm emit`. This writes `src/prisma/contract.json` and `src/prisma/contract.d.ts`. They are committed here, so you need this step only after you change `prisma/contract.prisma`.
4. Create the tables: `pnpm db:init`, which runs `prisma db init`.
5. Start the application: `pnpm dev`, then open <http://localhost:3000> and sign up.

## Add a Better Auth plugin

Plugins add models and fields to Better Auth. After you add a plugin to `src/lib/auth.ts`, run `pnpm auth generate`: it prints the models and fields your contract lacks and writes nothing. Add them to `prisma/contract.prisma`, run `pnpm emit` and `pnpm prisma db update`, and `pnpm auth generate` then prints `Your schema is already up to date.`. The [adapter's README](../../packages/9-public/@prisma/better-auth-adapter/README.md#when-the-contract-is-missing-something) explains the message and the options.

## Test

`pnpm test` starts a development Postgres database, creates the tables, starts the application, and then over HTTP signs up, signs in, reads the session, checks that the home page shows the user, signs out and checks that the session is gone.
