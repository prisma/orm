# ADR 328 — A library integration uses only published entrypoints, and its models live in the application's contract

**Status:** Accepted
**Date:** 2026-11-23
**Related:** [ADR 212 — Contract spaces](ADR%20212%20-%20Contract%20spaces.md), [ADR 226 — Cross-contract foreign-key references](ADR%20226%20-%20Cross-contract%20foreign-key%20references.md), [ADR 242 — Public npm surface](ADR%20242%20-%20Public%20npm%20surface%20-%20single%20%40prisma%20scope%20with%20consolidated%20publish%20packages.md), [ADR 308 — Community packages are named `prisma-orm-<name>`](ADR%20308%20-%20Community%20packages%20are%20named%20prisma-orm-name.md)


## At a glance

Better Auth is an authentication library. It keeps its users and sessions in the application's database, and it reaches that database through one object the application hands it, which Better Auth calls a database adapter. `@prisma/orm-better-auth` builds that object from the application's Prisma 8 client:

```ts
import { betterAuth } from 'better-auth';
import { prismaAdapter } from '@prisma/orm-better-auth';
import { db } from './db';

export const auth = betterAuth({
  database: prismaAdapter(db),
  emailAndPassword: { enabled: true },
});
```

Better Auth needs tables: `user`, `session`, `account` and `verification`. The application declares them as models in its own contract, next to its own models. Here `User` is Better Auth's and `Post` is the application's:

```prisma
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
  posts         Post[]

  @@map("user")
}

model Post {
  id       String @id
  title    String
  authorId String
  author   User   @relation(fields: [authorId], references: [id])
}
```

`Session` and `Account` are the other Better Auth models, written the same way; the package README lists them.

At run time the pieces connect like this. Everything inside the box belongs to the application's process:

```mermaid
flowchart LR
  subgraph App[Application]
    direction TB
    Lib[Better Auth]
    Pkg[Integration package]
    Client[Prisma 8 client]
    Contract[Application contract]
  end
  Db[(Database)]
  Lib -->|storage calls| Pkg
  Pkg -->|ORM client calls| Client
  Pkg -.->|reads| Contract
  Contract -.->|defines| Client
  Client -->|SQL| Db
```

The integration package sits between the library and the client. It owns nothing in the database and nothing in the contract. It reads the contract only to check that the models the library needs are there.

When they are not, it says so and changes nothing. After the application turns on Better Auth's two-factor plugin, Better Auth's `auth generate` command prints:

