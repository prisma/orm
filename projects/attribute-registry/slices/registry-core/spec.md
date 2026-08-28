# Slice: registry-core

Parent project: `projects/attribute-registry/`. Outcome this slice contributes: the registration machinery exists end-to-end and is proven LSP-consumable; the three consumer slices only register into / read from it.

## At a glance

Creates the uniform spec-factory contract (`AttributeSpecContext` / `FieldAttributeSpecContext` in `psl-parser`), the family built-in contribution key on `AuthoringContributions` (erased transit through core), and `assembleAttributeSpecs` — a plain-data assembly, no interface/accessors (the project's single documented `blindCast` narrow). Migrates ADR 236's descriptor `spec` to the factory shape — postgres `@@rls` and the SQL interpreter's contributed-attribute loop adapt — and proves LSP-side consumability with a test that assembles the registry through the existing `config-resolution.ts` plumbing and enumerates `@@rls`.

## Chosen design

Grounding note (per `drive/spec/README.md`): snippets below were verified against shipped code on 2026-08-28; re-verify at dispatch time, the code moves.

### 1. Uniform factory ctx + factory types — `@internal/psl-parser`

New module under `src/attribute-spec/` (exported from the barrel):

```ts
export interface AttributeSpecContext {
  readonly symbols: SymbolTable;                                  // src/symbol-table.ts:33
  readonly model: ModelSymbol;                                    // src/symbol-table.ts:55
  readonly controlMutationDefaults: ControlMutationDefaultRegistry; // @internal/framework-components/control
}
export interface FieldAttributeSpecContext extends AttributeSpecContext {
  readonly field: FieldSymbol;                                    // src/symbol-table.ts:102
}
export type ModelAttributeSpecFactory = (ctx: AttributeSpecContext) => AttributeSpec<unknown>;
export type FieldAttributeSpecFactory = (ctx: FieldAttributeSpecContext) => AttributeSpec<unknown>;
export interface AttributeSpecNamespace {
  readonly model: Readonly<Record<string, ModelAttributeSpecFactory>>;
  readonly field: Readonly<Record<string, FieldAttributeSpecFactory>>;
}
```

`psl-parser` already depends on `@internal/framework-components`, so importing `ControlMutationDefaultRegistry` (from `mutation-default-types.ts:82`, exported via `/control`) is layering-clean. `InterpretCtx` (`src/attribute-spec/types.ts`) is untouched — it is the parse-time ctx, not the factory ctx (design decision 2).

### 2. Family built-in contribution key — `@internal/framework-components`

`AuthoringContributions` (`src/shared/framework-authoring.ts:541`) gains one optional key holding the namespace with factories erased (core cannot name `AttributeSpec` — same pattern as `AuthoringModelAttributeDescriptor.spec:528` and `ControlMutationDefaultEntry.signature`):

```ts
readonly attributeSpecs?: AuthoringAttributeSpecContributions;
// where, in core:
export interface AuthoringAttributeSpecContributions {
  readonly model: Readonly<Record<string, unknown>>;  // opaque ModelAttributeSpecFactory
  readonly field: Readonly<Record<string, unknown>>;  // opaque FieldAttributeSpecFactory
}
```

- `AssembledAuthoringContributions` (`src/control/control-stack.ts:47`) gains the key as required; `assembleAuthoringContributions` (`:174`) merges it across descriptors with duplicate-name-per-level as an assembly error, following the existing `modelAttributes` merge (`:257–265`) precedent.
- The structural-validation walker in `framework-authoring.ts` (~`:748`, `:1192+`) learns the new key's shape (model/field records of functions).
- In this slice both subkeys assemble **empty** — no family registers built-ins yet (slices A/B do that). The machinery must handle populated namespaces; empty is just today's value.

### 3. `assembleAttributeSpecs` — `@internal/psl-parser`

**No registry interface, no accessor methods** (operator decision, 2026-08-28 — see design-decisions § 9). The assembled view is plain, strongly-typed `const` data; the assembly function is the project's **single documented narrow**:

```ts
export interface AssembledAttributeSpecs {
  readonly model: Readonly<Record<string, ModelAttributeSpecFactory>>;
  readonly field: Readonly<Record<string, FieldAttributeSpecFactory>>;
}
export function assembleAttributeSpecs(
  contributions: AssembledAuthoringContributions,
): AssembledAttributeSpecs; // returns frozen plain data
```

- Interpreters never consume this view: each family imports its own registered `const` namespace (`as const satisfies AttributeSpecNamespace`), so its known-attribute access is total and `InferAttr`-typed — no `undefined` checks (project spec § cross-cutting: typed access via object identity).
- The assembled view exists for consumers that genuinely face unknown names — LSP enumeration and (in later slices) unknown-attribute diagnostics: `Object.entries(specs.field)`, `name in specs.model`.
- The model record merges two sources: `contributions.attributeSpecs.model` (family built-ins) and `contributions.modelAttributes` descriptors' `spec` factories (target-contributed, ADR 236). Name collision between the two sources is an error, consistent with `assertNoCrossRegistryCollisions` (`control-stack.ts:279`).
- The field record reads `contributions.attributeSpecs.field` only (decision 6: family-built-ins-only).
- One `blindCast` with reason narrows the erased factories to the typed factory types. No other new cast lands in this project.
- Block attributes never enter this structure — they live on `AuthoringPslBlockDescriptor.attributes`, which the LSP already receives via `pslBlockDescriptors` (slice `block-attributes-on-kit`).

### 4. ADR 236 descriptor migration to factory shape

`AuthoringModelAttributeDescriptor.spec` (`framework-authoring.ts:528`) stays `unknown` in core; its **contract** changes — the doc comment (`:500–524`) now states the value is a spec *factory* over the uniform ctx.

- **postgres `@@rls`** (`packages/3-targets/3-targets/postgres/src/core/authoring.ts:650–663`): `spec: modelAttribute('rls', {})` becomes a nullary-use factory, e.g. `spec: rlsSpecFactory` where `const rlsSpecFactory: ModelAttributeSpecFactory = () => rlsSpec` (spec value hoisted to a module const so identity is stable).
- **SQL contributed-attribute loop** (`packages/2-sql/2-authoring/contract-psl/src/interpreter.ts:1060–1122`): the existing narrow at `:1078–1081` becomes a narrow to `ModelAttributeSpecFactory` (this is the loop's own pre-existing cast site, not a new one); the loop invokes the factory with a ctx built from facts it already holds (symbol table, current `ModelSymbol`, the default-function registry) and passes the result to `interpretModelAttribute` unchanged. If any of the three ctx facts is not already threaded to that site, thread it — additive plumbing, no behavior change.
- **ADR 236 text** (`docs/architecture docs/adrs/ADR 236 - Target-contributed model attributes.md:39,69,72`): sample and prose amended to the factory shape, with a pointer to the registry project's rationale (one entry shape everywhere).

### 5. LSP-consumability proof

A test in `packages/1-framework/3-tooling/language-server/test/` resolves a postgres project through the existing `config-resolution.ts` surface and asserts `assembleAttributeSpecs(...)` yields `'rls' in specs.model`. The full contributions already reach the LSP process (`config-resolution.ts:92` threads `stack.authoringContributions` into interpretation), so the expected shape is **test-only, zero production LSP changes** — `pipelineInputsFromStack` (`:71–76`) still drops `modelAttributes`/`attributeSpecs`; wiring registry data into the LSP pipeline is future Language Tools work (project non-goal).

## Coherence rationale

One reviewable unit: the factory contract, its one existing contributor (postgres `@@rls`), and its one existing consumer (SQL contributed-attribute loop) flip together, so no commit ever holds two spec shapes; the registry + LSP test then prove the machinery end-to-end. Splitting machinery from migration would ship a registry with zero entries and an unmigrated descriptor shape — two PRs each unreviewable on their own terms.

## Scope

**In:**
- `@internal/psl-parser`: ctx types, factory types, `AttributeSpecNamespace`, `AssembledAttributeSpecs` + `assembleAttributeSpecs`, barrel exports, tests.
- `@internal/framework-components`: `attributeSpecs` key (contributions + assembled + merge + structural validation), doc-comment update on `AuthoringModelAttributeDescriptor.spec`, tests.
- `@internal/sql-contract-psl`: contributed-attribute loop invokes factories (`interpreter.ts` narrow site + ctx threading), tests (`interpreter.model-attributes.test.ts` fixture adapts).
- `@internal/target-postgres`: `@@rls` descriptor to factory shape, its tests.
- `@internal/language-server`: new test only.
- `docs/architecture docs/adrs/ADR 236 …`: text amendment.

**Out:**
- Registering any family built-in spec (slices `sql-attributes-registered`, `mongo-attributes-registered`).
- Block-level attributes (slice `block-attributes-on-kit`; they ride block descriptors, never this structure).
- Unknown-attribute diagnostics (land last per family, in the family slices).
- LSP production changes (`pipelineInputsFromStack`, completion, etc.) — project non-goal.
- The registry ADR (authored at project close-out).

## Pre-investigated edge cases

**None pre-investigated.** The implementer's dispatch-time grep is the discovery mechanism; new edge cases that surface at dispatch time amend the spec via `drive-discussion` per invariant I12.

## Slice-specific done conditions

- [ ] The LSP-side test enumerates `@@rls` from a registry assembled through existing `config-resolution.ts` plumbing (project-DoD item, partial form — extended to `@relation` in slice A).
- [ ] `pnpm fixtures:check` clean — the factory migration changes no emitted contract (project transitional-shape constraint).
- [ ] ADR 236 amended to the factory descriptor shape.
- [ ] Net-new `blindCast` count in this slice ≤ 1 (the registry narrow); the interpreter's existing narrow is reshaped, not duplicated.

## Contract impact

No contract entities, kinds, or emitted artifacts change (`contract.json` / `contract.d.ts` byte-identical — enforced by `fixtures:check`). The authoring SPI in `@internal/framework-components` changes: `AuthoringContributions.attributeSpecs` added; `AuthoringModelAttributeDescriptor.spec` re-contracted from "spec value" to "spec factory" (type stays `unknown`). Downstream SPI consumers adapting in-slice: control-stack assembly, SQL contributed-attribute loop, postgres target pack.

## Adapter impact

**postgres** only (`@@rls` descriptor). sqlite/mongo target packs contribute no model attributes — unaffected.

## Open Questions

1. Contribution key + core type names (`attributeSpecs` / `AuthoringAttributeSpecContributions`). Working position: as written; implementer may adjust for collision/convention with reviewer sign-off recorded in `code-review.md`.
2. Where family descriptors will later inject built-ins (slices A/B) — via the `authoring` slot on `framework-components.ts:63/:220` descriptors. Working position: yes, same channel as every other contribution; nothing to build here beyond the merge.

## References

- Parent project: [`projects/attribute-registry/spec.md`](../../spec.md) — § The factory context, § Contract impact; [`design-decisions.md`](../../design-decisions.md) — decisions 1–5, 9.
- Linear: [TML-3227](https://linear.app/prisma-company/issue/TML-3227)
- ADRs: [ADR 231](../../../../docs/architecture%20docs/adrs/ADR%20231%20-%20Declarative%20attribute%20specifications.md) (accepted; specs-as-data), [ADR 236](../../../../docs/architecture%20docs/adrs/ADR%20236%20-%20Target-contributed%20model%20attributes.md) (amended by this slice).
