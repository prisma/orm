# Slice: representation — spec

**Project:** `projects/nullable-scalar-lists` (see [`../../spec.md`](../../spec.md), [`../../plan.md`](../../plan.md))
**Linear:** none (operator direction: no ticket)

## Chosen design

Introduce the **element nullability axis** at the two target-agnostic layers it must exist before any family can consume it:

1. **PSL parser** learns to parse a `?` between the type and `[]` (element-nullable), keeping the trailing `?` (list-nullable). The AST and the `FieldSymbol` expose the two axes separately.
2. **Framework contract IR** (`ContractField`) gains an optional `elementNullable` marker, its validator accepts it, and canonicalization omits it when false.
3. The parser's **token formatter** round-trips all four spellings verbatim. The semantic `@internal/psl-printer` / `PslField` surface is explicitly out of scope.

Actual population of `ContractField.elementNullable` from parsed PSL happens in the **family interpreter** slices (SQL, Mongo) — this slice makes the axis _representable and round-trippable_, not yet family-interpreted.

### Grammar

`parseTypeAnnotation` currently accepts `QualifiedName (argList)? ([])? (?)?`. It becomes:

```
QualifiedName (argList)? (?)? ([])? (?)?
```

- With `[]`: a `?` **before** `[]` ⇒ element-nullable; a `?` **after** `[]` ⇒ list-nullable. Both may be present (`Foo?[]?`).
- Without `[]`: a single `?` ⇒ field-nullable (existing `Foo?`); a leading `?` with no following `[]` is that same field-`?`. `Foo??` is invalid (diagnostic).

### AST + symbol

`TypeAnnotationAst` distinguishes the two `?` positions (a Question token before `LBracket` vs after `RBracket`). `FieldSymbol` keeps `optional` (the list/field axis — trailing `?`) and gains `elementOptional` (the element axis — leading `?`, meaningful only when `list`).

### Framework IR

`ContractField` gains `readonly elementNullable?: true` (present only when `many` and the element is nullable), mirroring the `many?: true` shape. Validator (`validate-domain.ts`) accepts it; `canonicalization.ts` omits it when absent/false so existing contract hashes are byte-stable.

## Slice Definition of Done

Beyond the inherited team-DoD floor and the project-DoD:

- [ ] All four spellings (`Foo`, `Foo?`, `Foo[]`, `Foo?[]`, `Foo[]?`, `Foo?[]?`) parse; the AST/`FieldSymbol` expose element vs list optionality distinctly; `Foo??` (and any other malformed `?`/`[]` combo) produces a clear diagnostic. Parser tests cover each.
- [ ] `ContractField` type carries `elementNullable?: true`; the domain validator accepts valid shapes and the canonicalizer omits it when false — proven by unit tests and `pnpm fixtures:check` (existing fixtures byte-stable).
- [x] The parser's token formatter round-trips all six spellings above verbatim, covered by formatter round-trip tests; the semantic printer remains unchanged.
- [x] The representation work is confined to the framework contract and parser/token-formatter surfaces; family interpreter, storage, typing, and enforcement changes are downstream.
- [ ] Validation gates green: `pnpm --filter @prisma-next/psl-parser test` + typecheck, `pnpm --filter @prisma-next/psl-printer test` + typecheck, `pnpm --filter @prisma-next/contract test` + typecheck, `pnpm fixtures:check`.

## Pre-investigated edge cases

- **`Foo?` with no brackets** must remain field-nullable (not element) — the leading-`?` interpretation only applies when `[]` follows.
- **`Foo??`** and **`Foo?[]??`** are malformed → diagnostic, not a silent parse.
- **Canonicalization hash stability**: `elementNullable` must be omitted when false so every existing `contract.json` fixture is unchanged (ADR 172 "always explicit" applies to `nullable`, not to this new optional marker — confirm the omission path matches `many`'s).
- **Whitespace/formatting** in the printer: `Foo?[]?` must not gain or lose spaces around `?`/`[]` (the `format/emit.ts` `spaceBetween` rules already handle `Question`/`LBracket`; verify they cover the leading `?`).
