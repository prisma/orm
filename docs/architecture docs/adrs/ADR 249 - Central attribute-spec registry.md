# ADR 249 — Central attribute-spec registry

**Status:** Accepted
**Date:** 2026-09-09
**Builds on:** [ADR 231 — Declarative attribute specifications](ADR%20231%20-%20Declarative%20attribute%20specifications.md), [ADR 236 — Target-contributed model attributes](ADR%20236%20-%20Target-contributed%20model%20attributes.md)

---

## At a glance

Every model-level and field-level PSL attribute a family accepts is registered in one namespace, keyed by level and by attribute name. Block-level attributes are declared on the block descriptor that owns them, not in this namespace. A family declares its built-ins as a single `const` object (abridged here from `packages/2-sql/2-authoring/contract-psl/src/sql-attribute-specs.ts`):

```ts
export const sqlAttributeSpecs = {
  model: {
    index: () => indexModelSpec,
    check: () => checkModelSpec,
  },
  field: {
    id: () => idFieldSpec,
    default: defaultFieldSpec,
  },
} as const satisfies AttributeSpecNamespace;
```

Every entry is a spec *factory* taking a framework-owned construction-time context, never a plain spec value. `index` and `check` ignore the context and return a hoisted constant; `default` builds its spec from the declaring field, because `@default`'s accepted argument grammar depends on whether the field is a list, which enum members exist, and which mutation-default functions the composed stack registered.

The family interpreter calls a factory through its own namespace, where the key set is statically known and access is total:

```ts
const spec = sqlAttributeSpecs.field.default(
  fieldSpecContext({
    symbols: input.symbolTable,
    model,
    field,
    controlMutationDefaults: input.defaultFunctionRegistry,
  }),
);
```

The language server reaches exactly the same factories through the composed control stack, where the key set is not known ahead of time and enumeration is the point:

```ts
const specs = assembleAttributeSpecs(interpretation.context.authoringContributions);
const spec = specs.model['rls']?.({
  symbols: pipeline.symbolTable,
  model,
  controlMutationDefaults: interpretation.context.controlMutationDefaults.defaultFunctionRegistry,
});
```

One entry shape, one assembly point, two consumers that cannot disagree about what the language accepts, because they run the same objects.

---

## Decision

Every model-level and field-level PSL attribute of every family is registered in one place, keyed by level and name, and enumerable by a consumer that holds the composed control stack. Block-level attributes are enumerable too, from the block descriptor that declares them.

Four rules make that possible.

1. **Registry entries are uniformly spec factories.** A family registers `AuthoringContributions.attributeSpecs` — one namespace with a `model` and a `field` subkey, each a record of factories keyed by bare attribute name. A target registers model attributes as before, through `AuthoringContributions.modelAttributes`, whose descriptors carry a spec factory alongside their `lower` function ([ADR 236](ADR%20236%20-%20Target-contributed%20model%20attributes.md)). No entry is a bare spec value, so no consumer branches on entry kind.
2. **The factory argument is a framework-owned context.** `AttributeSpecContext` at model level, `FieldAttributeSpecContext` at field level. Both consumers can construct it.
3. **`assembleAttributeSpecs` is the one assembly point.** It merges the family's built-ins with the target-contributed model-attribute descriptors into frozen plain records, and it is the point where the types erased through framework core are restored.
4. **Registry keys drive unknown-attribute diagnostics.** An attribute name absent from the registry is a diagnostic in both families, at field and at model level; a block attribute absent from its block descriptor's `attributes` is a diagnostic at parse time.

Block attributes are keyed on their block descriptor rather than in the flat keyspace, because a block attribute is legal only on some block kinds.

The registry is descriptive. It supplies the specs the interpreters run; it does not take over interpretation. Each family interpreter keeps its own pull-based flow and its existing call sites, and reads factories from its own registered namespace — the same objects the assembled view exposes.

---

## The construction-time context

`packages/1-framework/2-authoring/psl-parser/src/attribute-spec/spec-context.ts` declares what a factory is given:

```ts
export interface AttributeSpecContext {
  readonly symbols: SymbolTable;
  readonly model: ModelSymbol;
  readonly controlMutationDefaults: ControlMutationDefaultRegistry;
}

export interface FieldAttributeSpecContext extends AttributeSpecContext {
  readonly field: FieldSymbol;
}

export type ModelAttributeSpecFactory = (
  ctx: AttributeSpecContext,
) => AttributeSpec<never, ModelAttributeCtx>;

export type FieldAttributeSpecFactory = (
  ctx: FieldAttributeSpecContext,
) => AttributeSpec<never, FieldAttributeCtx>;
```

