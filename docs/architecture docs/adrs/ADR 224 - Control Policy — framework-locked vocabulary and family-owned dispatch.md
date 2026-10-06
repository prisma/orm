# ADR 224 — Control policy: a framework-locked vocabulary with family-owned dispatch

**Status:** Accepted
**Date:** 2026-06-04

---

## At a glance

An application built on Supabase declares a foreign key into `auth.users`, a table Supabase owns and migrates. The app wants two things that pull in opposite directions: the schema verifier should confirm `auth.users` exists with an `id` and `email` of the right shape, so a broken reference fails loudly — but the migration planner must never emit `CREATE`, `ALTER`, or `DROP` against the `auth` schema, because that schema is not the application's to manage.

The contract expresses this with one field. The Supabase extension ships its contract with a default of `external`, and the planner and verifier do the rest:

```jsonc
{
  "target": "postgres",
  "defaultControlPolicy": "external",
  "storage": {
    "namespaces": {
      "auth": {
        "tables": {
          "users": {
            "columns": {
              "id":    { "dataType": "pg/uuid", "nullable": false },
              "email": { "dataType": "pg/text", "nullable": false }
            }
          }
        }
      }
    }
  }
}
```

The verifier confirms `auth.users` exists and that the declared columns match exactly (after native-type normalization). The planner emits zero DDL into `auth`. The same intent can be authored per object rather than per contract, from either authoring surface:

```prisma
model AuthUser {
  id    String @id
  email String
  @@map("users")
  @@control(external)
}
```

```ts
defineContract(
  { family, target, defaultControlPolicy: 'external' },
  () => ({
    models: {
      AuthUser: model('AuthUser', {
        fields: {
          id: field.column(uuidColumn).id(),
          email: field.column(textColumn),
        },
      }).sql({ table: 'users' }),
    },
  }),
)
```

A first note on naming, because the word "control" is overloaded in this system. This ADR is about **control policy** — a per-object governance field that says how much of an object's lifecycle the framework owns. It is unrelated to the **control plane** ([ADR 151](ADR%20151%20-%20Control%20Plane%20Descriptors%20and%20Instances.md), [ADR 204](ADR%20204%20-%20Domain%20actions%20vs%20composable%20primitives%20in%20the%20control%20plane.md)), which is the machinery that executes migrate and verify. Control policy is *data carried in the contract*; the control plane is *behaviour that reads it*.

---

## Decision

Every persisted object in a contract carries an optional control policy drawn from a **fixed, framework-defined vocabulary of four values** — `managed`, `tolerated`, `external`, `observed` — that ranges from "the framework owns this completely" to "the framework knows about this but never touches it". A single resolver computes each object's effective policy; the schema verifier and the migration planner both **dispatch** on that policy. The dispatch logic lives **once, on each family's abstract base**; targets contribute only the small, target-specific hooks the dispatch needs. Targets may widen the set of *object kinds* that carry a policy, but they may not add a fifth *value*.

The rest of this document builds that up: the vocabulary, then how an object's policy is resolved and serialized, then where the dispatch lives, then the safety floor that makes `external` trustworthy, then the authoring surfaces. Rejected alternatives are collected at the end.

---

## The vocabulary

The four values sit on a spectrum of framework ownership:

| Policy | Verifier behaviour | Planner / DDL behaviour |
|---|---|---|
| `managed` | Must exist and match exactly; any drift is a `fail`. | Full lifecycle: `CREATE`, `ALTER`, `DROP`. |
| `tolerated` | Declared columns must match; extra, undeclared columns are accepted. | Create if missing; never `ALTER` or `DROP` an existing object. |
| `external` | Declared columns must match exactly; extra columns and constraints are ignored. | Never emit DDL. |
| `observed` | May exist or not, may mismatch; every divergence is a `warn`, never a `fail`. | Never emit DDL. |

