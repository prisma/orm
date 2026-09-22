# `@internal/extension-arktype-json`

Per-library JSON-with-schema column factory for Prisma 8, built on [arktype](https://arktype.io). Ships the `arktypeJson(schema)` column-author helper and the `arktype/json@1` codec descriptor.

## What it does

Given an arktype `Type`, `arktypeJson(schema)` produces a column descriptor that:

- Stores values as `jsonb` on Postgres.
- Eagerly serializes `schema.expression` (TypeScript-source-like rendering) and `schema.json` (arktype's internal IR) into `typeParams`. The IR is the lossless rehydration source; the expression is the emit-path renderer's input.
- At runtime, the framework's unified codec descriptor map rehydrates the schema via `ark.schema(typeParams.jsonIr)` and returns a `Codec` whose `decode` validates wire payloads via the rehydrated schema. Validation failures throw `RUNTIME.JSON_SCHEMA_VALIDATION_FAILED`.
- `encode` is schema-independent and only checks JSON representability; validation runs on `decode` and `decodeJson`.
- The emitted `contract.d.ts` renders the column's TS type as the schema's `expression` (e.g. `{ name: string; price: number }`). No-emit contracts currently fall back to the base codec output type (`unknown`).

## Why a per-library extension

The unified `CodecDescriptor` model routes JSON-with-schema through per-library extension packages: arktype-json now, future zod / valibot extensions when each has a clean serialize / rehydrate story. The Postgres adapter retains only the storage-level `jsonColumn` / `jsonbColumn` descriptors (untyped raw JSON). See [ADR 208 — Higher-order codecs for parameterized types](../../../docs/architecture%20docs/adrs/ADR%20208%20-%20Higher-order%20codecs%20for%20parameterized%20types.md).

## Usage

```ts
import { type } from 'arktype';
import { arktypeJson } from '@internal/extension-arktype-json/column-types';
import { defineContract, field, model } from '@internal/sql-contract-ts/contract-builder';

const ProductSchema = type({ name: 'string', price: 'number', 'description?': 'string' });

const contract = defineContract({ /* ... */ }, ({ field, model }) => ({
  models: {
    Product: model('Product', {
      fields: {
        id: field.id.uuidv4String(),
        spec: field.column(arktypeJson(ProductSchema)),
      },
    }).sql({ table: 'product' }),
  },
}));
```

After emit, `Product.spec` in `contract.d.ts` resolves to `{ name: string; price: number; description?: string }` because the schema's expression renders directly into the field type. In the no-emit TypeScript path, the column still carries `typeParams` and runtime validation, but `FieldOutputType` currently falls back to `CodecTypes['arktype/json@1']['output']` (`unknown`), so use emitted contracts when user-facing field types must preserve the arktype schema shape.

## Pack registration

Add the runtime descriptor to your runtime stack and the control descriptor to your `prisma.config.ts` `extensions`:

```ts
import arktypeJsonPack from '@internal/extension-arktype-json/pack';
import arktypeJsonRuntime from '@internal/extension-arktype-json/runtime';

// prisma.config.ts
export default {
  extensions: { arktypeJson: arktypeJsonPack },
  // ...
};

// runtime
const stack = createSqlExecutionStack({
  target: postgresTarget,
  adapter: postgresAdapter,
  extensions: [arktypeJsonRuntime],
});
```

## Compatibility

Codec stability depends on a round-trip invariant: `ark.schema(typeParams.jsonIr).expression === typeParams.expression`. The emit-path renderer reads `expression` directly, so a contract emitted against arktype `X` and rehydrated against arktype `Y` produces correct types only as long as that invariant holds across `X→Y`.

The package's `arktype` dependency is pinned to a tilde range (`~2.1.29`) — patch upgrades are accepted, minor and major upgrades are not. Bumping the range without a coordinated re-emit of every contract using `arktype/json@1` risks emit-path output going stale relative to the rehydrated runtime schema. Consumers who upgrade `arktype` outside this range should re-run `pnpm emit` and verify `contract.d.ts` matches expectations.

The runtime enforces the invariant defensively: the codec's factory runs at execution-context construction time (typically when `runtime.connect()` is called), and throws `RUNTIME.TYPE_PARAMS_INVALID` if the rehydrated schema's `expression` doesn't match the serialized one. So a stale-but-shape-valid `contract.json` fails fast at startup rather than rendering wrong types in user code. The error message points at re-running `pnpm emit`.

## Notes

- The codec is library-bound (`arktype/json@1`), not target-bound. Other schema libraries ship as parallel extensions (`zod/json@1`, `valibot/json@1`) when their serialize/rehydrate stories materialize.
- `decode` validates internally and throws on rejection. JSON-Schema validation lives uniformly inside the resolved codec's `decode` body; the framework no longer maintains a parallel validator registry. Validation rejections surface as `RUNTIME.JSON_SCHEMA_VALIDATION_FAILED`.
- For untyped raw JSON columns, use `jsonColumn` / `jsonbColumn` from `@internal/adapter-postgres/column-types` instead.

## Data integrity: validate-on-decode, not on encode

Schema validation runs only on `decode` / `decodeJson`. `encode` checks JSON representability but does not invoke the schema. This is intentional — ADR 208 keeps `encode` parameter-independent so it can be dispatched by `codecId` without resolving per-column schemas — but it has a consequence callers must plan for: **a schema-invalid write commits the row to the database, and only then fails on the read-back through `RETURNING`**.

The TypeScript types prevent this at the call site, so well-typed callers are safe. The footgun is reachable only when types are bypassed (`as never`, `// @ts-ignore`, untyped data from a third-party feed, runtime drift between writers). In that case:

1. `ORM.create({ ... })` calls `codec.encode` — succeeds, because encode skips the schema.
2. `INSERT … RETURNING` runs in autocommit — the row commits to the database.
3. Decoding the `RETURNING` payload invokes `codec.decode` — throws `RUNTIME.JSON_SCHEMA_VALIDATION_FAILED`.
4. The caller sees an error from `create`, but the bad row is now in the table and every subsequent read of it will fail the same way.

If your inputs cross a type boundary you don't fully control, mitigate:

- **Wrap mutations in `withTransaction`** so a `RETURNING`-decode failure rolls back the `INSERT`.
- **Pre-validate** with `schema.allows(value)` (or `schema(value) instanceof ArkErrors`) before calling `create` / `update`.

In a fully-typed application path this never fires; the warning is for the boundary where ergonomics collide with foreign data.
