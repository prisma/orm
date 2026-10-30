---
changes:
  - id: temporal-polyfill-is-a-peer-dependency-of-mysql
    summary: |
      `temporal-polyfill` is now a required peer dependency of `@prisma/orm-mysql` and `@prisma/orm-target-mysql`. The MySQL control plane, such as the `prisma` commands, imports it, because MySQL now has the convenience date and time types, and `DateTime(as: temporal)`, `Date(as: temporal)` and `Time(as: temporal)` read `Temporal` values. npm, pnpm and bun install it automatically. A project that installs with Yarn must add `temporal-polyfill` (`^1.0.4`) to its own dependencies.
    detection:
      glob: "**/yarn.lock"
      contains:
        - "@prisma/orm-mysql@"
        - "@prisma/orm-target-mysql@"
      anyMatch: true
  - id: mysql-datetime-writes-are-checked
    summary: |
      A MySQL `DateTime` field now refuses to write a year before 1000 or after 9999 with `RUNTIME.ENCODE_FAILED`, before the value reaches MySQL, and cuts a value with more fraction digits than its column holds instead of letting MySQL round it. Reads are unchanged, and no migration is needed.
    detection:
      glob: "**/package.json"
      contains:
        - "@prisma/orm-mysql"
        - "@prisma/orm-target-mysql"
      anyMatch: true
---

# MySQL: `temporal-polyfill` is a peer dependency, and `DateTime` writes are checked

## `temporal-polyfill-is-a-peer-dependency-of-mysql`

For each Yarn project that `detection` matches, add `"temporal-polyfill": "^1.0.4"` to `dependencies` in the `package.json` that depends on `@prisma/orm-mysql` or `@prisma/orm-target-mysql`, then reinstall. Without it, `prisma contract emit` and the other commands fail because Node.js cannot find the package `temporal-polyfill`.

A project that already depends on `temporal-polyfill` with a range inside `^1.0.4` needs no change.

An existing MySQL contract needs no other change: `DateTime` with no arguments is the type `DateTime` was before, renamed `DatetimeJsDate(3)`, and emits the same contract.

## `mysql-datetime-writes-are-checked`

Nothing to change in code. Two writes behave differently on a MySQL `DateTime` field:

- A `Date` before the year 1000 or after 9999 is refused with `RUNTIME.ENCODE_FAILED`. MySQL documents only those years for `datetime`. If the application writes such dates, keep them in range or store them in a `String` field.
- A value with more fraction digits than the column holds is cut to the column's written precision. MySQL used to round it, so a `DateTime(precision: 0)` field written with `12:00:00.700` now holds `12:00:00`, not `12:00:01`.
