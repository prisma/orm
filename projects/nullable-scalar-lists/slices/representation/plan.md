# Slice: representation — dispatch plan

**Spec:** [`spec.md`](./spec.md)

Three dispatches, stacked (each hands to the next). One persistent implementer.

## Dispatches

1. **`parser-element-axis`** — PSL parser + AST + symbol-table.
   - **Outcome:** `parseTypeAnnotation` accepts a `?` before `[]`; `TypeAnnotationAst` and `FieldSymbol` expose element optionality (leading `?`) separately from list/field optionality (trailing `?`); malformed combinations (`Foo??`) diagnose.
   - **Files in play:** `packages/1-framework/2-authoring/psl-parser/src/parse.ts`, `src/syntax/ast/type-annotation.ts`, `src/symbol-table.ts` (+ tests under `test/`).
   - **Completed when:** parser tests cover all six spellings + `Foo??` diagnostic; `pnpm --filter @prisma-next/psl-parser test` + typecheck green.
   - **Hands to:** the AST/symbol element-axis accessors.

2. **`contract-ir-marker`** — framework `ContractField.many` descriptor.
   - **Outcome:** `ContractField.many` is `false | { elementNullable: boolean }`; domain validation and canonicalization preserve the nested representation and reject legacy parallel shapes.
   - **Files in play:** `packages/1-framework/0-foundation/contract/src/domain-types.ts`, `src/validate-domain.ts`, `src/canonicalization.ts` (+ tests).
   - **Completed when:** unit tests for validator accept/reject + canonicalization omission; `pnpm --filter @prisma-next/contract test` + typecheck green; `pnpm fixtures:check` clean (existing fixtures byte-stable).
   - **Builds on:** dispatch 1 (conceptually; no code dependency — parser and IR type are independent, but sequence keeps one review coherent).
   - **Hands to:** the nested `many.elementNullable` IR descriptor the family slices populate.

3. **`printer-round-trip`** — PSL printer.
   - **Outcome:** the printer emits the exact spelling for all six forms; parse → print → identical source.
   - **Files in play:** `packages/1-framework/2-authoring/psl-printer/**` and/or the parser's `src/format/` (`emit.ts` `spaceBetween`) — implementer greps to locate the authoritative printer path.
   - **Completed when:** round-trip tests for all six spellings; `pnpm --filter @prisma-next/psl-printer test` + typecheck green.
   - **Builds on:** dispatch 1's AST accessors.

## ADR

The representation decision (a third nullability axis in the contract, extending ADR 178) is drafted as `projects/nullable-scalar-lists/design-decisions.md` during this slice and migrated to a numbered ADR at project close-out. Drafting is orchestrator-authored (within `projects/`), not a code dispatch.

## Validation gate (inherited by every dispatch)

`pnpm typecheck` (touched packages) + `pnpm --filter <pkg> test` for the touched package + `pnpm --filter <pkg> lint`. Dispatch 2 additionally runs `pnpm fixtures:check`.
