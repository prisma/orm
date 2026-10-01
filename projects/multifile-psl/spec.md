# multifile-psl

## Purpose

Let Prisma 8 users organize a schema across multiple PSL files as their domains grow, instead of forcing every model into one file. The CLI and the editor must agree on what the schema is: the same set of files, the same symbol table, the same diagnostics — whether a file is open in the editor or sitting on disk.

## At a glance

A user points their config at a glob instead of a single path:

```ts
// prisma.config.ts
export default defineConfig({
  contract: './prisma/**/*.prisma',
  // ...
});
```

and splits the schema by domain:

```prisma
// prisma/billing.prisma
// use prisma-8
namespace billing {
  model Invoice {
    id      Int @id
    account accounts.Account
  }
}
```

```prisma
// prisma/accounts.prisma
// use prisma-8
namespace accounts {
  model Account {
    id Int @id
  }
}
```

A file belongs to the schema when it both matches the glob and carries the `// use prisma-8` directive. All member files are parsed into one symbol table (the parser already supports this — namespaces reopen across files, duplicate names are diagnosed with the offending file attached), interpreted once per project, and emitted as one contract. In the editor, editing `billing.prisma` can produce or clear a diagnostic in `accounts.prisma` even when `accounts.prisma` is closed: the language server reads unopened member files from disk, watches the glob where the client supports it, and pushes diagnostics to every member file.

The glob is a standing rule, not a one-time expansion: dropping a new `orders.prisma` next to the others adds it to the schema on the next emit or keystroke, with no config change.

## Non-goals

- **No removal of the `// use prisma-8` directive.** It stays as the per-file opt-in for now; removing it is a separately triaged decision.
- **No `workspace/diagnostic` (LSP pull) machinery.** Push to member files covers closed-file diagnostics; the pull layer is a later addition if a client demands it.
- **No server-side file watcher** (chokidar or similar). Client-side `workspace/didChangeWatchedFiles` plus an mtime/size stat fallback for non-watching clients.
- **No incremental symbol-table computation.** Full rebuild per change stays; schema-sized projects make this affordable.
- **No changes to `contract-prisma7`.** The prisma7 adoption provider keeps its per-directory loading and per-document symbol tables (ADR 253 already excludes it).
- **No multi-root LSP workspaces.** Single-root stays.
- **No playground file management.** The playground drops arbitrary schema-path arguments and always opens a fixed gitignored scratch directory; browser edits are not written back to disk.
- **No changes to the shape of `contract.json` or `contract.d.ts`.**

## Place in the larger world

- **ADR 253 (PSL red-root source ownership)** did the preparatory work: `buildSymbolTable` accepts `documents[]`, `PslSources` merges multiple files, diagnostics carry filenames, namespace declarations track per-file provenance. This project supersedes ADR 253's "file-loading boundary" section (which deliberately excluded glob expansion and multi-file loading) and corrects its stale claim that repeated namespaces do not merge (they do, since `2ef670f83d`).
- **Packages touched:** `@internal/config` + `config-loader` (glob semantics on `inputs`), `psl-parser` (`PslInterpretInput`), `contract-psl` providers for SQL and Mongo (multi-file load loop), the postgres/sqlite/mongo extension `define-config` wrappers (output derivation), the CLI `format` operation, `language-server`, and `apps/lsp-playground`.
- **New dependency:** `tinyglobby` (already present transitively via vite/tsdown) enters the workspace catalog as the glob expander.
- **Design research:** the language-server design follows gopls's model (project-wide analysis, push diagnostics to all affected files, overlay-over-disk content store) and tsserver's open/closed file state machine; the decision record in [`design-decisions.md`](./design-decisions.md) carries the survey and the rejected alternatives.

## Cross-cutting requirements

