# Prisma 8 language server

The Prisma 8 language server provides diagnostics, formatting, code completion, and attribute signature help for PSL schemas through the Language Server Protocol.

## Project membership and diagnostics

A project's schema is every file matching the config's `contract.source.inputs` glob(s) whose current text carries `// use prisma-8` — the same gate `contract emit` applies, so the two surfaces agree on what the schema is. Membership is re-expanded on load, config reload, and schema-file watcher events, not fixed at config-read time: a file created after the server started joins on the next membership refresh without a config edit.

Unopened members are read from disk and interpreted alongside open ones: symbols and diagnostics span the whole membership set. Disk snapshots are cached until invalidation, without read-time metadata checks. Open editor text remains authoritative even when disk notifications invalidate cached content.

### Filesystem updates

Each loaded project selects one of two notification backends:

- **Client notifications:** when dynamic registration succeeds and every input pattern is compatible with LSP watching. The supported subset is simple ASCII paths with ordinary `*`, `?`, or whole-segment `**` wildcards. A successful compatible registration does not create a duplicate internal watcher.
- **Internal Chokidar 5 watching:** when the client lacks support, registration fails or exceeds its 10-second deadline, or patterns use extended or uncertain syntax such as extglobs, braces, brackets, negation, escapes, or file URIs. Late registrations are disposed.

Internal watching covers literal directory roots derived from positive input patterns, including safe existing ancestors of missing directories. This detects future members under initially empty globs. The owning config's directory is also observed so atomic config replacement updates membership without editor activity; a config-only subscription is shallow. Events trigger the same input expansion and directive check as loading, rather than a separate watcher-specific membership matcher.

Internal watching refuses recursive filesystem-root/share coverage and dynamic parent traversal. Symbolic schema roots or ancestors are rejected; encountered symlink paths are skipped with a warning, not followed. Inputs outside the config directory work when they have safe roots. Watching does not discover new projects across the workspace or follow imported config dependencies.

Loading and editor operations do not wait for registration or internal readiness. On readiness, the project discards potentially stale disk snapshots and reconciles membership to include changes during startup. Watcher failures are logged and do not suspend analysis or discard overlays. Working subscriptions are retained where possible, but external changes in unwatched paths may remain undetected until a project/config reload or server restart. Reload explicitly evicts disk snapshots and retries setup. There is no stat-on-read fallback or polling, including environment-forced Chokidar polling. A client that silently drops notifications is not detected.

### Diagnostic delivery

Diagnostic delivery has exactly two modes, selected during initialization:

| Client capabilities | Schema diagnostic delivery |
| --- | --- |
| `textDocument.diagnostic.relatedDocumentSupport: true` | Advertise `diagnosticProvider`; each pull returns the requested file's full report plus full `relatedDocuments` reports for every other project member, open or closed. No schema-member diagnostics are pushed. |
| All other clients, including pull clients without related-document support | Do not advertise `diagnosticProvider`; push `textDocument/publishDiagnostics` for every affected project member, open or closed. |

Both modes use the same diagnostic assembler. Empty reports clear previous findings, including those for members removed by deletion, directive removal, or config changes. Pull delivery tracks previously reported members per project so the next project pull can include empty related reports for removed members. Pulling an excluded former member first does not discard its pending related clear.

In pull mode, `interFileDependencies: true` tells the client that editor edits can change diagnostics in other files. Config and external-file notifications invalidate project state and request `workspace/diagnostic/refresh` when the client supports it. Without refresh support, updates are observed on the next client pull; the server does not fall back to pushing schema diagnostics. Config-load failures remain a separate `publishDiagnostics` notification on the config file in either mode. Protocol tests exercise capability negotiation and reports using in-process clients; they do not establish adoption by real editors.

Equivalent file URIs share one document and one normalized URI for source filenames and diagnostic publications, including clears. Normalization follows file-path identity: percent encoding is standardized, Windows paths are case-folded, and UNC authorities are preserved. The server does not resolve symlinks or preserve the editor's original URI spelling.

Each immutable document snapshot parses lazily, at most once, and owns its AST, source registry, and raw parser diagnostics. Reading text alone does not parse. Configuration reloads evict project disk snapshots while retaining editor overlays, and rebuild combined sources, symbols, and interpretation. `ProjectArtifacts.document(uri)` returns the snapshot itself without parsing. `ProjectArtifacts.diagnostics(uri)` combines mapped parse, symbol, and interpretation diagnostics; whole-project reports supply precomputed symbol diagnostics so each report scans the project once for symbols. Interpretation is memoized per project revision, not attached to a document snapshot. Edits and disk invalidation produce new snapshots without changing previous parses.

