---
from: "8.0.0-rc.8"
to: "8.0.0-rc.9"
changes:
  - id: define-config-becomes-define-prisma-config
    summary: |
      `prisma.config.ts` files import the config marker from `@prisma/cli-engine` as
      `definePrismaConfig` instead of `defineConfig`. `definePrismaConfig` has been the
      engine's name for the marker since `@prisma/cli-engine@0.2.0`; `defineConfig` is a
      deprecated alias that the next engine release removes, so configs still importing it
      from the engine will stop loading then. Only the engine import renames: the
      per-product section helpers (`defineConfig` from `@prisma/orm-*/config`) keep their
      name.
    detection:
      glob: "**/prisma.config.ts"
      contains:
        - "import { defineConfig } from '@prisma/cli-engine'"
---

# 8.0.0-rc.8 → 8.0.0-rc.9 — User upgrade instructions

## `define-config-becomes-define-prisma-config`

For every `prisma.config.ts` matched by `detection`, rename the engine import and its call site from `defineConfig` to `definePrismaConfig`:

```ts
// before
import { defineConfig } from '@prisma/cli-engine';
export default defineConfig({ ... });

// after
import { definePrismaConfig } from '@prisma/cli-engine';
export default definePrismaConfig({ ... });
```

Leave any `defineConfig` imported from a product package (for example `@prisma/orm-postgres/config`) untouched — those helpers keep their name. The engine function's behaviour is identical; only the name changes.
