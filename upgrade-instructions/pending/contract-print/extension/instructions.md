---
changes:
  - id: contract-source-format-is-psl-or-typescript
    summary: A contract source declares format 'psl' or 'typescript', or none; OpaqueContractSourceProvider is removed.
  - id: prisma7-schema-source-declares-psl
    summary: The prisma7Schema() contract source declares format 'psl' instead of 'prisma7'.
---

# Contract source formats are PSL and TypeScript

`ContractSourceProvider` from `@internal/config/config-types` is now the union of `PslContractSourceProvider` (`format: 'psl'`) and `TypeScriptContractSourceProvider` (`format: 'typescript'`, or no `format`). `OpaqueContractSourceProvider` and any other `format` string are gone.

If an extension defines a contract source with another `format` value, set `format: 'psl'` when its inputs are PSL text, and otherwise leave `format` out, which makes it a TypeScript source. Replace imports of `OpaqueContractSourceProvider` with `ContractSourceProvider`.

The source returned by `prisma7Schema()` now declares `format: 'psl'`, because a Prisma 7 schema is PSL text. It still does not implement `interpret`. Code that compared `source.format` with `'prisma7'` must stop doing so; nothing in the framework tells a Prisma 7 schema from a Prisma 8 one by its format.
