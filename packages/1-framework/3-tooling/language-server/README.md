# Prisma 8 language server

The Prisma 8 language server provides diagnostics, formatting, code completion, attribute signature help, hover, and go-to-definition for PSL schemas through the Language Server Protocol.

## Project membership and diagnostics

A project's schema is every file matching the config's `contract.source.inputs` glob(s) whose current text carries `// use prisma-8` — the same gate `contract emit` applies, so the two surfaces agree on what the schema is. Membership is re-expanded on load, config reload, and schema-file watcher events, not fixed at config-read time: a file created after the server started joins on the next membership refresh without a config edit.

Unopened members are read from disk and interpreted alongside open ones — the project symbol table and diagnostics span the whole membership set, not just currently-open documents. After the client successfully registers a `workspace/didChangeWatchedFiles` watcher for a project's input globs, covered members reuse cached disk text without checking file metadata on each read only when every pattern is in a conservatively supported subset: simple ASCII paths with ordinary `*`, `?`, or whole-segment `**` wildcards. Extended or uncertain syntax, including extglobs, negation, braces, brackets, backslash escapes, and file URIs, retains stat revalidation even after successful registration and membership refresh. Member create/change/delete events invalidate disk text and refresh membership, including coverage for newly discovered members. Open editor text remains authoritative. Files without successful watcher coverage re-check modification time and size on every read, including while registration is pending or after registration fails. Coverage is tracked per project and file identity; registration replacement and coverage changes discard affected disk entries so text cached during a registration gap is not trusted afterward.

Diagnostic delivery has exactly two modes, selected during initialization:

| Client capabilities | Schema diagnostic delivery |
| --- | --- |
| `textDocument.diagnostic.relatedDocumentSupport: true` | Advertise `diagnosticProvider`; each pull returns the requested file's full report plus full `relatedDocuments` reports for every other project member, open or closed. No schema-member diagnostics are pushed. |
| All other clients, including pull clients without related-document support | Do not advertise `diagnosticProvider`; push `textDocument/publishDiagnostics` for every affected project member, open or closed. |

Both modes use the same diagnostic assembler. Empty reports clear previous findings, including those for members removed by deletion, directive removal, or config changes. Pull delivery tracks previously reported members per project so the next project pull can include empty related reports for removed members. Pulling an excluded former member first does not discard its pending related clear.

In pull mode, `interFileDependencies: true` tells the client that editor edits can change diagnostics in other files. Config and external-file notifications invalidate project state and request `workspace/diagnostic/refresh` when the client supports it. Without refresh support, updates are observed on the next client pull; the server does not fall back to pushing schema diagnostics. Config-load failures remain a separate `publishDiagnostics` notification on the config file in either mode. Protocol tests exercise capability negotiation and reports using in-process clients; they do not establish adoption by real editors.

Equivalent file URIs share one document and one normalized URI for source filenames and diagnostic publications, including clears. Normalization follows file-path identity: percent encoding is standardized, Windows paths are case-folded, and UNC authorities are preserved. The server does not resolve symlinks or preserve the editor's original URI spelling.

Each immutable document snapshot parses lazily, at most once, and owns its AST, source registry, and raw parser diagnostics. Reading text alone does not parse. Projects reuse unchanged snapshots across configuration reloads while independently rebuilding combined sources, symbols, binding, and interpretation. `ProjectArtifacts.document(uri)` returns the snapshot itself without parsing. `ProjectArtifacts.diagnostics(uri)` combines mapped parse and symbol diagnostics with one semantic diagnostic source; whole-project reports supply precomputed symbol diagnostics so each report scans the project once for symbols. Interpretation is memoized per project revision, not attached to a document snapshot. Edits and disk invalidation produce new snapshots without changing previous parses.

Semantic diagnostics come from the configured interpreter when available, or from binding when no interpreter is configured. Interpreter failures do not switch diagnostic sources.

## Internal ownership

Closing the last editor document does not remove its project. Each config path has one stable `Project` instance, while document associations can be removed and discovered again. For example, reopening a file under the same config reuses its existing project even though closing it removed the document-to-project association.

