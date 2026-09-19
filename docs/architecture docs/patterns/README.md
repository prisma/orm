# Architecture pattern catalogue

This catalogue is the single place to learn **which structural shapes the Prisma 8 codebase has settled for**. Each entry pins a pattern's intent, when it applies (and when it does not), the canonical structure, and reference implementations in the codebase. Consult it before approving — or proposing — a new architectural shape.

The catalogue is distinct from its neighbours:

- **ADRs** ([`../adrs/`](../adrs/)) record one-time decisions. The catalogue records the recurring shapes those decisions instantiate.
- **Cursor rules** ([`../../../.cursor/rules/`](../../../.cursor/rules/)) are tactical do/don'ts. The catalogue records the structural rationale a rule enforces.
- **Reference docs** ([`../../reference/`](../../reference/)) are subsystem how-to guides. The catalogue records cross-subsystem shapes; subsystem-specific shapes stay in the reference docs.

## v1 entries

The "Reach for it when..." column is the fastest way to scan: read it for the situation you're in, then open the entry that matches.

| Pattern | Slug | Reach for it when... | Status |
|---|---|---|---|
| Frozen-class AST + visitor | [`frozen-class-ast.md`](./frozen-class-ast.md) | You have a tree with many kinds and many consumers, and you want every consumer to break loudly when a new kind is added. | Stable |
| JSON-canonical / class-in-memory round-trip | [`json-canonical-class-in-memory.md`](./json-canonical-class-in-memory.md) | You're writing data to disk that another process will read back, and you want the on-disk form to be diffable, greppable, and hashable. | Stable |
| Three-layer polymorphic IR | [`three-layer-polymorphic-ir.md`](./three-layer-polymorphic-ir.md) | An IR crosses the framework/target boundary and targets need to add kinds the framework cannot anticipate (Postgres-only, Mongo-only). | Emerging |
| SPI at the lowest consuming layer | [`spi-at-lowest-consuming-layer.md`](./spi-at-lowest-consuming-layer.md) | A lower layer needs to call into a higher-layer implementation, and `pnpm lint:deps` would otherwise force a circular import. | Stable |
| Interface + factory function (stateful services) | [`interface-plus-factory.md`](./interface-plus-factory.md) | You're building a stateful service (registry, runtime, adapter, driver) and consumers should never see the implementation class. | Stable |
| Adapter SPI for target-specific behaviour | [`adapter-spi.md`](./adapter-spi.md) | The framework needs target-specific behaviour (dialect, capabilities, error mapping) and you can't write `if (target === 'postgres')`. | Stable |
| Capability gating | [`capability-gating.md`](./capability-gating.md) | A feature is target-optional or target-varying (`RETURNING`, `LATERAL`, prepared statements), and the framework needs to check before relying on it. | Stable |
| Package layering: domains × layers × planes | [`package-layering.md`](./package-layering.md) | You're creating a new package, adding an import, or reaching for "shared utilities" — and you need to know where it goes. | Stable |
| Authoring warning sink | [`authoring-warning-sink.md`](./authoring-warning-sink.md) | A target pack or lowering helper needs to surface a non-fatal, batchable advisory to the user, and the emitter cannot see the flush boundary. | Emerging |

The status column reads **Stable** once an entry has at least two reference implementations in the codebase, and **Emerging** when a pattern has one shipped adopter plus a credible second adopter committed. Two entries are Emerging: three-layer polymorphic IR (migration ops follow it today; Contract IR and Schema IR are committed to follow) and the authoring warning sink (two push sites shipped — the shared index lowering and the Postgres policy factory — through one warning kind; a second warning kind is what graduates it).

## How to add a new pattern

A new entry joins the catalogue when it earns its keep against four criteria:

1. **Recurrent.** At least two reference implementations exist in the codebase, or are explicitly committed to land via an in-flight project. One-off shapes stay as ADRs.
2. **Crosses subsystem boundaries.** Patterns that fit inside a single subsystem belong in that subsystem's doc; the catalogue is for shapes any contributor working anywhere in the codebase might need.
3. **Structural, not tactical.** "How to lay out an AST node" is structural; "use `pathe` for paths" is tactical and belongs as a Cursor rule.
4. **Earns its keep.** A speculative-future pattern with no current adopter does not belong here — wait for the second instance.

The process:

1. Copy [`_template.md`](./_template.md) to a new kebab-case slug.
2. Fill in every section — every claim must cite a reference implementation, an ADR, or a rule. **Lead with a grounding example**; the template's own guidance has the writing rules.
3. Add a row to the table above and link the slug.
4. Cross-link from any related ADRs, rules, or reference docs.
5. Open a PR. The **architect persona** ([`.agents/skills/drive-agent-personas/personas/architect.md`](../../../.agents/skills/drive-agent-personas/personas/architect.md)) owns the bar; tech-lead arbitrates if there is disagreement on whether the entry is ready.

## Related indexes

- [ADR index](../ADR-INDEX.md) — every architecture decision the codebase has recorded.
- [Package layering](../Package-Layering.md) — the canonical doc for the package-layering pattern; the catalogue's entry summarises and links here.
- [Reference docs](../../reference/) — subsystem how-to guides; the catalogue cross-links here for capability lists, codec authoring, query patterns, etc.
