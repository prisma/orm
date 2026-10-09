## Dispatch plan

Slice spec: `projects/lsp-rename/slices/type-constructor-refs/spec.md`

Review: one reviewer round after Dispatch 2, covering Dispatches 1 and 2. Dispatch 3 adds tests and QA artefacts and is reviewed only if it changes source code.

### Dispatch 1: the binder binds entity-constructor arguments

- **Outcome:** the binder records a resolution on the entity argument of a type constructor that declares `entityRefArg`, for fields of models, fields of composite types and named types, with the outcomes in the slice spec's Binder section. Binder tests cover each outcome and each place.
- **Builds on:** `main`.
- **Hands to:** Dispatch 2: `binder.symbolForNode(argument node)` answers for every entity-constructor argument.
- **Focus:** `psl-parser/src/binder.ts` and binder tests. After this dispatch an unknown name is reported twice (binder and interpreter); tests of other packages that fail only for that reason are listed in the report and fixed in Dispatch 2.
- **Validation gate:** typecheck, lint and full tests for `psl-parser`.

### Dispatch 2: the SQL interpreter reads the binder's resolution

- **Outcome:** `resolveEntityRefTypeConstructorCall` reads the binder's resolution and finds the lowered entity by block symbol; the transitional refusals of the slice spec are in place; the Prisma 7 interpreter calls the split-out function with its resolved entity. Existing same-namespace contracts are unchanged.
- **Builds on:** Dispatch 1.
- **Hands to:** review; then Dispatch 3.
- **Focus:** SQL `contract-psl` (`interpreter.ts`, `psl-column-resolution.ts`, `psl-field-resolution.ts`), `contract-prisma7/src/interpreter.ts`, their tests, Postgres target tests for `pg.enum` columns.
- **Validation gate:**
  - during the dispatch: typecheck, lint and tests for the changed packages;
  - once at the end: `pnpm typecheck`, `pnpm lint:deps`, `pnpm fixtures:check`, `pnpm test:packages`.

### Dispatch 3: language-server tests and the QA rerun

- **Outcome:** language-server tests for go-to-definition, hover, find references and rename on a constructor argument; the slice-1 QA scenario for renaming a `native_enum` used in `pg.enum(...)` is rerun against the built CLI and passes, recorded in a new run report.
- **Builds on:** Dispatch 2, after review.
- **Hands to:** Slice DoD.
- **Focus:** `language-server/test/`, `projects/lsp-rename/qa/`.
