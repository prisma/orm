# block-attributes-on-kit — Dispatch plan

**Spec:** [`./spec.md`](./spec.md) · **Linear:** [TML-3230](https://linear.app/prisma-company/issue/TML-3230)

Sequence: kit (psl-parser) → node/descriptor substrate with every constructor adapted (core + fan-out) → reconstruction fills the substrate (psl-parser) → declarations + readers switch (families + postgres). Sandwich-shaped; each hand-off is a state the workspace typechecks and tests green in.

## Dispatch plan

### Dispatch 1: block-level-kit

- **Outcome:** `@internal/psl-parser` ships `BlockInterpretCtx`, ctx-generic `ArgType` / `AttributeSpec` / `PositionalParam` / `Param` (defaulting to `InterpretCtx`; `parse` a property function type), ctx-generic `interpretArgs` / `interpretAttribute`, `leafDiagnostic` over the base ctx, model-free combinators returning `ArgType<T, BlockInterpretCtx>`, `blockAttribute()`, and `BlockAttributeSpecFactory` — all exported; a `*.test-d.ts` pins that a `fieldRef` param is rejected inside `blockAttribute` and that a block spec is accepted where an `AttributeSpec<Out>` is expected; a behavioural test interprets a `ModelAttributeAst` through a block spec with a ctx that has no `selfModel`. Every existing psl-parser, contract-psl (sql + mongo) and postgres consumer of the kit typechecks unchanged — such that *the kit's ctx requirement is expressed in types (a spec cannot demand a model it will never receive) rather than at runtime*.
- **Builds on:** spec § Chosen design 1.
- **Hands to:** the block-level spec vocabulary the descriptors (D4) type against and the reconstruction (D3) runs.
- **Focus:** `packages/1-framework/2-authoring/psl-parser` only (`src/attribute-spec/**`, `src/exports/index.ts`, `test/`). No descriptor, node, or consumer changes.
- **Gates:** `cd packages/1-framework/2-authoring/psl-parser && pnpm typecheck` (incl. test project) · `pnpm --filter @internal/psl-parser lint` · `pnpm --filter @internal/psl-parser test` · workspace `pnpm typecheck` (kit consumers) · grep: `rg 'selfModel' packages/1-framework/2-authoring/psl-parser/src/attribute-spec/combinators` still names only `field-ref.ts`.

### Dispatch 2: block-attribute-substrate

- **Outcome:** `AuthoringPslBlockDescriptor.attributes?` (erased), `PslExtensionBlock.attributes` (required) + `PslExtensionBlockParsedAttribute`, and `PSL_EXTENSION_UNKNOWN_BLOCK_ATTRIBUTE` exist in `@internal/framework-components` and are exported; the descriptor walker accepts the key; `reconstructExtensionBlock` sets `attributes: {}`; every in-repo `PslExtensionBlock` literal (psl-infer builders, supabase script, printer/framework/family/validator tests) carries `attributes` — such that *the node is total: a consumer reads `block.attributes` without an existence check, and nothing but the generic machinery can produce a block node lacking it*. `resolveEnumCodecId` is untouched here.
- **Builds on:** none in-slice (core substrate); D1 only for the vocabulary the doc contract names.
- **Hands to:** a workspace where `attributes` is present (empty) on every block node — the surface D3 fills and D4 reads.
- **Focus:** `@internal/framework-components` (`src/shared/psl-extension-block.ts`, `src/shared/framework-authoring.ts`, exports, tests) + the mechanical fan-out to node constructors across packages. Mechanical-fan-out shape: one transformation (`attributes: {}` or the synthesised `map` entry beside the existing `blockAttributes` entry), no judgment.
- **Gates:** `pnpm build` of `framework-components` then workspace `pnpm typecheck` · `pnpm --filter @internal/framework-components lint && test` · `pnpm --filter @internal/target-postgres test` (psl-infer print tests) · `pnpm lint:deps` · grep: `rg -n 'blockAttributes:' packages --type ts` count equals `rg -n 'attributes:' … ` count at the same sites (every constructor adapted).

### Dispatch 3: reconstruct-parses-block-attributes

- **Outcome:** `reconstructExtensionBlock` runs the descriptor's block-attribute factories through `interpretAttribute` with a `BlockInterpretCtx`, fills `attributes`, converts kit diagnostics to `ParseDiagnostic`s (code widened to `PslDiagnostic['code']`), diagnoses unknown names with `PSL_EXTENSION_UNKNOWN_BLOCK_ATTRIBUTE` and duplicates first-wins with `PSL_INVALID_EXTENSION_BLOCK_ATTRIBUTE`; the one new `blindCast` narrows the erased factory. Tests (`symbol-table.test.ts` or a sibling file) cover: parsed value + span, unknown name, duplicate, arity/type failure surfacing as a symbol-table diagnostic, descriptor without `attributes`, descriptor `undefined` — such that *the LSP pipeline and the build see identical block-attribute diagnostics because both run `buildSymbolTable`*.
- **Builds on:** D1's kit + D2's substrate.
- **Hands to:** symbol tables whose block nodes carry parsed attributes for every declared attribute; nothing declares any yet, so every `@@` line diagnoses as unknown until D4 lands (D3 and D4 must merge together — D3 is not a shippable stop; the slice PR is the unit).
- **Focus:** `@internal/psl-parser` (`src/block-reconstruction.ts`, `src/parse.ts` code type, `src/symbol-table.ts` if `sourceId` must thread, tests). No consumer changes.
- **Gates:** psl-parser typecheck/lint/test · workspace `pnpm typecheck` (`ParseDiagnostic.code` widening) · `pnpm --filter @internal/language-server test` · grep: `rg 'blindCast' packages/1-framework/2-authoring/psl-parser/src` count = base + 1.

### Dispatch 4: declare-and-read

- **Outcome:** SQL and Mongo family `enum` descriptors declare `@@type`; postgres `policy_*` and `native_enum` descriptors declare `@@map` (policy with the non-empty `refine` → `PSL_POLICY_INVALID_MAP`); `resolveEnumCodecId`, `lowerRlsPolicyFromBlock`, `lowerNativeEnumFromBlock` read `block.attributes`; `PSL_NATIVE_ENUM_INVALID_MAP` removed; `@internal/family-mongo` depends on `@internal/psl-parser`; tests moved to the symbol-table stage; `rg 'blockAttributes\.find' packages test examples` → 0; `pnpm fixtures:check` clean — such that *every block attribute has exactly one parser (the kit) and consumers read data, never source text*.
- **Builds on:** D3's filled `attributes`; D1's `blockAttribute`/`str`.
- **Hands to:** slice DoD (all four slice-specific conditions).
- **Added in flight (D4 R1):** the kit's combinators switch from `instanceof` to `XAst.cast(arg.syntax)` and `@internal/family-sql` moves `psl-parser` from devDependencies to dependencies — `fixtures:check` exposed two-copy module resolution (see spec § Pre-investigated edge cases). Own commit; regression test `attribute-spec-combinators.foreign-copy.test.ts`.
- **Focus:** `family-sql`, `family-mongo` (`src/core/authoring-entity-types.ts`, `package.json`), `framework-components` `resolveEnumCodecId`, `target-postgres` `src/core/authoring.ts` + `test/psl-policy-map-authoring.test.ts` + `test/psl-native-enum-authoring.test.ts` + enum tests. Postgres edits stay inside the two `@@map` sites and the descriptor literals (slice A runs concurrently on `authoring.ts`'s `@@rls` region).
- **Gates:** `pnpm typecheck` · lint for the four touched packages · `pnpm --filter @internal/family-sql test`, `@internal/family-mongo`, `@internal/target-postgres`, `@internal/sql-contract-psl`, `@internal/mongo-contract-psl` · `pnpm lint:deps` · `pnpm fixtures:check` · the grep gate.

## Handoff-contract checks

- **Linearity:** D1 → D3 (kit), D2 → D3 (substrate), D3 → D4. D2 does not build on D1 (independent core change) — the two could land in either order; D4 reads both.
- **Completeness:** slice-DoD ← D4 (grep gate, fixtures, diagnostics through `buildSymbolTable`), D3 (the single narrow), D2/D1 (substrate + kit). Cast budget verified slice-wide at close.

## Calibration references (thread into briefs)

Failure modes ([`drive/calibration/failure-modes.md`](../../../../drive/calibration/failure-modes.md)):

- **F5** — destructive git operations forbidden.
- **F3** — broken consumers of the required `attributes` field and of `ArgType.parse` discovered by `rg`, not by repeated test runs.
- **F11** — placement pinned: kit + reconstruction in `psl-parser`; descriptor/node/diagnostic-code in `framework-components`; specs declared where the descriptors live.
- **F16/F17** — property statements in every outcome above; a self-acknowledged layering comment is a HALT. Core never imports `psl-parser`; the block factory is erased in core and narrowed once.
- **F13/F15** — D3's tests must go red if reconstruction stops running the factories or stops diagnosing unknown names; D4's migrated tests must fail if the kit-parsed value is bypassed.
- **F14** — gates mirror CI (lint per package; typecheck covers `test/`); sync `origin/main` before slice-close validation and push.
- **F24/F25** — build `framework-components` before trusting downstream red.
- **F26** — any reviewer finding on a constructor site or a narrow is a class; sweep the diff.

Grep-library ([`drive/calibration/grep-library.md`](../../../../drive/calibration/grep-library.md)): cross-cutting anti-patterns (file-extension imports, `: any`, `@ts-expect-error` outside `*.test-d.ts`); transient project refs in long-lived files; slice-specific `blockAttributes\.find` gate and the `blindCast` budget.

## Open items

- **For D3:** decide whether `BuildSymbolTableOptions` needs a `sourceId` for the block ctx or whether reconstruction uses a fixed placeholder — the kit's `sourceId` never reaches a `ParseDiagnostic` (range-only), so a placeholder is acceptable if no option exists.
- **For D4 / slice A coordination:** both slices edit `target-postgres/src/core/authoring.ts`; this slice touches only the six descriptor literals and the two `@@map` sites. If A merges first, rebase before slice-close validation.
