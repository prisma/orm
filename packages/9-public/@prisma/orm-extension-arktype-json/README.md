# @prisma/orm-extension-arktype-json

JSON columns with a validated, typed shape for Prisma 8, built on [arktype](https://arktype.io).

> **From `8.0.0` this package is Generally Available.** A later release in the same major version does not break its users. Until `8.0.0` every Prisma 8 package is published as a release candidate, `8.0.0-rc.N`. See [maturity levels](https://github.com/prisma/orm/blob/main/docs/oss/versioning.md#maturity-levels).

```bash
pnpm add @prisma/orm-extension-arktype-json
```

## Entrypoints

| Namespace | Surface |
| --- | --- |
| `/pack` | the extension pack an application composes into `extensions: [...]` — pure, no runtime imports |
| `/column-types` | the `arktypeJson(schema)` column author |
| `/codecs`, `/codec-types` | the `arktype/json@1` codec descriptor and the types emitted contracts reference |
| `/runtime` | the runtime extension |
| `/control` | the control descriptor |

## Responsibilities

Given an arktype `Type`, `arktypeJson(schema)` produces a column that stores `jsonb`, carries the schema's serialized form in `typeParams`, and renders the schema's TypeScript expression as the column's type in `contract.d.ts`. At runtime the framework rehydrates the schema from that serialized form and validates wire payloads on decode; a validation failure raises `RUNTIME.JSON_SCHEMA_VALIDATION_FAILED`. Encoding only checks JSON representability.

JSON-with-schema is deliberately a per-library extension — this pack covers arktype; other validators get their own packs once each has a clean serialize-and-rehydrate story. Raw, untyped JSON columns stay in the Postgres target.
