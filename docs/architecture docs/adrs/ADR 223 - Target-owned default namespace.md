# ADR 223 — Target-owned default namespace

**Status:** Accepted
**Date:** 2026-06-01
**Linear:** TML-2605

> **Update — emission takes several namespaces.** The single-namespace emission guard this ADR describes (`assertSingleDomainNamespaceForEmission`) no longer exists: `contract emit` emits a contract that declares several domain namespaces, and `migration plan` and `db update` plan and apply changes across them, including statements that move a model to another namespace and rename or remove a namespace. The runtime's sole-namespace helpers still throw for such a contract, as described below.

---

## A concrete example

A Postgres contract declares models under `domain.namespaces.public` and tables under `storage.namespaces.public`. Application code keeps the flat surface:

```ts
const rows = await db.sql.user.findMany();
```

At runtime the ORM and SQL builder resolve the bare name `user` to its namespace coordinate, stamp the resolved storage namespace on the table AST node, and the Postgres adapter renders:

```sql
FROM "public"."user"
```

The same bare name on SQLite or Mongo resolves through that contract's sole namespace (`__unbound__`); SQLite's `qualifyTable` remains a no-op (`"user"`), and Mongo addresses the collection in the late-bound namespace's database without SQL-style qualification.

The fact that makes `public` (not `__unbound__`) the Postgres default is declared **once**, on the Postgres target descriptor.

---

## Decision

**A target's default namespace is static data owned by the target.** Each target declares it once, on its descriptor:

```ts
readonly defaultNamespaceId: string;
```

| Target | `defaultNamespaceId` |
|---|---|
| Postgres | `public` |
| SQLite | `__unbound__` |
| Mongo | `__unbound__` |

