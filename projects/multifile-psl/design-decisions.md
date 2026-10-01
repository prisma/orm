# multifile-psl — design decisions

Record of the design discussion (2026-09-18 → 2026-09-21) that produced [`spec.md`](./spec.md). Each entry names the decision, the reasoning, the assumptions it rests on, and the alternatives rejected. Decisions that prove architecturally durable migrate to ADRs at close-out.

## 1. The glob is a standing membership rule

**Decision.** The config keeps the glob string; every load site (CLI provider, language server) expands it fresh and sorts the result. A new file matching the glob joins the schema without a config change.

**Why.** One-time expansion at config load would strand the language server with a stale file list (a newly created file needs a config reload to join the project) and would force glob I/O into `finalizeConfig`, which is synchronous. Sorting makes emission deterministic across machines and filesystem enumeration orders — the prisma7 directory loader already sorts for the same reason.

**Assumes.** Schema directories are small enough that re-expanding per load pass costs milliseconds.

**Rejected.** One-time expansion into a fixed list: new files would require touching the config, and the LSP could not use the glob as its watch pattern or membership predicate.

## 2. Membership = glob match ∧ `// use prisma-8` directive

**Decision.** A file is part of the schema only when it matches the glob **and** carries the directive. Contract emission adopts the same gate the language server already has; a glob-matched file without the directive is quietly not part of the schema on both surfaces.

**Why.** The directive check existed only in the language server; emission never checked it. With a glob, that split becomes silent divergence: emit includes a directive-less file the LSP excludes, breaking the lsp-emit-parity guarantee. The quiet exclusion (rather than a diagnostic) follows the repo's `explicit-opt-in-over-diagnostics` rule — the directive is the opt-in; its absence means "not mine", not an error.

**Assumes.** The directive's future removal is a separate decision; the operator explicitly chose to keep it for now.

**Rejected.** (a) Config membership as the sole opt-in, dropping the directive gate — deferred, not refused; the gate is nearly redundant already since the LSP requires config membership too. (b) Keeping the directive but raising a diagnostic on omission — more ceremony per file, contradicts the opt-in rule.

## 3. Composition checks become assertions; the interpreter loses its singular `document`

**Decision.** `PSL_TARGET_CONTEXT_REQUIRED` and `PSL_SCALAR_TYPE_CONTEXT_REQUIRED` become `InternalError` assertions. `PslInterpretInput` drops `document: DocumentAst` for `documents: readonly DocumentAst[]`; the language server interprets once per project and distributes diagnostics by `sourceId` instead of interpreting once per open document and filtering.

**Why.** Those two diagnostics were the only consumers of the singular `document` (as a span anchor). They signal a miscomposed provider, not a user mistake: `PrismaContractOptions.target` is a required field and every extension wrapper supplies it, so the state is unreachable through the typed surface — exactly what the `prefer-assertions-over-defensive-checks` rule says to assert. With the anchor gone, no arbitrary "first file" needs choosing, and project-level interpretation becomes one pass.

**Assumes.** No user-writable configuration reaches interpretation without a target context (verified against `provider.ts:22,63` and the extension wrappers; only untyped JavaScript or hand-built interpreter input can).

**Rejected.** (a) Anchoring project-level diagnostics to the first file in sorted order — deterministic but misattributes an internal fault to an innocent user file. (b) Anchoring to the config file — the fallback if the state ever becomes user-reachable; precedent exists (config-load failures publish against the config URI).

## 4. Language-server strategy: overlay-over-disk with client watching, stat fallback

**Decision.** Open buffers are authoritative; unopened member files are read from disk. The server registers `workspace/didChangeWatchedFiles` on the schema glob. When the client cannot watch, the server stats mtime+size of cached disk entries before reuse on each validation pass.

**Why.** Cross-file effects are the norm in PSL (one symbol table spans all files), so the tsserver/clangd model of open-files-only analysis is wrong here; gopls is the closest precedent. Client watching is the LSP-recommended mechanism, but the survey showed it is unreliable in the field: Neovim disables it by default on Linux (watcher backends fall back to polling), Helix only forwards its own writes, coc.nvim needs watchman, Sublime needs a companion plugin. The stat fallback restores correctness for those clients at the cost of a handful of syscalls per keystroke.

**Assumes.** Schema-sized projects (tens of files, not thousands); non-VS-Code clients matter enough to warrant the fallback but not a server-side watcher.

**Rejected.** (a) Read-everything-fresh-per-validation with no caching (the classic prisma-language-server approach) — correct but wasteful, and blind when no file is open. (b) Server-side watcher (rust-analyzer style, chokidar) — watcher lifecycle and platform quirks not justified while VS Code is the primary client. (c) Pull-first via `workspace/diagnostic` — capability-gated, so it is additional code on top of push, never a replacement; deferred.

## 5. One content abstraction, not two ordered lookups

**Decision.** `DocumentStore` evolves into the single content store: one map keyed by `canonicalFileIdentity`, values tagged `{ origin: 'overlay', document }` or `{ origin: 'disk', text, mtime, size }`. LSP sync events own the transitions (`open` replaces disk with overlay, `close` evicts the entry, `change` touches overlays only); watch invalidation is a no-op on overlays; stat revalidation is internal to the disk branch. Membership stays outside in `SchemaInputSet` — the store answers "what is this file's content", not "is this file in the project".

**Why.** With two parallel maps every caller must remember overlay-before-disk ordering; rust-analyzer's VFS shows the ordering belongs inside the store so downstream code sees one uniform content source. The "ignore watch events for open files" rule becomes unrepresentable instead of remembered. Requested by the operator explicitly.

