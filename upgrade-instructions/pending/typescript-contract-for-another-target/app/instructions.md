---
changes:
  - id: typescript-contract-for-another-target-refused
    summary: |
      The `defineConfig` of every SQL target now refuses, at `prisma contract emit`, a TypeScript contract built with another target's `defineContract`, such as a contract that imports `defineContract` from `@prisma/orm-sqlite/contract-builder` in a project whose config comes from `@prisma/orm-postgres/config`. Such a contract used to emit and then fail when the client loaded it. The error is `CONTRACT.TARGET_MISMATCH`, reported as `CONTRACT_SOURCE_INVALID`, and names the module to import `defineContract` from. The detection matches TypeScript files that import `defineContract` from a SQL target package.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '@prisma/orm-(?:postgres|sqlite|mysql|mariadb)/contract-builder'
---

# A TypeScript contract must be built for the config's target

For each file the detection matches that is a contract a `prisma.config.ts` names in `contract`, compare the package it imports `defineContract` from with the package the config imports `defineConfig` from. If they name different databases, change the contract's import to the `contract-builder` entry of the config's package, then run `prisma contract emit`. If the two already match, nothing changes.

```ts
// prisma.config.ts imports defineConfig from '@prisma/orm-postgres/config'

// Before
import { defineContract } from '@prisma/orm-sqlite/contract-builder';

// After
import { defineContract } from '@prisma/orm-postgres/contract-builder';
```
