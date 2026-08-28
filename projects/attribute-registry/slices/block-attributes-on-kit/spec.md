# Slice: block-attributes-on-kit

Parent project: `projects/attribute-registry/`. Outcome this slice contributes: block-level attributes (`@@type` on `enum`, `@@map` on postgres extension blocks) are declared on their block descriptors, parsed through the attribute-spec kit, and read by every consumer as plain data — the last hand-parsed attribute surface is gone.

## At a glance

The kit gains a block-level interpret ctx (no `selfModel`) and a `blockAttribute()` constructor; `AuthoringPslBlockDescriptor` gains `attributes`, a sibling of `parameters`; `reconstructExtensionBlock` runs the declared specs and attaches the parsed values to `PslExtensionBlock.attributes`; the three hand-parsing sites (`resolveEnumCodecId`, postgres policy `@@map`, postgres `native_enum` `@@map`) read the parsed values; unknown block-attribute names diagnose against the descriptor's `attributes` keys at symbol-table time, where the LSP already surfaces symbol-table diagnostics.

## Chosen design

Grounding note (per `drive/spec/README.md`): every path and line below was verified against `origin/main` at `af6042b5` on 2026-08-28; re-verify at dispatch time.

### 1. Block-level interpret ctx + ctx-generic kit — `@internal/psl-parser`

`src/attribute-spec/types.ts` today requires `selfModel` on `InterpretCtx` (`:20–27`), which an `enum` block cannot supply. The ctx splits into a base the block level can construct and the existing model/field ctx that extends it; the kit's types carry the ctx as a type parameter defaulting to today's shape so no existing call site changes:

```ts
export interface BlockInterpretCtx {
  readonly level: AttributeLevel;   // 'block' at the block level; the union already carries it (:9)
  readonly sourceId: string;
  readonly sourceFile: SourceFile;
}
export interface InterpretCtx extends BlockInterpretCtx {
  readonly selfModel: ModelSymbol;
  resolveReferencedModel(): ModelSymbol | undefined;
  readonly field?: FieldSymbol;
}
export interface ArgType<T, Ctx extends BlockInterpretCtx = InterpretCtx> {
  readonly kind: string;
  readonly label: string;
  readonly _out?: T;
  readonly parse: (arg: ExpressionAst, ctx: Ctx) => Result<T, readonly PslDiagnostic[]>;
}
export interface AttributeSpec<Out, Ctx extends BlockInterpretCtx = InterpretCtx> { … refine?: (parsed: Out, ctx: Ctx, attributeNode: AstNode) => … }
```

- `parse` becomes a property function type (today a method signature, `:16`), so the ctx parameter is checked contravariantly: an `ArgType<T, BlockInterpretCtx>` is usable in any spec, an `ArgType<T, InterpretCtx>` (`fieldRef`, `entityRef`, `funcCall`) is rejected inside a block spec. Pinned in a `*.test-d.ts`.
- Combinators that never read `selfModel` (`str`, `int`, `num`, `bool`, `json`, `identifier`, `oneOf`, `list`, `record`, `optional`; verified: only `field-ref.ts:26` reads `selfModel`/`resolveReferencedModel`, `diagnostic.ts` and `func-call.ts` read `sourceId`/`sourceFile`) return `ArgType<T, BlockInterpretCtx>`; `list`/`record`/`optional` forward their element's ctx type. `leafDiagnostic` takes `BlockInterpretCtx`.
- `interpretArgs` / `interpretAttribute` (`interpret.ts:27,128`) become generic over `Ctx`; behaviour byte-identical.
- New `src/attribute-spec/block-attribute.ts`: `blockAttribute(name, { positional?, named?, refine? })` mirrors `modelAttribute` (`model-attribute.ts`) with `level: 'block'` and `Ctx = BlockInterpretCtx`.
- `src/attribute-spec/spec-context.ts` gains the erased block factory contract, the block-level sibling of `ModelAttributeSpecFactory` (registry-core § Chosen design 1): `export type BlockAttributeSpecFactory = () => AttributeSpec<never, BlockInterpretCtx>`. Nullary: the descriptor a block factory hangs on is already the scoping fact (design-decisions § 8), and no shipped block attribute reads anything else. A parameter is added additively when a factory needs one; `() => X` stays assignable to `(ctx) => X`.
- Barrel `src/exports/index.ts` exports `blockAttribute`, `BlockInterpretCtx`, `BlockAttributeSpecFactory`.
- Combinators dispatch on syntax kind (`XAst.cast(arg.syntax)`), never on AST class identity (`arg instanceof XAst`). Amended at D4 (falsified assumption, I12): a family pack's spec and the parser can come from two module copies of `psl-parser` — `@internal/family-sql` had the package as a devDependency, so tsdown inlined a second copy into its dist, and `scripts/regen-example-migrations.mjs` deliberately pairs `src/` providers with the published `@prisma/orm-*` bundles (which carry `@prisma/orm-framework`'s copy). Under either, `instanceof` rejects every argument. Kind dispatch is copy-independent; `@internal/family-sql` moves `psl-parser` to `dependencies` so its dist externalises the package. Pinned by `test/attribute-spec-combinators.foreign-copy.test.ts`.

