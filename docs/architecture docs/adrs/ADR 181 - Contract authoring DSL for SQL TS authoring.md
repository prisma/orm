# ADR 181 — Contract authoring DSL for SQL

## At a glance

A User and Post contract authored with the contract DSL. The model definition speaks in application-domain terms first — fields, relations, identity — and falls back to SQL details only when the author needs something storage-specific.

```ts
import sqlFamily from '@internal/family-sql/pack';
import { defineContract } from '@internal/sql-contract-ts/contract-builder';
import postgresPack from '@internal/target-postgres/pack';

export const contract = defineContract(
  {
    family: sqlFamily,
    target: postgresPack,
    naming: { tables: 'snake_case', columns: 'snake_case' },
  },
  ({ field, model, rel, gen, type }) => {
    const User = model('User', {
      fields: {
        id: field.column(type.Char(36)).id().onCreate(gen.uuid(7)), // ← UUID v7 primary key (char(36))
        email: field.column(type.String()).unique(),                 // ← inline unique constraint
        createdAt: field.column(type.temporal.CreatedAt()), // ← pack-provided alias: timestamp set on create
      },
    });

    const Post = model('Post', {
      fields: {
        id: field.column(type.Char(36)).id().onCreate(gen.uuid(7)),
        authorId: field.column(type.Char(36)),
        title: field.column(type.String()),
        body: field.column(type.String()).optional(),
      },
    });

    return {
      models: {
        User: User.relations({
          posts: rel.hasMany(Post, { by: 'authorId' }), // ← reverse side, no FK authored here
        }),
        Post: Post.relations({
          author: rel.belongsTo(User, {                 // ← typed model token, not a string
            from: 'authorId',
            to: 'id',
          }).sql({
            fk: { name: 'post_author_id_fkey', onDelete: 'cascade' },
          }),
        }).sql(({ cols, constraints }) => ({            // ← SQL overlay: only storage-specific details
          table: 'blog_post',
          indexes: [constraints.index(cols.authorId, { name: 'post_author_id_idx' })],
        })),
      },
    };
  },
);
```

Three things to notice:

1. **No table or column layer.** Inside the callback helper namespace, the author writes `field.column(type.String())`, not `t.column('email', textColumn)`. Column names come from the field keys via a naming strategy. The author only touches storage names when overriding.
2. **Semantic intent, then SQL.** Identity (`.id()`), uniqueness (`.unique()`), and relations (`rel.belongsTo(User, ...)`) are expressed in the model definition. The `.sql()` block is reserved for table mapping, indexes, and constraint names.
3. **Typed references.** `User` is a model token, not a string. `User.ref('id')` is a typed field reference. The lowering pipeline validates these at build time.

## Design principles

