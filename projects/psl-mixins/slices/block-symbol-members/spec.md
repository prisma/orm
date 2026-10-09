# Slice: block-symbol-members

Parent project `projects/psl-mixins/`. Outcome this slice contributes: one place decides which members a block has, so that a later slice can add a mixin's members there and every consumer sees them.

## At a glance

`BlockSymbol` gains ordered `entries` and `attributes` records, and every production consumer that reads a block's, model's, composite type's or field's members from `symbol.node` reads them from the symbol instead. No behaviour changes; no fixture changes.

## Chosen design

**Symbol shape.** `BlockSymbol` in `psl-parser/src/symbol-table.ts` gains two fields, filled by `buildBlock`:

```ts
export interface BlockSymbol {
  readonly kind: 'block';
  readonly name: string;
  readonly keyword: string;
  readonly node: GenericBlockDeclarationAst;
  readonly span: PslSpan;
  readonly entries: readonly KeyValuePairAst[];
  readonly attributes: readonly ResolvedAttribute<ModelAttributeAst>[];
}
```

- `entries` is a list in source order, not a record: a map-mode block may repeat a key (`interpret-extension-blocks.test.ts` covers `on`, `on`).
- Each entry stays a `KeyValuePairAst`, so consumers keep `key()`, `value()` and, for enum members, `attributes()`.
- `attributes` has the same type as `ModelSymbol.attributes`.

`ModelSymbol`, `CompositeTypeSymbol` and `FieldSymbol` already carry `fields` and `attributes`; their shape does not change.

**Consumers.** Each of these reads moves from the syntax node to the symbol:

| File | Today | After |
|---|---|---|
| `psl-parser/src/binder.ts` (2 sites in block binding) | `block.node.entries()`, `readResolvedAttributes(block.node.attributes(), …)` | `block.entries`, `block.attributes` |
| `psl-parser/src/binder.ts` (`bindAttributes`) | pairs `holder.node.attributes()` with the resolved list by index | reads each resolved attribute's own `node` |
| `psl-parser/src/block-spec/interpret.ts` (3 sites) | `block.node.entries()`, `block.node.attributes()` | `block.entries`, `block.attributes` |
| `psl-parser/src/enum-member-attributes.ts` | `enumBlock.node.entries()` | `enumBlock.entries` |
| `contract-psl/src/sql-attribute-specs.ts` | `block.node.entries()` | `block.entries` |
| `contract-psl/src/interpreter.ts` (2 sites) | `model.node.attributes()` | `model.attributes` |
| `contract-prisma7/src/interpreter.ts` (5 sites) | `block.node.entries()`, `block.node.attributes()` | `block.entries`, `block.attributes` |
| `contract-prisma6/src/interpreter.ts` (4 sites) | same | same |
| `language-server/src/rename.ts` (4 sites) | `model.node.attributes()`, `field.node.attributes()`, `block.node.attributes()` | the symbol's `attributes` |

That is 23 production sites, counted on `main` at `24258f35e7`.

## Coherence rationale

One rule applied everywhere: a consumer asks the symbol for members, never the syntax node. The diff is one small addition to the symbol table plus the same substitution at each call site, so a reviewer checks the addition once and then confirms each site is the same move.

## Scope

**In:**

- `BlockSymbol.entries` and `BlockSymbol.attributes`, with symbol-table tests for order, repeated keys, enum members with `@` attributes, and block attributes.
- The 23 call sites above.
- The `psl-parser` README where it describes `BlockSymbol` and how consumers read members.

**Out:**

- Any mixin grammar, mixin symbol or inclusion. Nothing in this slice mentions mixins in code.
- Test files that read `.node` to find a syntax node to assert on. The rule is about production consumers.
- Code that walks the syntax tree by position and has no symbol in hand: the language server's `completion-provider.ts`, `attribute-syntax-context.ts`, `semantic-tokens.ts`, `completion-values.ts`, and the formatter.
- `fieldTakesMap` in `rename.ts` finding a field's owner through `field.node.syntax.parent`. A mixed-in field's parent will be the mixin, which is the `mixin-editor-support` slice's concern.

## Pre-investigated edge cases

| Edge case | Disposition | Notes |
| --- | --- | --- |
| `readResolvedAttributes` reports diagnostics or does work that must not run twice | Check before moving the block sites | The binder and the interpreters each call it on `block.node.attributes()` today. If it is pure, resolving once in `buildBlock` is a straight move; if it emits diagnostics, `buildBlock` needs the same diagnostics sink `buildModel` uses. |
| `bindAttributes` relies on index alignment between the node list and the resolved list | Replace with `attribute.node` | `ResolvedAttribute` already carries `node`. |

## Slice-specific done conditions

- [ ] `rg "\.node\.(fields|members|attributes|entries)\(\)" packages -g '*.ts' --glob '!**/test/**' --glob '!**/dist/**'` returns no line outside `psl-parser/src/symbol-table.ts`.
- [ ] No fixture file changes: `pnpm fixtures:check` passes with a clean working tree.
- [ ] No existing test assertion is changed. Test edits are limited to compile fixes for the new required `BlockSymbol` fields and the new symbol-table tests.

## Open Questions

None.

## References

- Parent project: `projects/psl-mixins/spec.md` (cross-cutting requirement "Consumers read block members from symbols", and the first transitional-shape constraint)
- Linear issue: none yet; parent issue [TML-3055](https://linear.app/prisma-company/issue/TML-3055/psl-mixins-named-field-set-reuse-retire-field-presets-type-aliases-and)
- `packages/1-framework/2-authoring/psl-parser/README.md`
