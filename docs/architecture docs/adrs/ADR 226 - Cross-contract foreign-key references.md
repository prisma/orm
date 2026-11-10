# ADR 226 — Cross-contract foreign-key references

## Status

Accepted. Builds on [ADR 212 — Contract spaces](./ADR%20212%20-%20Contract%20spaces.md), [ADR 221 — Contract IR two planes](./ADR%20221%20-%20Contract%20IR%20two%20planes%20with%20uniform%20entity%20coordinate%20and%20pack-contributed%20entity%20kinds.md), and [ADR 225 — Three-layer extensibility](./ADR%20225%20-%20Three-layer%20extensibility%20for%20pack-contributed%20entity%20kinds.md).

## Decision

An application can declare a foreign key whose target table is owned by **another contract space** — typically a table an extension ships — using the same authoring surface as a local foreign key. The framework resolves the cross-space target, emits a real database FK constraint, and verifies it.

Here is the canonical case. An app references `auth.users`, a table owned by the Supabase extension's contract space:

```prisma
types {
  AuthUserId = Uuid
}

namespace public {
  model Profile {
    id     String     @id @onCreate(uuid())
    userId AuthUserId @unique
    user   supabase:auth.AuthUser @relation(fields: [userId], references: [id], onDelete: Cascade)
  }
}
```

The only new piece of syntax is the `supabase:` prefix on the relation's type: it names the contract space the target model lives in. Everything else — `@relation`, `@unique`, the field declaration — is ordinary. The app declares which spaces it can reach through `extensions` in its config; `supabase` resolves against that list.

This lowers to a real Postgres constraint at migration time:

```sql
ALTER TABLE "public"."profile"
  ADD CONSTRAINT "profile_userId_fkey"
  FOREIGN KEY ("userId")
  REFERENCES "auth"."users"("id")
  ON DELETE CASCADE;
```

Three choices make this work, and the rest of this ADR explains them in turn:

1. The FK carrier in the IR gains an optional `spaceId` — present means cross-space, absent means local.
2. Authoring uses one call shape for both; the brand on the imported model handle is what distinguishes them.
3. Cross-space names resolve implicitly against the contract aggregate already built from `extensions` — no new resolver, no import directive.

## Context

An extension that ships a contract space (see [ADR 212](./ADR%20212%20-%20Contract%20spaces.md)) owns its own tables. The Supabase extension owns `auth.users`, `auth.identities`, and related tables. Applications frequently need referential integrity into those tables — a `public.profile` row that belongs to an `auth.users` row and cascades when that user is deleted.

The framework had no seam for this. The FK reference carrier in the Contract IR named only local coordinates; neither the TypeScript builders nor PSL had a way to name a model in another space; and the planner had no rule for resolving a target it didn't own. An author's only options were to drop database-level referential integrity entirely, or to hand-write FK SQL in a raw migration the framework could neither see nor verify.

The information needed to close the gap was already present: the contract aggregate the framework assembles from `extensions` contains every reachable extension contract. What was missing was a carrier shape that could hold a cross-space coordinate, an authoring surface that could produce one, and a resolution rule that walked the aggregate. This ADR adds those three things.

## Design

### The carrier: an optional `spaceId`

The FK reference carrier, `ForeignKeyReference`, gains an optional `spaceId`:

```ts
export class ForeignKeyReference extends SqlNode {
  readonly namespaceId: NamespaceId;  // UNBOUND_NAMESPACE_ID ('__unbound__') for single-namespace refs
  readonly tableName: string;
  readonly columns: readonly string[];
  declare readonly spaceId?: string;  // absent = local; present = cross-space
}
```

