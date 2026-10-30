---
changes:
  - id: temporal-polyfill-is-a-peer-dependency-of-mysql
    summary: |
      `temporal-polyfill` is now a required peer dependency of `@prisma/orm-target-mysql` and `@prisma/orm-mysql`. The target's control entry imports it. An extension pack that peers the target does not declare it; the application supplies it. npm, pnpm and bun install it automatically. An extension package that installs with Yarn and loads the target's control entry in its tests or tooling must add `temporal-polyfill` (`^1.0.4`) to its `devDependencies`.
    detection:
      glob: "**/yarn.lock"
      contains:
        - "@prisma/orm-mysql@"
        - "@prisma/orm-target-mysql@"
      anyMatch: true
  - id: mysql-create-namespace-moved-to-target-types
    summary: |
      `mysqlCreateNamespace` and `MysqlDatabase` moved from the MySQL target's `/target/control` entry to its `/target/types` entry, as PostgreSQL's and SQLite's are in theirs. The control entry loads `temporal-polyfill`, so code that is not control-plane code no longer has to load it to name a namespace. An import of either from `/target/control` fails to compile.
    detection:
      glob: "**/*.ts"
      contains:
        - "mysqlCreateNamespace"
        - "MysqlDatabase"
      anyMatch: true
---

# MySQL: `temporal-polyfill` is a peer dependency, and `mysqlCreateNamespace` moved

## `temporal-polyfill-is-a-peer-dependency-of-mysql`

For each Yarn project that `detection` matches, add `"temporal-polyfill": "^1.0.4"` to `devDependencies` in the `package.json` that installs `@prisma/orm-target-mysql` or `@prisma/orm-mysql`, then reinstall. Without it, a test or script that loads the target's control entry fails because Node.js cannot find the package `temporal-polyfill`.

## `mysql-create-namespace-moved-to-target-types`

In each file that `detection` matches, change the module of an import of `mysqlCreateNamespace` or `MysqlDatabase` from the target's control entry to its types entry, keeping the rest of the import:

| Before | After |
| --- | --- |
| `@prisma/orm-target-mysql/target/control` | `@prisma/orm-target-mysql/target/types` |
| `@prisma/orm-mysql/target/control` | `@prisma/orm-mysql/target/types` |

If the import also names other symbols from the control entry, split it into two imports. Nothing else changes: the function and the class are the same.