**Rejected.** A separate disk cache composed with `DocumentStore` at each call site — the composition point count only grows (`readDocument`, `formatDocument`, semantic tokens, folding).

## 6. Disk reads are synchronous

**Decision.** The store uses `readFileSync`.

**Why.** Synchronous computation is atomic on the Node event loop: no request can observe a half-rebuilt source registry, and `ProjectArtifacts`' memoization keeps its current shape instead of growing async invalidation races. The snapshot machinery that makes async loading safe elsewhere (salsa in rust-analyzer, immutable snapshots in gopls) is an army this schema-sized problem does not need. tsserver reads from disk on demand the same way.

**Assumes.** Member files are small and few; a blocking read never stalls the server perceptibly.

## 7. Diagnostics are pushed to all member files, open or closed

**Decision.** The server computes diagnostics project-wide and pushes them via `publishDiagnostics` to every member file, tracking published URIs so stale entries can be cleared. The existing pull path keeps serving open files. `workspace/diagnostic` is deferred.

**Why.** This is the common practice among whole-project servers: gopls pushes to closed files by default; Dart, jdt.ls, metals behave the same; rust-analyzer pushes cargo-check results to closed files. Pull remains a second layer everywhere except Roslyn because client support outside VS Code is spotty. `interFileDependencies` flips to true in the same change.

**Rejected.** (a) Open-files-only diagnostics (tsserver/clangd) — tolerable only where cross-file errors are rare, which PSL is not. (b) `workspace/diagnostic` as the foundation — capability-gated, extra code, deferred.

## 8. Projects outlive their open documents

**Decision.** A project is created when the first member document opens but is no longer dropped when the last one closes; watch events keep validating and publishing.

**Why.** With disk reads, a project's schema no longer depends on which files are open; dropping it on last-close would clear closed-file diagnostics and re-do all work on the next open.

## 9. Default output path derives from the glob's static prefix

**Decision.** `defaultOutputFromSchemaPath` stays for single paths (unchanged behavior) and gains a glob branch: the directory prefix before the first wildcard, so `./prisma/**/*.prisma` → `./prisma/contract.json`.

**Why.** It preserves the "contract lands beside your schema" behavior every example depends on, deterministically and without filesystem reads.

**History.** The operator first ruled to delete provider-level derivation entirely and fall through to `normalizeContractConfig`'s generic default, then reversed upon seeing that every example config relies on the colocated default and would need updating. Recorded so the reversal is not re-litigated.

**Rejected.** (a) Deriving from the first matched file — output path would depend on which files exist. (b) Requiring explicit `output` with globs — ceremony in the common case.

## 10. Playground: fixed scratch directory, lazy-opening tabs, no write-back

**Decision.** The playground drops arbitrary schema-path arguments and always opens a gitignored scratch directory seeded with a few `.prisma` files. The client registers one memory file per member and renders a tab strip; a tab's document opens in Monaco (and sends `didOpen`) only on first click, so untouched tabs remain unmanaged and exercise the disk path of the real language server. Browser edits stay in the overlay; nothing writes back to the scratch files.

**Why.** The staged files sit on the real filesystem and the language server runs as a real Node process, so the managed/unmanaged demonstration comes nearly free — no file tree, no save UI, no VS Code reimplementation. Operator explicitly bounded the budget: disk/in-memory demonstration only if cheap.

**Rejected.** (a) Opening every file up front — demos multi-file editing but silently skips the disk-fallback machinery. (b) A save endpoint on the ws bridge — noted as the fix if overlay/disk divergence ever grates; not built now.

## 11. `tinyglobby` is the glob dependency

**Decision.** `tinyglobby` enters the workspace catalog as a direct dependency.

**Why.** Already present transitively (vite/rolldown/tsdown pin it), small, maintained; the workspace's `minimumReleaseAge` and trust policies apply to catalog entries.

## 12. `inputs` is an array of globs

**Decision.** `ContractSourceProviderBase.inputs` is an array of glob patterns. A literal file path is the degenerate glob with no wildcards; the `contract: '<string>'` shorthand wraps a single glob into a one-element array. Directories are not auto-expanded.

**Why.** One entry shape means one expansion path — every entry goes through the glob expander, sorted, no type-sniffing of what an entry "really is". Users who think in folders write `./prisma/**/*.prisma` explicitly, which also states the recursion and the extension instead of implying them.

**Rejected.** (a) Directory shorthand (the prisma7 and classic-Prisma precedent: `inputs` carries a folder, expanded recursively to `*.prisma`) — attractive for migrating users, but it adds a third entry shape (`file | directory | glob`) distinguished by filesystem probing, and the `contract-prisma7` provider keeps that behavior for its own adoption surface anyway. (b) Single glob string only, no arrays — needlessly forbids splitting a schema across sibling directories.

## 13. `orm format` formats the membership set

**Decision.** The format operation iterates every member file instead of `inputs[0]`; its help text changes accordingly.

## 14. Directive enforcement at emit is a breaking change, paid openly (mid-flight ruling, 2026-09-22)

**Decision.** Enforcing `// use prisma-8` at emit (decision 2's consequence) broke every in-repo example/fixture schema lacking the directive — falsifying the spec's "examples keep working unchanged" wording. Operator ruling: sweep the directive into every affected example and fixture until `fixtures:check` is green, and ship upgrade instructions for downstream schemas.

**Why.** The directive is the deliberate per-file opt-in; the repo's own examples should model it, and `orm init` already scaffolds it. The alternative rulings — baseline-excepting `fixtures:check` (repo's examples broken against its own CLI) or exempting literal single-path inputs from the gate (reopens emit/LSP divergence for single-file projects) — were rejected.

**Assumes.** The sweep's full file count is discoverable only iteratively (chained fixture scripts short-circuit); accepted.