| Component | Responsibility |
| --- | --- |
| [`server.ts`](src/server.ts) | Capability negotiation, protocol registration, editor-buffer updates, and feature-handler delegation. |
| [`ProjectRegistry`](src/project-registry.ts) | Config-to-project and document-to-project indexes, nearest-config discovery, association cleanup, config watching, watched-file dispatch, and the global event sequence. |
| [`Project`](src/project.ts) | Private resolved configuration and load state, serialized reloads and last-good fallback, membership transitions, schema-watcher registration, diagnostic history, and operations using the resolved analysis. |
| [`ProjectArtifacts`](src/project-artifacts.ts) | Participating snapshots, combined sources and symbols, the snapshot's binder, interpretation, and diagnostic assembly. |
| [`DocumentStore`](src/document-store.ts) and [`DocumentSnapshot`](src/document-snapshot.ts) | Editor overlays and disk text with watcher coverage; immutable text snapshots with lazy parsing. |

Nearest-config discovery does not establish schema membership. Project operations check membership against their resolved configuration; pull reports can also serve a previously reported URI that has left membership so the client receives its clearing report. Synchronous AST and symbol reads use the existing document association without starting discovery or loading.

The registry allocates a member event's sequence before asynchronous config discovery and invalidates its disk text immediately. Reloads advance the same sequence. Each project checks its accepted sequence and resolved configuration identity across membership expansion, while a separate watcher generation rejects and disposes late registrations. Failed reloads retain the last-good configuration; failed first loads remove open-document associations so later requests can retry. In-flight reads retain the resolution they awaited rather than switching to a later queued load.

## Completion

Attribute, argument, function, identifier-value, registered scalar, generic block, and block parameter completions use contribution documentation as their detail when available. Scalar constructors, generic block descriptors, and block parameter descriptors can supply this text through their optional `documentation` property. Undocumented descriptors retain their generic completion details.

Required argument snippets use argument names as editable placeholders. Generic block snippets insert required parameters with named placeholders, omitting optional parameters and attributes. Blocks without required parameters include a comment hint describing their contents. Field-reference completions suggest scalar fields only, excluding relation and composite fields.

## Signature help

In an open, configured PSL input marked with `// use prisma-8`, clients can request signature help explicitly or trigger it when typing `(` or `,`. Help shows type-only positional parameters, named-only parameter names, optional markers, and declaration-authored Markdown documentation. Positional parameter documentation identifies the declaration name; parameters accepting both forms appear once and document their named alias. Named arguments highlight their matching parameter regardless of source order.

Field, model, and generic-block attributes use the project's contribution specs, so extension-authored signatures participate without additional server registration. Known nested functions show their innermost signature; unknown nested calls suppress help rather than display a misleading outer signature. Unfinished argument lists are supported from the current editor buffer even when contract interpretation fails.

Snippet-capable clients can opt into argument hints after completion by setting `initializationOptions.completion.supportsTriggerParameterHintsCommand: true` when they implement `editor.action.triggerParameterHints`. Only completions inserting argument snippets carry that command; plain names, existing argument lists, and nullary functions do not. Optional-only function snippets place a tab stop inside the parentheses. The playground also retriggers hints when Tab or Shift+Tab moves within an active PSL snippet.

The client controls tooltip presentation and the shortcut for an explicit signature-help request. Closed or unmanaged documents receive no help, and failures while resolving signature metadata produce an empty response without terminating the server.

## Hover

In an open, configured PSL input, clients can request hover over a model, composite type, field, named type, or generic block, at either its declaration or a reference to it. The tooltip shows the declaration line — `model User`, a field's full declaration, a named type's binding, or a block's keyword and name — followed by its `///` documentation comment, when one is present.

Hovering a model or field attribute shows the same signature label signature help renders for it, followed by the attribute's documentation. Hovering a contributed type (a scalar constructor such as a database-specific type) shows its dotted path with its argument types, followed by the contributing extension's documentation for it. Hovering a generic block's keyword (`policy`, `view`, and similar) shows the extension's documentation for that kind of block, with no declaration line.

A declaration, attribute, or contributed type with no documentation to show omits that section rather than leaving a blank one; a block keyword with no contributed documentation shows no hover at all. Closed or unmanaged documents, and positions with nothing to show, also receive no hover.
