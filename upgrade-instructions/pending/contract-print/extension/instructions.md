---
changes:
  - id: contract-source-format-is-psl-or-typescript
    summary: Every contract source declares format 'psl' or 'typescript'; format is required, and OpaqueContractSourceProvider is removed.
  - id: prisma7-schema-source-declares-psl
    summary: The prisma7Schema() contract source declares format 'psl' instead of 'prisma7'.
  - id: print-psl-description-option
    summary: printPsl() from @internal/psl-printer opens every file with only the // use prisma-8 marker unless the caller passes description.
  - id: family-sql-psl-ast-export
    summary: mapDefault, its option types, the PslTypeMap types and toEnumMemberName moved from @internal/family-sql/psl-infer to @internal/family-sql/psl-ast.
---

# Contract source formats are PSL and TypeScript

`ContractSourceProvider` from `@internal/config/config-types` is now the union of `PslContractSourceProvider` (`format: 'psl'`) and `TypeScriptContractSourceProvider` (`format: 'typescript'`). `format` is required on both. `OpaqueContractSourceProvider` and every other `format` value are gone, and config validation reports a source with no `format`, or any other value, as an issue on `contract.source.format`.

Give every contract source an extension defines a `format`: `'psl'` when its inputs are PSL text, and `'typescript'` when it builds the contract in TypeScript. Replace imports of `OpaqueContractSourceProvider` with `ContractSourceProvider`.

The source returned by `prisma7Schema()` now declares `format: 'psl'`, because a Prisma 7 schema is PSL text. It still does not implement `interpret`. Code that compared `source.format` with `'prisma7'` must stop doing so; nothing in the framework tells a Prisma 7 schema from a Prisma 8 one by its format.

# `printPsl()` takes a description line

`printPsl()` from `@internal/psl-printer` used to open every file with the `// use prisma-8` marker and a line saying the contract was inferred from the live database. It now writes only the marker, and a second comment line only when the caller passes `description`. Code that prints an inferred contract and wants the old second line passes it:

```ts
printPsl(ast, {
  pslBlockDescriptors,
  description:
    'Contract inferred from the live database schema. Edit as needed, then run `prisma contract emit`.',
});
```

# PSL building blocks moved to `@internal/family-sql/psl-ast`

`contract print` uses some of what `@internal/family-sql/psl-infer` exported, so those exports moved to the new subpath `@internal/family-sql/psl-ast`: `mapDefault`, `DefaultMappingOptions`, `DefaultMappingResult`, `PslTypeMap`, `PslTypeReference`, `PslTypeResolution` and `toEnumMemberName`. Import them from `@internal/family-sql/psl-ast`. Everything else stays in `@internal/family-sql/psl-infer`.
