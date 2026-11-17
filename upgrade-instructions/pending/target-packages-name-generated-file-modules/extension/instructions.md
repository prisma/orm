---
changes:
  - id: target-package-names-generated-file-modules
    summary: |
      A package that adds a target must name, in the config its `defineConfig` returns, the module generated contract types import from (`contract.typesModule`) and the module migration files import from (`migrations.module`), and must hand the config target and adapter descriptors whose type declarations state its own types module. Without `contract.typesModule`, every command that writes contract types fails with `CONFIG.CONTRACT_TYPES_MODULE_MISSING`: `prisma contract emit`, `prisma migration plan`, `prisma migration new`, `prisma migrate`, `prisma db init`, `prisma db update` and `prisma db sign`. Without `migrations.module`, `prisma migration plan` and `prisma migration new` fail with `CONFIG.MIGRATION_MODULE_MISSING`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '@prisma/orm-framework/config/config-types'
        - '@prisma/orm-toolchain/cli/config-types'
  - id: extension-config-names-generated-file-modules
    summary: |
      An extension that has a contract of its own, emitted with a config it assembles from the framework's `defineConfig`, must name `contract.typesModule` and `migrations.module` in that config. The extension's own commands otherwise fail in the same way as an application's: see `target-package-names-generated-file-modules`.
    detection:
      glob: "**/prisma.config.{ts,mts,cts}"
      matches:
        - '@prisma/orm-framework/config/config-types'
        - '@prisma/orm-toolchain/cli/config-types'
  - id: family-imports-are-import-requirements
    summary: |
      `EmissionSpi.getFamilyImports` takes the types module and returns import requirements, where it took a function that translated module names and returned lines of import text. `ImportSpecifierResolver`, `keepInternalSpecifiers` and `resolveRequirementSpecifiers` are removed from `@prisma/orm-framework/components/emission`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '(?<![\w$])getFamilyImports\s*\('
        - '(?<![\w$])(ImportSpecifierResolver|keepInternalSpecifiers|resolveRequirementSpecifiers)(?![\w$])'
  - id: migration-renderer-takes-the-migration-module
    summary: |
      A migration plan's `renderTypeScript` takes the module the rendered file imports from, as a string, where it took a function that translated module names. The renderer names no module of its own.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '(?<![\w$])renderTypeScript\s*\(\s*[^)\s]'
  - id: emitter-takes-the-types-module
    summary: |
      In `@prisma/orm-toolchain/emitter`, `generateContractDts` takes the types module as a required fifth argument, `EmitOptions.typesModule` is required and `EmitOptions.resolveImportSpecifier` is removed, and `generateImportLines` is replaced by `typesImportRequirements`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '(?<![\w$])(generateContractDts|generateImportLines)\s*\('
        - 'resolveImportSpecifier'
  - id: mysql-config-components-carry-family-and-modules
    summary: |
      `MysqlConfigComponents`, the argument of `createMysqlDefineConfig` from `@prisma/orm-mysql/config`, requires `family`, `typesModule` and `migrationModule`, and its `target` and `adapter` are used as given.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '(?<![\w$])createMysqlDefineConfig\s*\('
  - id: control-api-takes-types-module
    summary: |
      The control client's `emit` requires `contractConfig.typesModule`, and `renderContractDts` requires `typesModule`: the module the generated contract types import from. The `projectDir` option of the control API's contract emit, `migration new` and `migration plan` operations is removed, and `preflightRefAdvancement` takes the config in its place.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - 'contractConfig\s*:'
        - '(?<![\w$])renderContractDts\s*\('
        - '@prisma/orm-toolchain/cli/control-api'
  - id: component-type-import-module-is-not-a-literal-type
    summary: |
      On the Postgres and MongoDB target and adapter descriptors, the type of a type import's `package` is a template string type such as `` `${string}/codec-types` ``, where it was one string literal. Code that depends on the literal type compares the value instead.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - 'codecTypes\.import\.package'
  - id: toolchain-publish-surface-entrypoints-removed
    summary: |
      `@prisma/orm-toolchain/publish-surface`, `@prisma/orm-toolchain/publish-surface/import-roots` and `@prisma/orm-toolchain/publish-surface/shells` are removed. Nothing replaces them.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs}"
      matches:
        - '@prisma/orm-toolchain/publish-surface'
