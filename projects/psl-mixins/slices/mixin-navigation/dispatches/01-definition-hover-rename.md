# Brief: mixin-navigation D1 — definition, references, hover and rename

## Task

In `packages/1-framework/3-tooling/language-server`, make go-to-definition, find references, hover and rename treat a mixin as they treat a model, as the slice spec's feature table states row by row.

## Scope

**In:** `src/cursor-resolution.ts`, `src/hover.ts`, `src/rename.ts`, `src/attribute-spec-resolution.ts` (the field owner type and the `'field'` arm only), and tests.

**Out:** `src/semantic-tokens.ts` (dispatch 2); every completion and signature-help file; `psl-parser`.

## Completed when

- [ ] A test for each row of the feature table and each cursor position it lists, plus tests pinning the three positions that already work (`auth` in `+auth.Timestamps`, a field name in a mixin body, a mixed-in field named in an including model's attribute).
- [ ] Each row of the spec's edge-case table has a test.
- [ ] `pnpm --filter @internal/language-server typecheck`, `test` and `lint` pass.

## Halt conditions

- A row needs a change in `psl-parser`.
- Widening `FieldAttributeOwner` changes what completion or signature help returns for an existing test.
- An existing test's assertions need changing.
