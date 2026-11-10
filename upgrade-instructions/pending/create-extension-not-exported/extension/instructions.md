---
changes:
  - id: create-extension-not-exported
    summary: |
      `@internal/target-postgres/migration` no longer exports the free function `createExtension`, which a `migration.ts` could not call correctly since 8.0.0-rc.22. A `migration.ts` that imports it now fails at once with `does not provide an export named 'createExtension'`. Call the method on the migration class instead: `createExtension('btree_gist')` becomes `this.createExtension({ extension: 'btree_gist' })`. Run `node migration.ts` again only for a migration no database has applied.
    detection:
      glob: "**/migration.{ts,mts}"
      matches:
        - '(?<![\w$.])createExtension\s*\('
        - '\bimport\s*\{[^}]*(?<![\w$])createExtension(?![\w$])[^}]*\}\s*from\s*[\x27"]@internal/target-postgres/migration[\x27"]'
---

# `createExtension` is no longer a free function

`@internal/target-postgres/migration` no longer exports `createExtension`. Since 8.0.0-rc.22 the free function took an internal argument that only the migration class can supply, so a `migration.ts` that called it failed with `Cannot read properties of undefined (reading 'lowerToExecuteRequest')`. Now the import fails at once instead.

In every `migration.ts` the detection matches, call the method and remove `createExtension` from the import:

```ts
// Before
import { createExtension, Migration, MigrationCLI } from '@internal/target-postgres/migration';

override get operations() {
  return [createExtension('btree_gist'), ...];
}

// After
import { Migration, MigrationCLI } from '@internal/target-postgres/migration';

override get operations() {
  return [this.createExtension({ extension: 'btree_gist' }), ...];
}
```

Without `schema`, the method creates the extension where the old function did: in the connection's current schema, unless the extension's control file names one. For a migration no database has applied yet, run `node migration.ts` to write its `ops.json` again. Leave the `ops.json` of an applied migration alone: `prisma db migrate` applies `ops.json` and does not load `migration.ts`.
