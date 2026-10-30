---
changes:
  - id: temporal-polyfill-is-a-peer-dependency-of-sqlite
    summary: |
      `temporal-polyfill` is now a required peer dependency of `@prisma/orm-sqlite` and `@prisma/orm-target-sqlite`. The SQLite control plane, such as the `prisma` commands and the Vite plugin, imports it, because SQLite now has the convenience date and time types, and `DateTime(as: temporal)`, `Date(as: temporal)` and `Time(as: temporal)` read `Temporal` values. npm, pnpm and bun install it automatically. A project that installs with Yarn must add `temporal-polyfill` (`^1.0.4`) to its own dependencies.
    detection:
      glob: "**/yarn.lock"
      contains:
        - "@prisma/orm-sqlite@"
        - "@prisma/orm-target-sqlite@"
      anyMatch: true
---

# `temporal-polyfill` is a peer dependency of the SQLite packages

## `temporal-polyfill-is-a-peer-dependency-of-sqlite`

For each Yarn project that `detection` matches, add `"temporal-polyfill": "^1.0.4"` to `dependencies` in the `package.json` that depends on `@prisma/orm-sqlite` or `@prisma/orm-target-sqlite`, then reinstall. Without it, `prisma contract emit` and the other commands fail because Node.js cannot find the package `temporal-polyfill`.

A project that already depends on `temporal-polyfill` with a range inside `^1.0.4` needs no change.

An existing SQLite contract needs no other change: `DateTime` with no arguments is the type `DateTime` was before, renamed `DatetimeJsDate`, and emits the same contract.

One case reads differently. `db verify` used to read a database default of `date('now')` or `CURRENT_DATE` as `now()`, so it matched a field written `@default(now())` of any type. It now reads it as the current date, which only a `Date @default(now())` field writes, and a `now()` on a `DateTime` or `String` field means the current instant. If `db verify` now reports such a column, write the field as `Date @default(now())` when it holds a calendar date, or as ``@default(sql`date('now')`)`` to keep its type. Do not run `db update` first: it would change the column's default to the current instant, and new rows would get the instant instead of the date.