---

# A target package names the modules generated files import from

Prisma no longer works out which package a generated file should import from. The package an application installs for its target says so, in the config. Prisma's own target packages do this the same way.

An extension that only contributes types, operations or codecs to an existing target, and has no contract of its own, needs none of the changes below, as long as each type declaration it makes states a module of its own published package.

## `target-package-names-generated-file-modules`

This applies to a package that an application installs to use a target: one that exports a `defineConfig` built on the framework's `defineConfig`, from `@prisma/orm-framework/config/config-types` or `@prisma/orm-toolchain/cli/config-types`. It has three things to do.

**1. Export a module with the types a generated `contract.d.ts` imports.** It only re-exports: the framework's contract types, the family's, and the target's codec and operation types.

```ts
// src/generated-types.ts, exported as <your package>/generated-types
export type * from '@prisma/orm-framework/contract/types';
export type * from '@prisma/orm-family-sql/contract/types';
export type * from './codec-types';
export type * from './operation-types';
```

**2. State that module in the type declarations of the target and adapter you hand to the config.** `restateTypeDeclarations` returns a copy of a descriptor whose type declarations name the module you give it, keeping each name and alias. Assemble the components in one file, and build both `defineConfig` and any control client from it:

```ts
// src/components.ts
import { restateTypeDeclarations } from '@prisma/orm-framework/target-package-config/type-declarations';

export const typesModule = '@acme/orm-db/generated-types';
export const migrationModule = '@acme/orm-db/migration';

export const target = restateTypeDeclarations(dbTarget, typesModule);
export const adapter = restateTypeDeclarations(dbAdapter, typesModule);
```

An application on your package can import only from packages it depends on directly, which is your package and not the ones it is built from. This is what makes the generated file name yours.

**3. Name both modules in the config.**

```ts
// src/config.ts
import { defineConfig as defineFrameworkConfig } from '@prisma/orm-framework/config/config-types';
import { adapter, driver, family, migrationModule, target, typesModule } from './components';

export function defineConfig(options: ConfigOptions) {
  return defineFrameworkConfig({
    family,
    target,
    adapter,
    driver,
    contract: { ...contractSource(options), typesModule },
    migrations: { module: migrationModule },
  });
}
```

`migrations.module` names the module that exports the migration base class, the command-line entry and your operation helpers: everything your migration renderer writes an import for.

Neither module may be empty, a path or a URL. Name it the way your package is imported.

Then check from outside: install your package in a scratch application from a tarball, run `prisma contract emit` and `prisma migration plan`, and typecheck with `skipLibCheck` off. Every import in the generated files should name your package, an extension's own package, or a relative path.

## `extension-config-names-generated-file-modules`

This applies to an extension that has a contract of its own: it has a `prisma.config.ts` that imports `defineConfig` from `@prisma/orm-toolchain/cli/config-types` or `@prisma/orm-framework/config/config-types`, possibly under another name, and passes it the family, target and adapter, and it commits a generated `contract.d.ts` and migrations.

Name both modules in the object passed to that call, with a types module private to the extension package:

```ts
contract: { ...contractSource, typesModule: '#generated-types' },
migrations: { module: '@prisma/orm-target-postgres/target/migration' },
```

```json
{ "imports": { "#generated-types": "./src/generated-types.ts" } }
```

`src/generated-types.ts` exports the framework's contract types, the family's, and the target's codec and operation types, as in the first change above. A relative path such as `'./generated-types'` is refused: the copy of the contract kept beside each migration is written into another folder, where that path points at nothing.