### 2. Descriptor + node substrate — `@internal/framework-components`

- `AuthoringPslBlockDescriptor` (`src/shared/framework-authoring.ts:432`) gains `readonly attributes?: Readonly<Record<string, unknown>>` — attribute name → erased `BlockAttributeSpecFactory`. Erased for the same reason as `AuthoringModelAttributeDescriptor.spec` and `AuthoringContributions.attributeSpecs`: `AttributeSpec` lives in `psl-parser`; core transits, `psl-parser` narrows. Absent means "this block declares no attributes" — every `@@` line is then unknown.
- `PslExtensionBlock` (`src/shared/psl-extension-block.ts:288`) gains `readonly attributes: Readonly<Record<string, PslExtensionBlockParsedAttribute>>` where `PslExtensionBlockParsedAttribute = { readonly args: Readonly<Record<string, unknown>>; readonly span: PslSpan }` — the kit's bound output keyed by parameter key, plus the attribute's span for consumers that anchor diagnostics. `blockAttributes` stays: it is the source-shaped record the printer round-trips (`psl-printer/src/serialize-print-document.ts:166`) and the `psl-infer` builders synthesise (`postgres/src/core/psl-infer/infer-enum-blocks.ts:87`, `infer-policy-blocks.ts:128`, `extensions/supabase/scripts/generate-contract.ts:240`); those builders populate `attributes` alongside it.
- `PslDiagnosticCode` gains `PSL_EXTENSION_UNKNOWN_BLOCK_ATTRIBUTE`.
- The descriptor well-formedness walker (`isWellFormedDescriptor` `:717`, `collectPslBlockDescriptorEntries` `:1157`) accepts the optional key; the `pslBlock` types test (`test/psl-block-descriptor.types.test.ts`) pins the shape.
- `resolveEnumCodecId` (`:328–364`) reads `block.attributes['type']`, narrowing `args['codecId']` with `typeof === 'string'` (core reads data; it cannot name the spec's output type). `codecSpan` becomes the attribute span — the one anchor the parsed record carries. The unquoted-argument branch (`PSL_ENUM_MISSING_TYPE` at `:355`) is now the kit's `PSL_INVALID_ATTRIBUTE_SYNTAX` at symbol-table time; the "no members" reuse of that code (`family-sql/src/core/authoring-entity-types.ts:123`, mongo `:123`) is untouched.

### 3. Kit parsing at reconstruction — `@internal/psl-parser`

`reconstructExtensionBlock` (`src/block-reconstruction.ts:20`) already has the descriptor, the `ModelAttributeAst` nodes (`GenericBlockDeclarationAst.attributes()`, `syntax/ast/declarations.ts:228`), and the `SourceFile`. For each `@@` line:

1. Name absent from `descriptor.attributes` (or descriptor has none) → push `PSL_EXTENSION_UNKNOWN_BLOCK_ATTRIBUTE` naming the keyword, block name, and attribute, anchored on the attribute; no entry in `attributes`.
2. Known → the single documented narrow in this slice turns the erased entry into `BlockAttributeSpecFactory` (same reason string family as `assemble.ts`), the factory runs, and `interpretAttribute(node, spec, { level: 'block', sourceId, sourceFile })` binds the args. Success → `attributes[name] = { args, span }`. Failure → the kit's `PslDiagnostic`s are converted to `ParseDiagnostic`s (`range` from the span's offsets via `sourceFile.positionAt`) and pushed. `ParseDiagnostic.code` (`src/parse.ts:12`) widens to `PslDiagnostic['code']` so a spec `refine` can carry a contributed code (postgres uses this for `@@map("")`); every mapper (`contract-psl/src/provider.ts:52`, mongo `provider.ts:28`, `language-server/src/diagnostic-mapping.ts:21`) already treats the code as an opaque string.
3. Duplicate `@@name` → first wins, later occurrences diagnose with the same unknown-attribute code family? No — a duplicate is `PSL_INVALID_EXTENSION_BLOCK_ATTRIBUTE` (existing code, "invalid syntax" on the second line), mirroring `PSL_EXTENSION_DUPLICATE_PARAMETER`'s first-wins rule.

