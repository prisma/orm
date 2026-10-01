---
from: "8.0.0-rc.10"
to: "8.0.0-rc.11"
changes:
  - id: engine-pin-moves-to-0-4-0
    summary: |
      The toolchain now requires `@prisma/cli-engine@0.4.0` (up from 0.3.0). Projects assembled
      by the unified `prisma` CLI resolve the engine automatically. A project that pins
      `@prisma/cli-engine` itself must move the pin to `0.4.0`. The new engine adds a
      `--format markdown` output format to every command; nothing else in its public API changed.
    detection:
      glob: "**/package.json"
      contains:
        - '"@prisma/cli-engine": "0.3.0"'
  - id: contract-artifacts-restamp
    summary: |
      The emitted `contract.json` / `contract.d.ts` embed the toolchain version, which moves
      to 8.0.0-rc.11. Run `contract emit` once after upgrading so the emitted artifacts match
      the installed toolchain.
    detection:
      glob: "**/contract.json"
      contains:
        - '"version": "8.0.0-rc.10"'
---

# 8.0.0-rc.10 → 8.0.0-rc.11 — User upgrade instructions

## `engine-pin-moves-to-0-4-0`

For every `package.json` matched by `detection`, change the `@prisma/cli-engine` version from `0.3.0` to `0.4.0` and reinstall. No code changes are needed: the engine only adds `--format markdown`, and every existing flag and output format keeps working.

## `contract-artifacts-restamp`

For every `contract.json` matched by `detection`, run the project's emit command (`prisma contract emit`, or the project's `contract:emit` script) once after upgrading. The only expected diff is the embedded `version` moving to `8.0.0-rc.11`.