**Authoring is the sole consumer.** When authoring lowers a contract (the TS builder's `build-contract.ts` and the PSL interpreter), it stamps a bare model/table's namespace coordinate from `definition.target.defaultNamespaceId`. No framework or family package names a target for this fact, and **no `targetId === 'postgres'` default-namespace branch exists anywhere** — the descriptor field is the single source.

(Targets still legitimately differ in *grammar/validation* — Postgres reserves the `unbound` keyword for the late-binding opt-in; SQLite rejects `namespace { … }` blocks because it has no schema concept. Those are target-shaped rules within the SQL family, distinct from the default-namespace fact, and are not governed by this ADR.)

**Runtime resolves bare names from the contract's sole namespace — it needs no per-target default.** The contract carries the target only as an id *string* (`contract.target`), not the descriptor object. It does not need one: `defaultNamespaceId` is an *authoring-time placement* fact, and once authoring has lowered the contract every model/table already sits in an explicit namespace. A bare name (`db.User`) therefore resolves to "the contract's one namespace" — no inference, no guess. The domain-access helpers (`domainModelsAtDefaultNamespace` / `domainValueObjectsAtDefaultNamespace`) return that namespace's entities via `soleDomainNamespaceId`, which **throws** when the contract declares zero or more than one namespace rather than silently picking one. The bare-name resolvers (`resolveStorageTable` / `resolveDomainModel`) scan the contract's namespaces for the named entity; for the single-namespace contracts in scope the scan is exact. Explicit cross-namespace selection and bare-name collision ergonomics — the only cases where a stored default would change the answer — are [TML-2550](https://linear.app/prisma-company/issue/TML-2550), which selects a namespace explicitly rather than defaulting.

**SQL qualification** is not re-derived at render time by bare table name. Once the proxy or accessor has chosen a namespace, the coordinate is carried on the relational AST; the family adapter renders identifiers via the namespace concretion's `qualifyTable(tableName)` (Postgres → `"schema"."table"`; SQLite unbound → `"table"`). Column references in SELECT lists remain alias-qualified as before.

**Runtime and emitter both fail loud on multi-namespace:**

- **Runtime** reads the flat model / value-object surface through the sole-namespace helpers, which **throw** (via `soleDomainNamespaceId`) when a contract declares more than one domain namespace — they do not silently project one namespace and drop the rest. The bare-name entity resolvers scan and are exact for single-namespace contracts. Multi-namespace flat access awaits the explicit per-namespace APIs ([TML-2550](https://linear.app/prisma-company/issue/TML-2550)).
- **Contract emission** keeps the matching **fail-loud** single-namespace guard (`assertSingleDomainNamespaceForEmission`) because per-namespace `contract.d.ts` slices are not emitted yet. Extension authors with multiple namespaces must target explicit namespace paths in hand-authored types until TML-2550 co-designs per-namespace emission with the explicit DSL surface.

Transitional projection helpers (`contractModels`, `contractValueObjects`, `ContractModelsMap`, `ContractValueObjectsMap`) are removed from the foundation `contract` package; consumers read models/value objects through the sole-namespace access helpers and use `ContractModelDefinitions<Contract>` for typed model shapes.

---

## Context

[ADR 221](ADR%20221%20-%20Contract%20IR%20two%20planes%20with%20uniform%20entity%20coordinate%20and%20pack-contributed%20entity%20kinds.md) established namespaced `domain` and `storage` planes with uniform entity coordinates. Authoring already centralised Postgres's default as `public` in contract-ts/PSL. Runtime query SQL nevertheless continued to emit bare `"user"` because the relational AST dropped namespace identity after proxy resolution, and flat-name lookup scanned namespaces in insertion order.

The symmetric-domain-plane work moved models under `contract.domain.namespaces` but left throw-on-multi-namespace projection helpers as a deliberate bridge. Runtime qualification completes the bridge: namespace identity carried to the renderer, namespace-qualified SQL where the target requires it, and retirement of the transitional helpers.

The first implementation of the default-namespace rule expressed it as **framework- and family-level constants that name a target** — `POSTGRES_DEFAULT_DOMAIN_NAMESPACE_ID`, `defaultDomainNamespaceIdForSqlTarget`, `defaultDomainNamespaceIdForMongo` in the target-agnostic foundation `contract` package, `defaultStorageNamespaceIdForSqlTarget` in the SQL family, each branching on `targetId === 'postgres'`. That inverts the dependency direction: target-agnostic packages are not allowed to enumerate targets. This ADR records the corrected design — the one fact a target owns (its default namespace) lives on the target's descriptor, and target-agnostic code stays target-agnostic (it scans, or accepts an optional default from a caller that has one).

---

## Consequences

- **Positive:** Single-namespace Postgres consumers need no query-code changes; emitted SQL matches database schema qualification; the AST coordinate is the extension point for explicit per-namespace DSL ([TML-2550](https://linear.app/prisma-company/issue/TML-2550)) without another render-time rewrite.
- **Positive:** The default namespace lives in exactly one place — the target descriptor — so a new target declares it without touching framework or family code, and no target-agnostic package enumerates targets.
- **Positive:** Runtime resolution is target-agnostic; the runtime does not need the descriptor object at all for single-default-namespace contracts.
- **Trade-off:** Multi-namespace contracts at runtime resolve a bare name by scanning (sole namespace, else insertion order); cross-namespace collisions on the flat surface are not diagnosed until the explicit APIs ship ([TML-2550](https://linear.app/prisma-company/issue/TML-2550)).
- **Trade-off:** Emitter still rejects multi-namespace contracts for typed emission; runtime and emitter behaviour intentionally diverge until per-namespace `contract.d.ts` exists.

---

## References

- [ADR 221 — Contract IR two planes with uniform entity coordinate and pack-contributed entity kinds](ADR%20221%20-%20Contract%20IR%20two%20planes%20with%20uniform%20entity%20coordinate%20and%20pack-contributed%20entity%20kinds.md)
- Linear: [TML-2605](https://linear.app/prisma-company/issue/TML-2605), [TML-2550](https://linear.app/prisma-company/issue/TML-2550)
