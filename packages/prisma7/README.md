# `@prisma/prisma7`

Compatibility package for running the Prisma 7 CLI alongside a newer `prisma` package in the same project.

The package installs the `prisma7` executable and delegates to the exact matching Prisma 7 CLI version. For example:

```bash
pnpm add -D prisma@8 @prisma/prisma7@7
pnpm add @prisma/client@7

pnpm prisma --version
pnpm prisma7 --version
```

Use `prisma7` anywhere you would normally invoke the Prisma 7 CLI:

```bash
pnpm prisma7 generate
pnpm prisma7 migrate dev
pnpm prisma7 studio
```

## Prisma Config

Import Prisma Config helpers from the scoped compatibility package:

```ts
import { defineConfig, env } from '@prisma/prisma7/config'

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: env('DATABASE_URL'),
  },
})
```

The package is a compatibility wrapper, not a separate Prisma implementation. Its version is kept in lockstep with its exact `prisma` dependency.
