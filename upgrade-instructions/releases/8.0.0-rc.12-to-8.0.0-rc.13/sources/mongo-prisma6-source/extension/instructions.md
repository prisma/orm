---
changes: []
---

The Mongo facade's `defineConfig` `contract` option now also accepts a `ContractConfig` in addition to a path string, and `@internal/mongo/config` exports a new `prisma6Schema` helper. Both changes are additive, so existing configs keep working unchanged.