Descriptor `undefined` (unknown keyword) → `attributes` is `{}`, no attribute diagnostics; the unknown keyword is diagnosed elsewhere. `sourceId` at reconstruction is the value `BuildSymbolTableOptions` carries or `'unknown'` — verify at dispatch which; the kit's span is what the range conversion uses, `sourceId` is dropped on the way to `ParseDiagnostic`.

### 4. Declarations + consumer migration — families and postgres

- SQL family `enum` descriptor (`family-sql/src/core/authoring-entity-types.ts:145`) and Mongo family `enum` descriptor (`family-mongo/…:145`) declare `attributes: { type: () => enumTypeSpec }` with `enumTypeSpec = blockAttribute('type', { positional: [{ key: 'codecId', type: str() }] })`. `@internal/family-sql` already depends on `@internal/psl-parser`; `@internal/family-mongo` gains the dependency (`pnpm install`, lockfile via pnpm).
- Postgres (`target-postgres/src/core/authoring.ts`): the five `policy_*` descriptors (`:542–607`) and `native_enum` (`:619`) declare `attributes: { map: … }`. Policy `@@map` keeps its non-empty rule as a `refine` emitting `PSL_POLICY_INVALID_MAP` anchored on the attribute; `native_enum` `@@map` is `str()` only, so `PSL_NATIVE_ENUM_INVALID_MAP` (`:56`) is removed — the arity/quoting failures it covered are the kit's `PSL_INVALID_ATTRIBUTE_SYNTAX` now. `lowerRlsPolicyFromBlock` (`:273`) and `lowerNativeEnumFromBlock` (`:331`) read `block.attributes['map']?.args['name']` with a `typeof === 'string'` narrow; `unwrapQuotedString` stays for parameter values.
- Tests adapt to the new stage: `@@map()` / `@@map(foo)` are symbol-table diagnostics (`psl-policy-map-authoring.test.ts:257–300`, `psl-native-enum-authoring.test.ts:349`), `@@map("")` is `PSL_POLICY_INVALID_MAP` at symbol-table time, and the family enum tests' synthetic blocks (`family-sql/test/authoring-entity-types.enum.test.ts:42`) carry `attributes`.
- Grep gate: `rg 'blockAttributes\.find' packages` → zero.

## Coherence rationale

One reviewable unit because the descriptor key, the node field, the reconstruction that fills it, and the three readers are one contract: shipping the kit + substrate without the readers leaves two parsers for the same attribute (the exact drift this project exists to remove), and shipping the readers without the reconstruction has nothing to read. Every commit inside the slice is a stable state (kit → substrate with empty `attributes` → reconstruction fills it → readers switch), which is what makes it one PR rather than one dispatch.

## Scope

**In:**
- `@internal/psl-parser`: ctx split, ctx-generic kit types, combinator return types, `blockAttribute`, `BlockAttributeSpecFactory`, reconstruction parsing + diagnostics, `ParseDiagnostic.code` widening, exports, tests (`test/attribute-spec*.test.ts`, `test/symbol-table.test.ts`, a `*.test-d.ts` ctx-variance pin).
- `@internal/framework-components`: descriptor `attributes`, node `attributes` + `PslExtensionBlockParsedAttribute`, diagnostic code, walker, `resolveEnumCodecId`, exports, tests.
- Every in-repo `PslExtensionBlock` literal gains `attributes` (psl-infer builders, supabase script, printer/framework/family tests).
- `@internal/family-sql`, `@internal/family-mongo`: enum descriptor `attributes`; mongo gains the psl-parser dependency.
- `@internal/target-postgres`: descriptor `attributes`, two `@@map` readers, tests.