1. **Semantic model first, storage second.** Authors describe their application's domain graph — models, fields, relations, identity — before they describe how it maps to SQL. Most contracts need no `.sql()` block at all. This is a concrete application of the framework's [domain-first surfaces](../../Architecture%20Overview.md#domain-first-surfaces) principle.
2. **Pack-driven vocabulary.** Helpers like `type.String()`, `type.Char(36)` and `type.temporal.CreatedAt()` are not hardcoded DSL keywords. They come from composition units — families, targets, and extension packs — that contribute type constructors and type aliases ([ADR 170](ADR%20170%20-%20Pack-provided%20type%20constructors%20and%20field%20presets.md), [ADR 275](ADR%20275%20-%20Client%20generators%20are%20field%20attributes%2C%20and%20a%20type%20alias%20is%20expanded%20into%20each%20column.md)). The vocabulary changes as framework composition changes.
3. **Typed local references.** Inside `.sql()`, `cols` provides typed refs to the model's scalar fields only. Relation fields cannot appear in constraint authoring. Cross-model refs use model tokens.
4. **Same canonical output.** The contract DSL lowers to the same `contract.json` and `contract.d.ts` consumed by `schema()`, `sql()`, `orm()`, the runtime, and migration tooling. Downstream inference is unchanged.
5. **Contract purity.** The contract object remains pure data — no functions, closures, or side effects. Deterministic canonicalization ensures that equivalent authoring intent produces identical artifacts ([ADR 096](ADR%20096%20-%20TS-authored%20contract%20parity%20&%20purity%20rules.md)).

## Why a new authoring surface

The contract DSL keeps domain meaning close to the model definition. For a simple `User` model with an email field, the author can declare the field once, mark it unique inline, and let naming strategy plus lowering derive the corresponding storage shape.

Most SQL contract verbosity comes from restating information the system already has: field names imply column names, relation declarations imply FK structure, and common column shapes (UUID IDs, timestamps, text) have well-known codecs and defaults. The contract DSL removes that duplication while keeping explicit escape hatches for SQL-specific detail.

Pack-provided type constructors — introduced in [ADR 170](ADR%20170%20-%20Pack-provided%20type%20constructors%20and%20field%20presets.md), which defines how families, targets, and extension packs contribute named column shapes through a composition registry — are what make this collapse possible. When `type.String()` carries a codec ID (the framework's portable type identifier, e.g. `sql/text@1`), a native type descriptor, and nullability semantics from the pack registry, the author doesn't need to spell them out.

## How the DSL is structured

### Model-first, then SQL

The contract DSL is domain-first. Authors define their model graph — models, fields, and relations — and the system derives storage structure from it.

The model definition captures everything that is independent of any particular SQL target: scalar fields with their type, nullability, defaults, and inline constraints; relations with cardinality and ownership semantics; and a naming strategy applied to field keys to derive column names. The `.sql()` block captures only what is inherently SQL-specific: table name overrides, named indexes and their configuration, constraint name overrides, and FK constraint and index toggles.

The key rule: anything that could exist in a non-SQL data model belongs in the model definition. Anything that only makes sense in SQL belongs in `.sql()`. This reflects the [domain-storage separation](ADR%20172%20-%20Contract%20domain-storage%20separation.md) that structures the contract itself — the authoring surface mirrors the contract's architecture.

### Pack-driven field vocabulary

> Amended 2026-10-22: field presets and `field.generated()` were removed by [ADR 275](ADR%20275%20-%20Client%20generators%20are%20field%20attributes%2C%20and%20a%20type%20alias%20is%20expanded%20into%20each%20column.md). A field is written `field.column(type.X())`, with `.id()`, `.onCreate(gen.fn())` and `.onUpdate(gen.fn())`; `field.id.uuidv7String()` is `field.column(type.UuidString()).id().onCreate(gen.uuid(7))`. The two paragraphs below are kept as a record of the preset design.

Common column patterns like "UUID primary key with v7 generation" collapse into single-call field presets: `field.id.uuidv7String()` carries the codec, descriptor, generator, nullability, and identity semantics in one expression.

These presets are not hardcoded in the DSL. They are `AuthoringFieldPresetDescriptor` values contributed by composition units — the SQL family provides base vocabulary like `field.text()` and `field.uuidString()`, the target (e.g. Postgres) can add target-specific presets (`field.uuidNative()`, `field.id.uuidv4Native()`, `field.id.uuidv7Native()` — these emit `pg/uuid@1`), and extension packs (e.g. pgvector) add their own. The framework composition system merges these contributions into the `field.*` namespace that the author sees. Each preset carries a codec ID, a column type descriptor (native type, optional parameters), optional default behavior (literal, SQL expression, or execution-time generator), and optional nullability.

When a developer writes `field.id.uuidv7String()`, the preset resolves to a specific codec (`sql/char@1`), a char(36) column, a UUIDv7 execution-time generator, and non-nullable semantics — all from the pack registry. The DSL also provides structural helpers (`field.column()`, `field.generated()`, `field.namedType()`) for cases where no preset exists — specifying a raw column descriptor, an execution-time generated value, or a named storage type reference. These are part of the DSL mechanics, not pack-contributed.

### Typed cross-model references

In the chain builder, cross-model references were string-based: `constraints.ref('User', 'id')`. A typo in either string would only fail at build time with a generic error. The contract DSL replaces this with model tokens.

In the grounding example, `User` is a model token created by the `model('User', ...)` call. `User.ref('id')` is a typed field reference — the compiler validates that `id` exists on `User` and that it's a scalar field. This catches reference errors at the TypeScript level, with autocompletion.

Model tokens are the preferred way to reference other models. When a model isn't yet defined (forward references) or when two models reference each other (circular relations), string names work as a fallback. Lazy token resolution handles self-referential relations (e.g. a Category with parent/children fields) and circular relations (e.g. Employee ↔ Department). A fallback warning system emits diagnostics when authors use string-based refs where typed model tokens are available.

### Convention-driven naming

Explicit column names on every field are the single biggest source of boilerplate in the chain builder, and they restate information the system already has. The contract DSL replaces explicit names with a naming strategy:

```ts
defineContract({
  family: sqlFamily,
  target: postgresPack,
  naming: { tables: 'snake_case', columns: 'snake_case' },
  ...
});
```

With `snake_case`, a model named `User` maps to table `user`, a field `createdAt` maps to column `created_at`. The `applyNaming()` function handles camelCase boundaries, all-uppercase sequences, and digit boundaries.

Overrides take precedence at any level:
- Per-field: `field.column(type.String()).column('email_address')`
- Per-model: `.sql({ table: 'app_user' })`

### Constraint placement

Single-field constraints are most readable where the field is defined — the reader doesn't need to look anywhere else to understand the field's role:

```ts
id: field.column(type.Char(36)).id().onCreate(gen.uuid(7)),   // primary key
email: field.column(type.String()).unique(),  // unique constraint
```

Compound constraints reference multiple fields, which means they can't be expressed inline on any single field. They belong in `.sql()`, where `cols` provides typed references to all scalar fields:

```ts
.sql(({ cols, constraints }) => ({
  indexes: [constraints.index([cols.authorId, cols.slug], { name: 'post_author_slug_idx' })],
}))
```

Inside `.sql()`, `cols` exposes only scalar fields — relation fields are excluded. This prevents a common class of errors where relation names are accidentally used as column references.

### Relations and ownership

A foreign key column physically exists on one side of a relationship — the side that stores the reference. The contract DSL reflects this by requiring FK storage details only on the **owning side**:

- `rel.belongsTo(User, { from: 'authorId', to: User.ref('id') })` — the owning side. The `from` field on this model maps to the `to` field on the target. FK constraint details (name, referential actions) go in `.sql({ fk: { ... } })`.
- `rel.hasMany('Post', { by: 'authorId' })` — the reverse side. No FK is authored here; the `by` parameter tells the lowering pipeline which field on the target model owns the FK.
- `rel.hasOne('Profile', { by: 'accountId' })` — reverse side, 1:1.
- `rel.manyToMany('Tag', { through: 'PostTag', from: 'postId', to: 'tagId' })` — junction-table relationship.

## How lowering works

The contract DSL lowers through an intermediate representation called `ContractDefinition`; `buildSqlContractFromDefinition()` then produces the canonical `Contract<SqlStorage, SqlModelStorage>` (see [ADR 182](ADR%20182%20-%20Unified%20contract%20representation.md)).

```text
model() + field.* + rel.*                →  model builder instances
          ↓
defineContract({ family, target, models, ... })
          ↓
buildContractDefinition()  →  ContractDefinition
          ↓
buildSqlContractFromDefinition() →  Contract<SqlStorage, SqlModelStorage>
```

`ContractDefinition` is a flat, well-typed interface that captures each model's resolved fields (with column names, codecs, defaults), relations (with cardinality and join coordinates), and constraints (PKs, uniques, indexes, FKs). It creates a clean seam between the authoring surface and the serialization machinery in `SqlContractBuilder`.

This seam matters for two reasons:

1. **Decoupled authoring from serialization.** The contract DSL can evolve without touching the builder internals that lower to `Contract`. Alternative authoring surfaces can target the same contract definition.
2. **Shared lowering target.** PSL can lower to `ContractDefinition` instead of duplicating graph resolution, making TS ↔ PSL parity structural rather than fixture-tested. [ADR 306](ADR%20306%20-%20One%20plain-data%20definition%20and%20one%20builder%20per%20family.md) makes this the shape of every family: one plain-data definition and one builder, which every source of the family calls. [ADR 182](ADR%20182%20-%20Unified%20contract%20representation.md) unified the former `ContractIR` storage-first type with this model-first `Contract` shape; that unification is now implemented.

Lowering validates the contract graph and produces actionable error messages for:
- Duplicate PK or unique specifications on the same field
- Duplicate table or column mappings
- Missing FK target models or fields
- Arity mismatches on relation join columns
- Named constraint collisions

### Type-level inference

`SqlContractResult<Definition>` is a computed type that derives storage tables, column mappings, codec IDs, and type maps from the `Definition` generic parameter. This is what makes no-emit usage possible: downstream `schema()`, `sql()`, and `orm()` can infer their full type surface from the TS-authored contract without importing emitted `.d.ts` files.

## Consequences

### Benefits

- **Reduced boilerplate.** Pack type constructors and aliases carry codec, native type and generated values in a single call. A naming strategy eliminates explicit column names for the common case.
- **Visible intent.** The contract reads as a model graph first, SQL details second. A developer scanning the contract sees application concepts, not storage choreography.
- **Type-safe references.** Model tokens and typed `cols` provide autocompletion and compile-time validation for constraint authoring and cross-model FK targets.
- **Portability.** Switching a contract from Postgres to SQLite means changing the target import and any target-specific `.sql()` details. The model layer stays unchanged — measured at <10% source change for average portable contracts.
- **Shared TS/PSL foundation.** Both authoring surfaces can lower to `ContractDefinition`, making parity structural rather than fixture-tested.

### Costs

- **Coexisting surfaces.** The chain builder and the contract DSL both remain available until the old surface is deprecated.
- **Type-level complexity.** `SqlContractResult<Definition>` uses conditional and mapped types that can be harder to debug. Mitigation: keep authoring-time types shallow and opaque, push graph-wide inference to build/emit time.

## Related ADRs

- [ADR 096 — TS-authored contract parity & purity rules](ADR%20096%20-%20TS-authored%20contract%20parity%20&%20purity%20rules.md) — contracts must be pure data with deterministic canonicalization
- [ADR 170 — Pack-provided type constructors and field presets](ADR%20170%20-%20Pack-provided%20type%20constructors%20and%20field%20presets.md) — the composition registry that provides the field vocabulary
- [ADR 121 — Contract.d.ts structure and relation typing](ADR%20121%20-%20Contract.d.ts%20structure%20and%20relation%20typing.md) — emitted type structure this surface must continue to produce
- [ADR 161 — Explicit foreign key constraint and index configuration](ADR%20161%20-%20Explicit%20foreign%20key%20constraint%20and%20index%20configuration.md) — FK constraint and index toggle design
- [ADR 172 — Contract domain-storage separation](ADR%20172%20-%20Contract%20domain-storage%20separation.md) — the domain/storage separation that the model-first / SQL split reflects
- [ADR 306 — One plain-data definition and one builder per family](ADR%20306%20-%20One%20plain-data%20definition%20and%20one%20builder%20per%20family.md) — the same shape for every family, with MongoDB's definition and builder
- [ADR 182 — Unified contract representation](ADR%20182%20-%20Unified%20contract%20representation.md) — implemented: the former `ContractIR` / `ContractBase` split is replaced by a single `Contract<Storage, ModelStorage>` type; `ContractDefinition` remains the TS authoring seam before lowering to `Contract`