The three facts are exactly what the dynamic specs consume. SQL's `@default` reads `field.list` to choose between scalar and list arms, reads `controlMutationDefaults` to pin one `funcCall` arm per registered mutation-default function, and reads `symbols` to find the enum block named by the field's type and pin one `identifier` arm per member. Mongo's `@@index`, `@@unique`, and `@@textIndex` read `Object.keys(ctx.model.fields)` to pin one sorted-field call per field of the declaring model. Field-level factories receive `field` as a required property, so no factory handles its absence.

Uniformity is what makes the registry consumable at all. A factory whose signature is specific to its family — one taking a list flag and a registry, another taking a list of enum member names — can only be called by the interpreter that owns it. Any other consumer would have to know, per attribute, what arguments to assemble, which is the opacity that declarative specs exist to remove ([ADR 231](ADR%20231%20-%20Declarative%20attribute%20specifications.md)). A single context type both consumers can construct replaces that per-attribute knowledge with one contract: the interpreter builds it from the document it is lowering, the language server builds it from the symbol table its pipeline produced and the mutation defaults on the resolved interpretation.

The context is framework-owned, and a family that needs a new fact widens it for everyone rather than adding a bespoke parameter. That keeps every factory's dependencies visible in one signature and keeps family namespaces module-level constants, at the cost of a context type that grows as new facts are needed.

---

## Two contexts, one for construction and one for parsing

`AttributeSpecContext` is not the context a combinator sees. `packages/1-framework/2-authoring/psl-parser/src/attribute-spec/types.ts` declares a separate family of contexts for parse time:

```ts
export interface AttributeCtx {
  readonly sourceId: string;
  readonly sourceFile: SourceFile;
}

export interface ModelAttributeCtx extends AttributeCtx {
  readonly selfModel: ModelSymbol;
}

export interface FieldAttributeCtx extends ModelAttributeCtx {
  readonly field: FieldSymbol;
  resolveReferencedModel(): ModelSymbol | undefined;
}
```

The two serve different moments and carry different facts. The construction-time context answers "what grammar does this attribute accept here" and is consumed once, when the spec is built. The parse-time context answers "what can a combinator resolve against while reading this node" and is passed to `interpretAttribute` for every attribute occurrence; it carries the source coordinates that diagnostics anchor to, which a spec-construction context has no use for.

They are three separate types rather than one type with optional fields, so that a spec cannot demand a fact its level never carries. `fieldRef()` needs a model to validate a field name against, and is therefore usable at model and field level but not on a block; `referencedFieldRef()` needs a relation target, which only a field can resolve. A block attribute is parsed with only `AttributeCtx`, because a block has no model — `@@type` on an `enum` block has nothing to resolve names against. Optional fields would push that to a runtime check in every combinator instead of the type system.

None of the three carries a `level` discriminant. Level belongs to the spec, not to the site: `AttributeSpec.level` is set by the constructor that built it (`fieldAttribute`, `modelAttribute`, `blockAttribute` write `'field'`, `'model'`, `'block'` respectively), and that is the field consumers read. A discriminant on the context would duplicate it with no reader.

---

## Erased transit through core, and where the types are restored

Attribute specs are a PSL authoring concern, so the kit is in `psl-parser` ([ADR 231](ADR%20231%20-%20Declarative%20attribute%20specifications.md)). Framework core sits below that layer and cannot name `AttributeSpec`. The contribution surface in `packages/1-framework/1-core/framework-components/src/shared/framework-authoring.ts` therefore types every spec channel as `unknown`:

```ts
export interface AuthoringAttributeSpecContributions {
  readonly model: Readonly<Record<string, unknown>>;
  readonly field: Readonly<Record<string, unknown>>;
}
```

`AuthoringModelAttributeDescriptor.spec` and `AuthoringPslBlockDescriptor.attributes` are erased the same way. Core still validates what it cannot name: `mergeAuthoringAttributeSpecs` rejects a level that is not a record, an entry that is not a function, an entry keyed `__proto__` / `constructor` / `prototype`, and a second descriptor claiming an already-claimed `level.attribute` pair, all as `CONTRACT.PACK_CONTRIBUTION_INVALID`.

Each erased channel is restored at exactly one point in the authoring layer, with a `blindCast` carrying its reason. `assembleAttributeSpecs` restores the flat registry; `parseBlockAttribute` in `packages/1-framework/2-authoring/psl-parser/src/block-reconstruction.ts` restores a block descriptor's declared factories. Nothing downstream casts again.

Both factory types return `AttributeSpec<never, …>`, and the bottom type is deliberate. `AttributeSpec.refine` takes the parsed output as a parameter:

```ts
readonly refine?: (parsed: Out, ctx: Ctx, attributeNode: AstNode) => readonly PslDiagnostic[];
```

