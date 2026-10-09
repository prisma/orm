# Brief: mixin-inclusion D1 — mixin symbols and inclusion replacement in the symbol table

## Task

In `packages/1-framework/2-authoring/psl-parser`, make `buildSymbolTable` produce `MixinSymbol`s and replace every inclusion with the mixin's members, as the slice spec's "Symbol table" section describes: the symbol shape, the `mixins` records, the second pass, the name lookup, and the diagnostics table. Remove the interim "Mixins are not supported yet" diagnostic and its tests.

## Scope

**In:** `src/symbol-table.ts`, `src/scope.ts` (or wherever the shared mixin-name lookup belongs), exports, and symbol-table tests.

**Out:**

- `src/binder.ts` behaviour. After this dispatch the binder still walks mixed-in members once per including block; that is dispatch 2. Make only the changes the binder needs to compile and to keep its existing tests passing, and report them.
- Interpreters, the language server's behaviour, the formatter, the parser.

## Operator decisions already made

- **Duplicate member, which one is reported:** whichever comes second, because that is what the existing duplicate check does and it needs the least change. If the inclusion comes second, the diagnostic is at the inclusion with the message in the spec's table. If the block's own member comes second, the existing `Duplicate declaration of "<name>"` diagnostic at that member is reported, unchanged.
- **The same mixin included twice in one block:** one diagnostic at the second inclusion, and the second inclusion contributes nothing.

## Completed when

- [ ] Symbol-table tests cover: `fields`, `entries` and `attributes` for a model, a composite type, an enum and a `key = value` block; the inclusion first, in the middle and last; a mixin in a namespace included by an unqualified name from the same namespace, by an unqualified name resolved at the top level, and by a qualified name; the mixin and the including block in two documents; mixed-in members being the identical objects held by the mixin symbol.
- [ ] Every row of the spec's diagnostics table has a test asserting code, message, file and range.
- [ ] `rg -i "not supported yet" packages/1-framework/2-authoring/psl-parser` finds nothing about mixins.
- [ ] `pnpm --filter @internal/psl-parser typecheck`, `test` and `lint` pass; the package is rebuilt.

## Halt conditions

- The mixin-name lookup cannot be shared with the binder's scope chain without the symbol table depending on something built after it. Report the dependency and the options.
- A spec row cannot be implemented as written.
- An existing test outside the interim-diagnostic tests needs its assertions changed.
