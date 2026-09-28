---
changes:
  - id: engine-pin-moves-to-0-6-2
    summary: |
      The toolchain now peers `@prisma/cli-engine@0.6.2` (up from 0.6.1). An extension package that pins `@prisma/cli-engine` for its tests or tooling must move the pin to `0.6.2`.
    detection:
      glob: "**/package.json"
      contains:
        - '"@prisma/cli-engine": "0.6.1"'
---

## `engine-pin-moves-to-0-6-2`

For every `package.json` matched by `detection`, change the `@prisma/cli-engine` version from `0.6.1` to `0.6.2` and reinstall.
