---
changes:
  - id: target-package-exports-an-init-contribution
    summary: |
      `prisma orm init` takes everything about a target from the target package: a package that wants `init` to set up a project on it exports an init contribution, typed `InitContribution` from `@prisma/orm-toolchain/cli/init-contribution`, as the default export of its `init` entrypoint. `@prisma/orm-postgres` and `@prisma/orm-mongo` export one. A package without it is not affected; `init` cannot set up a project on it, and the application writes `prisma.config.ts` by hand.
---

# A target package can export an init contribution

`prisma orm init` installs the target package first, then loads the default export of its `init` entrypoint and writes the project from it. The CLI holds no template for any target.

## `target-package-exports-an-init-contribution`

This applies to a package that adds a target and wants `prisma orm init` to set up projects on it. Nothing changes for a package that does not.

In this release `--target` takes only the short names of the packages Prisma lists, so `init` cannot reach a package outside that list yet; accepting a package name comes in a later release. Exporting the entrypoint now prepares your package for it.

Export an `init` entrypoint whose default export satisfies `InitContribution`:

```ts
// src/init.ts, exported as <your package>/init
import type { InitContribution } from '@prisma/orm-toolchain/cli/init-contribution';

export default {
  label: 'AcmeDB',
  configModule: 'prisma-orm-acmedb/config',
  peerPackages: ['acmedb-driver'],
  authoringModes: ['psl', 'typescript'],
  starterContract: (mode) => (mode === 'psl' ? starterPsl : starterTs),
  contractSample: (mode) => (mode === 'psl' ? samplePsl : sampleTs),
  databaseFile: () => dbFile,
  envExample: () => 'DATABASE_URL="acmedb://localhost:5000/mydb"\n',
  quickReference: (input) => renderQuickReference(input),
} satisfies InitContribution;
```

- `db.ts` and `.env.example` read the connection string from `DATABASE_URL`, and `dotenv` is installed with your package, so `db.ts` may import `dotenv/config`. `--probe-db` reads `DATABASE_URL` from the shell's environment, not from `.env`.
- `peerPackages` names the drivers your package requires as peers. `init` reads it only after your package is installed, so it cannot help a package manager that refuses to install your package without its peers. For a package Prisma lists, the list names the drivers so they go into that first install; a probe must settle within the 60 seconds `init` gives it.
- `readme`, `serverRequirement`, `probe` and `prisma7QuickReference` are optional. Give `prisma7QuickReference` when your `configModule` exports `prisma7Schema`.
- The entrypoint may import types from the framework, and no framework code that runs. The CLI that loads it can be a different installed copy of the framework from the one your package depends on.
