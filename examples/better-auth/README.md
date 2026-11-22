# Better Auth with Prisma 8 (SQLite)

A minimal application that uses [Better Auth](https://www.better-auth.com) for email and password sign-in, storing its users, sessions, accounts and verification tokens through a Prisma 8 SQLite client with `@prisma/better-auth-adapter`.

- `prisma/contract.prisma` holds Better Auth's four core models.
- `src/lib/db.ts` creates the Prisma client; `src/lib/auth.ts` creates the Better Auth instance with `prismaAdapter(db)`.

## Run it

```bash
pnpm install
pnpm emit                             # writes src/prisma/contract.json and contract.d.ts
SQLITE_PATH=./dev.db pnpm db:init     # creates the tables
```

## Tests

`pnpm test` runs two tests, each in a copy of the project under the operating system's temporary directory:

- `test/sign-up.test.ts` signs a user up, signs in, reads the session and signs out through Better Auth's API.
- `test/auth-cli.test.ts` turns on Better Auth's two-factor plugin, runs `auth generate` and `auth check`, and checks that both print what the contract lacks and exit with code 1. It then adds what they printed to the contract, emits it, and checks that `auth generate` prints `Your schema is already up to date.` and `auth check` passes.
