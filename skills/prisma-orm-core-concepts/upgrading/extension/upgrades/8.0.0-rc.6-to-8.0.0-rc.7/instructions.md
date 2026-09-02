---
from: "8.0.0-rc.6"
to: "8.0.0-rc.7"
changes:
  - id: rename-orm-pagination-methods
    summary: |
      Rename ORM collection pagination calls from `.take(n)` to `.limit(n)` and from `.skip(n)` to `.offset(n)`. This applies to SQL and Mongo ORM collections, including relation refinements and grouped SQL collections. Do not rename Mongo query-builder `.skip(n)` calls: that lower-level API continues to mirror the `$skip` pipeline stage.
  - id: contract-space-restamp
    summary: |
      The emitted `contract.json` / `contract.d.ts` embed the toolchain version, which moves
      to 8.0.0-rc.7. Rebuild the extension's contract space (the package's `build:contract-space`
      script) once after upgrading so the emitted artifacts match the installed toolchain. The toolchain also re-released against
      `@prisma/cli-engine@0.2.3` (a CLI-side change with no ORM-facing surface).
    detection:
      glob: "**/contract.json"
      contains:
        - '"version": "8.0.0-rc.6"'
---

# 8.0.0-rc.6 → 8.0.0-rc.7 — Extension author upgrade instructions

## `rename-orm-pagination-methods`

Find calls on Prisma Next ORM collections in extension source and tests, then apply these translations:

- `.take(n)` → `.limit(n)`
- `.skip(n)` → `.offset(n)`

Apply the same translation inside `include(...)` refinement callbacks, `combine(...)` branches, and after SQL ORM `groupBy(...)`. Leave Mongo query-builder chains that start from `mongoQuery(...).from(...)` or an equivalent query-builder factory unchanged: their `.limit(...)` and `.skip(...)` methods name Mongo aggregation pipeline stages rather than the ORM collection API.

## `contract-space-restamp`

For every `contract.json` matched by `detection`, run the extension package's `build:contract-space` script (or its emit command) once after upgrading. The only expected diff beyond the pagination rename is the embedded `version` moving to `8.0.0-rc.7`.
