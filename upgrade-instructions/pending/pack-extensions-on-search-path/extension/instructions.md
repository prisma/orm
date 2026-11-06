---
changes:
  - id: pack-declares-extension-unbound
    summary: |
      A pack that declares a Postgres extension must declare it in the unbound namespace, and no two packs may declare the same extension. A composed pack that declares an extension in a named namespace, such as `public`, is refused when a command loads the configuration, with `CONTRACT.PACK_CONTRIBUTION_INVALID`. Declare it with `extension('<name>', { namespace: unbound })` from the Postgres contract builder, or `namespace unbound { extension <name> {} }` in PSL, re-emit the pack's contract, and plan one migration from the old head to the new one, which has no operations.
    detection:
      glob: "**/*.{ts,mts,cts,prisma}"
      matches:
        - '\bextension\(\s*[A-Za-z_$''"][^,()]*\)'
        - '(?<![\s\S])(?![\s\S]*namespace\s+unbound\s*\{)[\s\S]*\bextension\s+[A-Za-z_][\w-]*\s*\{'
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
3. Run `prisma migration plan --from <old head hash>` in the pack. The planned migration has no operations, because the extension a database already has is found through the search path.
4. Add the new migration to the migrations the pack's control descriptor lists, and point the head ref at the new contract hash.
