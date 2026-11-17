---
changes:
  - id: client-generated-created-at-presets
    summary: Re-emit contracts using creation timestamp presets and migrate their removed database defaults.
---

# Creation timestamp presets now use the client clock

For schemas using `temporal.createdAt()`, `temporal.createdAtString()`, or `temporal.createdAtJsDate()` (including the matching `field.temporal.*` TypeScript helpers), re-emit the contract with `prisma contract emit`. Review and apply a migration that removes the corresponding database defaults so the database matches the new storage contract. The creation timestamp now uses the same client-side generator as its matching update preset; it is still set only on create.

Update direct SQL writers to supply these required timestamps once their database defaults are removed. If database-generated time is intentional, replace the convenience preset with an explicit timestamp type and `@default(now())` in PSL, or an explicit column with `.defaultSql('now()')` in TypeScript. Preserve the original native type, precision, and codec representation. Explicit database defaults retain their existing behavior.

For Temporal-backed creation presets, provide a global `Temporal` implementation before writes as well as reads, for example `import 'temporal-polyfill/full/global'` when the runtime lacks native support. String and JavaScript Date presets do not require Temporal for their clock.
