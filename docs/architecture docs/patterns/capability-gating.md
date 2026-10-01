# Pattern: Capability gating

**Status:** Stable
**Maintainer:** architect

## Intent

Postgres supports `RETURNING` on `INSERT`. MySQL doesn't. SQLite supports it from a particular version. The framework can't pretend the feature is universal, but it also can't write `if (target === 'postgres')` everywhere `RETURNING` might apply. Instead, the framework asks `capabilities.sql.returning` at the consumption site: if true, build the `RETURNING` clause; if false, fall back to a separate `SELECT`.

The pattern: declare optional or target-varying features as **namespaced capabilities** in the contract or on the adapter profile. Verify them against the live database when relevant. Gate at every consumption site — the gate names a capability, never a target. When a capability is absent, the framework degrades, falls back, or refuses honestly; it never silently assumes.

## When to use

- A feature is target-optional (some targets implement it, others do not — `RETURNING`, `LATERAL`, `jsonAgg`).
- A feature is target-varying (the same target supports it differently across versions — prepared statements, JSON ops, partial indexes).
- A feature depends on live database state that the contract alone cannot tell you (extension installed, server version, configuration flag).
- A pack or extension surfaces a feature the framework should consume only when the pack is present (pgvector operators, PostGIS types).

## When NOT to use

- **Universally supported features.** A capability that every target the framework currently models supports adds noise without signal — gating it is performative. Surface as debt and remove the gate.
- **Features whose absence is a build error, not a runtime degradation.** If "no capability X" means the contract is broken rather than "X is unavailable", model it in the contract type instead of as a runtime capability.
- **Implementation toggles disguised as capabilities.** A capability key that gates an internal implementation choice (cursor vs full-fetch, JSON_AGG vs LATERAL) belongs on the adapter as a configuration option, not as a contract capability.

## Structure

```
contract.capabilities = {                          // declared at authoring time
  sql: { returning: true, defaultInInsert: true },
  postgres: { jsonAgg: true, lateral: true, returning: true },
  // …namespaced per family / target / extension pack
}

adapter.profile.capabilities = {                   // declared by the adapter
  sql:      { enums: true, returning: true, defaultInInsert: true },
  postgres: { orderBy: true, limit: true, lateral: true, jsonAgg: true, returning: true },
}

// at every consumption site:
if (adapter.profile.capabilities.postgres.lateral) {
  return lowerWithLateral(ast);
}
return lowerWithCorrelatedSubquery(ast);
```

The capability is **a key, not a code path** — gates are explicit, namespaced (`postgres.lateral`, not `lateral`), and live next to the consumption site, not buried in a target check. Family-instance views project the cross-cutting capability profile onto family-shaped surfaces so consumers see only the capabilities relevant to them — see [ADR 207](../adrs/ADR%20207%20-%20Family-instance%20capability%20views%20for%20the%20framework%20CLI.md).

## Reference implementations

| Implementation | Path | Demonstrates |
|---|---|---|
| Framework capability surfaces | [`packages/1-framework/1-core/framework-components/src/control/control-capabilities.ts`](../../../packages/1-framework/1-core/framework-components/src/control/control-capabilities.ts) | The framework-side capability discriminators (`hasMigrations`, `hasSchemaView`, `hasPslContractInfer`) — capability checks as type guards on the family / target descriptor. |
| Postgres adapter capability profile | [`packages/3-targets/6-adapters/postgres/src/core/adapter.ts`](../../../packages/3-targets/6-adapters/postgres/src/core/adapter.ts) (search for `defaultCapabilities`) | The `AdapterProfile.capabilities` object the adapter surfaces; namespaced under `postgres` and `sql`. |
| Capability namespace catalogue | [`docs/reference/capabilities.md`](../../reference/capabilities.md) | The catalogue of actual capability keys and their semantics. The pattern entry links forward; this catalogue entry does not duplicate. |
| Conflict skipping on `createAll` | [`packages/3-extensions/sql-orm-client/src/collection-contract.ts`](../../../packages/3-extensions/sql-orm-client/src/collection-contract.ts) (search for `assertInsertConflictSkipCapability`) | Two keys for one feature: `sql.insertOnConflictSkip` says the adapter can skip colliding rows at all, `sql.insertOnConflictWithoutTarget` says it can do so without a named constraint. Postgres and SQLite report both; SQL Server will report only the first. The optional `conflictOn` argument exists so a target that needs a key can require it through the second capability, with no API change. |

## Related ADRs

- [ADR 005 — Thin Core Fat Targets](../adrs/ADR%20005%20-%20Thin%20Core%20Fat%20Targets.md) — the framing principle; capabilities are how a thin core composes with fat targets.
- [ADR 031 — Adapter capability discovery & negotiation](../adrs/ADR%20031%20-%20Adapter%20capability%20discovery%20&%20negotiation.md) — the negotiation mechanism between the contract's required capabilities and the adapter's offered ones.
- [ADR 065 — Adapter capability schema & negotiation v1](../adrs/ADR%20065%20-%20Adapter%20capability%20schema%20&%20negotiation%20v1.md) — the v1 schema for capability declaration.
- [ADR 117 — Extension capability keys](../adrs/ADR%20117%20-%20Extension%20capability%20keys.md) — the namespaced vocabulary extension packs use to surface their capabilities.
- [ADR 207 — Family-instance capability views for the framework CLI](../adrs/ADR%20207%20-%20Family-instance%20capability%20views%20for%20the%20framework%20CLI.md) — the family-instance projection over the cross-cutting profile.
- [ADR 210 — Prepared Statements: Author Surface and Driver SPI](../adrs/ADR%20210%20-%20Prepared%20Statements%20-%20Author%20Surface%20and%20Driver%20SPI.md) — a concrete example of a capability-gated runtime feature.

## Related patterns

- [Adapter SPI for target-specific behaviour](./adapter-spi.md) — capabilities live on the adapter's profile; this pattern is what consumers do with that profile.
- [SPI at the lowest consuming layer](./spi-at-lowest-consuming-layer.md) — the capability profile interface follows the SPI placement rules (lowest consuming layer).

## Related rules

- [`.cursor/rules/capabilities-ownership.mdc`](../../../.cursor/rules/capabilities-ownership.mdc) — the tactical rule for who owns which capability namespace and how to register a new key.

## Cautions / common mistakes

- **Branching on target instead of consulting the capability.** `if (target === 'postgres')` and `if (capabilities.postgres.lateral)` look similar but are deeply different — the latter is honest about what the code depends on, the former is a target check. Every feature gate should name a capability, never a target.
- **Capabilities that name implementations rather than features.** `useCursor: true` is a configuration; `cursorBatching: true` is a capability. The first belongs on the adapter as an option; the second belongs in the capability profile.
- **Silent degradation without surfacing.** A capability gate that silently falls back without telling the caller is a footgun — operators discover the degradation only when results diverge. Surface degradation through a structured warning or guardrail.
- **Capability keys without namespace.** `lateral` could mean a SQL feature or a Mongo aggregation stage. Namespacing (`postgres.lateral`, `mongo.lookup`) prevents collisions and makes the gate's scope explicit.
