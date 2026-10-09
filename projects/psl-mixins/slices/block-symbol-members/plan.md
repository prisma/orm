# Slice plan: block-symbol-members

**Spec:** `projects/psl-mixins/slices/block-symbol-members/spec.md`

## Dispatch plan

### Dispatch 1: symbol records and psl-parser consumers

- **Outcome:** `BlockSymbol` carries `entries` and `attributes`, filled by `buildBlock`, and no production file in `psl-parser/src` other than `symbol-table.ts` reads members from `symbol.node`. `pnpm --filter @internal/psl-parser test`, typecheck and lint pass, and `@internal/psl-parser` is rebuilt so downstream packages see the new type.
- **Builds on:** The spec's chosen design.
- **Hands to:** The exported `BlockSymbol` shape with the two records, covered by symbol-table tests for source order, repeated keys, enum members with `@` attributes, and block attributes.
- **Focus:**
  - tests first, in `psl-parser/test/symbol-table.test.ts`;
  - `buildBlock`, after checking whether `readResolvedAttributes` emits diagnostics (spec edge case 1);
  - the seven `psl-parser/src` sites: `binder.ts` (3, including the index pairing in `bindAttributes`), `block-spec/interpret.ts` (3), `enum-member-attributes.ts` (1);
  - compile fixes in tests that construct a `BlockSymbol` by hand;
  - the `psl-parser` README.

  Other packages are dispatch 2.

### Dispatch 2: consumers outside psl-parser

- **Outcome:** The spec's grep gate returns no line outside `psl-parser/src/symbol-table.ts`, and `pnpm typecheck`, `pnpm test:packages`, `pnpm lint:deps` and `pnpm fixtures:check` pass with no fixture file changed.
- **Builds on:** Dispatch 1's `BlockSymbol` shape.
- **Hands to:** Slice done conditions met; the branch is ready for the PR.
- **Focus:**
  - the same substitution at 16 sites: `contract-psl` (`interpreter.ts` 2, `sql-attribute-specs.ts` 1), `contract-prisma7/src/interpreter.ts` (5), `contract-prisma6/src/interpreter.ts` (4), `language-server/src/rename.ts` (4);
  - per-package lint for each touched package;
  - an upgrade-instructions fragment with `changes: []` if the upgrade-coverage check asks for one.

  No assertion in an existing test changes. A site that cannot be moved by the same substitution is reported, not redesigned.
