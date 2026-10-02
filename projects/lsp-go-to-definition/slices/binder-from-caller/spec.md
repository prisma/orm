# Slice: binder-from-caller

Parent project: [`projects/lsp-go-to-definition/`](../../spec.md). This slice gives the language server the same binder the interpreter uses, which go-to-definition (slice 2) reads.

## At a glance

The binder moves out of `interpret`. One framework function builds it from the symbol table, the sources and `ContractSourceContext`. Both family providers and the language server's `ProjectArtifacts` call that function, report its diagnostics, and pass the binder to `interpret`. In the same PR, the extension-pack guess and both binder-diagnostic filters are removed, so every diagnostic describes what the user actually wrote.

## Chosen design

### One binder factory in `@internal/psl-parser`

```ts
createProjectBinder(input: {
  readonly symbolTable: SymbolTable;
  readonly sources: PslSources;
  readonly context: ContractSourceContext;
}): BinderResult   // { binder, diagnostics }
```

It calls the existing `createBinder` with:

| `createBinder` input | Derived from |
|---|---|
| `typeConstructors` | scalars from `collectScalarTypeConstructors(context.authoringContributions.type)`, plus field presets (`fieldPresetsAsTypeNames(contributions.field)`), plus `contributions.type` (the union `createSqlBinder` builds today) |
| `attributeSpecs` | `assembleAttributeSpecs(context.authoringContributions)`: family built-ins plus contributed model attributes |
| `pslBlockDescriptors` | `context.authoringContributions.pslBlockDescriptors` |
| `controlMutationDefaults` | `context.controlMutationDefaults`, with `dataTypeEntries` from `contributions.dataTypes` (as the SQL interpreter does today) |
| `describeUnsupportedAttribute` | the family's contribution (below), called with `sources` |

`createSqlBinder`, `createMongoBinder` and their tests are removed. The name `createProjectBinder` is a suggestion. The implementer may pick another name if an existing one fits better.

### `describeUnsupportedAttribute` is a family contribution

- **Declaration:** `AuthoringContributions` in `framework-components` gains a `describeUnsupportedAttribute` contribution. Its type is erased (`unknown`) at the framework layer, the same way `attributeSpecs` is, because framework core cannot name psl-parser types.
- **Type restoration:** `@internal/psl-parser` restores the type in one place, next to `assembleAttributeSpecs`.
- **Shape:** the contribution is a factory `(sources: PslSources) => DescribeUnsupportedAttribute`.
- **Contributors:** the SQL family descriptor (`sql/9-family`) contributes `describeUnsupportedSqlAttribute`, and the Mongo family descriptor (`mongo-family/9-family`) contributes `describeUnsupportedMongoAttribute`. Once the guess is removed, both need only `sources`.
- **Assembly:** a second contributor is an assembly error, like duplicate attribute spec registrations.

### `describeUnresolvedType` is a family contribution

