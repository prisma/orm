---
changes:
  - id: engine-pin-moves-to-0-6-3
    summary: |
      The toolchain now requires `@prisma/cli-engine@0.6.3` (up from 0.6.2). A project that pins `@prisma/cli-engine` itself must move the pin to `0.6.3`. The engine's only change is that it accepts any ArkType `^2.2.7`, so it shares one ArkType copy with the Prisma ORM packages.
    detection:
      glob: "**/package.json"
      contains:
        - '"@prisma/cli-engine": "0.6.2"'
---

## `engine-pin-moves-to-0-6-3`

For every `package.json` matched by `detection`, change the `@prisma/cli-engine` version from `0.6.2` to `0.6.3` and reinstall. Projects assembled by the `prisma` CLI resolve the engine automatically.

Engine 0.6.2 required ArkType `2.2.3` exactly, while the Prisma ORM packages accept any `^2.2.2`. A package manager could then install two ArkType copies, and with Bun `prisma contract emit` failed on a valid contract with `CONTRACT.VALIDATION_FAILED`. Engine 0.6.3 accepts `^2.2.7`, so one copy serves both. Nothing in the engine's commands or output changes.
