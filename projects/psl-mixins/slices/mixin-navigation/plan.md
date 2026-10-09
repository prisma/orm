# Slice plan: mixin-navigation

**Spec:** `projects/psl-mixins/slices/mixin-navigation/spec.md`

## Dispatch plan

### Dispatch 1: definition, references, hover and rename

- **Outcome:** Every row of the spec's feature table holds, with a test per row and cursor position. `language-server` typecheck, tests and lint pass.
- **Builds on:** The binder resolutions from `mixin-inclusion`.
- **Hands to:** `pslSymbolOf` returning the `MixinSymbol`, which every symbol-based feature reads.
- **Focus:** tests first. `pslSymbolOf`; `resolveHoverResult`, `HoverEntitySymbol`, `renderDeclarationLine`, `blockKeywordDocumentationAt`; `fieldTakesMap` with `FieldAttributeOwner` and the `'field'` arm of `attributeSpecResolver`. Semantic tokens are dispatch 2.

### Dispatch 2: semantic tokens for mixin bodies and inclusions

- **Outcome:** The spec's "Semantic tokens" section holds, with the tests the done conditions name. `pnpm typecheck`, `pnpm test:packages`, `pnpm lint:deps` and package lint pass apart from the known environment failures.
- **Builds on:** Nothing from dispatch 1; it is second so that the slice's full gate run comes last.
- **Hands to:** The branch ready for the PR.
- **Focus:** tests first. The mixin branch of `collectDeclaration`, an ordered walk of a mixin body, inclusion handling in `collectBlockMembers` and `collectGenericBlockMembers`; the README.
