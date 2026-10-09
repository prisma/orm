# Brief: block-symbol-members D1 — symbol records and psl-parser consumers

## Task

In `packages/1-framework/2-authoring/psl-parser`, give `BlockSymbol` two new required fields, `entries: readonly KeyValuePairAst[]` and `attributes: readonly ResolvedAttribute<ModelAttributeAst>[]`, filled by `buildBlock` in `src/symbol-table.ts` in source order. Then change every production file in `psl-parser/src` other than `symbol-table.ts` that reads members from a symbol's syntax node (`symbol.node.entries()`, `.node.attributes()`, `.node.fields()`, `.node.members()`) to read the symbol's records instead. Behaviour must not change.

## Scope

**In:**

- `src/symbol-table.ts`: the `BlockSymbol` interface and `buildBlock`.
- The seven read sites in `psl-parser/src`: `binder.ts` (block entries, block attributes, and the `holder.node.attributes()` index pairing in `bindAttributes`, which should use each resolved attribute's own `node`), `block-spec/interpret.ts` (3), `enum-member-attributes.ts` (1).
- New tests in `test/symbol-table.test.ts`, written before the implementation: entries in source order; a map-mode block that repeats a key keeps both entries; enum members keep their `@` attributes; block `@@` attributes appear in `attributes`.
- Compile fixes in existing tests or test helpers that construct a `BlockSymbol` by hand.
- The package `README.md`, where it describes `BlockSymbol` or how consumers read block members.

**Out:**

- Every package other than `psl-parser`. They will not compile-break (the new fields are additive for readers) and are the next dispatch.
- Any mention of mixins in code, tests or the README.
- Existing test assertions: do not change any. Tests that read `.node` to locate a syntax node for an assertion stay as they are.
- `projects/**` (spec, plan, review files).

## Completed when

- [ ] `rg "\.node\.(fields|members|attributes|entries)\(\)" packages/1-framework/2-authoring/psl-parser/src` returns only lines in `symbol-table.ts` (or none).
- [ ] The new symbol-table tests pass, and no existing assertion in the package was edited.
- [ ] `pnpm --filter @internal/psl-parser typecheck`, `test` and `lint` pass, and `pnpm --filter @internal/psl-parser build` has been run so `dist/*.d.mts` carries the new fields.

## Standing instruction

Stay focused on the goal; control scope. Trivial-and-related fixes that obviously serve the goal go in the same dispatch with a one-line note in your wrap-up message. Anything that pulls you off the goal halts and surfaces.

## References

- Slice spec: `projects/psl-mixins/slices/block-symbol-members/spec.md`
- Slice plan: `projects/psl-mixins/slices/block-symbol-members/plan.md` § Dispatch 1
- Project spec (background only): `projects/psl-mixins/spec.md`
- `packages/1-framework/2-authoring/psl-parser/README.md`
- The `psl-ast-layers` skill, for how the syntax tree layers are meant to be used.

## Operational metadata

- **Model tier:** orchestrator. One judgment call (below) inside an otherwise mechanical change.
- **Time-box:** 60 minutes.
- **Halt conditions:**
  - `readResolvedAttributes` emits diagnostics or has another effect that makes resolving once in `buildBlock` differ from resolving at each read site, and the fix is not simply passing `buildBlock` the diagnostics sink `buildModel` already receives.
  - A read site cannot be moved by substitution without changing behaviour.
  - Any file outside `packages/1-framework/2-authoring/psl-parser` needs editing for the package's own gates to pass.
