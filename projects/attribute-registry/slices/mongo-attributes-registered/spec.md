# Slice: mongo-attributes-registered

Parent project: `projects/attribute-registry/`. Outcome this slice contributes: the Mongo family's full built-in attribute surface is registered as one factory namespace, every Mongo interpreter call site sources its spec from that namespace, and unknown attribute names diagnose at model and field level — closing the project-DoD items "Mongo spec gaps closed", "Mongo enumeration", and "Mongo unknown-name diagnostics".

## At a glance

Mongo's field-level `@id` and `@unique` gain declarative specs (today: presence-only `getAttribute` checks). All Mongo built-ins — `@@map`, `@@discriminator`, `@@base`, `@@index`, `@@unique`, `@@textIndex`, `@id`, `@unique`, `@map`, `@relation` — are collected into `mongoAttributeSpecs`, a `const` namespace `satisfies AttributeSpecNamespace` whose per-model index specs are factories over the uniform ctx (field names read from `ctx.model.fields`). The Mongo family descriptor and pack register the namespace under `authoring.attributeSpecs`, so `assembleAttributeSpecs` enumerates it. Finally the interpreter reports `PSL_UNSUPPORTED_MODEL_ATTRIBUTE` / `PSL_UNSUPPORTED_FIELD_ATTRIBUTE` for any attribute name the namespace does not carry — new behavior; Mongo silently ignores unknown attributes today.

## Chosen design

