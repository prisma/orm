---
changes:
  - id: config-type-renamed-to-prisma-config
    summary: |
      The config type that `defineConfig` returns is renamed from `PrismaNextConfig` to `PrismaConfig`, in `@internal/config/config-types`, `@prisma/orm-toolchain/cli/config-types` and every package that re-exports it, including the target facades' `defineConfig` return types. The old name is gone. The detection matches TypeScript sources that name the old type.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\w$])PrismaNextConfig(?![\w$])'
---

# `PrismaNextConfig` is now `PrismaConfig`

In every file the detection matches, rename each import, re-export and type use of `PrismaNextConfig` to `PrismaConfig`. If the file already has its own `PrismaConfig`, import the type under an alias instead, such as `import type { PrismaConfig as PrismaToolchainConfig }`, and use the alias. Leave string literals that happen to contain the text alone; they are application values, not the type. Its type parameters do not change. Then run the project's formatter, since a shorter name can let an import fit on one line.

```ts
// Before
import type { PrismaNextConfig } from '@prisma/orm-toolchain/cli/config-types';
const config: PrismaNextConfig<'sql', 'postgres'> = defineConfig({ /* ... */ });

// After
import type { PrismaConfig } from '@prisma/orm-toolchain/cli/config-types';
const config: PrismaConfig<'sql', 'postgres'> = defineConfig({ /* ... */ });
```
