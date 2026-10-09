# Slice plan: mixin-grammar

**Spec:** `projects/psl-mixins/slices/mixin-grammar/spec.md`

## Dispatch plan

### Dispatch 1: tokenizer, parser and typed AST

- **Outcome:** `parse()` produces `MixinDeclaration` and `MixinInclusion` nodes for every block keyword, with the reserved-word diagnostics, the malformed-input recovery and the unchanged `prisma-7` grammar described in the spec; the typed AST classes expose them. `psl-parser` typecheck, tests and lint pass, and the package is rebuilt.
- **Builds on:** The spec's chosen design.
- **Hands to:** `MixinDeclarationAst`, `MixinInclusionAst`, and `inclusions()` on the three block AST classes, exported from the package and covered by parser tests including lossless round trip.
- **Focus:**
  - tests first: tokenizer (`Plus`), `+` in expression position still an error, parser shape tests for model, type, enum and `key = value` mixins at the top level and in a namespace, inclusion in each body grammar, each row of the reserved-word table, each malformed input, the `prisma-7` grammar;
  - `tokenizer.ts`, `syntax-kind.ts`, `parse.ts`, `syntax/ast/declarations.ts`, exports.

  The formatter and the symbol table are dispatch 2. If the formatter throws on the new kinds in existing tests, make it pass them through unformatted and leave the rest.

### Dispatch 2: formatter, symbol-table exclusion and other consumers

- **Outcome:** The formatter prints both forms as the spec describes and is idempotent on them; `buildSymbolTable` keeps mixin declarations out of `models`, `compositeTypes` and `blocks` and reports "Mixins are not supported yet" at each mixin declaration and each inclusion; every package's tests pass on trees that contain the new kinds. `pnpm typecheck`, `pnpm test:packages`, `pnpm lint:deps` and `pnpm fixtures:check` pass, apart from the four environment failures recorded in `reviews/code-review.md`.
- **Builds on:** Dispatch 1's AST classes.
- **Hands to:** Slice done conditions met; the branch is ready for the PR.
- **Focus:**
  - tests first: formatter cases for a model, an enum and a `key = value` mixin and for inclusions between aligned fields; symbol-table tests for the exclusion and the diagnostic;
  - `format/emit.ts`, `symbol-table.ts`;
  - a language-server test that opens a document containing both forms and requests semantic tokens, folding ranges and completion without an error;
  - the `psl-parser` README;
  - `pnpm check:upgrade-coverage` if `examples/**` or `packages/3-extensions/**` change.
