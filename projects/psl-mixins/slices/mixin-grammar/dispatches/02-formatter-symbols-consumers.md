# Brief: mixin-grammar D2 — formatter, symbol-table exclusion and other consumers

## Task

Finish the slice: the formatter prints both mixin forms, `buildSymbolTable` keeps mixin declarations out of every symbol record and reports the interim diagnostic, and every package compiles and passes its tests on trees that contain the new kinds. The slice spec's "Formatter" and "Symbol table" paragraphs are the contract.

## Scope

**In:**

- `psl-parser/src/format/emit.ts`: a mixin declaration prints as `<keyword> mixin <Name> {` with its body formatted as a block of that keyword; an inclusion prints as `+<QualifiedName>` on its own line at member indentation, with no space after `+`, outside field column alignment and without splitting an alignment group.
- `psl-parser/src/symbol-table.ts`: a mixin declaration is not added to `models`, `compositeTypes` or `blocks`, and takes no part in the duplicate-name check. One diagnostic "Mixins are not supported yet" at each mixin declaration's name (at the `mixin` word when the name is missing) and one at each inclusion that has a name. Use an existing diagnostic code.
- `language-server/src/semantic-tokens.ts:268`, which no longer compiles because `NamespaceMemberAst` has a fourth member, and any other consumer that fails to compile or throws on the new kinds.
- A language-server test that opens a document containing a mixin declaration and an inclusion and requests semantic tokens, folding ranges and completion without an error. What tokens a mixin gets is not specified; "no error and existing tokens unchanged for the rest of the document" is the bar.
- The `psl-parser` README: grammar and AST sections.
- The `NamespaceMemberAst` doc comment in `syntax/ast/declarations.ts`, which now lists three kinds for a four-member type. Correct it in place; add no other comments.

**Carry-over from D1:**

- **Inclusion only at the start of a line.** D1 turns the tail of `id Int @default(+1)` into a nameless `MixinInclusion` with the message "Expected a mixin name after +". That input has nothing to do with mixins. Change `parseMixinInclusion` so that a `+` is read as an inclusion only when it is the first significant token on its line; a `+` anywhere else gets the diagnostic it got on `main` (`Invalid model member declaration "+"`, or the entry-block equivalent). If the cursor cannot tell cheaply whether a token starts a line, halt and report what it would take.

**Out:** mixin symbols, name resolution, member placement, keyword matching, completion after `+`, new semantic-token types, a new diagnostic code.

## Completed when

- [ ] Formatter tests: a `model` mixin, an `enum` mixin and a `key = value` mixin; an inclusion between aligned fields; formatting the formatter's own output gives the same text.
- [ ] Symbol-table tests: a mixin is absent from all three records at the top level and in a namespace; a mixin sharing a name with a model raises no duplicate diagnostic; the interim diagnostic appears once per mixin declaration and once per named inclusion.
- [ ] Parser test: `id Int @default(+1)` produces no `MixinInclusion` node and the same diagnostic as on `main`.
- [ ] `pnpm typecheck`, `pnpm test:packages`, `pnpm lint:deps`, `pnpm fixtures:check` and `lint` for each touched package pass, apart from `prisma7-adoption#typecheck` and the three tarball-install tests. No fixture or snapshot changes.

## Halt conditions

- An existing formatter snapshot changes.
- A consumer outside `psl-parser` and `language-server` needs more than a compile fix.
