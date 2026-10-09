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
  using  = sql`"userId"::uuid = auth.uid()`
}
```

The predicate is a `sql` literal, the only form PSL takes for raw SQL; the TypeScript `policy*` helpers take a `sql` value ([ADR 268](ADR%20268%20-%20Raw%20SQL%20is%20a%20value%20of%20the%20data%20type%20sql-expression.md)).

Neither the framework nor the SQL family knows what `@@rls` means. The Postgres target teaches the interpreter both facts about it declaratively.

First, the attribute itself — a descriptor naming it, supplying a factory for its parameter spec (no parameters here), and lowering it to a pack entity:

```ts
const postgresRlsSpec = modelAttribute('rls', {
  documentation: 'Enables PostgreSQL row-level security on this model’s table.',
});
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
- **supplies a `lower` function** that turns the parsed attribute into a pack entity keyed into the namespace's `entries`. A lowering may instead return `{ index }`; see the amendment below.

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

## Amendment: a contributed attribute may produce a table index

A lowering returns either the entity it always could or `{ index }`, an opaque payload the family narrows. The SQL interpreter checks it with `isAuthoredIndexInput` and pushes it onto the same `indexNodes` list `@@index` fills, so index naming, index-type registration and the name-xor-map rules are shared rather than reimplemented. The framework declares only the arm: an index's *shape* belongs to the family, because a Mongo index and a SQL index agree on nothing but the word.

Two smaller additions serve the same case. A descriptor may declare itself `repeatable`, which skips the duplicate-attribute diagnostic, since a model may want several such indexes. And the lowering context resolves a field of the declaring model to its storage name and to the codec it stores through — `fieldStorageName` and `fieldCodecId` — so a lowering that names storage columns never guesses past `@map` or a naming convention, and can refuse a field whose values it cannot express.

Postgres's `@@fullTextIndex` is the first attribute to use all three. Its fields are weight groups: one field, or a list whose items are fields or lists of fields, at most four groups. It resolves each field to its storage column, refuses a field that is not stored through a textual codec, and returns an index of the registered type `fullText` over those columns whose `options` hold the groups (`weightGroups`), as column names, and the language, from the same allowlist the query operations check. The contract stores that definition, not SQL. One renderer turns it into the search document — `to_tsvector('<language>', "<column>")` for one field; for several, one `to_tsvector` per field joined with `||`, every column wrapped in `coalesce`, each field weighted with `setweight` when there is more than one group — for the `gin` index the DDL creates, for the schema that migrations and verification compare, and for `fullTextMatches` and `fullTextRank`. Postgres uses the index only for a query whose expression is the same document — it compares parsed expressions, not text, so qualifying the columns or not makes no difference. Sharing the renderer keeps the index and the query from diverging when they are given the same groups and language. To make sure they are, the SQL builder hands a query the index itself: `fns.fullTextMatches(post.indexes.post_search, q)` reads the groups and the language from the contract's definition, so the query renders exactly the expression the index covers. A document written by hand, with the `fullTextDocument` helper or as a single column, can still differ from every index; such a query gets no error, just a sequential scan.

Anchors: the `{ index }` arm and `repeatable` in [`interpreter.ts`](../../../packages/2-sql/2-authoring/contract-psl/src/interpreter.ts); the attribute in [`authoring.ts`](../../../packages/3-targets/3-targets/postgres/src/core/authoring.ts); the one place its search document is rendered in [`full-text-search-document.ts`](../../../packages/3-targets/3-targets/postgres/src/core/full-text-search-document.ts); its rules in [`full-text-index-definition.ts`](../../../packages/3-targets/3-targets/postgres/src/core/full-text-index-definition.ts); and [`full-text-index-usage.test.ts`](../../../test/integration/test/sql-builder/full-text-index-usage.test.ts) and [`weighted-full-text-index-usage.test.ts`](../../../test/integration/test/sql-builder/weighted-full-text-index-usage.test.ts), which prove with `EXPLAIN` against a real server that Postgres chooses the index for the SQL the lanes lower.

## Alternatives considered

**A procedural interpreter hook.** The target registers a callback the interpreter invokes per model, free to inspect and validate anything. Rejected for the same reasons ADR 231 rejects procedural attribute parsing: a hook can do anything, so nothing about it is statically inspectable — the printer, the language server, and the validator each need the *declarative* facts (which attributes exist, what parameters they take, what they require) that a callback hides. Every hook also re-implements parameter parsing and error wording, where descriptors get both generically with uniform diagnostics. And one-per-name descriptor keys make collisions between packs a load-time error instead of a silent override.

**A rule language for `requiresModelAttribute`.** Lists of pairs, and/or combinators, or a general predicate over the parsed block. Rejected as speculative generality: the policy→`@@rls` coupling is the only consumer, so any richer shape would be designed against zero additional examples. The single-pair form covers it, and the richer forms remain reachable later as additive changes.

**Enforce the coupling in each block's lowering.** Have every `policy_*` factory check its target model for `@@rls` itself. Rejected: the check duplicates across every block kind that needs it, each copy re-implements document-order independence (the model may be declared after the block), and the constraint disappears from the block's declarative description — the language server and validator can no longer see it as data.
