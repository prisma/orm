# ADR 328 — A library integration uses only published entrypoints, and its models live in the application's contract

**Status:** Accepted
**Date:** 2026-11-23
**Related:** [ADR 212 — Contract spaces](ADR%20212%20-%20Contract%20spaces.md), [ADR 226 — Cross-contract foreign-key references](ADR%20226%20-%20Cross-contract%20foreign-key%20references.md), [ADR 242 — Public npm surface](ADR%20242%20-%20Public%20npm%20surface%20-%20single%20%40prisma%20scope%20with%20consolidated%20publish%20packages.md), [ADR 308 — Community packages are named `prisma-orm-<name>`](ADR%20308%20-%20Community%20packages%20are%20named%20prisma-orm-name.md)

---

## Decision

A package that connects a library from outside Prisma to Prisma 8 follows two rules.

1. **It imports only the entrypoints Prisma publishes.** Its code imports `@prisma/orm-framework` and `@prisma/orm-family-sql`, and works on the client the application passes to it. It imports no private package of this repository, and no database package.
2. **The tables the library needs are models in the application's own contract.** The package owns no models, no contract space and no migrations. It reads the application's contract, says what is missing, and leaves every change to the contract and to the database's tables to the application's ordinary Prisma workflow.

`@prisma/orm-better-auth` is the first such package. The application passes its client to `prismaAdapter`, which returns the database adapter Better Auth asks for:

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

model Post {
  id       String @id
  title    String
  authorId String
  author   User   @relation(fields: [authorId], references: [id])
}
```

`Session` and `Account` are Better Auth's other models, as the package README gives them. `Post` is the application's own.

When the library's configuration needs a model or field the contract lacks, the package prints the PSL to add and writes no file. The application adds it, runs `prisma contract emit`, and updates the database with `prisma db update` or a migration.

## Why published entrypoints only

- **The package must work outside this repository.** A library integration is not part of Prisma 8's core. It can move to its own repository, or to the library's, without a rewrite, because nothing in it depends on being built here.
- **It proves the public interface is enough.** A community author who integrates another library has only the published packages. If Prisma's own integration needed a private import, theirs could not be written. Each gap found this way is a gap in the public interface, to be fixed there or recorded as a limit, not bridged with a private import.
- **One copy of Prisma's code.** The package holds `@prisma/orm-framework` and `@prisma/orm-family-sql` as peers at the exact version of the application's database package, which always installs them. The package manager reports a mismatch, where a regular dependency would silently load a second copy of the ORM client's filter functions.

Two checks keep the rule: the lint for consumer imports (`pnpm lint:consumer-internal-imports`) treats the package as a consumer and refuses `@internal/*` names in its imports and its manifest, and a test in the package refuses any `@repo/*` name other than the shared build and TypeScript configuration.

## Why the models live in the application's contract

- **The library decides its tables from the application's configuration.** Better Auth derives its tables from its options: plugins add tables and columns, the application adds its own fields and can rename models and fields. No fixed set of models shipped by a package would match, so the models have to be written where the configuration is, in the application.
- **The application relates its own models to them.** An application's `Post` belongs to a `User`. With the auth models in the same contract, that is an ordinary relation, with types, joins and foreign keys.
- **One migration history.** The application already has a way to change its database. Auth tables change through it, in the same migrations as the application's own, reviewed the same way.
- **The integration never changes the database's tables or the project's files.** It reads and writes rows, as the library asks. For the contract it only compares and reports, and a command that writes nothing cannot leave a project half-changed.

## Responsibilities

| Who | Does what |
| --- | --- |
| The application | Declares the library's models in its contract, emits the contract, and changes the database with Prisma |
| The integration package | Translates the library's storage calls into calls on the application's client; compares the contract with what the library's configuration needs; prints the PSL to add |
| The library | Decides which models and fields it needs, and calls the integration |
| Prisma 8 | Runs the queries and checks them against the contract; plans and applies database changes |

The comparison runs wherever the library gives the integration a place for it. Better Auth gives two: its schema check, which runs before requests and for the `auth check` command, and its `auth generate` command.

## Consequences

- The package is hand-written source in `packages/9-public/@prisma/`, unlike the other published packages, which are shells over private packages. It is named `@prisma/orm-<library>` ([ADR 242](ADR%20242%20-%20Public%20npm%20surface%20-%20single%20%40prisma%20scope%20with%20consolidated%20publish%20packages.md)); a community integration is named as any community package is ([ADR 308](ADR%20308%20-%20Community%20packages%20are%20named%20prisma-orm-name.md)).
- The integration is typed loosely on the inside. No published type says "a client whose contract contains these models", so correctness comes from the contract at run time, the comparison and the tests.
- Where the public interface lacks something, the integration works around it inside its own code and the gap is recorded. `@prisma/orm-better-auth` keeps a table of the kind of JavaScript value each codec reads, which nothing published gives at run time, and the name of Postgres's default namespace, which only the target package publishes and the integration does not depend on.
- Adding the library's models is a manual step for the user: copy the printed PSL into the contract. It becomes automatic only if Prisma publishes a way to add models and fields to an existing contract source.
- The integration supports the databases it has been proven on and refuses the others. `@prisma/orm-better-auth` accepts Postgres and SQLite clients. It refuses MySQL and MariaDB because its filters would give wrong answers there: `length()` counts bytes, and the default collation ignores case.
- The rule against private imports covers Prisma's packages. An integration may still need a hook the library itself labels internal, as `@prisma/orm-better-auth` does to register its comparison with Better Auth. It then limits the library's peer range to the minor version it was tested on.
- Revisit this decision if a library needs tables that are the same in every application and that the application never changes and never queries through its own client. A contract space owned by a package ([ADR 212](ADR%20212%20-%20Contract%20spaces.md)) may then fit better, as it does for Supabase's auth tables.

## Alternatives considered

### The integration ships the library's models as its own contract space

The package would own the auth models and their migrations, as an extension pack owns its entities. Rejected for three reasons. The application's client cannot query the models of another contract space, and the integration runs every call through that client; this alone decides it. The library's tables depend on the application's configuration, so no shipped set would be right. And an application model can point into another space only with a foreign key the ORM client cannot follow ([ADR 226](ADR%20226%20-%20Cross-contract%20foreign-key%20references.md)), where an application expects an ordinary relation to its users.

### The integration writes the models into the contract file

`auth generate` would edit `contract.prisma` in place. Not done. Prisma publishes a PSL parser, formatter and printer, but nothing that adds models and fields to an existing contract source while keeping the rest of the file as written, and nothing that can edit a contract written in TypeScript. Printing what to add works for every contract source.

### The integration imports private packages of this repository

It would reach the SQL runtime and the contract types directly, and could be typed more tightly. Rejected because the package could then live only here, and because it would hide gaps in the public interface that every community integration would still meet.

### The integration sends SQL of its own, beside the ORM client

It would build statements for the library's calls and skip the ORM client. Rejected because the ORM client already checks every model and field against the contract, encodes and decodes values with the contract's codecs on both databases, and runs inside the application's transactions. A second query path would have to repeat all three.

### The integration lives in the library's repository

Better Auth's repository holds its adapters for other tools. Not chosen before Prisma 8 reaches general availability: until then the integration changes in the same pull requests as the Prisma 8 packages and is tested against unreleased versions of them. The package is built so that it can move to its own repository or to the library's after that.
