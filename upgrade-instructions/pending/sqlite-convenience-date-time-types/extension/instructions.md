---
changes:
  - id: temporal-polyfill-is-a-peer-dependency-of-sqlite
    summary: |
      `temporal-polyfill` is now a required peer dependency of `@prisma/orm-target-sqlite` and `@prisma/orm-sqlite`. The target's control entry imports it. An extension pack that peers the target does not declare it; the application supplies it. npm, pnpm and bun install it automatically. An extension package that installs with Yarn and loads the target's control entry in its tests or tooling must add `temporal-polyfill` (`^1.0.4`) to its `devDependencies`.
    detection:
      glob: "**/yarn.lock"
      contains:
        - "@prisma/orm-sqlite@"
        - "@prisma/orm-target-sqlite@"
      anyMatch: true
  - id: sqlite-create-namespace-moved-to-target-types
    summary: |
      `sqliteCreateNamespace` and `SqliteUnboundDatabase` moved from the SQLite target's `/target/control` entry to its `/target/types` entry, as PostgreSQL's `postgresCreateNamespace` is in its `/target/types`. The control entry loads `temporal-polyfill`, so code that is not control-plane code no longer has to load it to name a namespace. An import of either from `/target/control` fails to compile.
    detection:
      glob: "**/*.ts"
      contains:
        - "sqliteCreateNamespace"
        - "SqliteUnboundDatabase"
      anyMatch: true
---

# SQLite: `temporal-polyfill` is a peer dependency, and `sqliteCreateNamespace` moved

## `temporal-polyfill-is-a-peer-dependency-of-sqlite`

For each Yarn project that `detection` matches, add `"temporal-polyfill": "^1.0.4"` to `devDependencies` in the `package.json` that installs `@prisma/orm-target-sqlite` or `@prisma/orm-sqlite`, then reinstall. Without it, a test or script that loads the target's control entry fails because Node.js cannot find the package `temporal-polyfill`.

## `sqlite-create-namespace-moved-to-target-types`

In each file that `detection` matches, change the module of an import of `sqliteCreateNamespace` or `SqliteUnboundDatabase` from the target's control entry to its types entry, keeping the rest of the import:

| Before | After |
| --- | --- |
| `@prisma/orm-target-sqlite/target/control` | `@prisma/orm-target-sqlite/target/types` |
| `@prisma/orm-sqlite/target/control` | `@prisma/orm-sqlite/target/types` |

If the import also names other symbols from the control entry, split it into two imports. Nothing else changes: the function and the type are the same.