`managed` is the framework's home ground: it owns the object end to end. `external` is the opposite pole — the framework will *check* the object against a declaration but will never *write* to it, which is exactly what referencing someone else's schema requires. `tolerated` and `observed` fill the middle: `tolerated` creates an object once and then leaves it alone (useful for objects the framework introduces but does not keep in lockstep), and `observed` is purely informational, a declaration the framework reports on but never acts upon.

```ts
export type ControlPolicy = 'managed' | 'tolerated' | 'external' | 'observed';
```

The vocabulary is **framework-locked**. A target may extend the set of IR node *kinds* that carry a policy — Postgres enums carry one, and roles or RLS policies would when they become persisted kinds — but no target may introduce a fifth *value*. The four values let the verifier and planner dispatch exhaustively without ever inspecting which target produced the object. A new value is a deliberate framework-level change, made only when a concrete need for a fifth posture appears; it is not an extension point targets reach for.

## Resolving an object's effective policy

Most objects never name a policy. An object's effective policy is resolved by a three-level fallback: its own value, else the contract's default, else `managed`.

```ts
export function effectiveControlPolicy(
  nodeControl: ControlPolicy | undefined,
  defaultControlPolicy: ControlPolicy | undefined,
): ControlPolicy {
  return nodeControl ?? defaultControlPolicy ?? 'managed';
}
```

The contract carries the default as a top-level `defaultControlPolicy?: ControlPolicy`. This is the field that does the work in practice: an extension that wraps an externally-owned schema sets `defaultControlPolicy: 'external'` once, and every object it declares inherits it. An application that owns its whole schema sets nothing and gets `managed` everywhere, which is the behaviour the framework had before control policy existed.

The resolver is deliberately framework-agnostic — it takes two raw optional values, not typed IR nodes — so that the verifier and the planner call the *same* function without depending on each other's types. There is one definition of "effective policy" in the system, and both consumers read it. Neither re-derives the precedence chain on its own, so the two can never disagree about what an object's policy is.

Because the default absorbs the common case, the field is **omitted from the serialized contract whenever an object's effective policy equals the contract default**. A contract that names no policies serializes identically to one with no notion of control policy at all, and therefore hashes identically. Control hashing is content-addressed, so this property is what lets the field exist without disturbing any contract that does not use it.

Where the field lives is shaped by the contract IR's structure ([ADR 221](ADR%20221%20-%20Contract%20IR%20two%20planes%20with%20uniform%20entity%20coordinate%20and%20pack-contributed%20entity%20kinds.md)). That ADR fixes the framework `Namespace` interface at `{ id, kind }` with no family-specific fields, so there is no single base class on which to hang a per-object field. The policy field is therefore declared on each concrete storage leaf independently — SQL tables and columns, the Mongo collection, the Postgres enum entry, and any future persisted kind. The cost is that a new persisted kind must opt in explicitly; the benefit is that the framework layer stays honest about knowing nothing family-specific. Each leaf uses the same idiom — an optional readonly field assigned only when present — so an unset policy is never an own-enumerable property and never serializes, and the no-churn property above falls straight out of it.

## Family-owned dispatch, target-supplied hooks

The verifier and the planner both decide what to do per object by switching on its effective policy. That decision is identical across every target within a family, so it lives **once on the family's abstract base** rather than being re-implemented per target. This is the [three-layer polymorphic IR pattern](../patterns/three-layer-polymorphic-ir.md): the framework defines the vocabulary and the resolver, the family owns the dispatch, and the target supplies only the hooks the dispatch cannot know on its own.

For the SQL verifier, the target supplies one hook, `normalizeDefault`, which canonicalises the spelling of column default expressions. Type spelling needs no hook: the contract side is written from the column's data type ([ADR 254](ADR%20254%20-%20Data%20types%20and%20casts.md)), and the target's introspection reports the database's type in that same written form (`int4` and `integer` are the same Postgres type and both arrive as `int4`). Neither step claims that two distinct types are equivalent. After normalisation, column-type comparison is **exact equality** for all four control policies. There is no "compatible-shape" seam; the family base does not delegate a compatibility relation to the target.

