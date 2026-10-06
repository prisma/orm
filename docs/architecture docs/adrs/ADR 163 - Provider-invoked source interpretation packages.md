# ADR 163 — Provider-invoked source interpretation packages

## Status

Accepted

## Context

Prisma Next supports multiple authoring inputs (TS-first and PSL-first) that must converge on the same deterministic emission pipeline:

`provider (input-specific) → Contract → validate/normalize → canonicalize/hash → emit`

We introduced provider-based contract sources (`config.contract.source: { inputs?: readonly string[]; load: (context: ContractSourceContext) => Promise<Result<Contract, ContractSourceDiagnostics>> }`) to keep the CLI/control plane **source-agnostic**. `inputs` is the user-declared list of source paths (e.g. `./schema.prisma`); the CLI loader resolves them to absolute paths and exposes them to `load` via `context.resolvedInputs`. At the same time, we want to keep input-specific logic (like PSL parsing + interpretation) pluggable and out of the CLI and control plane wiring.

During initial implementation, SQL PSL interpretation code lived in the TS authoring package (`@internal/sql-contract-ts`). That mixed concerns and increased the dependency surface of the TS authoring surface with PSL-specific logic.

## Decision

Input-specific parsing and interpretation live in **provider-invoked authoring packages** that:

- export **pure** interpretation APIs (no config loading, no CLI coupling)
- keep the interpreter itself free of file I/O; the provider's `load` may read from paths supplied via `context.resolvedInputs` and pass their contents to the interpreter
- return structured diagnostics with stable codes and spans when available

For SQL PSL-first, we create `@internal/sql-contract-psl` as the dedicated package that interprets PSL input into a SQL `Contract<SqlStorage, SqlModelStorage>`.

The CLI / ControlClient remain source-agnostic and do not import PSL-specific packages. They only call `config.contract.source.load()` and then emit from the returned `Contract`.

## Consequences

### Positive

- **CLI stays family/source-agnostic**: no PSL branching or imports in command handlers.
- **Pluggable providers remain real**: new authoring sources can ship as packages without modifying CLI/control-plane logic.
- **Clearer package boundaries**:
  - `@internal/sql-contract-ts`: TS-first authoring only
  - `@internal/sql-contract-psl`: PSL-first interpretation only
  - `@internal/psl-parser`: PSL parser plus shared symbol-table resolution (CST + parser diagnostics + target-agnostic symbols)

### Trade-offs

- Providers must compose file-loading + interpretation (often via a helper), e.g.:
  - read PSL text (provider) → parse to AST (`@internal/psl-parser`) → interpret (`@internal/sql-contract-psl`)
- Some duplication risk exists if multiple orchestrators want to “help” with PSL; this ADR prevents that by making the provider responsible for invoking interpretation.

## Implementation notes (non-normative)

- The interpretation package accepts parsed `documents`, their `sources`, and a **PSL symbol table**, alongside target composition inputs, and produces `Contract` (e.g. `interpretPslDocumentToSqlContract` in `@internal/sql-contract-psl`).
- The provider owns parsing and declaration collection: it calls `parse(text, path)` for each source, then `buildSymbolTable({ documents, sources })` (from `@internal/psl-parser`), seeds the combined parse + symbol-table diagnostics, and passes the parsed documents, sources, and symbol table to the interpreter.
- File paths belong in diagnostics only; canonical artifacts must not embed provenance.

## Related

- `docs/architecture docs/subsystems/2. Contract Emitter & Types.md`
- `packages/1-framework/2-authoring/psl-parser/README.md`
- `packages/2-sql/2-authoring/contract-psl/README.md`
- `docs/architecture docs/adrs/ADR 006 - Dual Authoring Modes.md`
- `docs/architecture docs/adrs/ADR 150 - Family-Agnostic CLI and Pack Entry Points.md`
