---
changes:
  - id: typescript-contract-for-another-target-refused
    summary: |
      The `defineConfig` of every SQL target now refuses, at `prisma contract emit`, a TypeScript contract built with another target's `defineContract`, such as a contract that imports `defineContract` from `@prisma/orm-sqlite/contract-builder` in a project whose config comes from `@prisma/orm-postgres/config`. Such a contract used to emit and then fail when the client loaded it. The CLI reports it as `CONTRACT.TARGET_MISMATCH`, with `expected`, `actual` and `contract` in its `meta`, and its fix names the module to import `defineContract` from. The detection matches TypeScript files that import `defineContract` from a SQL target package.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '@prisma/orm-(?:postgres|sqlite|mysql|mariadb)/contract-builder'
  - id: typescript-contract-from-path-requires-target
    summary: |
      `typescriptContractFromPath` from `@prisma/orm-family-sql/contract-ts/config-types` now takes three arguments: the contract path, the output path (or `undefined`), and an options object that must hold the configured target's pack ref as `target` and that target's `contract-builder` module as `contractBuilderModule`. Calls with one or two arguments, or with only `defaultControlPolicy` and `createNamespace`, no longer compile, and in JavaScript they throw. The detection matches files that import it from the SQL family and call it; the MongoDB family's function of the same name is unchanged.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '(?<![\s\S])(?=[\s\S]*@(?:prisma/orm-family-sql|internal/sql-contract-ts)/(?:contract-ts/)?config-types)[\s\S]*typescriptContractFromPath\('
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

# `typescriptContractFromPath` requires the configured target

In every file the detection matches, give each call of `typescriptContractFromPath` from `@prisma/orm-family-sql/contract-ts/config-types` all three arguments. Pass the output path second, or `undefined` to keep the default beside the contract. Pass as the third an object with `target`, the pack ref of the target the config is for, and `contractBuilderModule`, that target's `contract-builder` entry, such as `@prisma/orm-postgres/contract-builder`. Keep any `defaultControlPolicy` and `createNamespace` the call already passed beside them. The option types are exported from the same entry as `TypeScriptContractFromPathOptions` and `TypeScriptContractTarget`, though an object literal is enough. The loader then refuses a contract built for another target with `CONTRACT.TARGET_MISMATCH`.

```ts
// Before
typescriptContractFromPath('prisma/contract.ts', 'prisma/contract.json', {
  defaultControlPolicy: 'external',
  createNamespace: postgresCreateNamespace,
});

// After
typescriptContractFromPath('prisma/contract.ts', 'prisma/contract.json', {
  target: postgresPackRef,
  contractBuilderModule: '@prisma/orm-postgres/contract-builder',
  defaultControlPolicy: 'external',
  createNamespace: postgresCreateNamespace,
});
```

An application can instead pass the contract's path to its target's `defineConfig`, such as `defineConfig({ contract: './prisma/contract.ts' })` from `@prisma/orm-postgres/config`, which calls `typescriptContractFromPath` with these options itself.
