# Prisma 8 language server

The Prisma 8 language server provides diagnostics, formatting, code completion, and attribute signature help for PSL schemas through the Language Server Protocol.

## Project membership and diagnostics

A project's schema is every file matching the config's `contract.source.inputs` glob(s) whose current text carries `// use prisma-8` — the same gate `contract emit` applies, so the two surfaces agree on what the schema is. Membership is re-expanded on load and reload, not fixed at config-read time: a file created after the server started joins on the next reload without a config edit.

Unopened members are read from disk and interpreted alongside open ones — the project symbol table and diagnostics span the whole membership set, not just currently-open documents. After the client successfully registers a `workspace/didChangeWatchedFiles` watcher for a project's input globs, covered members reuse cached disk text without checking file metadata on each read only when every pattern is in a conservatively supported subset: simple ASCII paths with ordinary `*`, `?`, or whole-segment `**` wildcards. Extended or uncertain syntax, including extglobs, negation, braces, brackets, backslash escapes, and file URIs, retains stat revalidation even after successful registration and membership refresh. Member create/change/delete events invalidate disk text and refresh membership, including coverage for newly discovered members. Open editor text remains authoritative. Files without successful watcher coverage re-check modification time and size on every read, including while registration is pending or after registration fails. Coverage is tracked per project and file identity; registration replacement and coverage changes discard affected disk entries so text cached during a registration gap is not trusted afterward.

Diagnostics are pushed (`textDocument/publishDiagnostics`) to every current member, closed files included — a client that pulls diagnostics still receives push for its closed members, since pull only ever serves open documents. `interFileDependencies: true` reflects this honestly: an edit in one file can change diagnostics anywhere else in the project. A member that leaves the schema (directive removed, file deleted, glob no longer matches) is cleared with an empty diagnostics publish.

## Completion

Attribute, argument, function, identifier-value, registered scalar, generic block, and block parameter completions use contribution documentation as their detail when available. Scalar constructors, generic block descriptors, and block parameter descriptors can supply this text through their optional `documentation` property. Undocumented descriptors retain their generic completion details.

Required argument snippets use argument names as editable placeholders. Generic block snippets insert required parameters with named placeholders, omitting optional parameters and attributes. Blocks without required parameters include a comment hint describing their contents. Field-reference completions suggest scalar fields only, excluding relation and composite fields.

## Signature help

In an open, configured PSL input marked with `// use prisma-8`, clients can request signature help explicitly or trigger it when typing `(` or `,`. Help shows type-only positional parameters, named-only parameter names, optional markers, and declaration-authored Markdown documentation. Positional parameter documentation identifies the declaration name; parameters accepting both forms appear once and document their named alias. Named arguments highlight their matching parameter regardless of source order.

Field, model, and generic-block attributes use the project's contribution specs, so extension-authored signatures participate without additional server registration. Known nested functions show their innermost signature; unknown nested calls suppress help rather than display a misleading outer signature. Unfinished argument lists are supported from the current editor buffer even when contract interpretation fails.

Snippet-capable clients can opt into argument hints after completion by setting `initializationOptions.completion.supportsTriggerParameterHintsCommand: true` when they implement `editor.action.triggerParameterHints`. Only completions inserting argument snippets carry that command; plain names, existing argument lists, and nullary functions do not. Optional-only function snippets place a tab stop inside the parentheses. The playground also retriggers hints when Tab or Shift+Tab moves within an active PSL snippet.

The client controls tooltip presentation and the shortcut for an explicit signature-help request. Closed or unmanaged documents receive no help, and failures while resolving signature metadata produce an empty response without terminating the server.
