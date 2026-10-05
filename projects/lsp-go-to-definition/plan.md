# lsp-go-to-definition — Plan

**Spec:** `projects/lsp-go-to-definition/spec.md`
**Linear Project:** none (skipped by operator)

## At a glance

Two slices, stacked. The first moves binder construction out of `interpret` into one framework function used by the CLI and the language server, and removes the extension-pack guess along with the SQL filter. The second makes the binder resolve namespace qualifiers and adds `textDocument/definition` to the language server.

## Composition

### Stack (deliver in order)

1. **Slice `binder-from-caller`**. Linear: none. Folder: `projects/lsp-go-to-definition/slices/binder-from-caller/`
   - **Outcome:** One framework function builds the binder from `(symbolTable, sources, ContractSourceContext)`. Both family providers and `ProjectArtifacts` call it and pass the binder to `interpret` through `PslInterpretInput`. The caller reports the binder's diagnostics. `describeUnsupportedAttribute` is contributed by the SQL and Mongo family descriptors through authoring contributions. `createSqlBinder`, `createMongoBinder`, `checkUncomposedNamespace`, `PSL_EXTENSION_NAMESPACE_NOT_COMPOSED` and `voicedAsUncomposedNamespace` no longer exist.
   - **Builds on:** None.
   - **Hands to:** a `ProjectArtifacts` that holds one cached binder per snapshot, shared with interpretation, and a `PslInterpretInput.binder` that every interpreter reads instead of building its own.
   - **Focus:**
     - the framework binder function and its type-constructor inputs (scalars and field presets derived from `ContractSourceContext`);
     - the `describeUnsupportedAttribute` contribution in `framework-components`, `sql/9-family` and `mongo-family/9-family`;
     - both providers' `load()` and both interpreters;
     - `ProjectArtifacts` caching and invalidation;
     - one test helper per family package that builds the symbol table and binder, with the ~77 direct `interpret` test callers switched to it;
     - removing the guess at every call site (SQL type constructors, named types, relations, field and model attributes, Mongo field presets), with the 5 affected test files and the `namespace-without-pack` integration fixture changed to the diagnostic named in the spec.

     No navigation work and no change to what the binder resolves.

2. **Slice `go-to-definition`**. Linear: none. Folder: `projects/lsp-go-to-definition/slices/go-to-definition/`
   - **Outcome:** The binder records a `namespace` resolution on the qualifier identifier of a qualified type reference. The language server declares `definitionProvider` and answers `textDocument/definition` for every row of the spec's table, returning `LocationLink[]`, or `Location[]` for clients without `linkSupport`.
   - **Builds on:** Slice 1's cached per-snapshot binder in `ProjectArtifacts`.
   - **Hands to:** a language server that maps any bound reference to its declaration nodes. Find references is the planned follow-up and builds on the same mapping.
   - **Focus:**
     - qualifier resolution in `binder.ts`, with a unit test for a namespace declared in two blocks;
     - the cursor-to-resolution walk and the symbol-to-declaration mapping;
     - the client-capability read for `linkSupport`;
     - tests across files and for merged namespaces;
     - the language-server README entry and the manual VS Code check.

## Dependencies (external)

None. The binder, `PslInterpretInput`, and the language server's `ProjectArtifacts` are all on `main` (branch fast-forwarded to `d501bfbe69`).

## Sequencing rationale

Slice 2 needs a binder inside the language server, and only slice 1 provides one, so the two can't run in parallel. The operator kept the extension-pack guess removal inside slice 1 instead of splitting it into its own slice. Slice 1's PR description should therefore separate the one change users see (the diagnostics listed in the spec) from the mechanical binder move, so a reviewer can check each on its own.
