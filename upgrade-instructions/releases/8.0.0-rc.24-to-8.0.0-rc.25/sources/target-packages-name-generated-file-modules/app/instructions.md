---
changes:
  - id: contract-types-import-from-the-target-package
    summary: |
      A generated `contract.d.ts` imports all its framework, family and target types from one module of the target package, such as `@prisma/orm-postgres/contract-types`, and `contract.json` no longer records where an extension's types are imported from. Run `prisma contract emit` to regenerate both files.
    detection:
      glob: "**/contract.d.ts"
      matches:
        - '@prisma/orm-[a-z-]+/(contract/types|family-contract|target/(codec|operation)-types|adapter/codec-types)'
  - id: hand-assembled-config-names-generated-file-modules
    summary: |
      A config built with the framework's own `defineConfig`, and not a target package's, must name the module generated contract types import from (`contract.typesModule`) and the module migration files import from (`migrations.module`). Without `contract.typesModule`, every command that writes contract types fails with `CONFIG.CONTRACT_TYPES_MODULE_MISSING`: `prisma contract emit`, `prisma migration plan` and `prisma migration new` always, and `prisma db migrate`, `prisma db init`, `prisma db update` and `prisma db sign` when they advance a ref. Without `migrations.module`, `prisma migration plan` and `prisma migration new` fail with `CONFIG.MIGRATION_MODULE_MISSING`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '@prisma/orm-framework/config/config-types'
        - '@prisma/orm-toolchain/cli/config-types'
  - id: control-api-takes-types-module
    summary: |
      The control client's `emit` requires `contractConfig.typesModule`, and `renderContractDts` requires `typesModule`: the module the generated contract types import from. The `projectDir` option of the control API's contract emit, `migration new` and `migration plan` operations is removed.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - 'contractConfig\s*:'
        - '(?<![\w$])renderContractDts\s*\('
        - '@prisma/orm-toolchain/cli/control-api'
  - id: toolchain-publish-surface-entrypoints-removed
    summary: |
      `@prisma/orm-toolchain/publish-surface`, `@prisma/orm-toolchain/publish-surface/import-roots` and `@prisma/orm-toolchain/publish-surface/shells` are removed. Nothing replaces them.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs}"
      matches:
        - '@prisma/orm-toolchain/publish-surface'
---

# Generated files import from the module the facade names

The target package an application's `prisma.config.ts` imports, such as `@prisma/orm-postgres`, now tells Prisma which modules generated files import from. The CLI no longer reads the application's `package.json` to work that out.

An application whose config calls a target package's `defineConfig` needs only the first change below.

## `contract-types-import-from-the-target-package`

Run `prisma contract emit` and commit the regenerated `contract.json` and `contract.d.ts`.

The generated `contract.d.ts` now has one import statement for its framework, family and target types:

```ts
import type { CodecTypes as PgTypes, Contract as ContractType, ContractWithTypeMaps } from '@prisma/orm-postgres/contract-types';
```

where it had several, from `@prisma/orm-postgres/contract/types`, `@prisma/orm-postgres/family-contract/types` and `@prisma/orm-postgres/target/codec-types`. Each extension's types still come from the extension's own package.

In `contract.json`, each extension under `extensions` no longer records where its types are imported from: the `import` of its codec, operation and query operation types, its `typeImports` and its `parameterizedOutputTypes`. An extension's `types` entry disappears when nothing else is left in it. Nothing read these.

A file generated before the upgrade keeps working, because the modules it imports are still exported.

Leave the copies of the contract kept beside each migration, under `migrations/snapshots/`, as they are. They keep working, and no command rewrites a snapshot that already exists; only a snapshot written from now on has the new form. Do not edit them or any `migration.ts` by hand.

## `hand-assembled-config-names-generated-file-modules`

This applies only to a config that imports `defineConfig` from `@prisma/orm-framework/config/config-types` or `@prisma/orm-toolchain/cli/config-types` and passes the family, target, adapter and driver itself. A config that calls a target package's `defineConfig` already names both modules.

Add `typesModule` to the `contract` section and `module` to the `migrations` section of the object passed to that `defineConfig`, leaving the rest of the file as it is:

```ts
defineConfig({
  family,
  target,
  adapter,
  driver,
  contract: { ...contractSource, typesModule: '#contract-types' },
  migrations: { module: '@prisma/orm-target-postgres/target/migration' },
})
```

- `contract.typesModule` names a module that exports the framework's contract types, the family's contract types and the target's codec and operation types. Write one in the application that re-exports them:

  ```ts
  // src/contract-types.ts
  export type * from '@prisma/orm-framework/contract/types';
  export type * from '@prisma/orm-family-sql/contract/types';
  export type * from '@prisma/orm-target-postgres/target/codec-types';
  export type * from '@prisma/orm-target-postgres/target/operation-types';
  ```

  and give it a name private to the application, in `package.json`:

  ```json
  { "imports": { "#contract-types": "./src/contract-types.ts" } }
  ```

- `migrations.module` names the module that exports the migration base class and the target's operation helpers. For Postgres that is `@prisma/orm-target-postgres/target/migration`.
- Neither may be empty, a path or a URL. `'./contract-types'` is refused when the config is loaded, because generated files are written into more than one folder and a relative path is right for at most one of them.
- The application must depend directly on every package these modules import from. The target's and adapter's own types are imported from the target's package, such as `@prisma/orm-target-postgres`, so the application depends on that too.

## `control-api-takes-types-module`

A script that calls the control client passes the module the generated contract types import from:

```ts
await client.emit({ contractConfig: { source, output, typesModule } });
await client.renderContractDts({ contract, typesModule });
```

Take the value from the config: `defineConfig(...).contract.typesModule`. For an application on a target package it is that package's `contract-types` entrypoint, such as `'@prisma/orm-postgres/contract-types'`.

A script that calls the control API's contract emit, `migration new` or `migration plan` operations directly, from `@prisma/orm-toolchain/cli/control-api`, removes the `projectDir` option. The operations read the module names from the config they are given.

## `toolchain-publish-surface-entrypoints-removed`

Remove every import of `@prisma/orm-toolchain/publish-surface` and its two subpaths. They held the table and the functions that translated module names when files were generated. That translation no longer happens, so there is nothing to call in their place.
