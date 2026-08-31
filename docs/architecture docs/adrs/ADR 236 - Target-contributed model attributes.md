# ADR 236 — Target-contributed model attributes

Status: **Accepted**.

Related: [ADR 231 — Declarative attribute specifications](ADR%20231%20-%20Declarative%20attribute%20specifications.md).

## Decision

A target pack contributes `@@` model attributes **declaratively**: it registers an attribute descriptor (name, parameter spec, lowering) on the authoring contribution surface, and the family interpreter does the rest generically. A PSL block that requires its target model to carry such an attribute declares that requirement as data too. The split is: **the framework declares the shape, the family enforces it, the target names it.** The framework never learns any attribute name; the family interpreter runs one generic loop over registered descriptors; only the target package spells out what the attribute is called.

## A grounding example: `@@rls`

Postgres's `@@rls` marks a model's table as RLS-controlled, and a policy may only target a model so marked:

```prisma
model Profile {
  id     Int    @id
  userId String

  @@rls
}

policy_select profile_owner_read {
  target = Profile
  roles  = [authenticated]
  using  = "\"userId\"::uuid = auth.uid()"
}
```

Neither the framework nor the SQL family knows what `@@rls` means. The Postgres target teaches the interpreter both facts about it declaratively.

First, the attribute itself — a descriptor naming it, supplying a factory for its parameter spec (no parameters here), and lowering it to a pack entity:

```ts
const postgresRlsSpec = modelAttribute('rls', {});
const postgresRlsSpecFactory: ModelAttributeSpecFactory = () => postgresRlsSpec;

export const postgresAuthoringModelAttributes = {
  rls: {
    kind: 'modelAttribute',
    attribute: 'rls',
    spec: postgresRlsSpecFactory,
    lower: (_parsed, ctx) => ({
      key: ctx.storageName,
      entity: new PostgresRlsEnablement({ tableName: ctx.storageName, namespaceId: ctx.namespaceId }),
    }),
  },
} as const satisfies AuthoringModelAttributeDescriptorNamespace;
```

Second, the coupling — each `policy_*` block descriptor declares that its `target` model must carry `@@rls`:

```ts
policy_select: {
  kind: 'pslBlock',
  // …
  requiresModelAttribute: { parameter: 'target', attribute: 'rls' },
},
```

With those two registrations, `@@rls` on `Profile` lowers to a `PostgresRlsEnablement` entity in the namespace's entries, and a `policy_select` targeting an unmarked model fails the load with `PSL_EXTENSION_TARGET_MODEL_MISSING_ATTRIBUTE`, naming the block and the model.

## The two SPIs

Both live on the authoring contribution surface (`framework-components/src/shared/framework-authoring.ts`).

### `AuthoringContributions.modelAttributes`

A registry of `AuthoringModelAttributeDescriptor`s. Each descriptor:

- **claims a bare `@@` attribute name** (`attribute: 'rls'`);
- **supplies a factory for the declarative parameter spec** — a `ModelAttributeSpecFactory`, called with the declaring model's context and returning a spec built with the same `modelAttribute(...)` constructors as every other declarative attribute ([ADR 231](ADR%20231%20-%20Declarative%20attribute%20specifications.md)) — so parsing, validation, and printing come for free from the generic machinery. A spec that needs nothing from the context, like `@@rls`, returns a hoisted module constant so its identity is stable across calls;
- **supplies a `lower` function** that turns the parsed attribute into a pack entity keyed into the namespace's `entries`.

The factory indirection is uniform across every registered attribute spec, so one entry shape serves both this channel and the family built-ins that share the registry.

The family interpreter's model-attribute loop consults registered descriptors generically: it invokes the factory with the symbol table, the declaring `ModelSymbol`, and the composed stack's mutation-default functions, then interprets the attribute's arguments against the returned spec. A contribution supplies only the spec factory and the lowering.

### `AuthoringPslBlockDescriptor.requiresModelAttribute`

A declarative `{ parameter, attribute }` pair on a PSL block descriptor, stating that the model named by the block's ref parameter `parameter` must carry the bare `@@` attribute `attribute`. The family interpreter enforces it generically over the whole parsed document — declaration order of the block and the model does not matter.

Out of scope for the rule by design: a `parameter` that is missing or does not resolve to a model is **not** this rule's concern — the missing-parameter and unresolved-ref diagnostics own those cases. The rule fires only when the parameter resolves to a model and that model lacks the attribute.

The field expresses exactly one constraint — *one* ref parameter's model must carry *one* attribute — deliberately. A list of pairs, a boolean combinator, or a general predicate would be designed against no second example (see Alternatives). The narrow shape keeps the family interpreter's enforcement a single generic check, and widening it later (to a list, say) is an additive change to an optional field.

## Consequences

### Positive

- A target adds a model-level marker with a descriptor and a lowering — no framework or family change, no parser change.
- Cross-entity authoring constraints ("this block's target model must be marked") are declared, not coded, and are enforced document-order-independently in one place.
- Both authoring surfaces stay in lockstep: the TS authoring path validates the same coupling at build time (a policy on a model without RLS enablement is a build error), reading the same vocabulary the descriptors establish.

### Negative

- Both SPIs are durable public framework surface with a single consumer (`@@rls`). The shapes are the narrowest that serve it; a second consumer may force widening (e.g. multiple `requiresModelAttribute` pairs), which is additive but still a surface change.
- An argument-less attribute's `lower` receives an empty parse (`Record<never, never>`); the descriptor machinery's generality is unused until an attribute with parameters arrives.

## Alternatives considered

**A procedural interpreter hook.** The target registers a callback the interpreter invokes per model, free to inspect and validate anything. Rejected for the same reasons ADR 231 rejects procedural attribute parsing: a hook can do anything, so nothing about it is statically inspectable — the printer, the language server, and the validator each need the *declarative* facts (which attributes exist, what parameters they take, what they require) that a callback hides. Every hook also re-implements parameter parsing and error wording, where descriptors get both generically with uniform diagnostics. And one-per-name descriptor keys make collisions between packs a load-time error instead of a silent override.

**A rule language for `requiresModelAttribute`.** Lists of pairs, and/or combinators, or a general predicate over the parsed block. Rejected as speculative generality: the policy→`@@rls` coupling is the only consumer, so any richer shape would be designed against zero additional examples. The single-pair form covers it, and the richer forms remain reachable later as additive changes.

**Enforce the coupling in each block's lowering.** Have every `policy_*` factory check its target model for `@@rls` itself. Rejected: the check duplicates across every block kind that needs it, each copy re-implements document-order independence (the model may be declared after the block), and the constraint disappears from the block's declarative description — the language server and validator can no longer see it as data.
