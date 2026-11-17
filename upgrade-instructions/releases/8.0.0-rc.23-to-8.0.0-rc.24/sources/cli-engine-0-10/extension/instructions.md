---
changes:
  - id: engine-pin-moves-to-0-10-0
    summary: |
      The toolchain now peers `@prisma/cli-engine@0.10.0` (up from 0.9.0). An extension package that depends on `@prisma/cli-engine` for its tests or tooling must move to `0.10.0`.
    detection:
      glob: "**/{package.json,pnpm-workspace.yaml}"
      matches:
        - '"@prisma/cli-engine":\s*"[^"]*(?<![\d.])0\.\d(?!\d)'
        - '[''"]?@prisma/cli-engine[''"]?:\s*[''"]?[\^~]?0\.\d(?![\d])'
---

## `engine-pin-moves-to-0-10-0`

For every file matched by `detection`, change the `@prisma/cli-engine` version (`0.9.0`, `^0.9.0` or any other 0.x below 0.10) to `0.10.0` and reinstall. In engine 0.10.0 a normalized redirect's `replacement` is a list of steps rather than one string, so code that reads `CommandRedirect.replacement` from a command family reads an array.