If your build inlines that module into a declaration file you publish, check that the built file still exports every type. A bundler can drop a whole-module `export type *` when it inlines the module; naming each type in the re-export avoids that.

Then run `prisma contract emit` in the extension and commit the regenerated files.

## `family-imports-are-import-requirements`

This applies to a package that implements a family's `EmissionSpi`, from `@prisma/orm-framework/components/emission`.

```ts
// before
getFamilyImports(resolveImportSpecifier: ImportSpecifierResolver): string[];
// after
getFamilyImports(typesModule: string): ReadonlyArray<ImportRequirement>;
```

Return one `ImportRequirement`, from `@prisma/orm-framework/ts-render`, for each type the family's part of `contract.d.ts` uses, each with `moduleSpecifier: typesModule` and `typeOnly: true`, and with `alias` where the generated file uses the type under another name. Do not build or return import text.

`ImportSpecifierResolver`, `keepInternalSpecifiers` and `resolveRequirementSpecifiers` are removed. Nothing translates a module name any more, so remove their uses.

## `migration-renderer-takes-the-migration-module`

This applies to a package that implements a migration planner whose plan has `renderTypeScript`.

```ts
// before
renderTypeScript(resolveImportSpecifier: ImportSpecifierResolver): string;
// after
renderTypeScript(migrationModule: string): string;
```

Write every import of the migration base class, the command-line entry and your operation helpers from `migrationModule`. It is the config's `migrations.module`. Remove any module name the renderer or its operations held themselves.

## `emitter-takes-the-types-module`

This applies to code that calls the emitter directly, from `@prisma/orm-toolchain/emitter`.

- `generateContractDts` takes the types module as its fifth argument. Pass the config's `contract.typesModule`.
- In `EmitOptions`, pass `typesModule` and remove `resolveImportSpecifier`.
- `generateImportLines`, which returned lines of import text, is replaced by `typesImportRequirements`, which returns import requirements. Render them with the helper in `@prisma/orm-framework/ts-render`.

## `mysql-config-components-carry-family-and-modules`

This applies to a package that builds its `defineConfig` with `createMysqlDefineConfig`, as a target that speaks the MySQL protocol does.

Pass three more members:

```ts
export const defineConfig = createMysqlDefineConfig({
  pack,
  family,
  target,
  adapter,
  driver,
  typesModule: '@acme/orm-db/generated-types',
  migrationModule: '@acme/orm-db/migration',
});
```

- `family` is the SQL family's control descriptor. The helper no longer supplies it.
- `typesModule` and `migrationModule` are the two modules of your package that generated files import from. The helper names them in the config, so your package must export both.
- `target` and `adapter` are used as given. Restate their type declarations yourself with `restateTypeDeclarations`, as in the first change above.

## `control-api-takes-types-module`

A script or test that calls the control client passes the module the generated contract types import from:

```ts
await client.emit({ contractConfig: { source, output, typesModule } });
await client.renderContractDts({ contract, typesModule });
```

Take the value from the config: `defineConfig(...).contract.typesModule`.

Code that calls the control API's operations directly, from `@prisma/orm-toolchain/cli/control-api`, removes the `projectDir` option from contract emit, `migration new` and `migration plan`, and passes the config to `preflightRefAdvancement` where it passed `projectDir`.

## `component-type-import-module-is-not-a-literal-type`

This applies to code that reads the module of a type import from a Prisma target or adapter descriptor, such as `postgresAdapter.types.codecTypes.import.package`, and relies on its type being one exact string.

The value is unchanged. Its type is now a template string type, because the module is filled in when the package is built. Replace a type-level comparison with the exact string by a comparison of the value, or by a check of the suffix.

## `toolchain-publish-surface-entrypoints-removed`

Remove every import of `@prisma/orm-toolchain/publish-surface` and its two subpaths. They held the table and the functions that translated module names when files were generated. That translation no longer happens, so there is nothing to call in their place.
