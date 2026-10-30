# @internal/extension-citext

PostgreSQL `citext` extension pack for Prisma 8. Published as the `/citext` entrypoints of `@prisma/orm-postgres-contrib`.

## Overview

`citext` is a contrib module that ships with PostgreSQL. It adds a text type that compares, orders and matches without regard to case, so `WHERE email = 'A@x.com'` finds `a@x.com`. The value keeps the case it was written in.

## Responsibilities

- **Data type**: `citext/citext`, written and reported as `citext`. Its stored form is the text; it casts from `pg/text` unchanged.
- **Codec**: `pg/citext@1`, a `string` at runtime, with the traits of a text codec (equality, order, text matching). It refuses enums: a `CHECK` on a citext column admits a member in another case.
- **PSL**: the type constructor `citext.Citext`, which `contract infer` prints for a `citext` column.
- **TypeScript**: the `citext()` column type from `/column-types`.
- **Extension**: the pack's contract declares `extension citext {}` in `public`. `db sign` checks that a database already has it, so a database Prisma 7 built is adopted without running a migration, and `db verify` fails when it is missing. The contract space's one migration, planned from the empty contract, creates it, so `db init`, `db update` and `db migrate` install the module before any table that uses it. The pack records no invariant.

## Configuration

```typescript
import { definePrismaConfig } from 'prisma/config';
import citext from '@prisma/orm-postgres-contrib/citext/control';
import { defineConfig as ormConfig } from '@prisma/orm-postgres/config';

export default definePrismaConfig({
  orm: ormConfig({
    contract: './src/prisma/contract.prisma',
    extensions: [citext],
  }),
});
```

```prisma
model User {
  id    Int           @id
  email citext.Citext @unique
}
```

At runtime, pass `@prisma/orm-postgres-contrib/citext/runtime` in `extensions`.

## Authoring (maintainers)

After changing the contract source, run `pnpm migrations:regen` from the repo root. See [ADR 212 — Contract spaces](../../../docs/architecture%20docs/adrs/ADR%20212%20-%20Contract%20spaces.md) for the layout.
