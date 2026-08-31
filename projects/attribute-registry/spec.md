# attribute-registry

## Purpose

Give every consumer of PSL attribute knowledge — the family interpreters and the language server — one shared, complete description of the attribute surface, so the editor's understanding can never fall out of step with what the interpreters accept. This delivers the "central registration" follow-up that the accepted ADR 231 explicitly defers.

## At a glance

Today the knowledge exists but is scattered. Family built-in specs are loose module constants imported directly at interpreter call sites (`sql-attribute-specs.ts`, `mongo-attribute-specs.ts`); target-contributed model attributes (ADR 236) reach only the SQL interpreter's generic loop; and the language server sees none of it — `config-resolution.ts` already loads the full control stack, but `pipelineInputsFromStack` extracts only `pslBlockDescriptors` and drops `modelAttributes`. Mongo additionally has attributes with no spec at all (field-level `@id`, `@unique` are presence-only checks) and silently ignores unknown attribute names.

After this project, every attribute is registered once, as a **spec factory**, and read by two consumers (snippet illustrative — re-verify against shipped code before executing):

```ts
// A family registers one namespace with `model` and `field` subkeys.
// Static specs are nullary factories; dynamic specs (per-field @default,
// per-model Mongo index specs) are first-class, not special cases.
export const sqlAttributeSpecs = {
  model: {
    index: () => indexModelSpec,
  },
  field: {
    id: () => idFieldSpec,
    default: (ctx) => buildDefaultSpec(ctx), // ctx: uniform, framework-owned
  },
} as const satisfies AttributeSpecNamespace;

// The interpreter keeps its existing call sites and its InferAttr typing:
// the factory it runs is the const object its family registered — total,
// strongly-typed key access, no undefined checks.
// The LSP reads the same objects through the assembled view — plain frozen
// data (no interface, no accessor methods):
const specs = assembleAttributeSpecs(stack.authoringContributions);
Object.keys(specs.field); // enumeration; `name in specs.model` for unknown-name checks
```

One entry shape (factory over a uniform ctx), one assembly point (`AuthoringContributions` → `assembleAttributeSpecs` in `psl-parser`, returning plain data), two consumers.

### The factory context

