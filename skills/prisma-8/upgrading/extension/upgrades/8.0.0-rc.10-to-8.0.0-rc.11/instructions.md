---
from: "8.0.0-rc.10"
to: "8.0.0-rc.11"
changes:
  - id: engine-pin-moves-to-0-4-0
    summary: |
      The toolchain now requires `@prisma/cli-engine@0.4.0` (up from 0.3.0). An extension that
      pins `@prisma/cli-engine` in its own manifests must move the pin to `0.4.0`. The new engine
      adds a `--format markdown` output format to every command and widens its `Format` type to
      `"human" | "json" | "markdown"`; nothing else in its public API changed.
    detection:
      glob: "**/package.json"
      contains:
        - '"@prisma/cli-engine": "0.3.0"'
  - id: contract-space-restamp
    summary: |
      The emitted `contract.json` / `contract.d.ts` embed the toolchain version, which moves
      to 8.0.0-rc.11. Rebuild the extension's contract space (the package's `build:contract-space`
      script) once after upgrading so the emitted artifacts match the installed toolchain.
    detection:
      glob: "**/contract.json"
      contains:
        - '"version": "8.0.0-rc.10"'
---

# 8.0.0-rc.10 → 8.0.0-rc.11 — Extension author upgrade instructions

## `engine-pin-moves-to-0-4-0`

For every `package.json` matched by `detection`, change the `@prisma/cli-engine` version from `0.3.0` to `0.4.0` and reinstall. Code that names the engine's `Format` type must accept the new `"markdown"` member; an exhaustive `switch` over the format now needs a `markdown` branch. Nothing else changes.

## `contract-space-restamp`

For every `contract.json` matched by `detection`, run the extension package's `build:contract-space` script (or its emit command) once after upgrading. The only expected diff is the embedded `version` moving to `8.0.0-rc.11`.