Discrimination is by presence, not by a tag. When `spaceId` is absent, the target is in the same contract space. When it is present, the target is in the space it names. We chose presence over an explicit `source: 'local' | 'space'` discriminator deliberately — see [Alternatives](#alternatives-considered) — because it keeps a local FK's serialized JSON byte-identical to a contract authored before cross-space support existed. A `spaceId`-absent carrier is indistinguishable on disk from a plain local FK, so no existing contract re-serializes differently.

The carrier is target-agnostic at the framework and family layers; the SQL and Mongo family concretions inherit the shape unchanged.

### One authoring surface, distinguished by the handle's brand

A cross-space FK is authored with the *same* calls as a local one — `rel.belongsTo(...)` and `constraints.foreignKey(...)` in TypeScript, `@relation(...)` in PSL. There is no separate `refExt` or `belongsToExternal`.

What distinguishes the two is the model handle being referenced. An extension exports its model handles from its `/contract` subpath, branded with the extension's space id:

```ts
import { AuthUser } from '@internal/extension-supabase/contract';
// rel.belongsTo(AuthUser, ...) — AuthUser's brand carries spaceId 'supabase'
```

The signal that a reference crosses a space boundary lives at the **import statement**, where a reader already sees it, rather than being duplicated in a distinct call name at every use site. The brand flows through to lowering, which produces a carrier with `spaceId` set.

In PSL, where there are no imports, the same distinction is carried by a colon prefix on the type:

```text
type_ref ::= [ <space>: ] <namespace>. <name>
           | [ <space>: ] <name>
           | <name>
```

- `supabase:auth.AuthUser` — space `supabase`, namespace `auth`, model `AuthUser`.
- `supabase:AuthUser` — no namespace, so the target lives in the extension's `__unspecified__` namespace.
- `auth.AuthUser` — no colon, so this is the local cross-namespace form.
- `AuthUser` — the local same-namespace form.

`@relation(fields: …, references: …)` is unchanged: `references:` still takes plain column names, because the parser knows which model they belong to from the type position. The AST carries the prefix on `PslField.typeContractSpace?`, alongside the `typeNamespace?` coordinate used for within-space cross-namespace references.

### Names resolve implicitly through `extensions`

There is no PSL `use` directive, no TypeScript resolver call, and no separate registration step. The lowering pass walks each FK reference: if `spaceId` is absent it resolves within the current contract; if present it looks up the named space in the aggregate, then the model, then the column. A reference to a space that isn't in `extensions`, a model that doesn't exist, or a missing column fails fast at lowering time with a diagnostic that names the missing pack.

`extensions` does double duty here. It is both the *import* declaration — which extension models the app can name — and the *dependency* declaration that orders aggregate loading. That conflation is intentional and sufficient for the cases we have; splitting it is an additive change we have not needed (see [Alternatives](#alternatives-considered)).

### Dependency graph and ownership

`extensions` declares a contract's dependencies, and extensions can declare their own recursively, so the spaces form a directed graph. The aggregate loads depended-on spaces first and rejects two shapes at load time, each with a fail-fast diagnostic:

- **Cycles** — A depends on B depends on A.
- **Reverse references** — an extension referencing an application model. References point from dependents toward dependencies, never back.

Ownership follows the same grain. A namespace is open: multiple contracts may contribute models to `auth`, for instance. A *primitive* — a model, enum, or type — is owned by the single contract that declares it. Two contracts declaring the same `(namespace, name)` primitive is a fail-fast load error that names both contributors, rather than a silent last-writer-wins.

### Relations are declared but not navigable

A cross-space reference declares a *relationship*, not merely a column constraint — `rel.belongsTo(AuthUser, ...)` and `user supabase:auth.AuthUser @relation(...)` both produce a relation carrier. But the emitter renders that relation so that traversing it through the ORM is a **compile-time error**: `db.public.Profile.find({ include: { user: true } })` does not type-check.

This is deliberate. The relationship's value today is the database constraint — referential integrity and cascade, realized through migration DDL. Querying across spaces would require a runtime aggregate that merges loaded spaces into one queryable surface, which is a separate, unstarted design. The canonical Supabase pattern (`public.profiles` references `auth.users`, but the app does not query `auth.users` directly) needs only the constraint, so non-navigable relations deliver the real-world capability without committing us to a cross-space query model we have not designed.

### Referential actions are the author's call

`onDelete` and the rest of the referential-action set are permitted on cross-space FKs, and the framework emits no diagnostic for them. An explicit cascade across a space boundary is no more dangerous than a local one — the risk is identical and the author typed it on purpose. This follows the repo-wide stance in [`explicit-opt-in-over-diagnostics`](../../.agents/rules/explicit-opt-in-over-diagnostics.mdc): the code the author wrote is the audit trail, and a warning on every build is noise.

## Consequences

- **The carrier is additive.** Contracts with no cross-space references are unaffected, and their serialized form does not change.
- **Native-type matching is the author's responsibility.** The branded column reference carries a space id, not a storage type. When a cross-space FK targets a column with a non-default native type — `auth.users.id` is `uuid` — the author must match that type on the source column, which is why the grounding example declares `types { AuthUserId = Uuid }` and types `userId` as `AuthUserId`. Postgres rejects mismatched FK column types at apply time; the framework does not coerce.
- **`extensions` carries two meanings at once** (imports and load-order dependency). This is acceptable while every app that imports a space also depends on it, but it leaves no way to depend on a space for ordering without importing its models.
- **Relations are non-navigable.** Declaring a relation the ORM cannot traverse is a partial capability: the constraint and migration work, the query surface does not. This matches how the target tables are used in practice but is a seam that a future cross-space query model will need to fill.

## Alternatives considered

- **A `source: 'local' | 'space'` discriminator (or a parallel carrier type)** instead of an optional `spaceId`. Rejected because it would change the serialized shape of every existing local FK; presence-based discrimination on an optional field keeps local-FK JSON byte-identical and additive.
- **A separate call surface** — `refExt`, `belongsToExternal`, or similar — to mark a cross-space reference explicitly. Rejected in favor of keying off the imported handle's brand. The cross-space signal already lives at the import statement; a second call name would duplicate it at every use site and split one concept into two APIs.
- **A PSL `use … as` import/aliasing directive** for naming external spaces. Rejected in favor of implicit resolution against `extensions`. A `use … as` form remains available as a future additive layer *if* name collisions ever make aliasing necessary, but implicit resolution is the canonical path and nothing depends on aliasing today.
- **Automatic native-type coercion** from the FK target to the source column. Rejected: the framework matches Postgres's own behavior and does not coerce. The author matches the native type explicitly, which keeps the storage type visible at the authoring site rather than inferred invisibly.
- **Splitting `extensions` into `dependsOn` + `imports`.** Deferred. The split is additive and can be made when a real case needs dependency-without-import; conflating them is sufficient and simpler for now.
- **Navigable cross-space relations** (ORM `include` across spaces). Deferred. It requires a runtime contract-space aggregate that merges loaded spaces into the query surface — an undesigned model — and the constraint-only capability covers the motivating use case.

## References

- [ADR 212 — Contract spaces](./ADR%20212%20-%20Contract%20spaces.md) — the contract-space mechanism this builds on.
- [ADR 221 — Contract IR two planes](./ADR%20221%20-%20Contract%20IR%20two%20planes%20with%20uniform%20entity%20coordinate%20and%20pack-contributed%20entity%20kinds.md) — the IR coordinate model the carrier extends.
- [ADR 225 — Three-layer extensibility](./ADR%20225%20-%20Three-layer%20extensibility%20for%20pack-contributed%20entity%20kinds.md) — the extensibility pattern of the surrounding framework.
- [`explicit-opt-in-over-diagnostics`](../../.agents/rules/explicit-opt-in-over-diagnostics.mdc) — the policy behind emitting no diagnostic on cross-space cascade.