- **One membership predicate.** "File is part of the schema" is defined in exactly one place (glob match ∧ directive present) and enforced identically by contract emission and the language server. The `lsp-emit-parity` integration suite gains a multi-file fixture proving it, including a file excluded by a missing directive in both surfaces.
- **Deterministic expansion.** Every load site expands the glob fresh and sorts the result; the emitted contract is byte-identical regardless of filesystem enumeration order or which machine runs the emit.
- **File identity on every diagnostic.** No diagnostic is anchored to an arbitrarily chosen file; project-level failure states that cannot occur through the typed configuration surface become `InternalError` assertions instead of diagnostics.
- **One identity normalization point.** Glob expansion emits absolute paths through `pathe`; the LSP's `canonicalFileIdentity` (lowercasing on Windows) remains the only place file identity is normalized — no second normalization grows in config or providers.
- **Single-path configs keep their config surface and output behavior unchanged throughout** (path spelling, derived output colocated with the schema). One deliberate exception, ruled by the operator on 2026-09-22 after execution falsified the original "examples unchanged" wording: emit now enforces the `// use prisma-8` directive on every member file, so every in-repo example and fixture schema gains the directive line as part of the first slice, and the release ships upgrade instructions for downstream schemas that lack it. Emit and LSP thereby agree on membership for single-path configs too.

## Transitional-shape constraints

- The interpreter input change (`document: DocumentAst` → `documents: readonly DocumentAst[]`) and the provider's multi-file load loop may land before glob support in config, but every intermediate state keeps single-file configs green across CLI, LSP, and examples.
- The LSP advertises `interFileDependencies: true` only in the same change that makes cross-file re-diagnosis actually work; capability flags never run ahead of behavior.

## Project Definition of Done

- [ ] Team-DoD floor items (inherited; see [`drive/calibration/dod.md`](../../drive/calibration/dod.md)).
- [ ] A config whose `contract` is a glob emits one contract from N files, and an emission-determinism test proves the output is independent of file-discovery order.
- [ ] The `lsp-emit-parity` suite runs a multi-file fixture: LSP diagnostics equal emit diagnostics, including a glob-matched file without the directive being excluded by both.
- [ ] A language-server test shows an edit in one open file producing and then clearing a diagnostic in a closed sibling file, delivered by push.
- [ ] External modification of an unopened member file is picked up on both freshness paths: watch events (watching client) and stat revalidation (non-watching client), each covered by a test.
- [ ] `orm format` formats every member file, not `inputs[0]`.
- [ ] The playground opens the scratch directory with a tab per file; a diagnostic caused by a file whose tab was never opened is visible; the demo runs end-to-end.
- [ ] An ADR records multi-file PSL loading and the language-server file store; ADR 253 is amended (superseded boundary section, corrected namespace wording).

## Open Questions

None — every question raised during the design discussion has been resolved by the operator; the outcomes are folded into the sections above and recorded in [`design-decisions.md`](./design-decisions.md).

## Contract-impact

No contract entities change; `contract.json` and `contract.d.ts` shapes are untouched. The impact is confined to the config layer (`packages/1-framework/1-core/config`, `packages/1-framework/3-tooling/config-loader`): `ContractSourceProviderBase.inputs` becomes an array of globs — every entry is a glob pattern, a literal file path being the degenerate wildcard-free case, and directories are not auto-expanded — `ContractSourceContext.resolvedInputs` becomes the flat expanded list and its positional-matching contract is deleted (consumer audit: the two providers, `format.ts`, `contract-emit` pass-throughs, the vite plugin's watch loop), and glob expansion is filesystem work performed at load sites rather than in `finalizeConfig`, which stays synchronous.

## Adapter-impact

- **postgres, sqlite, mongo** `define-config` wrappers: `contract` string routing accepts globs; default output derivation generalizes to the glob's static prefix (`./prisma/**/*.prisma` → `./prisma/contract.json`); single-path derivation is unchanged.
- **Mongo `contract-psl` provider** mirrors every SQL provider change (multi-file load loop, interpreter input, assertion conversion).

## References

- Linear Project: _to be created at project DoR_
- ADR: [`docs/architecture docs/adrs/ADR 253 - PSL red-root source ownership.md`](../../docs/architecture%20docs/adrs/ADR%20253%20-%20PSL%20red-root%20source%20ownership.md)
- Prior planning artefact: `wip/psl-source-provenance/spec.md` (provenance groundwork; its non-goals are this project's goals)
- Design-discussion record: [`design-decisions.md`](./design-decisions.md) — decisions, reasoning, assumptions, alternatives rejected
- External precedents: [gopls diagnostics](https://go.dev/gopls/features/diagnostics), [rust-analyzer architecture](https://rust-analyzer.github.io/book/book/contributing/architecture.html), LSP 3.17 pull-diagnostics adoption ([golang/go#53275](https://github.com/golang/go/issues/53275), [dotnet/roslyn#70703](https://github.com/dotnet/roslyn/issues/70703))
