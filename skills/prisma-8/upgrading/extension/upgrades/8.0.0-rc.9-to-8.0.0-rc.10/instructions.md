---
from: "8.0.0-rc.9"
to: "8.0.0-rc.10"
# sql-orm-client doc-comment sweep: reviewed, no entry required
# postgres shell dependency ownership: reviewed, no extension-author action required; bundled packages now declare the catalog Node/pg type dependencies that public shell manifests mirror
changes:
  - id: schema-header-use-prisma-8
    summary: |
      The schema header that marks a Prisma 8 schema is now `// use prisma-8`. The language server
      still serves the old header and its Format action rewrites it; new schemas and the
      inferred-schema printer write the new form. Replace `// use prisma-next`
      at the top of every `.prisma` file the extension ships or tests against.
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
      in the extension's test setup and CI configuration.
    detection:
      glob: "**/*"
      contains:
        - "PRISMA_NEXT_"
  - id: to-one-relations-record-nullable
    summary: |
      `ContractNonJunctionRelation`'s `'1:1'` and `'N:1'` members now require `nullable: boolean`,
      and contract validation rejects a `contract.json` whose to-one relations lack it. Set
      `nullable` on every to-one relation the extension constructs, and rebuild the extension's
      contract space so its emitted `contract.json` / `contract.d.ts` carry the flag.
    detection:
      glob: "**/*.ts"
      matches:
        - '(?<!\bnullable\b(?:[^{}]|\{[^{}]*\})*)(?:(?<=\bon\s*:(?:[^{}]|\{[^{}]*\})*)|(?=(?:[^{}]|\{[^{}]*\})*\bon\s*:))\bcardinality:\s*[''"](?:N:1|1:1)[''"](?!(?:[^{}]|\{[^{}]*\})*\bnullable\b)'
  - id: contract-space-re-emit-nullable
    summary: |
      The extension's emitted `contract.json` must carry `nullable` on every `1:1` and `N:1`
      relation. Rebuild the contract space (the package's `build:contract-space` script) once
      after upgrading.
    detection:
      glob: "**/contract.json"
      matches:
        - '"cardinality":\s*"(?:N:1|1:1)",\s*"on":'
---

## `to-one-relations-record-nullable`

For every TypeScript file matched by `detection`, find each object literal that builds a to-one contract relation (`cardinality: 'N:1'` or `'1:1'` together with an `on` join) and add `nullable: <boolean>` to it: `true` when the relation field is optional (the local foreign-key columns are nullable), `false` when it is required. The side of a one-to-one relation that does not own the foreign key is always `nullable: true`. Contract builders and PSL authoring set the flag from the field's `?`, so only code that assembles `ContractRelation` values by hand needs the edit.

## `contract-space-re-emit-nullable`

For every `contract.json` matched by `detection`, run the extension package's `build:contract-space` script (or its emit command) once after upgrading. The expected diff is one `"nullable"` boolean per to-one relation in `contract.json`, plus the `Models` namespace, `models` constant, and `RelationKeys` import in `contract.d.ts`.

## `schema-header-use-prisma-8`

For every `.prisma` file matched by `detection`, replace the first-line header `// use prisma-next` with `// use prisma-8`. Nothing else in the file changes.

## `env-vars-drop-next-infix`

For every file matched by `detection`, replace the `PRISMA_NEXT_` prefix with `PRISMA_` on each environment variable name.
