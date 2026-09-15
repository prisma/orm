# Prisma 8 language server

The Prisma 8 language server provides diagnostics, formatting, code completion, and attribute signature help for PSL schemas through the Language Server Protocol.

## Signature help

In an open, configured PSL input marked with `// use prisma-8`, clients can request signature help explicitly or trigger it when typing `(` or `,`. Help shows parameter names, type labels, optional markers, and declaration-authored Markdown documentation. Named arguments highlight their matching parameter regardless of source order.

Field, model, and generic-block attributes use the project's contribution specs, so extension-authored signatures participate without additional server registration. Known nested functions show their innermost signature; unknown nested calls suppress help rather than display a misleading outer signature. Unfinished argument lists are supported from the current editor buffer even when contract interpretation fails.

The client controls tooltip presentation and the shortcut for an explicit signature-help request. Closed or unmanaged documents receive no help, and failures while resolving signature metadata produce an empty response without terminating the server.
