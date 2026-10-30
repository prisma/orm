# Pattern: Package layering — domains × layers × planes

**Status:** Stable
**Maintainer:** architect

## Intent

A SQL-family package tries to import a type from a Mongo-family package. `pnpm lint:deps` refuses: SQL and Mongo are sibling family domains; neither knows about the other; the import would tangle two contexts that the architecture deliberately keeps separate. The fix is to lift the type to the framework domain if it is an affordance every family fills in, such as an interface or a base class, or else to redesign the coupling. Code that several targets share only so they can reuse it is not an affordance and does not go in the framework: it goes in `packages/3-targets/0-shared/` ([ADR 311](../adrs/ADR%20311%20-%20Code%20shared%20by%20several%20targets'%20type%20implementations%20lives%20in%20one%20package.md)).

The pattern: every package lives at known coordinates in a three-axis grid — **Domain × Layer × Plane**. Imports flow downward and outward only, enforced mechanically by `pnpm lint:deps`. The grid encodes a dependency direction so cross-cutting concerns don't accumulate as ad-hoc imports.

The three axes:

- **Domains** — Framework (target-agnostic), per-family (SQL, Mongo, Document), Targets (Postgres, SQLite, …), Extensions.
- **Layers** — Core → Authoring → Tooling → Lanes → Runtime → Adapters / Drivers. Lower layers are foundational; higher layers depend downward.
- **Planes** — Migration vs Runtime (vs Shared). Migration-plane code may not import runtime-plane code; runtime may consume migration _artifacts_ (JSON manifests), never migration code.

The full mapping and per-domain detail live in [`Package-Layering.md`](../Package-Layering.md); this entry pins the **shape** so a contributor can reach for the canonical doc when they need the rules.

## When to use

- Whenever you create a new package — the directory hierarchy and naming convention pin where it goes.
- Whenever you add an import — `lint:deps` checks the direction; this pattern is the rationale for what those checks enforce.
- Whenever you reach for a "shared utilities" package — the layering says shared code lives at a layer at-or-below every consumer; if no such layer exists, the shape is wrong.

## When NOT to use

- **Examples and integration tests** — these are explicitly outside the layering rule (they consume from many layers); the pattern still informs how you reason about their consumption, but it doesn't constrain their imports.
- **Tooling under `scripts/`** — repo-level scripts are not packages and have no layer; doc-tooling helpers like the catalogue link-checker are the canonical example.

## Structure

The full directory mapping is in [`Package-Layering.md`](../Package-Layering.md). At a glance:

```
packages/
├── 1-framework/        # Framework domain (target-agnostic)
│   ├── 1-core/         # Lowest layer; foundational types
│   ├── 3-tooling/      # Emitters, CLIs
│   └── 5-runtime/      # Runtime orchestration
├── 2-sql-family/       # SQL family domain
│   ├── 1-relational-core/, 3-tooling/, 4-lanes/, 5-runtime/, 9-family/, …
├── 2-mongo-family/     # Document family domain
│   └── 1-core/, 3-tooling/, 4-query/, 6-transport/, 9-family/, …
├── 3-targets/          # One folder per database (postgres, sqlite, mongo), plus 0-shared/ for code several targets share
│   └── postgres/1-target/, postgres/2-adapter/, postgres/3-driver/, postgres/4-codec-testkit/, postgres/9-facade/, …
└── 3-extensions/       # Extension packs (pgvector, sql-orm-client, …)
```

Within a package, the migration plane and runtime plane are separated as sibling entry points (`exports/runtime.ts`, `exports/migration.ts`); a package straddles planes only by exposing both, never by mixing them in one module.

The mapping is machine-readable in [`architecture.config.json`](../../../architecture.config.json) and enforced by `pnpm lint:deps`, which composes:

- `depcruise --config dependency-cruiser.config.mjs packages` — the core layering rules.
- [`scripts/lint-framework-target-imports.mjs`](../../../scripts/lint-framework-target-imports.mjs) — guards the framework / target boundary specifically.
- [`scripts/lint-app-space-id.mjs`](../../../scripts/lint-app-space-id.mjs) — guards that the contract `appSpaceId` constant lives only where it should.

## Reference implementations / sources of truth

| Source | Path | Demonstrates |
|---|---|---|
| Canonical doc | [`docs/architecture docs/Package-Layering.md`](../Package-Layering.md) | The full layering rules, naming conventions, and per-domain mapping. |
| Machine-readable mapping | [`architecture.config.json`](../../../architecture.config.json) | The package → (domain, layer, plane) assignments `lint:deps` consumes. |
| Layering enforcement | [`dependency-cruiser.config.mjs`](../../../dependency-cruiser.config.mjs) (`depcruise`), [`scripts/lint-framework-target-imports.mjs`](../../../scripts/lint-framework-target-imports.mjs), [`scripts/lint-app-space-id.mjs`](../../../scripts/lint-app-space-id.mjs) | The enforcement run by `pnpm lint:deps`. |

## Related ADRs

- [ADR 140 — Package Layering & Target-Family Namespacing](../adrs/ADR%20140%20-%20Package%20Layering%20&%20Target-Family%20Namespacing.md) — the codifying decision for the layering and naming.
- [ADR 005 — Thin Core Fat Targets](../adrs/ADR%20005%20-%20Thin%20Core%20Fat%20Targets.md) — the framing principle the layering operationalises.
- [ADR 150 — Family-Agnostic CLI and Pack Entry Points](../adrs/ADR%20150%20-%20Family-Agnostic%20CLI%20and%20Pack%20Entry%20Points.md) — the entry-point conventions that fall out of the layering.

## Related patterns

- [SPI at the lowest consuming layer](./spi-at-lowest-consuming-layer.md) — the pattern that formalises "interfaces live at the lowest layer that can host them"; it is the operational rule for cross-layer dispatch under this layering.
- [Adapter SPI for target-specific behaviour](./adapter-spi.md) — the layering puts adapters in their own layer; this pattern explains what adapters carry.

## Related rules

- [`.cursor/rules/import-validation.mdc`](../../../.cursor/rules/import-validation.mdc) — the tactical rule for `pnpm lint:deps`.
- [`.cursor/rules/no-barrel-files.mdc`](../../../.cursor/rules/no-barrel-files.mdc) — barrel files defeat the layering by hiding what a package consumes.
- [`.cursor/rules/multi-plane-packages.mdc`](../../../.cursor/rules/multi-plane-packages.mdc) — how a package straddles migration and runtime planes cleanly.
- [`.cursor/rules/multi-plane-entrypoints.mdc`](../../../.cursor/rules/multi-plane-entrypoints.mdc) — how a multi-plane package exposes its entry points without leaking cross-plane code.

## Cautions / common mistakes

- **Cross-plane imports.** A migration-plane module that imports from a runtime-plane module is a structural defect; the planes communicate through artifacts, not code.
- **Upward imports across layers.** Core importing from Tooling (or Tooling importing from Lanes) inverts the dependency direction; the SPI pattern exists to invert dependencies _without_ violating the layering.
- **Cross-domain imports without going through the framework.** A SQL-family package importing from a Mongo-family package leaks family-specific concepts across domains; routes that need to share an affordance should lift it to the framework domain or rethink the cross-domain coupling. Implementation code several targets reuse goes in `packages/3-targets/0-shared/`, not the framework.
- **A "utils" package that everyone imports.** Shared utilities that consumers from several layers depend on must live at a layer at-or-below every consumer. Give it a scope that names what it is for, not "utils". Code several targets' type implementations share goes in `@internal/type-implementations` (ADR 311); other shared code gets a package of its own scope at the lowest domain and layer every consumer can import, and the framework Core layer takes only affordances.