Grounding note (per `drive/spec/README.md`): snippets below were verified against shipped code on 2026-08-28 (post `registry-core`, PR #30154); re-verify at dispatch time.

### 1. The namespace — `@internal/mongo-contract-psl`, `src/mongo-attribute-specs.ts`

```ts
export const idFieldSpec = fieldAttribute('id', {});
export const uniqueFieldSpec = fieldAttribute('unique', {});

export const mongoAttributeSpecs = {
  model: {
    map: () => mapModelSpec,
    discriminator: () => discriminatorModelSpec,
    base: () => baseModelSpec,
    index: (ctx) => buildIndexModelSpec('index', indexFieldElement(Object.keys(ctx.model.fields))),
    unique: (ctx) => buildIndexModelSpec('unique', indexFieldElement(Object.keys(ctx.model.fields))),
    textIndex: (ctx) => buildTextIndexModelSpec(indexFieldElement(Object.keys(ctx.model.fields))),
  },
  field: {
    id: () => idFieldSpec,
    unique: () => uniqueFieldSpec,
    map: () => mapFieldSpec,
    relation: () => relationFieldSpec,
  },
} as const satisfies AttributeSpecNamespace;
```

- Static specs stay module constants (identity-stable) behind nullary factories; the three index specs become per-model factories replacing `buildIndexModelSpecs(fieldNames)`. `InferAttr<ReturnType<typeof mongoAttributeSpecs.model.index>>` keeps the interpreter's `NormalIndexArgs` / `TextIndexArgs` typing intact — no cast.
- `@id` and `@unique` are nullary specs (`fieldAttribute(name, {})`): an argument on either now yields `PSL_INVALID_ATTRIBUTE_SYNTAX` where today it is ignored.
- The namespace is exported from the package barrel so the family package can register it.
- **Wrong-level registration guard (project open item):** a model factory is assignable where a field factory is expected (contravariant ctx widening, pinned intentional in `registry-core`). Mongo guards behaviourally: a test invokes every `mongoAttributeSpecs.field` factory and asserts `spec.level === 'field'`, and every `mongoAttributeSpecs.model` factory asserting `spec.level === 'model'`. That is the whole guard — no runtime check in the assembler.

### 2. Interpreter call sites source from the namespace

`packages/2-mongo-family/2-authoring/contract-psl/src/interpreter.ts`:

- `collectIndexes` (`:807`) builds one `AttributeSpecContext` per model and calls `mongoAttributeSpecs.model.index(ctx)` / `.unique(ctx)` / `.textIndex(ctx)` in place of `buildIndexModelSpecs(Object.keys(pslModel.fields))`.
- `@@map` (`:175`), `@@discriminator` (`:224`), `@@base` (`:253`), `@map` (`:150`), `@relation` (`:1101`) invoke the corresponding factory instead of importing the spec constant.
- Field-level `@id` (`:1172`) and `@unique` (`:826`) are interpreted through `interpretFieldAttribute` against `mongoAttributeSpecs.field.id(ctx)` / `.unique(ctx)`; presence is "node found and parsed", so `@id("x")` diagnoses rather than counting as an id.
- `InterpretPslDocumentToMongoContractInput` gains **required** `controlMutationDefaults: ControlMutationDefaultRegistry`; `provider.ts` passes `context.controlMutationDefaults.defaultFunctionRegistry`. **Project open item resolved for Mongo:** there is no `?? new Map()` fallback — an omitted registry is a type error at the call site, not a silently empty registry. No Mongo factory consults it today; the ctx contract is uniform regardless.
- `getAttribute` (`psl-helpers.ts`) remains only for `@@base` presence (`:1170`) and the polymorphism `@map` check (`:390`), both of which read attributes the namespace also registers; no spec constant is imported at a call site without being registered (project grep gate).

### 3. Registration — `@internal/family-mongo`

`src/core/control-descriptor.ts` and `src/exports/pack.ts` add `attributeSpecs: mongoAttributeSpecs` to their `authoring` slot. `@internal/family-mongo` gains a production dependency on `@internal/mongo-contract-psl` (today devDependency-only). Layering: `layerOrder.mongo` places `family` above `authoring`, so the edge is legal; `pnpm lint:deps` is a slice gate. `mongo-contract-psl` does not depend on `family-mongo` — no cycle.

Enumeration proof: a `family-mongo` test assembles `assembleAttributeSpecs(assembleAuthoringContributions([mongoFamilyDescriptor]))` and asserts the exact key sets at both levels; an integration test next to `attribute-specs.lsp-consumability.test.ts` resolves a Mongo project (`@internal/mongo/config`) through `resolveConfigInputs` and enumerates a Mongo built-in from the LSP-side assembled view.

### 4. Unknown-attribute diagnostics (lands last — transitional-shape constraint)

After every built-in is registered, the interpreter reports:

- model level: each `pslModel.attributes` entry whose name is not an own key of `mongoAttributeSpecs.model` → `PSL_UNSUPPORTED_MODEL_ATTRIBUTE`, `Model "X" uses unsupported attribute "@@y"`, span = attribute span (message shape mirrors the SQL interpreter at `interpreter.ts:1147`).
- field level: each attribute on a model field or composite-type field whose name is not an own key of `mongoAttributeSpecs.field` → `PSL_UNSUPPORTED_FIELD_ATTRIBUTE`, `Field "X.y" uses unsupported attribute "@z"`.
- Dotted names (`@db.ObjectId`, `@pg.type`) resolve to a single dotted `name` (`resolve.ts:85`) and therefore diagnose as unsupported; Mongo has no composed-extension attribute namespaces, so no uncomposed-namespace hint exists to give.
- The check consults the family's own `const` namespace, not the assembled view: the assembled view would only add target-contributed model attributes, and the Mongo interpreter has no ADR-236 lowering loop, so accepting such a name would parse and never lower. When Mongo grows that loop, this check moves to `assembleAttributeSpecs(...)` keys in the same change.

Both diagnostics are already members of the shared diagnostic-code union (`psl-extension-block.ts:32–33`).

## Coherence rationale

One reviewable unit: the spec gaps, the namespace, the call-site rewiring, the registration, and the diagnostics are one behavioural statement — "the Mongo interpreter accepts exactly the registered surface". Splitting registration from diagnostics would ship a registry that is provably complete but unenforced; splitting the `@id`/`@unique` specs out would ship a diagnostic that rejects real attributes. Ordering inside the PR (specs → registration → diagnostics) satisfies the transitional-shape constraint without a second PR.

## Scope

**In:**
- `@internal/mongo-contract-psl`: `mongoAttributeSpecs` namespace, `@id`/`@unique` specs, factory-shaped index specs, interpreter call-site rewiring, `controlMutationDefaults` input + provider threading, unknown-attribute diagnostics, tests, README line.
- `@internal/family-mongo`: `attributeSpecs` on descriptor + pack, production dependency on `mongo-contract-psl` (via `pnpm install`), enumeration test.
- `test/integration`: Mongo LSP-consumability test + fixture config.
- Schema fixtures that today rely on silently-ignored attributes (see edge cases): `examples/retail-store/src/contract.prisma` and its two migration snapshots (`@default(Active)`), `test/integration/test/ports/prisma/functional/legacy-aggregate-raw/_fixture/contract.prisma` (`@default(now())`, `@updatedAt`).

**Out:**
- Any Mongo support for `@default` / `@updatedAt` — Mongo has no default-value lowering; the correct behaviour for this slice is to say so instead of ignoring the attribute.
- Target-contributed model attributes for Mongo (no ADR-236 loop exists in the Mongo interpreter; project non-goal territory).
- SQL family (slice `sql-attributes-registered`), block-level attributes (slice `block-attributes-on-kit`), LSP production changes, the registry ADR.

## Pre-investigated edge cases

- **Schemas carrying attributes Mongo ignores today.** Repo-wide inventory of Mongo schemas (files declaring `ObjectId`) found three real users of unregistered attributes: `examples/retail-store/src/contract.prisma:74` (`@default(Active)`), the same line in `examples/retail-store/migrations/app/20260513T0508_backfill_product_status/contract.prisma` and `…/20260628T0931_add_product_status_order_type_enums/contract.prisma` (both re-emitted by `scripts/regen-example-migrations.mjs` under `pnpm fixtures:check`), and `test/integration/test/ports/prisma/functional/legacy-aggregate-raw/_fixture/contract.prisma:16–17` (`@default(now())`, `@updatedAt`). The attributes never reached the emitted contract, so removing them changes no `contract.json`; `pnpm fixtures:check` stays byte-clean. All other `@default` / `@db.ObjectId` hits are inside `//` comments.
- **Composite-type fields.** `type` blocks' fields carry attributes the interpreter never reads (`resolveNonRelationField` ignores them). They are checked against the field namespace like model fields, so a typo in a `type` block diagnoses; `@map` on a composite field stays accepted-and-ignored (pre-existing gap, unchanged by this slice).
- **`@id` / `@unique` with arguments.** Previously ignored; now `PSL_INVALID_ATTRIBUTE_SYNTAX`. No fixture in the repo declares either with arguments.
- **`@unique` on a relation field.** `collectIndexes` skips relation-typed fields before reading `@unique`; the field-level unknown-name check still runs on them, and `unique` is a registered name, so behaviour is unchanged there.

## Slice-specific done conditions

- [x] `@id` and `@unique` have declarative specs; `mongoAttributeSpecs` registers every attribute the Mongo interpreter accepts; a test pins the exact key sets at both levels through `assembleAttributeSpecs`.
- [x] No Mongo spec constant is imported at an interpreter call site without also being registered (grep gate: every `*Spec` identifier imported in `interpreter.ts` from `mongo-attribute-specs` is reachable through `mongoAttributeSpecs`; `buildIndexModelSpecs` no longer exists).
- [x] Unknown attribute names diagnose at model and field level with the codes above; tests cover an unknown model attribute, an unknown field attribute, a dotted field attribute, and an unknown attribute on a composite-type field.
- [x] Every factory's spec level matches its subkey (behavioural wrong-level guard).
- [x] `pnpm fixtures:check` clean; `pnpm lint:deps` clean with the new `family-mongo → mongo-contract-psl` edge.
- [x] Net-new `blindCast` count: 0.

## Contract impact

No contract entities, kinds, or emitted artifacts change (`contract.json` / `contract.d.ts` byte-identical — enforced by `fixtures:check`). Authoring-time behaviour changes: Mongo schemas that carry unregistered attributes (including `@default`, `@updatedAt`, `@db.*`) now fail `contract emit` with a diagnostic instead of silently dropping the attribute. The `@internal/mongo-contract-psl` interpreter input gains a required `controlMutationDefaults` key; the provider is its only production caller.

## Adapter impact

**mongo** family only (`@internal/family-mongo` descriptor + pack). No target pack contributes Mongo attributes; postgres/sqlite unaffected.

## Open Questions

None. The two project open items addressed to this slice are resolved above (§ 1 wrong-level guard, § 2 no-fallback registry).

## References

- Parent project: [`projects/attribute-registry/spec.md`](../../spec.md) — § The factory context, § Transitional-shape constraints; [`design-decisions.md`](../../design-decisions.md) — decisions 6, 7, 9.
- Sibling slice: [`registry-core`](../registry-core/spec.md) — the ctx / factory / assembly surface this slice registers into.
- Linear: [TML-3229](https://linear.app/prisma-company/issue/TML-3229)
- ADRs: [ADR 231](../../../../docs/architecture%20docs/adrs/ADR%20231%20-%20Declarative%20attribute%20specifications.md) (accepted; specs-as-data).
