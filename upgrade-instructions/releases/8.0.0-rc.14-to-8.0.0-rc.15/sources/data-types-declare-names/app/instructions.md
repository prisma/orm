---
changes:
  - id: ts-contract-lists-extension-codecs
    summary: |
      A TypeScript contract built with `defineContract` from `@prisma/orm-postgres/contract-builder`
      or `@prisma/orm-sqlite/contract-builder` names each column's database type from the data type
      its codec represents. A contract that uses an extension's codec without listing the extension
      in `extensions` now fails with `CONTRACT.CODEC_DESCRIPTOR_MISSING`. List the extension.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '(?<![\s\S])(?![\s\S]*GENERATED FILE - DO NOT EDIT)(?=[\s\S]*(?<![\w$])defineContract(?![\w$]))[\s\S]*[''"]@prisma/orm-extension-(?:pgvector|postgis|arktype-json)/column-types[''"]'
        - '(?<![\s\S])(?![\s\S]*GENERATED FILE - DO NOT EDIT)(?=[\s\S]*(?<![\w$])defineContract(?![\w$]))[\s\S]*(?<![\w$])codecId\s*:\s*[''"](?:pg/vector|pg/geometry|arktype/json)@\d+[''"]'
  - id: sqlite-contract-d-ts-char-aggregates
    summary: |
      On SQLite, `sql/char@1` and `sql/varchar@1` are registered codecs. Re-emit the contract:
      `contract.d.ts` gains `min` and `max` aggregate rows for both codecs. `contract.json`, its
      hashes and the migration SQL do not change.
    detection:
      glob: "**/contract.d.ts"
      matches:
        - '^(?![\s\S]*[''"]sql/char@1[''"]\s*:\s*\{\s*readonly output)[\s\S]*@prisma/orm-(?:target-)?sqlite/'
  - id: column-helpers-raise-type-params-invalid
    summary: |
      pgvector's `vector(length)` and PostGIS's `geometry({ srid })` and `pgGeometryColumn({ srid })`
      no longer check their arguments. Building the contract checks every column's parameters
      against its data type: an argument outside its bounds now fails `defineContract` with
      `CONTRACT.TYPE_PARAMS_INVALID` instead of failing the helper call with
      `CONTRACT.ARGUMENT_INVALID`, and `srid: 0` is refused when the contract is built, not later
      when a migration is planned.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\bCONTRACT\.ARGUMENT_INVALID\b'
        - '\bsrid\s*:\s*0\b'
---

## `ts-contract-lists-extension-codecs`

A column's stored database type name is now written from the data type of the column's codec, so the contract build needs the pack that provides the codec. Add every extension whose codec the contract uses:

```ts
import pgvector from '@prisma/orm-extension-pgvector/pack';
import { defineContract } from '@prisma/orm-postgres/contract-builder';

export const contract = defineContract(
  { extensions: { pgvector } },
  ({ field, model }) => ({
    // …
  }),
);
```

A contract that already lists the extension changes nothing. `contract.json` does not change.

## `sqlite-contract-d-ts-char-aggregates`

Run `prisma contract emit` for a SQLite project. The emitted `contract.d.ts` adds these rows under both `AggregateTypes.max.byCodec` and `AggregateTypes.min.byCodec`:

```ts
readonly 'sql/char@1': { readonly output: 'sql/char@1'; readonly nullable: true };
readonly 'sql/varchar@1': { readonly output: 'sql/varchar@1'; readonly nullable: true };
```

`contract.json`, `storageHash`, `profileHash` and migration snapshots do not change, so no migration or re-sign is needed.

## `column-helpers-raise-type-params-invalid`

The error now comes from `defineContract`, not from the helper call. Code that catches it by its code checks the new code, around the contract build:

```ts
// before
if (error.code === 'CONTRACT.ARGUMENT_INVALID') { /* … */ }

// after
if (error.code === 'CONTRACT.TYPE_PARAMS_INVALID') { /* … */ }
```

The error's `meta` is `{ dataType, parameters, modelName, fieldName }`, for example `{ dataType: 'postgis/geometry', parameters: ['srid'], modelName: 'Place', fieldName: 'location' }`, in place of `helperPath`, `expected` and `received`. A contract that passes `srid: 0` now fails when it is built; PostgreSQL refuses an SRID below 1, so such a column never migrated. Use a real SRID such as `4326`, or `geometryColumn` for a column with no SRID.

The build checks every column, so the PostgreSQL column helpers' parameters are checked too: a contract with `varcharColumn(0)` or `numericColumn(2000)` now fails when it is built, where before `migration plan` or `db verify` failed.
