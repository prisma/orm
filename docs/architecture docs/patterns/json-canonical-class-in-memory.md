# Pattern: JSON-canonical / class-in-memory round-trip

**Status:** Stable
**Maintainer:** architect

## Intent

A migration emits `ops.json`; some time later, a runner in a different process reads that file and applies the ops. In between, you want to `cat` the file in PR review, `git diff` it across versions, `grep` it during an incident, and hash it for attestation — none of which work if the canonical form is "a tree of TypeScript class instances". So `ops.json` is the contract: the bytes the runner re-reads, the bytes the hash is computed over, the bytes a human can review. In memory the runner walks classes (so it gets polymorphic dispatch via [Frozen-class AST + visitor](./frozen-class-ast.md)), but the JSON is what's authoritative.

The pattern: keep the persisted shape and the in-memory shape **the same shape** — every class field is a plain readonly value with a stable JSON encoding, so `JSON.stringify(node)` round-trips without a custom `toJSON()`. Validate at the boundary (with arktype) when reading; trust the instances inside. Identity (hashes, attestation) keys off the JSON, never off the in-memory representation.

## When to use

- The artifact persists across processes (planner emits, runner consumes; tooling emits, runtime consumes).
- Reproducibility, attestation, or auditability requires a stable byte-level form — for example, content-addressed hashes computed over the JSON.
- In-memory consumers benefit from polymorphic dispatch over a kind-discriminated tree (typically pairs with [Frozen-class AST + visitor](./frozen-class-ast.md)).
- The artifact must be reviewable as data — diffable in PRs, greppable in incidents, parseable by tools that have no TypeScript runtime.

## When NOT to use

- **Transient values that never persist** — a frozen plain object is enough; the JSON contract adds no value.
- **Configuration objects with no polymorphism** — `Record<string, T>` over a typed value is simpler than a class hierarchy.
- **Hot-path runtime structures** where the JSON serialise/parse cost matters (or where field types genuinely need `Map` / `Set` / `Date` semantics) — model the persistent form separately and accept the dual-shape cost as deliberate.
- **Stateful services** — use [Interface + factory function](./interface-plus-factory.md). A service has a lifecycle; this pattern is for data.

## Structure

```
            authoring                      apply / consume
                │                                 ▲
                ▼                                 │
   ┌─────────────────────┐         ┌─────────────────────────────┐
   │  class instances    │── JSON.stringify ───► │  ops.json     │
   │  (frozen AST nodes) │                       │  contract.json│
   │  with `kind` field  │◄── arktype validate ──│               │
   └─────────────────────┘         └─────────────────────────────┘
            ▲                                 │
            │                                 ▼
       in-memory                     content-addressed,
       polymorphic                   reviewable, replayable
       dispatch                      across processes
```

The classes have plain readonly fields only — no methods on properties, no JS types that don't have a stable JSON form. Hydration walks the JSON, switches on `kind`, and calls the matching constructor; the constructor calls `Object.freeze(this)` (per [Frozen-class AST + visitor](./frozen-class-ast.md)). Identity is computed over the canonical JSON, never over the in-memory representation.

## Reference implementations


| Implementation                  | Path                                                                                                                                                                    | Demonstrates                                                                                                                                   |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Migration `ops.json` (Mongo)    | `[packages/3-targets/mongo/1-target/src/core/op-factory-call.ts](../../../packages/3-targets/mongo/1-target/src/core/op-factory-call.ts)`                     | `OpFactoryCall` classes serialise via `JSON.stringify` to `ops.json`; the runner rehydrates and walks the same class hierarchy at apply time.  |
| Migration `ops.json` (Postgres) | `[packages/3-targets/postgres/1-target/src/core/migrations/op-factory-call.ts](../../../packages/3-targets/postgres/1-target/src/core/migrations/op-factory-call.ts)` | Same shape on the SQL side; demonstrates the pattern is target-agnostic.                                                                       |
| Mongo wire commands             | `[packages/2-mongo-family/6-transport/mongo-wire/src/wire-commands.ts](../../../packages/2-mongo-family/6-transport/mongo-wire/src/wire-commands.ts)`                   | Wire commands round-trip natively because MongoDB commands *are* JSON; the canonical example of the pattern's "JSON is the contract" property. |


## Related ADRs

- [ADR 192 — ops.json is the migration contract](../adrs/ADR%20192%20-%20ops.json%20is%20the%20migration%20contract.md) — the codifying decision: JSON is what gets attested and replayed; classes are the authoring sugar that emits it.
- [ADR 196 — In-process emit for class-flow targets](../adrs/ADR%20196%20-%20In-process%20emit%20for%20class-flow%20targets.md) — companion decision for the emit half of the round-trip.
- [ADR 097 — Tooling runs on canonical JSON only](../adrs/ADR%20097%20-%20Tooling%20runs%20on%20canonical%20JSON%20only.md) — extends the principle from migrations to the contract.
- [ADR 098 — Runtime accepts contract object or JSON](../adrs/ADR%20098%20-%20Runtime%20accepts%20contract%20object%20or%20JSON.md) — the runtime side of the same boundary.

## Related patterns

- [Frozen-class AST + visitor](./frozen-class-ast.md) — the in-memory half. Almost every adopter of this pattern is also an adopter of that one; the two compose.
- [Three-layer polymorphic IR](./three-layer-polymorphic-ir.md) — the layering pattern that JSON-canonical IRs typically follow when targets extend the framework's kind set.

## Cautions / common mistakes

- **Non-JSON-clean fields.** A `Map`, `Set`, `Date`, or method-on-property field will silently round-trip wrong (a `Date` becomes a string; a `Map` becomes `{}`). Every class field should be a plain readonly value of a type with a stable JSON encoding.
- **Custom `toJSON()`.** Once a class needs a custom `toJSON()` to serialise correctly, the in-memory shape and the JSON shape have diverged — the round-trip is no longer canonical. Surface the divergence rather than papering over it with `toJSON()`.
- **Hashing the in-memory form.** Identity must key off the JSON, not the class instances; in-memory representations can vary by Node version, by frozen-state, by V8 internals. The JSON is the only stable byte stream.
- **Skipping arktype validation at the boundary.** A consumer that constructs class instances from an unverified JSON shape inherits every drift, every renamed field, every off-by-one-version mismatch. Validate at the boundary; trust inside it.

