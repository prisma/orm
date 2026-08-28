# Dispatch 3 — reconstruct-parses-block-attributes

Slice plan: `../plan.md` § Dispatch 3. Spec: `../spec.md` § Chosen design 3.

## Task

`reconstructExtensionBlock` runs the descriptor's block-attribute factories through the kit and fills `PslExtensionBlock.attributes`; unknown names and duplicates diagnose; kit failures surface as `ParseDiagnostic`s — such that the build and the LSP see identical block-attribute diagnostics because both run `buildSymbolTable`.

## Completed when

- [ ] `symbol-table.test.ts` covers: parsed value + span; unknown name → `PSL_EXTENSION_UNKNOWN_BLOCK_ATTRIBUTE`; duplicate → `PSL_INVALID_EXTENSION_BLOCK_ATTRIBUTE` first-wins; arity failure → `PSL_INVALID_ATTRIBUTE_SYNTAX`; refine code carried; descriptor without `attributes`; descriptor `undefined`.
- [ ] Exactly one new `blindCast` in psl-parser `src/`.
- [ ] Gates: psl-parser typecheck/lint/test; workspace typecheck; language-server test.

## Edge cases

| Case | Disposition |
| --- | --- |
| F5 destructive git | forbidden |
| `sourceId` for the block ctx | `'unknown'` placeholder, the interpreters' existing idiom; dropped on the way to `ParseDiagnostic` |
| F16 layering comment | HALT |
| No code comments | none added |
