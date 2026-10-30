# @prisma/orm-postgres-contrib

Prisma 8 packs for the PostgreSQL contrib modules that PostgreSQL marks trusted, the ones any database owner can install.

```bash
pnpm add @prisma/orm-postgres-contrib
```

Every trusted contrib module gets its pack here, as one group of entrypoints named after the module. Third-party extensions such as pgvector and PostGIS keep a package each (`@prisma/orm-extension-<name>`), because they release on their own schedule; see [ADR 312](https://github.com/prisma/orm/blob/main/docs/architecture%20docs/adrs/ADR%20312%20-%20Postgres%20extension%20packs%20are%20published%20by%20tier.md).

## Modules

| Module | Entrypoints | What it adds |
| --- | --- | --- |
| `citext` | `/citext/control`, `/citext/runtime`, `/citext/pack`, `/citext/column-types`, `/citext/codec-types` | Text that PostgreSQL compares, orders and matches without regard to case: the `citext.Citext` PSL type, the `citext()` column type, and the `pg/citext@1` codec (a `string`) |

## Using citext

Add the pack to `extensions` in `prisma.config.ts`:

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

Then declare a column with it:

```prisma
model User {
  id    Int           @id
  email citext.Citext @unique
}
```

The pack's contract declares the `citext` extension, so `db sign` adopts a database that already has it, and `db init`, `db update` and `db migrate` create it before the first table that uses it. At runtime, pass `@prisma/orm-postgres-contrib/citext/runtime` in the client's `extensions`.
