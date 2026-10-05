## Dispatch plan

Slice spec: [`spec.md`](./spec.md). Five dispatches, each building on the one before it. Dispatch 1 changes what users see. Dispatches 2–5 move code without changing behaviour, and each keeps every test green with unchanged expectations.

### Dispatch 1: remove the extension-pack guess and the binder-diagnostic filters

- **Outcome:** Four things are true:
  - `checkUncomposedNamespace`, `uncomposedNamespaceDiagnostic`, `reportUncomposedNamespace` and `PSL_EXTENSION_NAMESPACE_NOT_COMPOSED` no longer exist.
  - SQL's `voicedAsUncomposedNamespace` and Mongo's `reference !== 'type'` filter on binder diagnostics are gone.
  - Mongo's `PSL_UNSUPPORTED_FIELD_TYPE` in `resolveNonRelationField`, and SQL's unsupported field-type and type-constructor diagnostics, are reported only when the binder resolved the type reference. An unknown name gets only the binder's `Cannot find type`.
  - `rg` for the removed names across `packages test docs` returns nothing.
- **Builds on:** the slice spec's "Removals" and "Unknown type names get one diagnostic".
- **Hands to:** interpreters that report every binder diagnostic unfiltered, and a SQL `describeUnsupportedSqlAttribute` that no longer needs `composedExtensions`, `familyId` or `targetId`.
- **Focus:**
  - The five call sites listed in the spec, both interpreters' binder-diagnostic handling, and their tests.
  - The `namespace-without-pack` integration fixture.
  - Any doc that names the removed code.
  - Test expectations change only where they asserted a removed diagnostic, depended on a filter, or asserted an unsupported-type diagnostic for an unknown name. The dispatch report lists every edited expectation with before and after.
  - Binder construction stays where it is.

### Dispatch 2: framework binder factory and the `describeUnsupportedAttribute` contribution

- **Outcome:**
  - `AuthoringContributions` carries a `describeUnsupportedAttribute` factory contribution (type-erased at `framework-components`, restored in `@internal/psl-parser`, a second contributor is an assembly error). The SQL and Mongo family descriptors contribute theirs.
  - `@internal/psl-parser` exports the factory described in the spec, which builds a `BinderResult` from `(symbolTable, sources, ContractSourceContext)`.
  - Unit tests show that, for the same schema and stack, the factory's binder resolves every reference the same way and produces the same diagnostics as `createSqlBinder` / `createMongoBinder`.
- **Builds on:** Dispatch 1's simplified `describeUnsupportedSqlAttribute`.
- **Hands to:** a factory that is exported and tested but has no production caller yet. `createSqlBinder` / `createMongoBinder` still exist, which lets the equivalence test compare against them.
- **Focus:**
  - The contribution slot and its assembly in `control-stack.ts` / `framework-authoring.ts`.
  - Type restoration next to `assembleAttributeSpecs`.
  - The two family descriptors.
  - The factory and its tests.
  - No interpreter, provider, or language-server change.

### Dispatch 3: per-family test helper, and direct `interpret` callers moved to it

- **Outcome:**
  - Each family's `contract-psl/test/` has one helper that turns schema text plus interpreter options into an interpretation result. It does the parsing, symbol-table building and interpret call internally.
  - Every test that built `{ documents, sources, symbolTable }` by hand and called `interpret(...)` / `interpretPslDocumentTo{Sql,Mongo}Contract(...)` now goes through the helper.
  - No test expectation changes.
- **Builds on:** Dispatch 2's factory, which the helper doesn't use yet. Nothing in this dispatch depends on it, so it could run before dispatch 2 if needed.
- **Hands to:** test code where the interpret input is built in exactly two places, one helper per family. Dispatch 4 changes that input without touching the ~77 test files.
- **Focus:**
  - This is a mechanical move across test files.
  - The design decision (the helper's signature) is made once, in the helper, and reported with an example call in the dispatch report.
  - Tests of the provider itself (`provider.test.ts`, `provider.interpret.test.ts`) keep going through the provider.
  - No production code changes.

### Dispatch 4: callers build the binder and pass it to `interpret`

- **Outcome:**
  - `PslInterpretInput.binder` is required.
  - Both `provider.load()` implementations build the binder with the dispatch 2 factory, add its diagnostics to `seedDiagnostics`, and pass it to `interpret`.
  - Both interpreters read `input.binder` and don't report binder diagnostics.
  - `createSqlBinder`, `createMongoBinder` and their tests are deleted, including the dispatch 2 equivalence tests that compared against them. Those tests are converted to tests of the factory alone.
  - The dispatch 3 helpers build the binder with the factory.
  - All package tests pass with unchanged expectations.
- **Builds on:** Dispatch 2's factory and Dispatch 3's helpers.
- **Hands to:** the CLI path in its final shape, where the binder is built by the caller and passed through `PslInterpretInput`, and no family constructs a binder.
- **Focus:**
  - `psl-parser/interpret.ts`, both providers, both interpreters, and both helpers.
  - The dispatch report confirms there are no other production callers of `interpret`.
  - The language server's `ProjectArtifacts` changes only as far as needed to keep compiling. Caching and reporting diagnostics there are dispatch 5.

### Dispatch 5: `ProjectArtifacts` owns one binder per snapshot

- **Outcome:**
  - `ProjectArtifacts` builds the `BinderResult` with the factory when a `ProjectInterpretation` exists and caches it next to `#symbolTableResult`.
  - The cache is cleared at every point that clears the symbol table.
  - The same binder instance is passed to `interpret`, and the binder's diagnostics are added to each document's diagnostics, filtered by file.
  - Language-server tests show that an unsupported attribute and an unknown type each produce the same single diagnostic in the language server as in the provider path, and that a document edit produces a new binder.
- **Builds on:** Dispatch 4's `PslInterpretInput.binder`.
- **Hands to:** slice DoD, and for slice 2, a binder that `ProjectArtifacts` exposes for the current snapshot.
- **Focus:**
  - `project-artifacts.ts` and language-server tests.
  - A public accessor for the binder that slice 2 will read.
  - No `textDocument/definition` work.

## Validation gate

**Per dispatch:** `pnpm build` (when exported types consumed elsewhere change), `pnpm typecheck`, `pnpm --filter <pkg> test` and `lint` for touched packages, `pnpm lint:deps`, and `rg` for every name the dispatch removes.

**Once at slice end, before the PR:** `pnpm test:packages` and `pnpm test:integration` (known pre-existing failures: the `@vercel/detect-agent` trust-downgrade tarball tests and `contract-imports.test.ts`, which fail identically on `origin/main`).

**Review:** D2 gets a reviewer round. D3–D5 are checked by the orchestrator against their outcome, and the reviewer reviews the whole slice once before the PR.