**Why there is no compatibility hook.** Column-type compatibility is a question about whether two *codecs'* storage types are interchangeable — a concern that is correct only with full knowledge of the codecs involved. Codecs are an open extension point: a user-supplied codec can map a domain type onto any native type, and a list of "compatible" native-type pairs maintained by the framework or the target would necessarily be incomplete. More critically, any pair that appeared on such a list would silently suppress a `type_mismatch` under `external`, which is the one policy where the framework offers no DDL safety net. A false "compatible" result under `external` is worse than useless: it lets a schema drift go undetected with no corrective path. Exact equality after normalisation is the only guarantee the framework can make honestly.

**Verifier dispatch** maps each policy to a severity per situation:

| Live-vs-declared situation | `managed` | `tolerated` | `external` | `observed` |
|---|---|---|---|---|
| Declared object/column missing | `fail` | `fail` | `fail` | `warn` |
| Declared column type mismatch | `fail` (exact) | `fail` (exact) | `fail` (exact) | `warn` |
| Extra, undeclared column | `fail` | accepted | accepted | `warn` |
| Extra constraint / index | `fail` | `fail` | accepted | `warn` |

The Mongo family base mirrors the same four-way severity dispatch over collections, expressed in terms of existence and index checks rather than column types. The shape of the decision is the family's; only the primitives it compares differ.

**Planner dispatch** gates DDL per policy:

- `managed` — full lifecycle; every operation is permitted.
- `tolerated` — only operations that create a previously-absent top-level object (a table, enum, or schema) are permitted; operations that alter or drop an existing object are suppressed.
- `external` and `observed` — no DDL at all.

## The external-namespace safety floor

`external` is only worth trusting if it cannot be defeated by a single careless declaration. Consider an application that imports an `external`-default extension and, by mistake, marks one table inside that namespace as `managed`. Taken literally, that override would invite the planner to emit DDL into a schema the framework must never touch.

The planner refuses. When the contract default is `external`, every object in that contract space resolves to `external` regardless of any per-object override — the floor is not overridable:

```ts
export function controlPolicyForCall(
  subject: ControlPolicySubject | undefined,
  defaultControlPolicy: ControlPolicy | undefined,
): ControlPolicy {
  if (defaultControlPolicy === 'external') {
    return 'external';
  }
  return effectiveControlPolicy(subject?.explicitNodeControlPolicy, defaultControlPolicy);
}
```

A mistake of this kind is not silently swallowed. When the floor suppresses DDL that an override would otherwise have produced, the planner records a `warn`-level conflict identifying the suppressed object by its coordinates. The plan still succeeds — the safe outcome already happened — but the contradiction is visible.

The choice to enforce this at the planner, rather than reject the override at authoring time, is deliberate. A hard authoring error would forbid a legitimate pattern: an extension that is `external` by default but genuinely owns one object within its space. The floor lets that object's declaration stand while guaranteeing the dangerous interpretation can never reach the database. Enforcement lives in one place; the authoring surface does not duplicate it.

## Authoring surfaces

The contract default is set wherever a contract is specified, with parity across authoring surfaces. The PSL specifier and the TypeScript builder both accept `defaultControlPolicy`, and both apply it through one shared step so a value carried in the source contract wins over a specifier-supplied default. PSL additionally gains a model-level `@@control(<policy>)` attribute for per-object overrides; it reuses the existing parameterized-attribute grammar and lowers to the same storage-leaf field the TypeScript surface produces. Both paths converge on the single IR field and the single resolver, so the dispatch above is blind to how an object's policy was authored.

---

## Consequences

