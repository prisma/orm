# @prisma/better-auth-adapter

Use [Better Auth](https://www.better-auth.com) with Prisma 8. The adapter stores Better Auth's users, sessions, accounts and verification tokens through your application's Prisma 8 client, on Postgres or SQLite.

```ts
// src/lib/auth.ts
import { betterAuth } from 'better-auth';
import { prismaAdapter } from '@prisma/better-auth-adapter';
import { db } from './db';

export const auth = betterAuth({
  database: prismaAdapter(db),
  emailAndPassword: { enabled: true },
});
```

## Install

Install the adapter at the same version as your Prisma 8 database package, together with Better Auth 1.7:

```sh
pnpm add @prisma/better-auth-adapter@<version of @prisma/orm-postgres or @prisma/orm-sqlite> better-auth@1.7
```

The adapter uses the Prisma packages your database package already installs. If the versions differ, your package manager warns you, or refuses to install when it checks peer dependencies strictly. Keep them the same, or the adapter loads a second copy of Prisma's code.

Better Auth must load one copy of `@better-auth/core`, the one `better-auth` itself uses. Better Auth keeps the contract check described below in that package, so a second copy never sees it.

## Supported databases and versions

- Postgres and SQLite, through `@prisma/orm-postgres` and `@prisma/orm-sqlite`. The adapter refuses a client for another database.
- Better Auth 1.7 (`>=1.7.0 <1.8.0`). It is tested against 1.7.27.

## Set up

These steps assume an application that already uses Prisma 8 on Postgres or SQLite. To start one, see the [Prisma docs](https://www.prisma.io/docs/orm).

### 1. Add Better Auth's models to your contract

Better Auth's models live in your contract, next to your own models. For the default configuration, add these four models to your PSL contract, for example `prisma/contract.prisma`. The same PSL works on Postgres and SQLite:

```prisma
// use prisma-8

model User {
  id            String    @id
  name          String
  email         String    @unique
  emailVerified Boolean
  image         String?
  createdAt     DateTime
  updatedAt     DateTime
  sessions      Session[]
  accounts      Account[]

  @@map("user")
}

model Session {
  id        String   @id
  expiresAt DateTime
  token     String   @unique
  createdAt DateTime
  updatedAt DateTime
  ipAddress String?
  userAgent String?
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@map("session")
}

model Account {
  id                    String    @id
  accountId             String
  providerId            String
  userId                String
  user                  User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  accessToken           String?
  refreshToken          String?
  idToken               String?
  accessTokenExpiresAt  DateTime?
  refreshTokenExpiresAt DateTime?
  scope                 String?
  password              String?
  createdAt             DateTime
  updatedAt             DateTime

  @@index([userId])
  @@map("account")
}

model Verification {
  id         String   @id
  identifier String
  value      String
  expiresAt  DateTime
  createdAt  DateTime
  updatedAt  DateTime

  @@index([identifier])
  @@map("verification")
}
```

Plugins and `additionalFields` add models and fields. You do not have to work them out: `auth generate` prints what to add (see below).

Then emit the contract and update your database:

```sh
prisma contract emit
prisma db update
```

### 2. Create the client

On Postgres:

```ts
// src/lib/db.ts
import postgres from '@prisma/orm-postgres/runtime';
import { contractFromJson } from '@prisma/orm-postgres/static';
import type { Contract } from '../../prisma/contract';
import contractJson from '../../prisma/contract.json' with { type: 'json' };

const url = process.env['DATABASE_URL'];
if (url === undefined && process.env['NEXT_PHASE'] !== 'phase-production-build') {
  throw new Error('DATABASE_URL is not set. Set it to your Postgres connection string.');
}

export const db = postgres({
  contract: contractFromJson<Contract>(contractJson),
  ...(url !== undefined && { url }),
});
```

The `NEXT_PHASE` condition is for Next.js: `next build` loads this file without your environment. Outside Next.js, drop the condition.

On SQLite, give the client a file path:

```ts
// src/lib/db.ts
import sqlite from '@prisma/orm-sqlite/runtime';
import { contractFromJson } from '@prisma/orm-sqlite/static';
import type { Contract } from '../../prisma/contract';
import contractJson from '../../prisma/contract.json' with { type: 'json' };

export const db = sqlite({
  contract: contractFromJson<Contract>(contractJson),
  path: './dev.db',
});
```

### 3. Pass the client to Better Auth

Pass the client itself, not a transaction, to `prismaAdapter`, as in the example at the top.

## When the contract is missing something

The adapter compares your contract with what your Better Auth configuration needs. When something is missing, it tells you what to add. You see the same text in three places:

- `auth generate` prints it and exits with code 1. It never writes a file.
- `auth check` prints it and exits with code 1.
- Every request your application serves, and every server-side Better Auth call it makes, fails with it until the contract is fixed.

For example, after adding Better Auth's two-factor plugin to the configuration above:

```text
$ npx auth@latest generate
Your Prisma contract is missing models or fields that Better Auth needs.

Add to your contract:

model User {
  twoFactorEnabled Boolean?
  twoFactors       TwoFactor[]
}

model TwoFactor {
  id                      String    @id
  secret                  String
  backupCodes             String
  userId                  String
  user                    User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  verified                Boolean?
  failedVerificationCount Int?
  lockedUntil             DateTime?

  @@index([secret])
  @@index([userId])
  @@map("twoFactor")
}

Then run `prisma contract emit` and update your database.
```

Add the printed fields to your existing `User` model, add the new model, then run `prisma contract emit` and `prisma db update`. After that, `auth generate` prints `Your schema is already up to date.` and `auth check` prints `Schema check passed against adapter "prisma-8".`, both with exit code 0.

The message can also list fields whose type is wrong, and fields your contract requires that Better Auth never writes: make those optional or give them a default.

Some things to know:

- The commands read the contract through your application's client, so they compare against the contract you last emitted with `prisma contract emit`.
- A contract written in TypeScript gets the same message, in PSL. Add the equivalent models and fields in TypeScript.
- Setting Better Auth's `advanced.database.validateSchema` to `false` turns off the check on requests. It does not make an incomplete contract work: a call that uses a field your contract lacks then fails with Prisma's own error, `ORM.FIELD_UNKNOWN`.

## Options

`prismaAdapter(db, options)` takes these options:

| Option | Type | Default | What it does |
| --- | --- | --- | --- |
| `namespace` | `string` | none | The Postgres schema that holds Better Auth's models, for example `auth`. You need it only when a model name exists in more than one schema. Models `auth generate` prints then go inside `namespace <name> { ... }`. |
| `usePlural` | `boolean` | `false` | Better Auth's model names get an `s`: `users`, `sessions`, and so on. |
| `transaction` | `boolean` | `false` | When `true`, Better Auth's multi-step operations run in a database transaction. |
| `debugLogs` | Better Auth's debug log option | none | Logs each call the adapter makes. |

Model and field names: the adapter matches Better Auth's model names to your contract's model names, either exactly (`user`) or with the first letter upper-cased (`User`), and Better Auth's field names to your field names exactly. Table and column names come from `@@map` and `@map` in your contract. Rename a model or field on Better Auth's side with its `modelName` and `fields` options. A name must be letters, digits and `_`, and must not start with a digit.

## Limits

- **SQLite needs a file.** With `:memory:`, each transaction gets its own empty database.
- **Transactions on SQLite.** With `transaction: true` on SQLite, a write from another request while a transaction is open blocks the whole process for up to five seconds and then fails with `database is locked`. Leave `transaction` off on SQLite if your application serves requests concurrently.
- **Case-insensitive search.** Case-insensitive filters compare both sides with `lower()`. On SQLite, `lower()` changes ASCII letters only, so `École` and `école` do not match each other. On Postgres, `lower()` follows the database's collation.
- **Booleans cannot be sorted.** Sorting on a `Boolean` field fails with an error that names the field.
- **Joins need relations.** With Better Auth's `advanced.database.joins`, a join runs as one query only when your contract declares the relation between the two models, as the printed PSL does. Without the relation, Better Auth runs one extra query per row.
- **Dates.** Better Auth's date fields must be `DateTime` fields that read as JavaScript `Date` values, with a precision of three fraction digits or fewer. `DateTime` and `DateTime(storage: timestamp)` both work. `DateTime(as: temporal)` and `DateTime(as: string)` do not.
- **JSON and list fields are stored as text.** Declare Better Auth's JSON fields and its string and number lists as `String`, not `Json` or `String[]`; Better Auth converts them itself. If you are upgrading a Postgres database that has a `jsonb` or array column for such a field, convert it to text:

  ```sql
  ALTER TABLE "oauthClient" ALTER COLUMN "metadata" TYPE text USING "metadata"::text;
  ALTER TABLE "oauthClient" ALTER COLUMN "redirectUris" TYPE text USING array_to_json("redirectUris")::text;
  ```

- **Numbers.** The printed PSL declares Better Auth's number fields as `Int`, which on Postgres holds whole numbers up to about two billion. A number field that holds fractions or larger values, such as an interval in milliseconds, should be declared `Float` or `BigInt(as: number)` instead; both are accepted.
- **Optional fields must be optional.** A field Better Auth treats as optional must be optional (`?`) in your contract, because Better Auth writes `null` to it.
- **Ids.** With `generateId: false`, declare the id with a default, as the printed PSL does (`id String @id @onCreate(uuid())`). A `generateId` function that returns `false` for some models needs the same for those models' ids.

## Responsibilities

- Translate Better Auth's database calls into calls on your Prisma 8 client.
- Compare your contract with the models and fields Better Auth needs, and say what to add or change, through `auth generate`, `auth check` and the check on requests.
- Print the PSL to add for missing models and fields.

## Dependencies

- `@prisma/orm-framework` and `@prisma/orm-family-sql`, as peers at the same version as your database package.
- `@better-auth/core` 1.7, as a peer.

The package imports only published entrypoints, so it works outside the Prisma repository.
