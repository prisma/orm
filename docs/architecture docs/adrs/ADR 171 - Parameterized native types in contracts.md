# ADR 171 — Parameterized native types in contracts

**Status:** Superseded by [ADR 254 — Data types and casts](ADR%20254%20-%20Data%20types%20and%20casts.md). A data type now declares how its name is written, with and without parameters, and the bounds of those parameters. The planners, the schema verifier and `contractToSchema` write a column's type from the data type its codec represents. `CodecControlHooks.expandNativeType`, `expandLength`, `expandPrecision`, `expandNumeric` and `NativeTypeExpander` no longer exist. Contracts store the data type's id in `dataType` next to structured `typeParams`, and no type name. The content below is preserved as a historical record.

## Context

Some storage types are **parameterized** at the database level (for example `varchar(255)`, `bit(16)`, `vector(1536)`).

We need a safe, cross-target contract representation that:

- Preserves the base native type name for planner/type safety rules.
- Carries parameters as structured data.
- Allows adapters to render target-specific SQL correctly (for DDL) and also to verify schemas (contract vs database introspection).

This decision was prompted by pgvector `vector(N)` when authored via PSL named types: representing the full `vector(1536)` string in `nativeType` caused migration planning and verification edge cases (including unsafe quoting paths).

## Decision

For parameterized storage types, **contracts MUST represent the base type name in `nativeType`** and represent parameters in `typeParams`.

- Example (pgvector):
  - `nativeType: "vector"`
  - `typeParams: { length: 1536 }`

Expansion to a parameterized SQL type string (for example `vector(1536)`) is the responsibility of each component (adapter or extension) that owns the codec, via `CodecControlHooks.expandNativeType`:

- DDL/migrations: the migration planner extracts codec hooks from framework components and uses them when rendering column types.
- Schema verification: the schema verifier uses the same hooks to expand the *expected* type before comparing to introspected schema types.
- `contractToSchema`: receives framework components to build a `NativeTypeExpander` from hooks for offline planning.

No centralized dispatch function is used. Each component declares its own expansion logic alongside its codec hook definitions.

## Consequences

- **Safety**: planners and validators can continue applying native type safety rules to base type identifiers, without handling arbitrary strings that might look like executable SQL.
- **Determinism**: contracts remain stable; parameters are explicit structured data.
- **Extensibility**: new parameterized types can follow the same pattern by adding an `expandNativeType` hook to their component's `controlPlaneHooks` — no adapter changes needed.
- **No adapter coupling**: the adapter does not reference extension-owned codecs. Each component owns its expansion logic.
- **Hash changes**: adopting this convention changes storage/profile hashes for affected contracts; contracts should be re-emitted.

## Implementation Notes

- Contract authoring (PSL/TS) should emit base `nativeType` + `typeParams` for parameterized types.
- Expansion is hook-driven: each component provides `expandNativeType` in its `controlPlaneHooks` map. The planner and schema verifier extract hooks via `extractCodecControlHooks(frameworkComponents)` and look up per-codec hooks by `codecId`.
- The Postgres adapter defines category-based expansion functions (`expandLength`, `expandPrecision`, `expandNumeric`) assigned to its built-in codec hooks.
- Extensions (e.g. pgvector) define their own `expandNativeType` hooks for extension-owned codecs.