An extension that wraps an externally-owned schema sets `defaultControlPolicy: 'external'` once. Every object it declares stays out of application migration plans automatically, while the verifier still confirms those objects exist and match exactly — the behaviour the opening example needs, with no per-object ceremony.

The common case stays free. An application that owns its whole schema names no policies, resolves to `managed` everywhere, and produces byte-identical contract hashes to a world without control policy. The field is invisible to anyone who does not use it.

Dispatch lives once per family. A new SQL target inherits the four-way semantics for free and supplies only its own native-type normaliser and any target-only carrier kinds; no gating logic is copied per target.

The cost is borne at the IR leaves. Because the framework namespace interface carries no family-specific base ([ADR 221](ADR%20221%20-%20Contract%20IR%20two%20planes%20with%20uniform%20entity%20coordinate%20and%20pack-contributed%20entity%20kinds.md)), each new persisted object kind must add the policy field explicitly. The idiom is mechanical and well-worn across the existing carriers, but it is a recurring touch-point a future kind must remember.

---

## Alternatives considered

**A fifth value, contributed per target.** A target could be allowed to introduce its own posture — say, `read-only` — alongside the four. Rejected: the value set is what lets the verifier and planner dispatch exhaustively without inspecting the target, and an open-ended set forces every framework-level consumer to handle an unknown it cannot reason about. A genuine need for a fifth posture is a framework decision, made once for everyone, not a target escape hatch.

**Per-column policy overrides.** Letting a column carry a policy distinct from its table. Rejected: no consumer needs a `managed` table with an `external` column, and supporting it adds a resolution level (object, then column, then default) that both the verifier and planner would have to thread through. Columns inherit their table's effective policy. The field could be added to columns later without disturbing the resolver's shape if a real case appears.

**Namespace-level policy inheritance.** Marking a namespace `external` so its contents inherit, rather than setting a contract default. Rejected: policy boundaries align with contract-space boundaries — an extension that wraps an external schema is `external` in its entirety, and an application is `managed` in its entirety — so no consumer mixes policies within one contract space. Per-namespace inheritance would add grammar, an IR field, and a resolver level with nothing yet to justify it. It remains cheap to add: one optional namespace field and one rung in the resolver. The case that would motivate it is an introspect-an-existing-database workflow, where a single space legitimately straddles owned and adopted objects.

**Rejecting `managed`-inside-`external` at authoring time.** Treating the override in the safety-floor scenario as a hard error rather than a suppressed-with-warning. Rejected: it would forbid the legitimate pattern of an `external`-default space that genuinely owns one object, and the planner floor already guarantees the unsafe interpretation cannot reach the database. A visible warning preserves both the guarantee and the legitimate case.

**Introspection-driven defaulting.** Having an "adopt an existing database" tool assign policies to the objects it generates based on which schema owns them. Out of scope rather than rejected: such a tool's job is to choose the right `defaultControlPolicy` for each space it emits. This ADR provides the vocabulary and the dispatch; it does not decide how a generator should assign them.

---

## References

- [ADR 221 — Contract IR: two planes with a uniform entity coordinate and pack-contributed entity kinds](ADR%20221%20-%20Contract%20IR%20two%20planes%20with%20uniform%20entity%20coordinate%20and%20pack-contributed%20entity%20kinds.md) — the two-plane IR and the `Namespace { id, kind }` constraint that places the policy field on each storage leaf.
- [Pattern: Three-layer polymorphic IR](../patterns/three-layer-polymorphic-ir.md) — the framework-vocabulary → family-dispatch → target-hook layering instantiated here.
- [ADR 151 — Control plane descriptors and instances](ADR%20151%20-%20Control%20Plane%20Descriptors%20and%20Instances.md) and [ADR 204 — Domain actions vs composable primitives in the control plane](ADR%20204%20-%20Domain%20actions%20vs%20composable%20primitives%20in%20the%20control%20plane.md) — the *control plane* (migrate/verify execution), distinct from the *control policy* this ADR defines.
