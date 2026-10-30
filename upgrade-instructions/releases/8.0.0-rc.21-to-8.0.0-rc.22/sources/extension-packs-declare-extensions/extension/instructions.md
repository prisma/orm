---
changes:
  - id: declare-postgres-extension-in-pack-contract
    summary: |
      A Postgres pack whose migration installs an extension with `installExtension(...)` and an invariant cannot be adopted by `prisma db sign`, which refuses a space whose head ref requires an invariant its marker does not record. Declare the extension in the pack's contract instead, with `extension pg_trgm {}` in PSL or `entities: [extension('pg_trgm')]` in a TypeScript contract, re-run `prisma contract emit` for the pack, and plan two migrations with `prisma migration plan`: one from the old head (`--from <old head hash>`), whose one operation creates the extension if it is missing, and one from the empty contract (`--from @empty`). Wire both into the descriptor's `contractSpace.migrations`, keep the old install migration, and set `migrations/refs/head.json` to the new storage hash with no invariants.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '(?<![\w$])installExtension\s*\('
---

# Declare a pack's Postgres extension in its contract

```ts
// Before: src/contract.ts
export const contract = defineContract(config, () => ({ models: {} }));

// After
import { defineContract, extension } from '@prisma/orm-postgres/contract-builder';
export const contract = defineContract(config, () => ({
  models: {},
  entities: [extension('vector')],
}));
```

After emitting the pack's contract, plan from the old head and from the empty contract, keep the old install migration in the descriptor, and list the two new migrations beside it. The head ref lists no invariants.