```text
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

The application's developer copies that into the contract and changes the database the way they change it for their own models.

## Decision

A **library integration** is a package that connects a library from outside Prisma, such as Better Auth, to an application's Prisma 8 client. Every library integration follows two rules.

1. **It imports only what Prisma publishes.** Its code builds on the published packages `@prisma/orm-framework` and `@prisma/orm-family-sql`, and on the client the application passes in. It imports none of this repository's private packages.
2. **The tables the library needs are models in the application's contract.** The integration ships no models and no migrations of its own. It checks the application's contract against what the library needs, reports what is missing, and leaves every change to the contract and to the database's tables to the application.

The next two sections take the rules one at a time: what each means, why it holds, and what it costs.

## Rule 1: only what Prisma publishes

### What it means

Prisma 8 is built from many private packages in this repository, named `@internal/*`. Applications never see them. What an application can install is a small set of published packages, named `@prisma/orm-*` ([ADR 242](ADR%20242%20-%20Public%20npm%20surface%20-%20single%20%40prisma%20scope%20with%20consolidated%20publish%20packages.md)).

A library integration is written against that published set only, the same set an author outside Prisma would have. It also names no database package, such as `@prisma/orm-postgres`: it receives a client and works with whichever database that client is for.

### Why

**Anyone must be able to write one.** A community author who integrates another library has only the published packages. If Prisma's own integration needed a private import, theirs could not be written. Building ours under the same limit proves the published packages are enough, and every gap we meet is a gap they would meet.

**The package is not tied to this repository.** A library integration is not part of Prisma 8's core. Because nothing in it depends on being built here, its source can live in this repository, in one of its own, or in the library's, and move between them without a rewrite. This record does not decide where any one integration lives.

### How the integration depends on Prisma's packages

The integration declares `@prisma/orm-framework` and `@prisma/orm-family-sql` as peer dependencies, at the exact version of the application's database package. The database package always installs both, so the application ends up with one copy of each, shared by its client and the integration.

One copy matters, because the integration builds query filters with functions from `@prisma/orm-family-sql` and hands them to the client. As a peer, a version mismatch is reported by the package manager at install time. As a regular dependency, a second copy of those functions would be installed silently beside the client's.

### How the rule is kept

Two checks fail when the rule is broken. The lint `pnpm lint:consumer-internal-imports` treats the integration like an application and refuses any `@internal/*` name in its imports or its manifest. A test inside the package refuses any `@repo/*` name, the repository's other private prefix, apart from the shared build and TypeScript configuration.

### What it costs

- **Looser types inside the package.** No published type says "a client whose contract contains these models". The integration treats the client loosely on the inside, and its correctness rests on the contract check described under rule 2 and on its tests.
- **Gaps are worked around, and written down.** Where the published packages lack something, the integration carries its own small substitute and the gap is recorded so it can be closed in the published packages. For example, `@prisma/orm-better-auth` keeps its own table of the kind of JavaScript value each codec reads, because nothing published gives that at run time.
- **The rule covers Prisma's packages, not the library's.** An integration may need a hook that the library itself labels internal; `@prisma/orm-better-auth` uses one to register its contract check with Better Auth. The integration then accepts only the library versions it has been tested against.

## Rule 2: the library's tables are models in the application's contract

### What it means

A contract describes an application's models and the tables behind them. The client is built from it, and Prisma plans every change to the database from it. An application has one contract of its own.

Prisma 8 also lets a package own tables. Such a package ships a **contract space**: a contract and a migration history of its own, applied beside the application's ([ADR 212](ADR%20212%20-%20Contract%20spaces.md)). A library integration does not do this. The library's tables are ordinary models in the application's contract, as `User` is in the example above.

### Why

**The integration works through the application's client, and that client reaches only the application's contract.** The client cannot query models that live in another contract space. An integration that runs every one of the library's storage calls through the client therefore needs the library's models in the contract the client was built from.

**The library decides its tables from the application's configuration.** Better Auth works out its tables from its options. Each plugin adds tables and columns, the application can add fields of its own, and it can rename models and fields. No fixed set of models shipped inside a package would match what one application has configured. The models have to be written where the configuration is: in the application.

**The application relates its own models to the library's.** A `Post` belongs to a `User`. With both in one contract this is an ordinary relation that the client can follow in a query. A model in another contract space can be pointed at only with a foreign key that the client cannot follow ([ADR 226](ADR%20226%20-%20Cross-contract%20foreign-key%20references.md)).

**One migration history.** The application already has a way to change its database. The library's tables change through it, in the same migrations as the application's own tables, reviewed in the same way.

### What the integration does instead of owning the models

It compares and reports. The integration takes the list of models and fields the library needs under the application's configuration and checks each against the contract. It reports a missing model or field, a field of the wrong type, and a field whose optionality the library cannot work with. For what is missing it prints the PSL to add, as in the example at the top.

It never writes. The integration edits no file and changes no table; it only reads and writes rows, as the library asks. A check that writes nothing cannot leave a project half-changed, and it works the same for a contract written in PSL and one written in TypeScript.

The check runs wherever the library gives the integration a place for it. Better Auth gives two: a check it runs before serving requests and from its `auth check` command, and its `auth generate` command.

### What it costs

Adding the library's models is a manual step: the developer copies the printed PSL into the contract, emits the contract with `prisma contract emit`, and updates the database with `prisma db update` or a migration. The step could be automated only if Prisma published a way to add models and fields to an existing contract source.

## Who does what

| Who | Does what |
| --- | --- |
| The library | Decides which models and fields it needs, and makes its storage calls through the integration |
| The integration package | Translates those calls into calls on the application's client; checks the contract against what the library needs; prints the PSL to add |
| The application | Declares the library's models in its contract, emits the contract, and changes the database with Prisma |
| Prisma 8 | Runs the queries and checks them against the contract; plans and applies changes to the database |

## Consequences

- A library integration published by Prisma is hand-written source in `packages/9-public/@prisma/`, where the other published packages are thin shells over private packages. It is named `@prisma/orm-<library>` ([ADR 242](ADR%20242%20-%20Public%20npm%20surface%20-%20single%20%40prisma%20scope%20with%20consolidated%20publish%20packages.md)). One published by someone else is named as any community package is ([ADR 308](ADR%20308%20-%20Community%20packages%20are%20named%20prisma-orm-name.md)).
- An integration accepts the databases it has been proven correct on and refuses a client for any other, with an error that names the database. `@prisma/orm-better-auth` accepts Postgres and SQLite.
- Revisit this decision for a library whose tables are the same in every application, and which the application never changes and never queries through its own client. A contract space owned by a package may fit that case better, as it does for Supabase's auth tables.

## Alternatives considered

### The integration ships the library's models as its own contract space

The package would own the library's models and their migrations, as an extension pack owns the tables it adds. Rejected for the reasons under rule 2. The first decides it alone: the integration runs every call through the application's client, and that client cannot query another contract space.

### The integration writes the models into the contract file

The library's generate command would edit the application's contract source in place. Rejected because Prisma publishes a PSL parser, formatter and printer, but nothing that adds models and fields to an existing contract source while keeping the rest of the file as the developer wrote it, and nothing that can edit a contract written in TypeScript. Printing what to add works for every contract source.

### The integration imports this repository's private packages

It could then reach the SQL runtime and the contract's internal types, and be typed more tightly. Rejected because the package could be built only in this repository, and because it would hide gaps in the published packages that every community integration would still meet.

### The integration sends SQL of its own, beside the ORM client

It would build SQL statements for the library's calls and not use the ORM client. Rejected because the ORM client already checks every model and field against the contract, converts values with the contract's codecs on each database, and runs inside the application's transactions. A second query path would have to repeat all three.