Added after merging `origin/main` (#30521 gave Mongo richer wording for unknown field types). The binder's `PSL_UNRESOLVED_REFERENCE` for a type reference takes its message from a family-contributed `describeUnresolvedType`, contributed and assembled like `describeUnsupportedAttribute` (type-erased in `framework-components`, restored in psl-parser, one contributor). The diagnostic code stays `PSL_UNRESOLVED_REFERENCE`; only the message comes from the family. Mongo contributes #30521's wording: a name from an earlier Prisma (`BigInt`, `Bytes`, `Decimal`) gets the current name and its BSON storage, any other name gets the list of Mongo scalar types (derived from `context.authoringContributions`). The earlier-name table becomes part of the Mongo contribution, and the `formerScalarCodecIds` provider option is removed. SQL contributes nothing and keeps the binder's default message.

### Callers build the binder and report its diagnostics

- `PslInterpretInput` gains `readonly binder: Binder`.
- The SQL and Mongo `provider.load()` build the symbol table, then the binder. They add the binder's diagnostics to `seedDiagnostics` next to the symbol-table diagnostics and pass the binder to `this.interpret(...)`.
- `interpretPslDocumentToSqlContract` and the Mongo interpreter read `input.binder` and never report binder diagnostics themselves.
- `ProjectArtifacts` caches the `BinderResult` next to `#symbolTableResult`, clears it in `#refreshSources` and at every point that clears the symbol table, passes `binder` to `interpret`, and adds the binder's diagnostics to each document's diagnostics, filtered by file as `symbolDiagnostics` already is. It is built only when a `ProjectInterpretation` exists.

### Removals

- **The extension-pack guess:** `checkUncomposedNamespace` (framework-components), `uncomposedNamespaceDiagnostic`, `reportUncomposedNamespace` (psl-parser `field-presets.ts`), and `PSL_EXTENSION_NAMESPACE_NOT_COMPOSED`, at every call site:
  - SQL: `psl-column-resolution.ts`, `psl-named-type-resolution.ts`, `psl-relation-resolution.ts`, `psl-field-resolution.ts`;
  - Mongo: `field-presets.ts`.

  Each call site falls through to the diagnostic it gives any other unknown name.
- **The unknown-preset diagnostic:** `reportUnknownFieldPreset` (psl-parser `field-presets.ts`), `PSL_UNKNOWN_FIELD_PRESET`, and the branches that call it (SQL `resolveFieldTypeDescriptor`, Mongo `resolveFieldPreset`). The binder resolves presets from the same `contributions.field` tree the preset lookup reads, so a preset typo is always an unresolved reference and gets the binder's `Cannot find type`. The `contract-prisma7` path never reaches the branch, because its type-constructor paths have one segment.
- **The filters:** SQL's `voicedAsUncomposedNamespace` and Mongo's `binderDiagnostics.filter((d) => d.data?.['reference'] !== 'type')` (`mongo-family/.../interpreter.ts:1188`).

### Unknown type names get one diagnostic

An interpreter's own unsupported-type diagnostic is reported only when `binder.symbolForNode(typeReferenceNode(field))` resolved:
- Mongo: `PSL_UNSUPPORTED_FIELD_TYPE` in `resolveNonRelationField`;
- SQL: its `PSL_UNSUPPORTED_FIELD_TYPE` and `PSL_UNSUPPORTED_NAMED_TYPE_CONSTRUCTOR` sites for field types and type constructors.

For an `unresolved` reference, the binder's `Cannot find type "…"` is the only diagnostic.

Before and after for `vector pgvectr.Vector(3)` in a SQL schema without pgvector:

```
before:  PSL_EXTENSION_NAMESPACE_NOT_COMPOSED  Type constructor "pgvectr.Vector" uses unrecognized namespace "pgvectr". Add extension pack "pgvectr" to extensions in prisma.config.ts.
after:   PSL_UNRESOLVED_REFERENCE              Cannot find type "pgvectr.Vector"
```

### Test callers

Each family package's test utilities (`contract-psl/test/` in SQL and in Mongo) gain one helper that parses source text and builds the symbol table and binder with the framework factory. The ~77 files that call `interpret(...)` / `interpretPslDocumentTo{Sql,Mongo}Contract(...)` directly switch to it.

## Coherence rationale

Everything in the PR follows from one change: the binder is built once, before `interpret`, by family-blind code. Removing the guess and the filters is required for that. A family-blind caller cannot filter diagnostics by family, so the diagnostics must be correct when the binder produces them. The reviewer reads the framework factory, the contribution, the two providers, `ProjectArtifacts`, and then a mechanical test-helper migration. The PR description separates the user-visible diagnostic changes from the mechanical move.

## Scope

**In:**
- `@internal/psl-parser`: the factory, `PslInterpretInput.binder`, the `describeUnsupportedAttribute` type restoration, and removal of the uncomposed-namespace helpers.
- `framework-components`: the contribution slot and its assembly, and removal of `checkUncomposedNamespace`.
- `sql/9-family` and `mongo-family/9-family` descriptors.
- `sql/2-authoring/contract-psl` and `mongo-family/2-authoring/contract-psl`: providers, interpreters, the resolution files listed above, and tests.
- The language server's `ProjectArtifacts`.
- The integration fixture `test/integration/test/authoring/diagnostics/namespace-without-pack/expected-diagnostics.json`.
- Docs that mention `PSL_EXTENSION_NAMESPACE_NOT_COMPOSED`, if any.

**Out:**
- Qualifier resolution and `textDocument/definition` (slice 2).
- Switching Mongo's `resolveNonRelationField` to binder-driven resolution (parallel work in another worktree).
- `contract-prisma7`.
- Any change to what the binder resolves.

## Pre-investigated edge cases

| Edge case | Disposition | Notes |
|---|---|---|
| Mongo's binder today gets no contributed model-attribute specs (`createMongoBinder` passes `mongoAttributeSpecs` only), while `assembleAttributeSpecs` includes `contributions.modelAttributes`. | Accept | A Mongo stack with contributed model attributes now binds them instead of reporting them unsupported. Report any Mongo test whose output changes because of this. |
| The unsupported-attribute check must use the spec registry, not "the binder recorded no resolution". | Keep current binder behaviour | `bindAttributes` already calls `describeUnsupportedAttribute` only when no factory is registered. A registered spec that can't be instantiated (e.g. on a composite type) must not become "unsupported". |

## Slice-specific done conditions

- [ ] `rg "createSqlBinder|createMongoBinder|checkUncomposedNamespace|uncomposedNamespaceDiagnostic|reportUncomposedNamespace|PSL_EXTENSION_NAMESPACE_NOT_COMPOSED|voicedAsUncomposedNamespace" packages test docs` returns nothing, and neither interpreter filters `binderDiagnostics`.
- [ ] A language-server test shows an unsupported attribute producing the same diagnostic in `ProjectArtifacts` as in the CLI provider path for the same schema.

## Open Questions

None.

## References

- Parent project: [`projects/lsp-go-to-definition/spec.md`](../../spec.md)
- Linear issue: none (skipped by operator)
- ADRs: ADR 231, ADR 249, ADR 255
- Origin of the removed filters: #30349 (`62ceaab854`)

## Amendment (after review on #30563)

The describers moved from `authoring` contributions to the family descriptor's `pslDiagnostics`, copied into `ContractSourceContext.pslDiagnostics` by the CLI and the language server. The duplicate-contribution checks in `control-stack.ts` and the `AuthoringContributions` fields were removed. Sections above that describe the `authoring` route are superseded by this.

Later operator decisions, also in #30563:

- `interpretPslSqlSources` / `interpretPslMongoSources` were removed. `provider.load()` builds the symbol table and binder itself; tests build them through each family's `./test` `bindPslSchema` and pass `binder` explicitly.
- Interpreters never look up names written in the schema. SQL `resolveFieldTypeDescriptor` and Mongo `resolveNonRelationField` switch on the binder resolution, so Mongo field-type resolution through the binder is in scope here, not a separate project. The binder binds a field preset name to the preset descriptor (`contributedTypes`).
- New diagnostics: `PSL_PRESET_NOT_CALLED` and `PSL_TYPE_CONSTRUCTOR_NOT_CALLED`, reported by the interpreters. A resolved name SQL cannot store gets a specific `PSL_UNSUPPORTED_FIELD_TYPE` message instead of the catch-all. A schema whose only errors come from the binder gets the `Schema has N errors` summary.
- `FieldAttributeSpecContext` carries the field's `typeResolution`; enum member validation takes the enum from it. The discriminator check identifies `String` by codec id from the resolution, so a named type based on `String` is accepted.
- A named type's base resolves in a scope without the named types (`Uuid = Uuid` binds to the contributed `Uuid`).
- `contract-prisma7` does not use the binder; it instantiates its mapped type constructors directly.
- `@internal` API changes get no upgrade instructions; the fragment is `changes: []`.
- One binder factory: `createBinder` derives its inputs from the context subset it needs; the language server uses it with or without an interpretation.
