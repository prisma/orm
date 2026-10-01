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
- The provider owns parsing and declaration collection: it calls `parse(text, path)` for each source, merges the returned source registries, then calls `buildSymbolTable({ documents, sources })` (from `@internal/psl-parser`). The symbol table is family-blind: it collects declarations and reports duplicates without target types or block descriptors. The provider seeds the combined parse + symbol-table diagnostics and passes `documents`, `sources`, and `symbolTable` to the interpreter.
- Reference binding is separate from declaration collection. The SQL interpreter uses `createSqlBinder`, which composes types and attribute specs and invokes the framework's `createBinder({ sources, symbolTable, typeConstructors, attributeSpecs, controlMutationDefaults, pslBlockDescriptors, describeUnsupportedAttribute })`. The binder resolves references against those injected contributions; the interpreter consumes its results and diagnostics before family-specific interpretation.
- File paths belong in diagnostics only; canonical artifacts must not embed provenance.

## Shared binding and snapshot lifetime

Declaration collection remains eager and family-blind; the symbol table is data, not a resolver. A separate interface-and-factory service owns binding state. `createBinder` returns `{ binder, diagnostics }` after two eager phases: declaration and type-reference binding, then attribute and registered-block reference binding using those type results. `declaredSymbol(node)` and `symbolForNode(node)` read stable snapshot results; `scopeAt(node)` exposes the lexical scope for lookup and completion enumeration. Resolution diagnostics are returned by the factory rather than produced by queries, so diagnostic completeness does not depend on which editor feature ran.

Unqualified lookup is kind-blind: declaring namespace → document top level → configured contributed types. The nearest declaration wins even if a reference site requires a different kind; kind and entity-selector validation happen after lookup. Sibling namespaces are never searched. For `ns.Name`, the qualifier follows that same lookup rule, then only the selected namespace's members are searched. A user namespace shadows a contributed namespace without member fallthrough, and a missing member never falls back to lexical lookup.

Document changes discard the snapshot's symbol table, binder results, and retained lexical scopes together. The contributed-type scope is cached separately by type-constructor registry identity, so callers retain that registry with the configuration and replace it when configuration changes. Family knowledge enters through injected types, attribute factories, block descriptors, and diagnostic callbacks, not parser dependencies on targets.

Eager binding fits full-document reparsing and consumers that need complete diagnostics after an edit. Lazy binding would require a second entry path reconstructing attribute context from a reference node, only for diagnostics to force the full walk anyway. Dependency-tracked invalidation adds revision and dependency bookkeeping without avoiding the existing full parse and collection work; abandoning snapshot state keeps ownership explicit. The query API does not promise eager execution, but the factory does promise complete binding diagnostics on return.

## Related

- `docs/architecture docs/subsystems/2. Contract Emitter & Types.md`
- `packages/1-framework/2-authoring/psl-parser/README.md`
- `packages/2-sql/2-authoring/contract-psl/README.md`
- `docs/architecture docs/adrs/ADR 006 - Dual Authoring Modes.md`
- `docs/architecture docs/adrs/ADR 150 - Family-Agnostic CLI and Pack Entry Points.md`
