# Slice: sql-attributes-registered

Parent project: `projects/attribute-registry/`. Outcome this slice contributes: the SQL family's whole built-in attribute surface is registered once as a factory namespace, every SQL interpreter call site sources its spec from that namespace, and unknown-attribute diagnostics at both levels are derived from the namespace keys — completing the project-DoD LSP test in its final form (`@relation` named arguments enumerated from a resolved postgres project).

## At a glance

`@internal/sql-contract-psl` gains `sqlAttributeSpecs` (`as const satisfies AttributeSpecNamespace`) holding all eight model-level and six field-level built-ins as factories over the uniform ctx; `@internal/family-sql` registers it on `AuthoringContributions.attributeSpecs` (pack ref + control descriptor); the four interpreter files stop importing spec constants and read `sqlAttributeSpecs.<level>.<name>(ctx)` instead; the model- and field-level "unsupported attribute" diagnostics test membership in the namespace instead of a hand-maintained list / fall-through chain. The LSP-side tests (in-package and integration) extend to enumerate `@relation`'s named arguments through the assembled view.

## Chosen design

Grounding note (per `drive/spec/README.md`): every path and line below was verified against `origin/main` at `af6042b5` on 2026-08-28; re-verify at dispatch time.

### 1. The namespace — `@internal/sql-contract-psl`

`src/sql-attribute-specs.ts` (363 lines today) becomes the single home of the SQL family's spec values and exports **one** registry object plus the interpretation helpers; the individual spec constants stop being exported:

```ts
export const sqlAttributeSpecs = {
  model: {
    map: () => mapModelSpec,
    id: () => idModelSpec,
    unique: () => uniqueModelSpec,
    index: () => indexModelSpec,
    check: () => checkModelSpec,
    control: () => controlModelSpec,
    discriminator: () => discriminatorModelSpec,
    base: () => baseModelSpec,
  },
  field: {
    map: () => mapFieldSpec,
    id: () => idFieldSpec,
    unique: () => uniqueFieldSpec,
    noCheck: () => noCheckFieldSpec,
    relation: () => relationFieldSpec,
    default: (ctx) => buildDefaultSpec(ctx),
  },
} as const satisfies AttributeSpecNamespace;
```

- The set is exactly today's accepted surface: model `map | id | unique | index | check | control | discriminator | base` (the `if (modelAttribute.name === …)` chain in `interpreter.ts:840–1050,1646,1672` plus `buildModelMappings` in `psl-field-resolution.ts:730`) and field `id | unique | default | relation | map | noCheck` (`BUILTIN_FIELD_ATTRIBUTE_NAMES`, `psl-field-resolution.ts:166`).
- `sqlRelation` (`psl-relation-resolution.ts:102–139`, with its `relationInvariants` refine) moves into the namespace's module so the namespace never imports from a consumer; `SqlRelationOutput = InferAttr<typeof relationFieldSpec>` keeps being exported where `psl-relation-resolution.ts` needs it (import direction: relation-resolution → sql-attribute-specs, as today at `:30`).
- **`@default` is one factory over `FieldAttributeSpecContext`**, replacing the two hand-called builders `buildDefaultSpec({ isList, registry })` (`sql-attribute-specs.ts:170`) and `buildEnumDefaultSpec(memberNames)` (`:191`): when the field's declared type resolves to an `enum` block in the symbol table — `ctx.symbols.topLevel.blocks[ctx.field.typeName]` or, for a namespaced type, `ctx.symbols.topLevel.namespaces[ctx.field.typeNamespaceId].blocks[…]`, with `keyword === 'enum'` — the grammar is one `identifier(member)` arm per `Object.keys(block.block.parameters)` (enum members are the block's bare parameters — `family-sql/src/core/authoring-entity-types.ts:56`); otherwise it is today's literal/list/`funcCall` grammar built from `ctx.field.list` and `ctx.controlMutationDefaults`. A memberless enum yields a spec with no arms exactly as today's early return yields no lowering (see edge cases).
- Typing: because the object is `as const satisfies AttributeSpecNamespace`, `sqlAttributeSpecs.field.relation` keeps the literal factory type and `interpretFieldAttribute<Out>` infers `Out` from it — `InferAttr` typing at every call site is unchanged, and no cast is added (project cross-cutting requirement).
- New package export `@internal/sql-contract-psl/attribute-specs` (a new `src/exports/attribute-specs.ts`, wired in `package.json` `exports` like `./provider`) exposing `sqlAttributeSpecs` only. This is the surface `@internal/family-sql` registers.

