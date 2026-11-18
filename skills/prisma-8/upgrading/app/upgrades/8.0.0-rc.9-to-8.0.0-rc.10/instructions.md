---
from: "8.0.0-rc.9"
to: "8.0.0-rc.10"
changes:
  - id: schema-header-use-prisma-8
    summary: |
      The schema header that marks a Prisma 8 schema is now `// use prisma-8`. The language server
      still serves the old header and its Format action rewrites it; new schemas and the
      inferred-schema printer write the new form. Replace `// use prisma-next`
      at the top of every `.prisma` file.
    detection:
      glob: "**/*.prisma"
      contains:
        - "// use prisma-next"
  - id: env-vars-drop-next-infix
    summary: |
      The CLI environment variables lost their `NEXT_` infix: `PRISMA_NEXT_DISABLE_TELEMETRY`,
      `PRISMA_NEXT_TELEMETRY_ENDPOINT`, `PRISMA_NEXT_DEBUG`, and the rest are now
      `PRISMA_DISABLE_TELEMETRY`, `PRISMA_TELEMETRY_ENDPOINT`, `PRISMA_DEBUG`, and so on. The old
      `PRISMA_NEXT_DISABLE_TELEMETRY` opt-out is still honoured; the others are not. Rename them
      in shell profiles, `.env` files, and CI configuration. The per-user telemetry config also moved
      from `~/.config/prisma-next/` to `~/.config/prisma-8/`, so the consent prompt runs once more.
    detection:
      glob: "**/*"
      contains:
        - "PRISMA_NEXT_"
  - id: primer-file-prisma-8-md
    summary: |
      The quick-reference primer `init` writes at the project root is now `prisma-8.md`. Rename the
      existing `prisma-next.md` and update any README or agent instruction that points at it.
    detection:
      glob: "**/prisma-next.md"
      contains:
        - "#"
  - id: to-one-relations-record-nullable
    summary: |
      Every `1:1` and `N:1` relation in `contract.json` now carries a `nullable` boolean. A
      contract without it still loads, with the flag derived from the foreign-key columns (or
      fields), but its `contract.d.ts` lacks the `Models` namespace. Re-run
      `prisma contract emit` so the emitted `contract.json` / `contract.d.ts` match the installed
      toolchain.
    detection:
      glob: "**/contract.json"
      matches:
        - '"cardinality":\s*"(?:N:1|1:1)",\s*"on":'
  - id: reemit-supabase-extension-version
    summary: |
      Contracts that use the Supabase extension carry its package version in their extension
      metadata. Re-emit them after upgrading so `contract.json` and `contract.d.ts` say
      `8.0.0-rc.10` instead of `8.0.0-rc.9`.
    detection:
      glob: "**/contract.json"
      contains:
        - '"id": "supabase"'
  - id: contract-dts-exports-models
    summary: |
      `contract.d.ts` now exports a `Models` namespace and a `models` constant that name every
      model with its fields and relations. The re-emit above produces them; use them with
      `Scalars` and `Shape` to name row types without a client in scope.
---

## `to-one-relations-record-nullable`

For every `contract.json` matched by `detection`, run the project's emit command (`prisma contract emit`, or the project's `contract:emit` script) once after upgrading. The emit reads the `?` on each to-one relation field in the schema and writes `"nullable": true` or `"nullable": false` next to that relation's `"cardinality"`. The emit also fails, rather than emitting, when a required relation field sits over a nullable foreign key or the reverse; fix the schema so the field's `?` matches the key's `?`, then emit again. Until the re-emit, the client and the migration tools still load the old `contract.json`: a to-one relation without the flag is treated as nullable when any of its foreign-key columns (Mongo: fields) is nullable, and as required otherwise. Migration contract snapshots written by earlier versions are never rewritten and load the same way.

## `contract-dts-exports-models`

After the emit, `import type { Models, models } from './prisma/contract'` (the project's contract path) gives `Models.<namespace>_<Model>` for every model, and `Scalars<M>` / `Shape<M, { '+': 'relation' }>` from `@prisma/orm-postgres/family-contract/types` (or the Mongo family package) derive the default row and a data structure with relations from it. Replace hand-written row types that duplicate a model's fields with these when convenient.

## `schema-header-use-prisma-8`

For every `.prisma` file matched by `detection`, replace the first-line header `// use prisma-next` with `// use prisma-8`. Nothing else in the file changes.

## `env-vars-drop-next-infix`

For every file matched by `detection`, replace the `PRISMA_NEXT_` prefix with `PRISMA_` on each environment variable name. Delete `~/.config/prisma-next/` (or `%APPDATA%\prisma-next\` on Windows); the CLI recreates its config under `prisma-8` and asks for telemetry consent once.

## `primer-file-prisma-8-md`

Rename `prisma-next.md` at the project root to `prisma-8.md`, and update any link to it in the project README or agent instructions.

## `reemit-supabase-extension-version`

For every `contract.json` matched by `detection`, run `prisma contract emit` once after upgrading the Supabase extension and commit the regenerated `contract.json` and `contract.d.ts`. The only expected change is the Supabase extension's `version` field moving from `8.0.0-rc.9` to `8.0.0-rc.10` in both files. Do not edit the generated files by hand.
