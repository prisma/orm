# Prisma 8 language server

The Prisma 8 language server provides diagnostics, formatting, code completion, and attribute signature help for PSL schemas through the Language Server Protocol.

## Completion

Attribute, argument, function, identifier-value, registered scalar, generic block, and block parameter completions use contribution documentation as their detail when available. Scalar constructors, generic block descriptors, and block parameter descriptors can supply this text through their optional `documentation` property. Undocumented descriptors retain their generic completion details.

Required argument snippets use argument names as editable placeholders. Generic block snippets insert required parameters with named placeholders, omitting optional parameters and attributes. Blocks without required parameters include a comment hint describing their contents. Field-reference completions suggest scalar fields only, excluding relation and composite fields.

## Signature help

In an open, configured PSL input marked with `// use prisma-8`, clients can request signature help explicitly or trigger it when typing `(` or `,`. Help shows type-only positional parameters, named-only parameter names, optional markers, and declaration-authored Markdown documentation. Positional parameter documentation identifies the declaration name; parameters accepting both forms appear once and document their named alias. Named arguments highlight their matching parameter regardless of source order.

Field, model, and generic-block attributes use the project's contribution specs, so extension-authored signatures participate without additional server registration. Known nested functions show their innermost signature; unknown nested calls suppress help rather than display a misleading outer signature. Unfinished argument lists are supported from the current editor buffer even when contract interpretation fails.

Snippet-capable clients can opt into argument hints after completion by setting `initializationOptions.completion.supportsTriggerParameterHintsCommand: true` when they implement `editor.action.triggerParameterHints`. Only completions inserting argument snippets carry that command; plain names, existing argument lists, and nullary functions do not. Optional-only function snippets place a tab stop inside the parentheses. The playground also retriggers hints when Tab or Shift+Tab moves within an active PSL snippet.

The client controls tooltip presentation and the shortcut for an explicit signature-help request. Closed or unmanaged documents receive no help, and failures while resolving signature metadata produce an empty response without terminating the server.