A parameter position makes `Out` contravariant. A concrete spec — the one `modelAttribute('index', …)` builds, whose `refine` receives `{ fields?: string[]; expression?: string; … }` — is assignable to `AttributeSpec<Out, ModelAttributeCtx>` only when `Out` is assignable to that concrete output type. `never` is assignable to every type, so every real spec fits. `unknown` is assignable to none of them, so `AttributeSpec<unknown, …>` would reject every spec that declares a `refine` — `@@index`, `@@check`, `@noCheck`, `@relation` — and the registry would be able to hold only the specs with no cross-argument validation. The same reasoning fixes `AuthoringModelAttributeDescriptor<Out = never>` and leaves `InferAttr<S>`'s parameter unconstrained.

---

## Registry-driven diagnostics

An attribute name the registry does not carry is reported, in both families and at both levels.

- SQL model level: `buildModelNodeFromPsl` in `packages/2-sql/2-authoring/contract-psl/src/interpreter.ts` reports a name absent from both `sqlAttributeSpecs.model` and the target-contributed model attributes as `PSL_UNSUPPORTED_MODEL_ATTRIBUTE`.
- SQL field level: `validateFieldAttributes` in `packages/2-sql/2-authoring/contract-psl/src/psl-field-resolution.ts` reports a name absent from `sqlAttributeSpecs.field` as `PSL_UNSUPPORTED_FIELD_ATTRIBUTE`, after the `db.` prefix and removed-attribute paths have had their say. A module-level check refuses to load if a removed-attribute rule and a registered field attribute claim the same name, so the two name sets cannot overlap.
- Mongo, both levels: `reportUnknownAttributes` in `packages/2-mongo-family/2-authoring/contract-psl/src/interpreter.ts` walks every model and composite type and reports names absent from `mongoAttributeSpecs.model` / `.field` with the same two codes.
- Block level: `parseBlockAttribute` reports a name absent from the block descriptor's `attributes` as `PSL_EXTENSION_UNKNOWN_BLOCK_ATTRIBUTE`, and a repeated name as `PSL_INVALID_EXTENSION_BLOCK_ATTRIBUTE`.

This makes coverage a correctness requirement, not a nicety: a diagnostic driven by registry keys is only sound if every attribute the interpreter accepts is registered. Mongo's field-level `@id` and `@unique` are declared as specs for that reason — argument-less `fieldAttribute` specs with required documentation for the primary-key and uniqueness markers — so that the surface is complete and enumerable rather than recognized by an ad-hoc presence check the registry cannot see. Per-family tests assert the exact key set of each level, so adding an accepted attribute without registering it fails.

---

## Block attributes are declared on their block descriptor

Block attributes are scoped by block kind. `@@type` is legal on an `enum` block and meaningless on `policy_select`; `@@map` is legal on both a policy block and a native-enum block. Placing them in the flat keyspace would invert that ownership and force every consumer to join two structures to answer what is legal here. They are declared on the descriptor instead, as `AuthoringPslBlockDescriptor.attributes` — a record of factories, sibling to `parameters`:

```ts
export const sqlFamilyPslBlockDescriptors = {
  enum: {
    kind: 'pslBlock',
    keyword: 'enum',
    discriminator: 'enum',
    name: { required: true },
    parameters: {},
    variadicParameters: true,
    attributes: { type: () => enumTypeBlockAttribute },
  },
} as const satisfies AuthoringPslBlockDescriptorNamespace;
```

A block's legal attributes are its descriptor's keys, so scoping is structural, and the language server needs no new plumbing: it already receives `pslBlockDescriptors` from the composed stack.

`reconstructExtensionBlock` interprets those attributes while it reconstructs the block, and attaches the typed results to the node as plain data:

```ts
export interface PslExtensionBlockParsedAttribute {
  readonly args: Readonly<Record<string, unknown>>;
  readonly span: PslSpan;
}
```

`PslExtensionBlock.attributes` is a record of those, keyed by attribute name. Consumers in core and in target packs read the parsed values and never invoke the kit, which keeps the layering intact: `resolveEnumCodecId` reads `block.attributes['type']` and its `args['codecId']`, and the Postgres target reads `block.attributes['map']` and its `args['name']` for both the policy block and the native-enum block. The block's untyped `blockAttributes` array, whose argument values are flattened source text, remains for consumers that want the raw form.

---

## Consequences

Adding an attribute to a family is one registration. It becomes interpretable, enumerable by the language server, and excluded from the unknown-name diagnostic at the same moment, because those three facts read the same keys.

The two consumers cannot drift on grammar. The interpreter and the assembled view hold the same factory objects, so a spec the editor completes against is the spec the interpreter enforces. What object identity does not close, a registration gate does: an interpreter call site that imports a spec constant without registering it would reintroduce the gap, so no spec is consumed unregistered.

A uniform factory over a framework-owned context costs something on both ends. A static spec is reached through a function call rather than read directly, and specs are cheap enough to build per call site that this is not a real cost. The context type is shared, so a fact only one family needs still widens it for both.

