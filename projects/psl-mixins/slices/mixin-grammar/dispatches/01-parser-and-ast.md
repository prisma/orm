# Brief: mixin-grammar D1 — tokenizer, parser and typed AST

## Task

In `packages/1-framework/2-authoring/psl-parser`, make `parse()` read the two mixin forms described in the slice spec, `<keyword> mixin <Name> { … }` and `+<QualifiedName>`, as `MixinDeclaration` and `MixinInclusion` nodes, and expose them through typed AST classes. The slice spec's "Chosen design" section is the contract for token, node shapes, body grammar, recognition, the reserved-word table, the `prisma-7` grammar, and the AST surface; its edge-case table is the contract for malformed input.

## Scope

**In:** `src/tokenizer.ts`, `src/syntax/syntax-kind.ts`, `src/parse.ts`, `src/syntax/ast/declarations.ts` and whatever `src/exports/*` needs to export the new classes; parser, tokenizer and AST tests.

**Out:**

- `src/format/**` and `src/symbol-table.ts`, except the minimum needed to keep existing tests passing (for the formatter: pass the new kinds through unformatted). Report what you had to touch.
- The binder, interpreters, language server and every other package.
- Anything that gives a mixin meaning: symbols, name resolution, member placement.

## Completed when

- [ ] Parser tests cover: a mixin for `model`, `type`, `enum` and a `key = value` keyword, at the top level and inside a `namespace`; an inclusion in each of the three body grammars and inside a mixin body, with a qualified and an unqualified name; every row of the spec's reserved-word table; every row of the edge-case table; the `prisma-7` grammar rows.
- [ ] For every one of those inputs, the tree prints back to the exact source text.
- [ ] `pnpm --filter @internal/psl-parser typecheck`, `test` and `lint` pass; the package is rebuilt.

## Halt conditions

- The recognition rule (`Ident`, `mixin`, `Ident`, `{`) is ambiguous with an input that is valid on `main` under the default grammar, other than a block named `mixin`.
- A spec row cannot be implemented as written. Report the row and why; do not pick a different behaviour.
- Existing snapshot or fixture output changes.
