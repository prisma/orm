---
changes:
  - id: define-config-becomes-define-prisma-config
    summary: Rename the engine config marker import in `prisma.config.ts` from `defineConfig` to `definePrismaConfig`.
    detection:
      glob: "**/prisma.config.ts"
      contains:
        - "import { defineConfig } from '@prisma/cli-engine'"
---

# The engine's config marker is `definePrismaConfig`

For every `prisma.config.ts` matched by `detection`, rename the engine import and its call site from `defineConfig` to `definePrismaConfig`:

```ts
// before
import { defineConfig } from '@prisma/cli-engine';
export default defineConfig({ ... });

// after
import { definePrismaConfig } from '@prisma/cli-engine';
export default definePrismaConfig({ ... });
```

`definePrismaConfig` has been the engine's name for the marker since `@prisma/cli-engine@0.2.0`; `defineConfig` is a deprecated alias that the next engine release removes. Leave any `defineConfig` imported from a product package (for example `@prisma/orm-postgres/config`) untouched — those helpers keep their name. The engine function's behaviour is identical; only the name changes.
