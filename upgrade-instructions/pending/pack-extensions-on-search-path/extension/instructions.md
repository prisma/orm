---
changes:
  - id: pack-declares-extension-unbound
    summary: |
      A pack that declares a Postgres extension must declare it in the unbound namespace, and no two packs may declare the same extension. A composed pack that declares an extension in a named namespace, such as `public`, is refused when a command loads the configuration, with `CONTRACT.PACK_CONTRIBUTION_INVALID`. Declare it with `extension('<name>', { namespace: unbound })` from the Postgres contract builder, or `namespace unbound { extension <name> {} }` in PSL, re-emit the pack's contract, and plan one migration from the old head to the new one, which has no operations.
    detection:
      glob: "**/*.{ts,mts,cts,prisma}"
      matches:
        - '\bextension\((?![^)]*namespace:\s*unbound\b)[^)]*\)'
        - '^(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*?\bextension\s+[A-Za-z_][\w-]*\s*\{'
        - '\bnamespace\s+(?!unbound\b)[A-Za-z_][\w-]*\s*\{(?:[^{}]|\{[^{}]*\})*?\bextension\s+[A-Za-z_][\w-]*\s*\{'
---

# A pack declares its extension in the unbound namespace

```typescript
import { defineContract, extension, unbound } from '@prisma/orm-postgres/contract-builder';

export const contract = defineContract({
  entities: [extension('vector', { namespace: unbound })],
});
```

## `pack-declares-extension-unbound`

1. In the pack's contract source, pass `{ namespace: unbound }` to `extension(...)`, importing `unbound` from `@prisma/orm-postgres/contract-builder`. In a PSL contract, move the `extension` block into `namespace unbound { ... }`.
2. Run `prisma contract emit` in the pack.
3. Plan one migration from the old head to the new one. The planned migration has no operations, because the extension a database already has is found through the search path. Today `prisma migration plan` reads and writes the migrations of a project's own space under `migrations/app/`, while a pack keeps its migrations directly under `migrations/`, so plan through a temporary copy. Issue TML-3473 tracks removing these steps:
   1. Copy the pack's migration directories and `migrations/refs/` into a new `migrations/app/` directory.
   2. Run `prisma migration plan --from <old head hash> --name <name>`, where the old head hash is the `hash` in `migrations/refs/head.json`. It writes the new migration to `migrations/app/<timestamp>_<name>/` and the new contract snapshot to `migrations/snapshots/<new hash>/`.
   3. Move `migrations/app/<timestamp>_<name>/` to `migrations/<timestamp>_<name>/`, then delete `migrations/app/`.
   4. In the moved `migration.ts`, change each import of `../../snapshots/` to `../snapshots/`.
   5. Set `hash` in `migrations/refs/head.json` to the new contract hash, the `to` of the new `migration.json`, and keep its `invariants`.
4. Add the new migration's `migration.json` and `ops.json` to the migrations the pack's control descriptor lists.