**Out:**
- Field/model attribute registration and unknown-name diagnostics (slices `sql-attributes-registered`, `mongo-attributes-registered`).
- Block attributes entering `assembleAttributeSpecs` or `AuthoringContributions.attributeSpecs` — never (design-decisions § 8).
- LSP completion of block attributes (`completion-provider.ts:224` keeps reading `parameters` only) — Language Tools work on top of this slice.
- Printing from parsed values — the printer keeps round-tripping `blockAttributes`.
- Wiring `validateExtensionBlock` into a production path (it has no production caller today; not this slice's concern).

## Pre-investigated edge cases

| Edge case | Disposition | Notes |
| --------- | ----------- | ----- |
| `@@map` on a family `enum` block | Diagnoses as unknown | Grep of every `*.psl`/`*.prisma` under `packages`, `test`, `examples`: extension-ish blocks carry only `@@type` (32) and `@@map` (14, all on `native_enum`/`policy_*`); the one `enum … @@map` hit is a comment in `issues-28591-mapped-enums/_fixture/contract.prisma`. No fixture regresses. |
| `@@type` diagnostics move from interpretation to symbol-table stage | Accepted | Contract emission fails on either stage; the LSP shows both. Tests asserting the old stage move with it. |
| `codecSpan` anchor widens from the argument to the attribute | Accepted | The parsed record carries one span. Family enum tests use a zero span throughout. |
| Spec and parser from different `psl-parser` module copies | Fixed in-slice (D4) | Found by `pnpm fixtures:check`: three example migration regens emit `PSL_INVALID_ATTRIBUTE_SYNTAX` on every `@@type`. See § Chosen design 1, last bullet. |

## Slice-specific done conditions

- [ ] `rg 'blockAttributes\.find' packages test examples` returns zero hits (project-DoD grep gate).
- [ ] `pnpm fixtures:check` clean — no emitted contract changes (project transitional-shape constraint).
- [ ] Net-new `blindCast` in this slice ≤ 1 (the reconstruction narrow of the erased block factory).
- [ ] Unknown block-attribute names diagnose with `PSL_EXTENSION_UNKNOWN_BLOCK_ATTRIBUTE` through `buildSymbolTable` — the path the LSP pipeline (`language-server/src/pipeline.ts:33`) already runs.

## Contract impact

No contract entities, kinds, or emitted artifacts change (`fixtures:check`). Authoring SPI in `@internal/framework-components`: `AuthoringPslBlockDescriptor.attributes` added (optional); `PslExtensionBlock.attributes` added (required — every constructor of the node adapts); one new framework diagnostic code. `@internal/psl-parser` kit: `ArgType`/`AttributeSpec` gain a defaulted `Ctx` parameter; `ArgType.parse` becomes a property; `ParseDiagnostic.code` widens.

## Adapter impact

**postgres** only: six block descriptors declare `@@map`, two lowering sites read parsed values, one diagnostic code removed. sqlite/mongo target packs contribute no block descriptors.

## Open Questions

1. Should `native_enum` `@@map("")` also be rejected? Working position: no — keep today's behaviour (an empty type name was accepted before and is not this slice's rule to add); the policy refine is a migration of an existing rule, not a new one.

## References

- Parent project: [`projects/attribute-registry/spec.md`](../../spec.md) § Block-level attributes; [`design-decisions.md`](../../design-decisions.md) § 8.
- Sibling slice: [`../registry-core/spec.md`](../registry-core/spec.md) § Chosen design 1 (erased factory precedent, `Out = never` rationale).
- Linear: [TML-3230](https://linear.app/prisma-company/issue/TML-3230)
- ADRs: [ADR 231](../../../../docs/architecture%20docs/adrs/ADR%20231%20-%20Declarative%20attribute%20specifications.md)
