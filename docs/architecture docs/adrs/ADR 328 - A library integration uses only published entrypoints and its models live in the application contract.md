# ADR 328 — A library integration uses only published entrypoints, and its models live in the application's contract

**Status:** Accepted
**Date:** 2026-11-23
**Related:** [ADR 242 — Public npm surface](ADR%20242%20-%20Public%20npm%20surface%20-%20single%20%40prisma%20scope%20with%20consolidated%20publish%20packages.md), [ADR 308 — Community packages are named `prisma-orm-<name>`](ADR%20308%20-%20Community%20packages%20are%20named%20prisma-orm-name.md)

---

## Decision

A package that connects a library from outside Prisma to Prisma 8 follows two rules.

1. **It imports only the entrypoints Prisma publishes.** It is written as an application would be: against `@prisma/orm-framework`, `@prisma/orm-family-sql` and the client the application already has. It imports no private package of this repository.
2. **The tables the library needs are models in the application's own contract.** The package owns no models, no contract space and no migrations. It reads the application's contract, says what is missing, and leaves every change to the contract and the database to the application's ordinary Prisma workflow.

`@prisma/orm-better-auth` is the first such package. The application passes its client to the adapter:

```ts
import { betterAuth } from 'better-auth';
import { prismaAdapter } from '@prisma/orm-better-auth';
import { db } from './db';

export const auth = betterAuth({
  database: prismaAdapter(db),
  emailAndPassword: { enabled: true },
});
```

Better Auth's models sit in the application's contract beside its own, and the application may relate its models to them:

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
```

When the library's configuration needs a model or field the contract lacks, the package prints the PSL to add and writes no file. The application adds it, runs `prisma contract emit`, and updates the database with `prisma db update` or a migration.

## Why published entrypoints only

- **The package must work outside this repository.** A library integration is not part of Prisma 8's core. It can move to its own repository, or to the library's, without a rewrite, because nothing in it depends on being built here.
- **It proves the public interface is enough.** A community author who integrates another library has only the published packages. If Prisma's own integration needed a private import, theirs could not be written. Each gap found this way is a gap in the public interface, to be fixed there or recorded as a limit, not bridged with a private import.
- **One copy of Prisma's code.** The package holds `@prisma/orm-framework` and `@prisma/orm-family-sql` as peers at the exact version of the application's database package, which always installs them. The package manager reports a mismatch, where a regular dependency would silently load a second copy of the ORM client's filter functions.

Two checks keep the rule: the lint for consumer imports (`pnpm lint:consumer-internal-imports`) treats the package as a consumer and reads its imports and its manifest, and a test in the package refuses any repository-only package name other than the shared build and TypeScript configuration.

## Why the models live in the application's contract

- **The library decides its tables from the application's configuration.** Better Auth derives its tables from its options: plugins add tables and columns, the application adds its own fields and can rename models and fields. No fixed set of models shipped by a package would match, so the models have to be written where the configuration is, in the application.
- **The application relates its own models to them.** An application's `Post` belongs to a `User`. With the auth models in the same contract, that is an ordinary relation, with types, joins and foreign keys.
- **One migration history.** The application already has a way to change its database. Auth tables change through it, in the same migrations as the application's own, reviewed the same way.
- **The integration never changes the database or the project.** It compares and reports. A command that writes nothing cannot leave a project half-changed.

## Responsibilities

| Who | Does what |
| --- | --- |
| The application | Declares the library's models in its contract, emits the contract, and changes the database with Prisma |
| The integration package | Translates the library's storage calls into calls on the application's client; compares the contract with what the library's configuration needs; prints the PSL to add |
| The library | Decides which models and fields it needs, and calls the integration |
| Prisma 8 | Runs the queries and checks them against the contract; plans and applies database changes |

The comparison runs wherever the library gives the integration a place for it. For Better Auth that is its schema check, which runs before requests and for `auth check`, and `auth generate`.

## Consequences

- The package is hand-written source in `packages/9-public/@prisma/`, unlike the other published packages, which are shells over private packages. It is named `@prisma/orm-<library>` ([ADR 242](ADR%20242%20-%20Public%20npm%20surface%20-%20single%20%40prisma%20scope%20with%20consolidated%20publish%20packages.md)); a community integration is named as any community package is ([ADR 308](ADR%20308%20-%20Community%20packages%20are%20named%20prisma-orm-name.md)).
- The integration is typed loosely on the inside. No published type says "a client whose contract contains these models", so correctness comes from the contract at run time, the comparison and the tests.
- Where the public interface lacks something, the integration works around it inside its own code and the gap is recorded. `@prisma/orm-better-auth` keeps a small table of each database's default namespace and of the JavaScript type of each data type, because neither is published.
- Adding the library's models is a manual step for the user: copy the printed PSL into the contract. It becomes automatic only if Prisma publishes a way to read and write a contract source.
- The integration supports the databases it has been proven on and refuses the others. `@prisma/orm-better-auth` accepts Postgres and SQLite clients.
- Revisit this decision if a library needs tables that are the same in every application and that the application never relates to or changes. A contract space owned by a package may then fit better.

## Alternatives considered

### The integration ships the library's models as its own contract space

The package would own the auth models and their migrations, as an extension pack owns its entities. Rejected because the library's tables depend on the application's configuration, so no shipped set would be right; because the application relates its own models to them; and because it would give the auth tables a migration history apart from the application's.

### The integration writes the models into the contract file

`auth generate` would edit `contract.prisma` in place. Not done, because no published API reads and writes a contract source, and writing PSL by string editing would break on contracts the package cannot parse, and could not serve a contract written in TypeScript. Printing what to add works for every contract source.

### The integration imports private packages of this repository

It would reach the SQL runtime and the contract types directly, and could be typed more tightly. Rejected because the package could then live only here, and because it would hide gaps in the public interface that every community integration would still meet.

### The integration sends SQL of its own, beside the ORM client

It would build statements for the library's calls and skip the ORM client. Rejected because the ORM client already checks every model and field against the contract, applies the contract's data types on both databases, and runs inside the application's transactions. A second query path would have to repeat all three.

### The integration lives in the library's repository

Better Auth's repository holds its adapters for other tools. Not chosen for now: Prisma 8 is still changing, and the integration has to change with it and be tested against unreleased packages. The package is built so that it can move there later.
