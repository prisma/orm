---
changes:
  - id: typescript-contract-from-path-requires-target
    summary: |
      `typescriptContractFromPath` from `@prisma/orm-family-sql/contract-ts/config-types` now takes three arguments: the contract path, the output path (or `undefined`), and an options object that must hold the configured target's pack ref as `target` and that target's `contract-builder` module as `contractBuilderModule`. Calls with one or two arguments, or with only `defaultControlPolicy` and `createNamespace`, no longer compile, and in JavaScript they throw. The detection matches TypeScript and JavaScript files that import it from the SQL family, under any name; the MongoDB family's function of the same name is unchanged.
    detection:
      glob: "**/*.{ts,mts,cts,js,mjs,cjs}"
      matches:
        - '(?<![\s\S])(?=[\s\S]*@(?:prisma/orm-family-sql|internal/sql-contract-ts)/(?:contract-ts/)?config-types)[\s\S]*\btypescriptContractFromPath\b'
---

# `typescriptContractFromPath` requires the configured target

In every file the detection matches, give each call of `typescriptContractFromPath` from `@prisma/orm-family-sql/contract-ts/config-types`, under whatever name the file imports it, all three arguments. Pass the output path second, or `undefined` to keep the default beside the contract. Pass as the third an object with `target`, the pack ref of the target the config is for, and `contractBuilderModule`, that target's `contract-builder` entry, such as `@prisma/orm-postgres/contract-builder`. Keep any `defaultControlPolicy` and `createNamespace` the call already passed beside them. The option types are exported from the same entry as `TypeScriptContractFromPathOptions` and `TypeScriptContractTarget`, though an object literal is enough. The loader then refuses a contract built for another target with `CONTRACT.TARGET_MISMATCH`.

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
