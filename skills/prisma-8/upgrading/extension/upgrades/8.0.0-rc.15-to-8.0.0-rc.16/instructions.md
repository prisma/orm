---
from: "8.0.0-rc.15"
to: "8.0.0-rc.16"
changes:
  - id: engine-pin-moves-to-0-6-3
    summary: |
      The toolchain now peers `@prisma/cli-engine@0.6.3` (up from 0.6.2). An extension package that pins `@prisma/cli-engine` for its tests or tooling must move the pin to `0.6.3`. The engine's only change is that it accepts any ArkType `^2.2.7`, so it shares one ArkType copy with the Prisma ORM packages.
    detection:
      glob: "**/package.json"
      contains:
        - '"@prisma/cli-engine": "0.6.2"'
---

# 8.0.0-rc.15 → 8.0.0-rc.16 — Extension author upgrade instructions

## `engine-pin-moves-to-0-6-3`

For every `package.json` matched by `detection`, change the `@prisma/cli-engine` version from `0.6.2` to `0.6.3` and reinstall.

Engine 0.6.2 required ArkType `2.2.3` exactly, while the Prisma ORM packages accept any `^2.2.2`. With two ArkType copies installed, a type your package exports from an ArkType schema can fail to build its declarations with `TS2742`, because the inferred type names the other copy's path. After moving the pin, make sure your lockfile resolves a single ArkType version, for example with `pnpm dedupe`. Nothing in the engine's commands or output changes.