Derived from what every existing dynamic spec actually consumes (`buildDefaultSpec`, `buildEnumDefaultSpec`, Mongo's `buildIndexModelSpecs`), and constructible by both consumers (the interpreter has all of it; the LSP holds the symbol table via its pipeline and `controlMutationDefaults` via `ProjectInterpretation`):

```ts
// psl-parser; names illustrative
interface AttributeSpecContext {
  readonly symbols: SymbolTable;   // cross-declaration lookups — enum members via topLevel.blocks
  readonly model: ModelSymbol;     // field names, for per-model specs (Mongo index arms)
  readonly controlMutationDefaults: ControlMutationDefaultRegistry; // @default funcCall arms (core type)
}
interface FieldAttributeSpecContext extends AttributeSpecContext {
  readonly field: FieldSymbol;     // list-ness + typeName, for @default's arm selection
}
```

Model-level factories take `AttributeSpecContext`; field-level factories take `FieldAttributeSpecContext`, so `field` is guaranteed present exactly where the kit's `fieldAttribute` constructor already guarantees it — no `undefined` handling inside factories. Coverage check against today's factories: `@default` needs `field.list`, the default-function registry, and — for enum fields — the enum's member names, which the factory reads from the enum's declaration via `symbols.topLevel.blocks[field.typeName]` (member *names* only; the interpreter's `EnumTypeHandle`-based lowering is unchanged and stays family-side). Mongo's index specs need `Object.keys(model.fields)`. Deliberately excluded: `codecLookup` (no `codecRef` combinator exists in shipped code — ADR 231-draft aspiration only), capability flags (`@@check` gating is call-site interpretation logic, not spec shape), and `sourceFile`/`sourceId` (parse-time `InterpretCtx` concerns). The ctx grows additively if a future factory needs a new fact both consumers can supply.

### Block-level attributes

Block-level attributes ship today — `@@type("pg/text@1")` (enum codec binding, consumed generically in `framework-authoring.ts`) and `@@map` inside extension blocks (consumed by the postgres target) — and are in scope. They are currently hand-parsed: `reconstructExtensionBlock` flattens the attribute args to strings (`printSyntax`) even though the real `ExpressionAst` is in hand at that point, and each consumer `.find`s its attribute by name. The registry brings them onto the kit:

- The kit gains a `blockAttribute()` constructor and a block-level ctx variant (the current `InterpretCtx` requires `selfModel`, which an `enum` block lacks). Both shipped attributes are single-string positionals — static specs, nullary factories.
- Specs register on **`AuthoringPslBlockDescriptor.attributes`**, a sibling of `parameters` — not in the flat keyspace. Block attributes are scoped per block kind (`@@type` is legal on `enum`, not `policy_select`); descriptor placement makes scoping structural (a block's legal attributes are its descriptor's keys), and the LSP already receives `pslBlockDescriptors`, so the knowledge arrives with zero new plumbing — consumers read a block's attributes off its descriptor directly; block attributes never enter the flat assembled structure.
- **Full consumer migration**: the kit parses block attributes at reconstruction/validation, the typed values are attached to the `PslExtensionBlock` node as plain data (core reads data; it never invokes the kit — layering intact), and the three hand-parsing sites (`framework-authoring.ts` `@@type`, postgres `authoring.ts` `@@map` ×2) migrate to the parsed values. Unknown block-attribute diagnostics read the descriptor's attribute keys.

So the registry covers flat `(level, name)` for `'field'` and `'model'`, plus per-descriptor block attributes.

The settled design decisions and their rationale live in [`design-decisions.md`](./design-decisions.md).

## Non-goals

- **No authoritative interpretation loop.** Interpreters keep their imperative, pull-based flow and existing call sites; the registry supplies the spec factories they run, nothing more. Research finding: field-level interpretation is interleaved with type/column/relation resolution and Mongo's `@@base`/`@map` lowering mutates non-local structures across phases — lifting lowering into descriptors is a rewrite, not a lift.
- **No target-contributed field attributes.** The new field-level contribution namespace is family-built-ins-only; no interpreter has a generic field-attribute lowering path, so a target entry there would parse but never lower. Explicit non-goal until such a path exists.
- **No language-server features.** This project ends at the registry being consumable from the LSP process (proven by a test that assembles it through the existing config-resolution plumbing). Completion, go-to-definition, find-usages, hovers — all of it is separate Language Tools work built on top of this registry, none of it in this project.
- **No change to the contract IR or emitted artifacts.** The registry is authoring-time machinery; `contract.json` / `contract.d.ts` for existing schemas are unchanged.

## Place in the larger world

- **ADR 231 (accepted)** — establishes specs-as-data and names central registration + language-server consumption as follow-up work. This project is that follow-up.
- **ADR 236 (accepted, amended by this project)** — target-contributed model attributes. Its descriptor's `spec` field becomes a factory over the uniform ctx; postgres `@@rls` adapts trivially.
- **Layering** — `AuthoringModelAttributeDescriptor.spec` is `unknown` in core (`framework-components`), because `AttributeSpec` lives in the PSL authoring layer. The registry keeps this: contributions transit core erased; `assembleAttributeSpecs` in `psl-parser` performs the one documented narrow (`blindCast` with reason) and exposes the typed plain-data view.
- **Consuming packages** — `psl-parser` (registry + assembler + uniform ctx), `framework-components` (contribution surface), SQL and Mongo `contract-psl` interpreters, `language-server` (via its existing `config-resolution.ts` control-stack plumbing), `postgres` target.
- **Linear** — [Language Tools Support Prisma Next PSL](https://linear.app/prisma-company/project/language-tools-support-prisma-next-psl-3422a7e44b9c) (Terminal team).

## Cross-cutting requirements

- **One entry shape everywhere.** Every registry entry — family built-in or target-contributed, static or dynamic — is a factory taking the uniform ctx. No consumer branches on entry kind.
- **Typed access is preserved without new casts.** Interpreters retain `InferAttr`-derived result types by accessing factories through their own registered const namespaces (object identity with the registry's content). The only cast added by this project is the single documented narrow in the assembler.
- **Registry completeness is enforced, not assumed.** Every attribute an interpreter accepts is registered; registry keys drive unknown-attribute diagnostics in both families, at field and model level (new behavior for Mongo, which silently ignores unknown attributes today).
- **The ctx contract stays framework-owned.** Family-specific needs enter through the uniform ctx (site + stack facts), never through bespoke factory signatures the LSP cannot construct.
- **Layering stays clean.** `pnpm lint:deps` clean throughout; the erased-transit / typed-view split above is the mechanism.

## Contract impact

None on the contract surface itself: no contract entities, kinds, or serialized artifacts change. The affected public surface is the **authoring SPI** in `framework-components`: `AuthoringModelAttributeDescriptor.spec` becomes a factory, `AuthoringContributions` gains one family built-in registration key — a single namespace with `model` and `field` subkeys (target descriptors stay on `modelAttributes`: their entries carry `lower`, a different shape, and field-level is family-only), `AuthoringPslBlockDescriptor` gains the `attributes` field, and `PslExtensionBlock` carries the kit-parsed attribute values as plain data. Downstream consumers of that SPI: SQL interpreter's contributed-attribute loop, control-stack composition, postgres target pack, `resolveEnumCodecId`.

## Adapter impact

**postgres** only: its `@@rls` descriptor migrates to the factory spec shape, its block descriptors declare `@@map` (and the enum descriptor `@@type`) via the new `attributes` field, and its two hand-parsing `@@map` sites migrate to kit-parsed values. No other target contributes attributes today; sqlite/mongo target packs are unaffected.

## Transitional-shape constraints

- **Unknown-attribute diagnostics land last per family.** A family's unknown-name diagnostic may only ship after that family's full built-in set is registered — otherwise real attributes diagnose as unknown. For Mongo this means the missing `@id`/`@unique` specs land first.
- **Every intermediate state keeps `pnpm fixtures:check` clean.** The ADR-236 factory migration and the interpreter call-site rewiring must not change emitted contracts at any slice boundary.

## Project Definition of Done

- [ ] Team-DoD floor items (inherited; see [`drive/calibration/dod.md`](../../drive/calibration/dod.md)).
- [ ] An LSP-side test obtains the assembled registry through the existing config-resolution plumbing and enumerates both a family built-in (e.g. `@relation`'s named arguments) and a target-contributed attribute (`@@rls`) for a postgres project.
- [ ] Interpreters source every built-in spec from a registered namespace; no spec constant is imported at a call site without also being registered (grep gate).
- [ ] Mongo's field-level `@id` and `@unique` have declarative specs and are registered; Mongo's full built-in attribute surface is enumerable from the registry.
- [ ] Unknown attribute names produce diagnostics in both families at field and model level, driven by registry keys.
- [ ] `@@type` and extension-block `@@map` are declared on their block descriptors, parsed through the kit, and all three former hand-parsing sites read the kit-parsed values (no `blockAttributes.find` remains outside the generic machinery — grep gate); unknown block-attribute names diagnose against the descriptor's attribute keys.
- [ ] ADR 236 amended to the factory descriptor shape; registry ADR authored at close-out (per ADR-audit gate).

## Open Questions

None. The pre-spec discussion settled the design forks and follow-up research resolved the ctx shape (§ The factory context); anything further is slice-level detail.

## References

- Linear Project: [Language Tools Support Prisma Next PSL](https://linear.app/prisma-company/project/language-tools-support-prisma-next-psl-3422a7e44b9c)
- ADRs: [ADR 231 — Declarative attribute specifications](../../docs/architecture%20docs/adrs/ADR%20231%20-%20Declarative%20attribute%20specifications.md), [ADR 236 — Target-contributed model attributes](../../docs/architecture%20docs/adrs/ADR%20236%20-%20Target-contributed%20model%20attributes.md)
- Design-discussion record: [`design-decisions.md`](./design-decisions.md)