The type system does not catch registration at the wrong level. Because the construction-time contexts nest, `FieldAttributeSpecContext` is accepted where `AttributeSpecContext` is expected, and by parameter contravariance a `ModelAttributeSpecFactory` is assignable to `FieldAttributeSpecFactory` — a model-level factory registered under `field` type-checks. The reverse is correctly rejected. Both directions are pinned as type tests in `packages/1-framework/2-authoring/psl-parser/test/attribute-spec-assembly.test-d.ts`. The guard against the assignable direction is behavioural: per-family tests invoke every registered factory and assert that the returned spec's `name` matches its key and its `level` matches the subkey it was registered under.

Duplicate claims fail loudly rather than silently overriding. Two descriptors claiming the same `level.attribute` fail control-stack assembly; a family built-in and a model-attribute descriptor claiming the same model attribute name fail `assembleAttributeSpecs` with an `InternalError`.

Two boundaries stay open by design. Field-level entries are the family's own built-ins. No interpreter has a generic field-attribute lowering path, so there is nothing for a target-contributed field attribute to lower to; the family interpreters accordingly read their own namespaces at field level, and a field entry contributed from anywhere else would be enumerable without being interpreted. Model level has no such gap, because a target's model attributes arrive as descriptors carrying `lower`. And the registry describes attributes without owning their interpretation; lifting lowering into descriptors would be a rewrite of both interpreters, whose field-level work is interleaved with type, column, and relation resolution and whose model-level work writes heterogeneous accumulators with cross-attribute preconditions.

---

## Alternatives considered

**A registry of plain spec values.** Rejected: the attribute surface is not static. SQL's `@default` and Mongo's index attributes derive their accepted arguments from the declaring field, the declaring model, and the composed stack's mutation defaults, so a registry of values cannot hold them — and `@default` is precisely the attribute an editor most needs to complete.

**Two entry kinds, static values alongside factories.** Rejected: non-uniformity does not disappear, it relocates into every consumer as a branch on entry kind. Wrapping contributed static specs at assembly time (`() => spec`) was rejected for the same reason at one remove — it preserves a second authoring shape that every future contribution copies.

**Family-specific factory signatures.** Rejected: a factory that takes a list flag and a mutation-default registry, or a list of enum member names, can only be called by the interpreter that already knows those facts attribute by attribute. That per-attribute knowledge is exactly what a second consumer cannot have.

**Closing stack facts over the factories at registration time.** Rejected: it hides each factory's dependencies and forces family namespaces to be constructed per composed stack instead of being module-level constants.

**Reusing the parse-time context as the construction-time context.** Rejected: wrong moment and wrong facts. Parse-time contexts carry source coordinates for diagnostics and are built per attribute occurrence; they carry neither the symbol table nor the mutation-default registry a spec needs while being built.

**A registry interface with accessor methods.** A `createAttributeRegistry` returning `get(level, name)` and `entries(level)` was rejected: the level is statically known at every call site, so a string parameter only creates overloads, and a `get(): F | undefined` accessor imposes an undefined check on the interpreters, whose access to their own known attributes is total. Frozen plain records let partiality appear only where it is real — enumeration and unknown-name checks.

**Making framework core generic over the spec type.** Rejected: the type machinery needed to thread an authoring-layer type through core is disproportionate to two documented narrows in the authoring layer.

**A second, authoring-layer-only contribution channel that bypasses core.** Rejected: it duplicates plumbing the control stack already provides to both consumers, and target packs contribute through core, so they could not reach it.

**An authoritative descriptor-driven interpretation loop.** Rejected as a rewrite rather than a lift, for the reasons recorded under Consequences. It remains reachable additively, attribute by attribute.

**Flat `('block', name)` keys with an annotation naming the blocks each attribute is legal on.** Rejected: it inverts ownership and makes every consumer join two structures to answer what a given block accepts.

**Leaving unknown attribute names unreported.** Rejected: silently ignoring an attribute turns a typo into missing behaviour with no message, and a complete registry is what makes reporting sound.

---

## References

- [ADR 231 — Declarative attribute specifications](ADR%20231%20-%20Declarative%20attribute%20specifications.md) — the combinator kit, `interpretAttribute`, and the specs this registry registers
- [ADR 236 — Target-contributed model attributes](ADR%20236%20-%20Target-contributed%20model%20attributes.md) — the model-attribute descriptor channel and `requiresModelAttribute`
- [ADR 126 — PSL top-level block SPI](ADR%20126%20-%20PSL%20top-level%20block%20SPI.md) — the block descriptors that carry block attributes
- [ADR 225 — Three-layer extensibility for pack-contributed entity kinds](ADR%20225%20-%20Three-layer%20extensibility%20for%20pack-contributed%20entity%20kinds.md) — the contribution model the authoring surface follows
