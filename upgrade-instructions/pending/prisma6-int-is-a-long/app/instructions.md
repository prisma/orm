---
changes:
  - id: prisma6-int-reads-as-bigint
    summary: |
      A contract read with `prisma6Schema(...)` now gives a plain Prisma 6 `Int` field the codec for the BSON
      long Prisma 6 stores: in `contract.d.ts` the field changes from `number` to `bigint`, reads return a
      `bigint`, and writes take a `bigint` and store a long. `Int @db.Int` stays a `number`, and `@db.Int`
      and `@db.Long` on an `Int` field are now read instead of refused. Re-emit the contract, then pass and
      expect `bigint` values for those fields.
    detection:
      glob: "**/prisma.config.{ts,mts,cts,js,mjs}"
      matches:
        - '\bprisma6Schema\s*\('
---

# A Prisma 6 `Int` is a `bigint`

Prisma 6 stores a plain `Int` on MongoDB as a BSON long. A contract read with `prisma6Schema(...)` used to give such a field the 32-bit int codec, so Prisma 8 wrote new values as BSON ints, and a fractional number was accepted and stored as a double. It now uses the 64-bit codec, as it does for `BigInt`.

1. Run `prisma contract emit`. In `contract.d.ts`, each plain `Int` field of the Prisma 6 schema is now typed with `mongo/int64@1` (`bigint`) instead of `mongo/int32@1` (`number`). `db sign` and `db verify` need nothing new: the contract carries no validators.
2. Run the TypeScript compiler over the application. Fix each error on these fields:
   - Values passed to `create`, `update`, `upsert` and `where` become `bigint`: `5n`, or `BigInt(count)` for a `number` that holds a whole number.
   - Values read become `bigint`: convert with `Number(value)` where the code needs a `number` and the value fits in 2^53, and compare with `bigint` literals (`value === 0n`).
   - Arithmetic mixes no `number` with a `bigint`: `value + 1n`, not `value + 1`.
3. Add `@db.Int` to a field in the Prisma 6 schema only if the collection really holds 32-bit ints, for example a collection other code writes. Prisma 6 then writes new values as ints too, and the field reads as a `number` in Prisma 8.
