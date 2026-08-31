---
from: "8.0.0-rc.7"
to: "8.0.0-rc.8"
changes:
  - id: engine-pin-moves-to-0-3-0
    summary: |
      The toolchain now peers `@prisma/cli-engine@0.3.0` (up from 0.2.3). Projects assembled
      by the unified `prisma` CLI resolve the engine automatically. A project that pins
      `@prisma/cli-engine` itself must move the pin to `0.3.0`. The engine now declares
      `@prisma/management-api-sdk` as a peer dependency (`^1.55.0`) instead of a regular
      dependency; the `prisma` CLI shell supplies it at runtime, so only a project that runs
      the engine outside the CLI shell needs to install the SDK itself.
    detection:
      glob: "**/package.json"
      contains:
        - '"@prisma/cli-engine": "0.2.3"'
  - id: contract-artifacts-restamp
    summary: |
      The emitted `contract.json` / `contract.d.ts` embed the toolchain version, which moves
      to 8.0.0-rc.8. Run `contract emit` once after upgrading so the emitted artifacts match
      the installed toolchain.
    detection:
      glob: "**/contract.json"
      contains:
        - '"version": "8.0.0-rc.7"'
---

# 8.0.0-rc.7 → 8.0.0-rc.8 — User upgrade instructions

## `engine-pin-moves-to-0-3-0`

For every `package.json` matched by `detection`, change the `@prisma/cli-engine` version from `0.2.3` to `0.3.0` and reinstall. If the project runs the engine outside the unified `prisma` CLI shell (rare), also install `@prisma/management-api-sdk` at a version satisfying `^1.55.0` — the engine now declares it as a peer dependency and no longer bundles it.

## `contract-artifacts-restamp`

For every `contract.json` matched by `detection`, run the project's emit command (`prisma contract emit`, or the project's `contract:emit` script) once after upgrading. The only expected diff is the embedded `version` moving to `8.0.0-rc.8`.