### 2. Registration — `@internal/family-sql`

`@internal/sql-contract-psl` moves from `devDependencies` to `dependencies` in `packages/2-sql/9-family/package.json` (layering: `sql` layer order is `… → authoring → … → family`, so family → authoring is a legal direction; nothing in `sql-contract-psl`'s dependency closure names `family-sql` — verified against every `package.json` that lists it). Both places the family declares `authoring` gain the key:

- `src/exports/pack.ts:11` — `authoring: { …, attributeSpecs: sqlAttributeSpecs }`
- `src/core/control-descriptor.ts:17` — same object.

After this, `resolveConfigInputs` for any SQL project yields `assembleAttributeSpecs(contributions).field.relation` etc. with zero new plumbing — `config-resolution.ts` already threads the assembled contributions (registry-core D4/D5 proved the channel with `@@rls`).

### 3. Call-site rewiring — `@internal/sql-contract-psl`

Every `spec: <constant>` becomes `spec: sqlAttributeSpecs.<level>.<name>(ctx)` where `ctx` is built once per site from facts the site already holds or receives additively:

| Site | Facts already there | Threaded additively |
| --- | --- | --- |
| `interpreter.ts` model-attribute loop (`:865,903,949,983,1044`) and `:1646,1672` | `input.symbolTable`, `model`, `input.defaultFunctionRegistry` (`:637,632`) — the same three the contributed-attribute loop already passes at `:1085–1087` | — |
| `psl-field-resolution.ts` `extractFieldConstraintNames` (`:295,308`), `lowerNoCheckForField` (`:342`) | `model`, `field`, `defaultFunctionRegistry` (`CollectResolvedFieldsInput:150`) | `symbolTable` onto `CollectResolvedFieldsInput`, from `interpreter.ts:697` |
| `psl-field-resolution.ts` `buildModelMappings` (`:730,744`) | `model`, `field` | `symbolTable` + `defaultFunctionRegistry` as parameters; the caller in `interpretPslDocumentToSqlContract` holds both (`interpreter.ts:2103,2420`) |
| `psl-column-resolution.ts` `lowerDefaultForField` (`:712`) and `psl-field-resolution.ts` `lowerEnumDefaultForField` (`:67`) | `model`, `field`, `defaultFunctionRegistry` | `symbolTable` on both inputs (they are called from `collectResolvedFields`, which gets it above) |
| `psl-relation-resolution.ts` `interpretRelationAttribute` (`:166`) | `symbols`, `selfModel`, `field` | `controlMutationDefaults` on its input; the three callers (`interpreter.ts:771,1201,1358`) hold `input.defaultFunctionRegistry` |

Two helpers in `sql-attribute-specs.ts` remove the repetition: `modelSpecContext({ symbols, model, controlMutationDefaults })` and `fieldSpecContext({ …, field })` returning the ctx interfaces — plain object construction, no logic.

The enum/scalar split in `collectResolvedFields` (`psl-field-resolution.ts:578–600`) stays as the *lowering* decision (`enumHandle` present → `lowerEnumDefaultForField`, else `lowerDefaultForField`); both lowering functions obtain their spec from the one `default` factory. `buildDefaultSpec` / `buildEnumDefaultSpec` as separately exported builders are removed.

### 4. Registry-driven unknown-attribute diagnostics

- **Field level** — `BUILTIN_FIELD_ATTRIBUTE_NAMES` (`psl-field-resolution.ts:166–173`) is deleted; the check at `:229` becomes `Object.hasOwn(sqlAttributeSpecs.field, attribute.name)`. Message, code (`PSL_UNSUPPORTED_FIELD_ATTRIBUTE`), `db.`-prefix migration hint, uncomposed-namespace routing, and `REMOVED_ATTRIBUTE_RULES` hints are untouched.
- **Model level** — the loop in `interpreter.ts:838` gains one guard before the dispatch chain: a name that is neither `Object.hasOwn(sqlAttributeSpecs.model, name)` nor in `input.modelAttributesByName` (ADR 236 contributions) takes the existing uncomposed-namespace / `PSL_UNSUPPORTED_MODEL_ATTRIBUTE` tail (`:1128–1150`) immediately. The per-name `if` chain remains the lowering dispatch and is unchanged in behaviour; the fall-through diagnostic at `:1145` becomes unreachable for registered names and is kept only as the tail of that guard (one code path, not two).
- Emitted diagnostics for every existing fixture are byte-identical: the registered sets equal today's accepted sets (design § 1), so this is a source-of-truth swap, not a behaviour change. The transitional-shape constraint ("diagnostics land only after the full set is registered") is satisfied inside one dispatch ordering: namespace + registration + rewiring first, diagnostics after.

### 5. Wrong-level registration guard (project open item, decided here)

A model factory is assignable where a field factory is expected (contravariant ctx widening — pinned intentional in registry-core), so the type system cannot catch a spec registered under the wrong subkey. Decision: a **behavioural test in `@internal/sql-contract-psl`** iterates `sqlAttributeSpecs.model` and `.field`, invokes each factory with a fixture ctx, and asserts `spec.level === <subkey>` and `spec.name === <key>` (both are runtime fields on `AttributeSpec`, `psl-parser/src/attribute-spec/types.ts:44–46`). No production guard: the namespace is a module constant, so the test is the complete check.

### 6. LSP-side proof, final form

- `packages/1-framework/3-tooling/language-server/test/attribute-spec-consumability.test.ts` — the synthetic-pack test stays (Domain 1 cannot name Domain 3 packs); it additionally registers a synthetic `attributeSpecs` namespace on its demo family and asserts a field-level factory is enumerated and invocable through `resolveConfigInputs` → `assembleAttributeSpecs`. This is the machinery half.
- `test/integration/test/authoring/attribute-specs.lsp-consumability.test.ts` — extended with the real-pack half: `assembleAttributeSpecs(contributions).field['relation']` invoked with a ctx built from a parsed `model Widget { … }` yields a spec whose `named` keys equal `['fields', 'index', 'map', 'name', 'onDelete', 'onUpdate', 'references']` (sorted), plus `'default' in specs.field` and the full model key set. This test goes red if `@internal/family-sql` stops registering the namespace or the namespace loses `relation` — the ¬P for the project-DoD item.

## Coherence rationale

The namespace, its registration, the call-site rewiring, and the key-driven diagnostics are one change to one fact — "what attributes does the SQL family accept" — and the project's grep gate ("no spec constant imported at a call site without being registered") is only true when all four land together: a namespace nobody consumes, or consumers reading constants that are also registered, would each leave two sources of truth in the tree. One reviewer holds it: one package defines, one registers, one test proves.

## Scope

**In:**
- `@internal/sql-contract-psl`: `src/sql-attribute-specs.ts` (namespace, `default` factory, relation spec moved in, ctx helpers, constants un-exported), `src/exports/attribute-specs.ts` + `package.json` export, `interpreter.ts`, `psl-field-resolution.ts`, `psl-column-resolution.ts`, `psl-relation-resolution.ts` (rewire + additive ctx threading), tests (namespace/level guard, unknown-attribute diagnostics at both levels, existing interpreter tests adapt to new input keys).
- `@internal/family-sql`: `package.json` dependency move, `src/exports/pack.ts`, `src/core/control-descriptor.ts`.
- `@internal/language-server` `test/` and `test/integration/test/authoring/` — test extensions only.

**Out:**
- Mongo family (slice `mongo-attributes-registered`).
- Block-level attributes (slice `block-attributes-on-kit`).
- Target-contributed field attributes (project non-goal).
- Any LSP production change (`pipelineInputsFromStack`, completion) — project non-goal.
- Exporting `resolveConfigInputs` from `@internal/language-server` (open item from registry-core) — **decided: not in this slice.** The integration test already deep-imports it and this slice adds no new import site; the export becomes worthwhile only if a third consumer appears.
- The `?? new Map()` mutation-default fallback at `interpreter.ts:2103–2104` (open item from registry-core) — **decided: unchanged.** `buildDefaultSpec` already receives that same fallback registry today (`psl-column-resolution.ts:714`), so the factory form changes nothing about when an empty registry reaches a spec; a hard error would break every test caller that omits `controlMutationDefaults` for no behavioural gain. Revisit only if a consumer other than `@default` starts depending on the registry.

## Pre-investigated edge cases

| Edge case | Disposition | Notes |
| --- | --- | --- |
| Field typed as an enum whose declaration failed to lower (no `EnumTypeHandle`) but whose block is in the symbol table | The `default` factory follows the declaration (enum grammar); `lowerDefaultForField` (scalar branch) still runs because no handle exists. Implementer picks the branch by the factory's output shape only if a fixture shows a difference; otherwise keep the existing branch selection and let the existing declaration diagnostic stand. | Today the scalar grammar runs on such a field and can emit a second, spurious syntax diagnostic on `@default(MEMBER)`; either outcome is acceptable for an already-diagnosed declaration. `fixtures:check` decides. |
| Memberless enum (`enum Role {}`) with `@default` | Factory yields a spec whose value arm is empty; `lowerEnumDefaultForField` keeps its early return before interpretation (`psl-field-resolution.ts:65`). | Preserves today's "declaration already errored, skip" behaviour. |
| Namespaced enum type (`ns.Role`) | Factory resolves the block through `topLevel.namespaces[field.typeNamespaceId].blocks`. | `FieldSymbol.typeNamespaceId` exists for this (`symbol-table.ts:104`). |

## Slice-specific done conditions

- [ ] Grep gate: `rg "ModelSpec\b|FieldSpec\b|buildDefaultSpec|buildEnumDefaultSpec" packages/2-sql/2-authoring/contract-psl/src --glob '!sql-attribute-specs.ts'` returns zero hits; the only spec reachable from a consumer is via `sqlAttributeSpecs`.
- [ ] The integration LSP test enumerates `@relation`'s named arguments from a resolved postgres project (project-DoD item, final form).
- [ ] `pnpm fixtures:check` clean (project transitional-shape constraint).
- [ ] Net-new `blindCast` in this slice = 0.

## Contract impact

None on contract entities or emitted artifacts. Authoring SPI: `@internal/sql-contract-psl` gains the `./attribute-specs` export; `@internal/family-sql`'s pack ref and control descriptor gain `authoring.attributeSpecs`. `InterpretPslDocumentToSqlContractInput` is unchanged (all threading is internal to the package).

## Adapter impact

None. postgres/sqlite target packs declare no field attributes and their `@@rls` descriptor is untouched; the assembler already merges `modelAttributes` with the family namespace and errors on a name collision — no SQL built-in name collides with `rls`.

## Open Questions

1. Should the model-level guard (design § 4) replace the `if` chain's fall-through diagnostic outright rather than sit before it? Working position: the guard is the single exit for unknown names; the fall-through stays as the tail of the same guard so there is exactly one diagnostic site. Implementer may collapse them if the chain reads better; behaviour is identical.

## References

- Parent project: [`projects/attribute-registry/spec.md`](../../spec.md) — § The factory context, § Cross-cutting requirements, § Transitional-shape constraints; [`design-decisions.md`](../../design-decisions.md) — decisions 1, 2, 4, 6, 7, 9; [`plan.md`](../../plan.md) — parallel group A + open items addressed above.
- Predecessor slice: [`slices/registry-core/spec.md`](../registry-core/spec.md) (merged in PR #30154).
- Linear: [TML-3228](https://linear.app/prisma-company/issue/TML-3228)
- ADRs: [ADR 231](../../../../docs/architecture%20docs/adrs/ADR%20231%20-%20Declarative%20attribute%20specifications.md), [ADR 236](../../../../docs/architecture%20docs/adrs/ADR%20236%20-%20Target-contributed%20model%20attributes.md)
