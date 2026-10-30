---
changes:
  - id: mongo-date-is-a-calendar-date
    summary: |
      On MongoDB, `Date` is now a calendar date, stored as a BSON date at midnight UTC and read as a string such as `"2024-02-29"`. `DateTime` with no arguments is what `Date` was: an instant read as a JavaScript `Date` (`mongo/date@1`). Rewrite `Date` to `DateTime` in MongoDB schemas and `type.Date()` to `type.DateTime()` in MongoDB TypeScript contracts with `scripts/rewrite-mongo-date-types.ts`. The contract does not change.
    detection:
      glob: "**/*.{prisma,ts,mts,cts,tsx,js,mjs,cjs,jsx}"
      matches:
        - '(?<![\s\S])(?![\s\S]*(?<![\w$])datasource[ \t]+\w+[ \t]*\{)(?=[\s\S]*(?<![\w$])ObjectId(?![\w$]))[\s\S]*\n[ \t]+[A-Za-z_]\w*[ \t]+(?:=[ \t]*)?Date(?![\w$])'
        - '(?<![\s\S])(?=[\s\S]*@(?:prisma/orm-(?:mongo|family-mongo/contract-ts)|internal/mongo)/contract-builder[\x27"])[\s\S]*(?<![\w$])[A-Za-z_$][\w$]*\s*\.\s*Date\s*\('
    script: scripts/rewrite-mongo-date-types.ts
  - id: temporal-polyfill-is-a-peer-dependency-of-mongo
    summary: |
      `temporal-polyfill` is now a required peer dependency of `@prisma/orm-mongo` and `@prisma/orm-target-mongo`. The MongoDB control plane imports it, because `DateTime(as: temporal)`, `Date(as: temporal)` and `Time(as: temporal)` read `Temporal` values. npm, pnpm and bun install it automatically. An extension package that installs with Yarn and loads the target's control entry in its tests or tooling must add `temporal-polyfill` (`^1.0.4`) to its `devDependencies`.
    detection:
      glob: "**/yarn.lock"
      contains:
        - "@prisma/orm-mongo@"
        - "@prisma/orm-target-mongo@"
      anyMatch: true
---

# MongoDB: `Date` is a calendar date, and `temporal-polyfill` is a peer dependency

## `mongo-date-is-a-calendar-date`

Commit your work first. From the project root, run:

```sh
node scripts/rewrite-mongo-date-types.ts
```

Pass files or directories to limit it.

## `temporal-polyfill-is-a-peer-dependency-of-mongo`

For each Yarn project that `detection` matches, add `"temporal-polyfill": "^1.0.4"` to `devDependencies` in the `package.json` that depends on `@prisma/orm-mongo` or `@prisma/orm-target-mongo`, then reinstall.
