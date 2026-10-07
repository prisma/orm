---
from: "8.0.0-rc.15"
to: "8.0.0-rc.16"
changes:
  - id: engine-pin-moves-to-0-6-3
    summary: |
      The toolchain now requires `@prisma/cli-engine@0.6.3` (up from 0.6.2). A project that pins `@prisma/cli-engine` itself must move the pin to `0.6.3`. The engine's only change is that it accepts any ArkType `^2.2.7`, so it shares one ArkType copy with the Prisma ORM packages.
    detection:
      glob: "**/package.json"
      contains:
        - '"@prisma/cli-engine": "0.6.2"'
  - id: contract-artifacts-restamp
    summary: |
      An extension that writes its own package version into the contracts it emits, such as the
      Supabase extension, now writes 8.0.0-rc.16. Run `contract emit` once after upgrading so the
      emitted `contract.json` and `contract.d.ts` match the installed extension.
    detection:
      glob: "**/contract.json"
      contains:
        - '"version": "8.0.0-rc.15"'
---

# 8.0.0-rc.15 → 8.0.0-rc.16 — User upgrade instructions

## `engine-pin-moves-to-0-6-3`

For every `package.json` matched by `detection`, change the `@prisma/cli-engine` version from `0.6.2` to `0.6.3` and reinstall. Projects assembled by the `prisma` CLI resolve the engine automatically.

Engine 0.6.2 required ArkType `2.2.3` exactly, while the Prisma ORM packages accept any `^2.2.2`. A package manager could then install two ArkType copies, and with Bun `prisma contract emit` failed on a valid contract with `CONTRACT.VALIDATION_FAILED`. Engine 0.6.3 accepts `^2.2.7`, so one copy serves both. Nothing in the engine's commands or output changes.

## `contract-artifacts-restamp`

For every `contract.json` matched by `detection`, run the project's emit command (`prisma contract emit`, or the project's `contract:emit` script) once after upgrading. This entry accounts for the extension's embedded `version` moving to `8.0.0-rc.16`; any other difference in the emitted files comes from an earlier entry in this guide.
