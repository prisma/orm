---
changes:
  - id: contract-format-formats-prisma7-schema
    summary: prisma contract format now formats a Prisma 7 schema configured through prisma7Schema().
  - id: config-contract-source-requires-format
    summary: A contract source object written in prisma.config.ts must declare format 'psl' or 'typescript'.
  - id: policy-expression-json-escapes
    summary: A policy expression in a PSL contract decodes every JSON escape, so \t, \b, \f, \/ and \uXXXX no longer read as written.
---

# `prisma contract format` formats a Prisma 7 schema

A project whose `contract` is `prisma7Schema('./prisma/schema.prisma')` used to be skipped by `prisma contract format`. The Prisma 7 source is now a PSL source, so the command formats that file with the Prisma 8 formatter when it parses, and refuses without writing when it does not (for example, a schema with a `view` block).

If the Prisma 7 schema must keep Prisma 7's own formatting, do not run `prisma contract format` on it; format it with Prisma 7's `prisma format` instead.

# A contract source in `prisma.config.ts` declares its format

A config that builds `contract.source` itself, as an object with a `load` function, must now give it a `format`: `'psl'` when its inputs are PSL text, and `'typescript'` when it builds the contract in TypeScript, for example `source: { format: 'typescript', load: async () => ok(contract) }`. Without it, or with any other value, every command that reads the config fails with `CONFIG.VALIDATION_FAILED` on the field `contract.source.format`. Sources made by `defineConfig`, `prisma7Schema()`, `prismaContract()` and the TypeScript contract helpers already declare one.

# A policy expression decodes every JSON escape

A `using` or `withCheck` expression in a `policy_*` block of a PSL contract is a JSON string, the form `prisma contract print` and `prisma contract infer` write. The reader used to decode only `\n`, `\r`, `\"` and `\\`, and kept every other backslash sequence as written. It now also decodes `\t`, `\b`, `\f`, `\/` and `\uXXXX`, so `"a\tb"` reads as `a`, a tab and `b`. A backslash sequence that is not a JSON escape, such as `\d`, is still kept as written.

If a PSL contract writes one of those five sequences in a policy expression and means the backslash and the letter, write the backslash twice (`\\t`), then run `prisma contract emit`. Otherwise the emitted policy, and the contract's storage hash, change.