## Internal ownership

Closing the last editor document does not remove its project. Each config path has one stable `Project` instance, while document associations can be removed and discovered again. For example, reopening a file under the same config reuses its existing project even though closing it removed the document-to-project association.

| Component | Responsibility |
| --- | --- |
| [`server.ts`](src/server.ts) | Capability negotiation, protocol registration, editor-buffer updates, and feature-handler delegation. |
| [`ProjectRegistry`](src/project-registry.ts) | Config-to-project and document-to-project indexes, nearest-config discovery, association cleanup, config watching, watched-file dispatch, and the global event sequence. |
| [`Project`](src/project.ts) | Private resolved configuration and load state, serialized reloads and last-good fallback, membership transitions, client/internal watcher lifecycle and event batches, diagnostic history, and operations using the resolved analysis. |
| [`ProjectArtifacts`](src/project-artifacts.ts) | Participating snapshots, combined sources and symbols, interpretation, and diagnostic assembly. |
| [`DocumentStore`](src/document-store.ts) and [`DocumentSnapshot`](src/document-snapshot.ts) | Authoritative editor overlays and explicitly invalidated disk caches; immutable text snapshots with lazy parsing. |

Nearest-config discovery does not establish schema membership. Project operations check membership against their resolved configuration; pull reports can also serve a previously reported URI that has left membership so the client receives its clearing report. Synchronous AST and symbol reads use the existing document association without starting discovery or loading.

The registry supplies the event sequence used by project membership transitions. Projects invalidate disk text before expanding membership; reloads advance the same sequence. Each project checks its accepted sequence and resolved configuration identity across membership expansion, while a separate watcher generation rejects and disposes late registrations. Failed reloads retain the last-good configuration; failed first loads remove open-document associations so later requests can retry. In-flight reads retain the resolution they awaited rather than switching to a later queued load.

Both backends use the project's 50 ms coalescing delay, allowing Chokidar's same-path change suppression window to finish before reading final content. Each batch invalidates affected disk entries and reconciles final membership once; events arriving during asynchronous work schedule a later pass. Generation and configuration checks reject stale schema work. During a reload, previous internal subscriptions continue observing the owning config until replacement coverage is ready, so repeated config edits during loading are not lost. Old schema callbacks remain rejected. Server shutdown and asynchronous disposal cancel queued work and await all owned Chokidar closures, including watchers still starting.

The decision and tradeoffs are recorded in [ADR 256 — Project-owned language-server file watching](../../../../docs/architecture%20docs/adrs/ADR%20256%20-%20Project-owned%20language-server%20file%20watching.md).

## Completion

Attribute, argument, function, identifier-value, registered scalar, generic block, and block parameter completions use contribution documentation as their detail when available. Scalar constructors, generic block descriptors, and block parameter descriptors can supply this text through their optional `documentation` property. Undocumented descriptors retain their generic completion details.

Required argument snippets use argument names as editable placeholders. Generic block snippets insert required parameters with named placeholders, omitting optional parameters and attributes. Blocks without required parameters include a comment hint describing their contents. Field-reference completions suggest scalar fields only, excluding relation and composite fields.

## Signature help

In an open, configured PSL input marked with `// use prisma-8`, clients can request signature help explicitly or trigger it when typing `(` or `,`. Help shows type-only positional parameters, named-only parameter names, optional markers, and declaration-authored Markdown documentation. Positional parameter documentation identifies the declaration name; parameters accepting both forms appear once and document their named alias. Named arguments highlight their matching parameter regardless of source order.

Field, model, and generic-block attributes use the project's contribution specs, so extension-authored signatures participate without additional server registration. Known nested functions show their innermost signature; unknown nested calls suppress help rather than display a misleading outer signature. Unfinished argument lists are supported from the current editor buffer even when contract interpretation fails.

Snippet-capable clients can opt into argument hints after completion by setting `initializationOptions.completion.supportsTriggerParameterHintsCommand: true` when they implement `editor.action.triggerParameterHints`. Only completions inserting argument snippets carry that command; plain names, existing argument lists, and nullary functions do not. Optional-only function snippets place a tab stop inside the parentheses. The playground also retriggers hints when Tab or Shift+Tab moves within an active PSL snippet.

The client controls tooltip presentation and the shortcut for an explicit signature-help request. Closed or unmanaged documents receive no help, and failures while resolving signature metadata produce an empty response without terminating the server.
