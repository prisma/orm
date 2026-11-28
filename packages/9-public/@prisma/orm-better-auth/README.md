# @prisma/orm-better-auth

Use [Better Auth](https://www.better-auth.com) with Prisma 8. The adapter stores Better Auth's users, sessions, accounts and verification tokens through your application's Prisma 8 client, on Postgres.

> **Maturity level: Generally Available.** From release 8.0, no later 8.x release breaks code that uses this package. Until release 8.0 it is published as `8.0.0-rc.N`, like every Prisma 8 package, and any of those versions may contain breaking changes. See [Versions and support](https://github.com/prisma/orm/blob/main/docs/oss/versioning.md#maturity-levels).

```ts
// src/lib/auth.ts
import { betterAuth } from 'better-auth';
import { prismaAdapter } from '@prisma/orm-better-auth';
import { db } from './db';

export const auth = betterAuth({
  database: prismaAdapter(db),
  emailAndPassword: { enabled: true },
});
```

## Install

Install the adapter from the same release as your Prisma 8 packages, together with Better Auth 1.7.22 or a later 1.7 release.

- **Until release 8.0,** use the same exact `8.0.0-rc.N` as your database package.
- **From release 8.0,** the adapter is Generally Available, so its version has no level suffix, even when your database package is below GA. Write its line the way your other Prisma lines are written: with a caret beside `@prisma/orm-postgres`, which is GA, and with a tilde beside `@prisma/orm-sqlite`, which is not. With a tilde, an update cannot move the adapter to a release that your database package cannot follow.

For release 8.0:

```sh
# beside @prisma/orm-postgres
pnpm add "@prisma/orm-better-auth@^8.0.1" "better-auth@~1.7.22"
# beside @prisma/orm-sqlite, a proof of concept
pnpm add "@prisma/orm-better-auth@~8.0.1" "better-auth@~1.7.22"
```

For a later release, such as 8.3, write `8.3.0` in place of `8.0.1`.

The adapter uses the Prisma packages your database package already installs: `@prisma/orm-framework`, `@prisma/orm-family-sql` and `@prisma/orm-toolchain`. If the adapter needs a later release of them than you have, your package manager warns you, or refuses to install when it checks peer dependencies strictly. So install the adapter from the same release as those packages.

Better Auth must load one copy of `@better-auth/core`, the one `better-auth` itself uses. Better Auth keeps the contract check described below in that package, so a second copy never sees it.

## Supported databases and versions

- Postgres, through `@prisma/orm-postgres`.
- SQLite, through `@prisma/orm-sqlite`, as a proof of concept only. Prisma 8's SQLite package is itself a proof of concept, and the adapter promises nothing beyond what that package does. Better Auth's adapter suites run on it, and the limits below apply.
- The adapter refuses a client for any other database.
- Better Auth 1.7.22 or a later 1.7 release (`>=1.7.22 <1.8.0`). It is tested against 1.7.22 and 1.7.27. Releases from 1.7.6 to 1.7.21 run the contract check when the auth instance is created, and log a contract that is missing something as "Could not validate the database schema. Check your database connection.", which is wrong. From 1.7.22 the check runs before the first request instead, and the request fails with the adapter's message.

## Set up

These steps assume an application that already uses Prisma 8 on Postgres. To start one, see the [Prisma docs](https://www.prisma.io/docs/orm).

### 1. Add Better Auth's models to your contract

Better Auth's models live in your contract, next to your own models. For the default configuration, add these four models to your PSL contract, for example `prisma/contract.prisma`. The same PSL also works on SQLite:

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

Plugins and `additionalFields` add models and fields. You do not have to work them out: `auth generate` adds them to your contract (see below).

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

export const db = postgres({
  contract: contractFromJson<Contract>(contractJson),
  url: process.env['DATABASE_URL']!,
});
```

On SQLite, as a proof of concept, give the client a file path:

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

The adapter compares your contract with what your Better Auth configuration needs. When your contract is written in PSL and lacks only models or fields, `auth generate` adds them. For example, after adding Better Auth's two-factor plugin to the configuration above:

```console
$ npx auth@latest generate
Changes to prisma/contract.prisma: 2 fields added to User, model TwoFactor added. After the file is written, run `prisma contract emit` and update your database.
✔ The file /home/me/my-app/prisma/contract.prisma already exists. Do you want to overwrite the schema to the file? … yes
🚀 Schema was overwritten successfully!
```

Better Auth asks before it writes the file, and `--yes` answers for you. Its question names the file by its full path. The new fields go after the last field of the model they belong to, before its `@@` lines, indented like that field. The new models go at the end of the file, indented like your other models, and inside `namespace <name> { ... }` when you set the adapter's `namespace` option. Every line you wrote stays as it was. When Better Auth asks for a foreign-key action the printed PSL cannot use, a `Note:` line after the first line says what is written instead. Then run `prisma contract emit` and `prisma db update`. After that, `auth generate` prints `Your schema is already up to date.` and `auth check` prints `Schema check passed against adapter "prisma-8".`, both with exit code 0.

`auth generate` finds the contract files through `prisma.config.ts` in the directory the command runs in, and skips any file there that does not start with `// use prisma-8`, as `prisma contract emit` does. To name the file yourself, pass it with `--output`, for example `npx auth@latest generate --output prisma/contract.prisma`; the file must be one of your contract's files. With Better Auth's `--cwd` option, always pass `--output`: Better Auth does not tell the adapter the directory `--cwd` names, so the adapter would look for `prisma.config.ts` in the directory you run the command in. A contract split over several files works when everything to add belongs in one of them.

### When nothing is written

In every other case the adapter tells you what to add or change, and writes nothing. You see the same text in three places:

- `auth generate` prints it and exits with code 1.
- `auth check` prints it and exits with code 1.
- Every request your application serves, and every server-side Better Auth call it makes, fails with it until the contract is fixed.

For example, `auth check` with the two-factor plugin, before `auth generate` has added its models:

```text
$ npx auth@latest check
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

The message can also list fields whose type is wrong; optional Better Auth fields that your contract makes required, which you make optional; and fields your contract requires that Better Auth never writes, which you make optional or give a default. `auth generate` does not make these changes. Make them, run `prisma contract emit`, and run `auth generate` again for what is left to add.

`auth generate` also writes nothing, and adds a line to the message that says why, when:

- the contract is written in TypeScript. The message is in PSL: add the equivalent models and fields in TypeScript.
- the contract is read from a Prisma 7 schema. The message is in Prisma 8 syntax: add the equivalent lines by hand.
- there is neither `--output` nor a `prisma.config.ts` that names the contract, `prisma.config.ts` does not load, or Prisma's config loader is not installed.
- the file `--output` names does not exist or cannot be read.
- `--output` names a directory. Better Auth then passes the adapter a file named `auth-schema.ts` in that directory, so `--output` must name the contract file itself. The adapter treats any `--output` file named `auth-schema.ts` this way, whether or not it exists.
- a contract file does not parse, the file `--output` names does not start with `// use prisma-8`, or none of the files `prisma.config.ts` names does.
- the contract inputs `prisma.config.ts` names match no file.
- a model it would add fields to is declared in none of the contract files, or in more than one.
- the additions belong in more than one file, because Better Auth writes one file.
- a model has no field named `id` (see [Limits](#limits)).
- a model it would add fields to is written on one line, with its `}` on the line of its last field.
- the contract file already declares a model or field it would add, under the name Better Auth looks it up by. This happens when you edit the contract and do not run `prisma contract emit`: run it, then `auth generate` again.
- the contract file stores a model in the table, or a field in the column, that Better Auth's model or field needs, under another name. Emitting does not help, because the adapter finds models and fields by name, not by table or column. The message names the model or field Better Auth looks for: rename yours to that name, then run `prisma contract emit`. Better Auth's own naming options are the other way to make the names agree (see the model and field names under [Options](#options)). Table and column names are compared exactly, letter case included.
- the contract file declares something else, such as an enum, a composite type or a mixin, with the name of a model it would add. Rename that declaration and run `auth generate` again.
- Prisma would not accept the edited file although it accepted the original, for example because of a duplicate declaration the other checks did not foresee. The line names Prisma's first new error.

Some things to know:

- The commands read the contract through your application's client, so they compare against the contract you last emitted with `prisma contract emit`. `auth generate` then edits the contract's source file.
- Setting Better Auth's `advanced.database.validateSchema` to `false` turns off the check on requests. It does not make an incomplete contract work: a call that uses a field your contract lacks then fails with Prisma's own error, `ORM.FIELD_UNKNOWN`.

## Options

`prismaAdapter(db, options)` takes these options:

| Option | Type | Default | What it does |
| --- | --- | --- | --- |
| `namespace` | `string` | none | The Postgres schema that holds Better Auth's models, for example `auth`. You need it only when a model name exists in more than one schema. Models `auth generate` adds or prints then go inside `namespace <name> { ... }`. |
| `usePlural` | `boolean` | `false` | Better Auth's model names get an `s`: `users`, `sessions`, and so on. |
| `transaction` | `boolean` | `false` | When `true`, Better Auth's multi-step operations run in a database transaction. |
| `debugLogs` | Better Auth's debug log option | none | Logs each call the adapter makes. |

Model and field names: the adapter matches Better Auth's model names to your contract's model names, either exactly (`user`) or with the first letter upper-cased (`User`), and Better Auth's field names to your field names exactly. Table and column names come from `@@map` and `@map` in your contract. Rename a model or field on Better Auth's side with its `modelName` and `fields` options, for example `user: { modelName: 'person', fields: { email: 'emailAddress' } }`. A plugin's models and the fields it adds are renamed through the plugin's `schema` option instead, for example `twoFactor({ schema: { twoFactor: { modelName: 'mfa' }, user: { fields: { twoFactorEnabled: 'mfaOn' } } } })`. A name must be letters, digits and `_`, and must not start with a digit. Two Better Auth model names must not differ only in the case of the first letter (`user` and `User`); the adapter does not support that configuration and refuses it. Set a different `modelName` on all but one of them.

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
- **Optional fields must be optional.** Every field Better Auth declares optional must be optional (`?`) in your contract, as the printed PSL writes it, because Better Auth can write `null` to it. A default does not help, whether it is a database default or Better Auth's own, since a default replaces only a missing value and never an explicit `null`. The contract check reports an optional field that is not optional.
- **Ids.** With `generateId: false`, declare the id with a default, as the printed PSL does (`id String @id @onCreate(uuid())`). A `generateId` function that returns `false` for some models needs the same for those models' ids.
- **A primary key that is not named `id`.** Better Auth needs a field named `id`. When a model's primary key has another name and the model has no `id` field, the printed PSL adds `id String @id`, which would give the model two `@id` fields and does not emit, so `auth generate` does not write it. Add the line yourself, with `@unique` in place of `@id`.

## Responsibilities

- Translate Better Auth's database calls into calls on your Prisma 8 client.
- Compare your contract with the models and fields Better Auth needs, and say what to add or change, through `auth generate`, `auth check` and the check on requests.
- Add missing models and fields to a PSL contract through `auth generate`, and print the PSL to add when it cannot.

## Dependencies

- `@prisma/orm-framework`, `@prisma/orm-family-sql` and `@prisma/orm-toolchain`, as peer dependencies. Your database package already requires all three, at the same release. The adapter loads `@prisma/orm-toolchain` only while `auth generate` runs, to read `prisma.config.ts`. Reading it also needs `@prisma/cli-engine`, which your `prisma.config.ts` already imports.
- `@better-auth/core` 1.7.22 or a later 1.7 release, below 1.8, as a peer.

The package imports only published entrypoints, so it works outside the Prisma repository. [DEVELOPING.md](DEVELOPING.md) has notes for people who change it.

## Where this package lives

The package is developed in the [prisma/orm](https://github.com/prisma/orm) repository for now. The plan is to move it to its own repository when Prisma 8 reaches general availability, and not before: until then the Prisma 8 packages change in ways that the adapter has to follow in the same pull request, and its tests run against the unreleased packages in this repository. The package name, `@prisma/orm-better-auth`, stays the same after the move.
