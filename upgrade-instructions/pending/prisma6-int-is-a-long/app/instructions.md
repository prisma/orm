---
changes:
  - id: prisma6-int-reads-as-bigint
    summary: |
      A contract read with `prisma6Schema(...)` now gives a plain Prisma 6 `Int` field the codec for the BSON
      long Prisma 6 stores: in `contract.d.ts` the field changes from `number` to `bigint`, reads return a
      `bigint`, and writes take a `bigint` and store a long. `Int @db.Int` stays a `number`. Every native
      type Prisma 6 accepts except `DateTime @db.Timestamp` is now read instead of refused. A document in
      which such a field holds a fractional number, which the previous contract let Prisma 8 write, now
      fails to read with `RUNTIME.DECODE_FAILED`: repair those documents, re-emit the contract, then pass
      and expect `bigint` values for those fields.
    detection:
      glob: "**/prisma.config.{ts,mts,cts,js,mjs}"
      matches:
        - '\bprisma6Schema\s*\('
---

# A Prisma 6 `Int` is a `bigint`

Prisma 6 stores a plain `Int` on MongoDB as a BSON long. A contract read with `prisma6Schema(...)` used to give such a field the 32-bit int codec, so Prisma 8 wrote new values as BSON ints, and a fractional number was accepted and stored as a double. It now uses the 64-bit codec, as it does for `BigInt`.

1. Repair every document in which a plain `Int` field holds a fractional number. The previous contract let Prisma 8 store one as a BSON double, and the 64-bit codec refuses to read it (`RUNTIME.DECODE_FAILED`, "wire value is the fractional double 2.5"), so a query that returns such a document fails as a whole. For each plain `Int` field of each model, in the collection the model is stored in, with the MongoDB shell (`mongosh`) or the driver:
   - List the affected documents, to decide how to repair them:

     ```js
     db.Post.find({ likes: { $type: 'double' }, $expr: { $ne: ['$likes', { $trunc: '$likes' }] } })
     ```

   - Store every double in the field as a long. Choose `$round` or `$trunc`: `$round` rounds to the nearest whole number and a half to the even one (2.5 becomes 2, 3.5 becomes 4); `$trunc` drops the fraction (2.9 becomes 2). Whole-number doubles become longs either way.

     ```js
     db.Post.updateMany({ likes: { $type: 'double' } }, [
       { $set: { likes: { $toLong: { $round: ['$likes', 0] } } } },
     ])
     ```

   - For an `Int[]` field, convert each double in the list:

     ```js
     db.Post.updateMany({ scores: { $type: 'double' } }, [
       {
         $set: {
           scores: {
             $map: {
               input: '$scores',
               in: {
                 $cond: [
                   { $eq: [{ $type: '$$this' }, 'double'] },
                   { $toLong: { $round: ['$$this', 0] } },
                   '$$this',
                 ],
               },
             },
           },
         },
       },
     ])
     ```

   - For a field of a composite type, write its dotted path (`'address.zip'` and `'$address.zip'`) in the filter and the update.

   Here `Post`, `likes` and `scores` stand for the collection and the field names in the database, after `@@map` and `@map`.
2. Run `prisma contract emit`. In `contract.d.ts`, each plain `Int` field of the Prisma 6 schema is now typed with `mongo/int64@1` (`bigint`) instead of `mongo/int32@1` (`number`). `db sign` and `db verify` need nothing new: the contract carries no validators.
3. Run the TypeScript compiler over the application. Fix each error on these fields:
   - Values passed to `create`, `update`, `upsert` and `where` become `bigint`: `5n`, or `BigInt(count)` for a `number` that holds a whole number.
   - Values read become `bigint`: convert with `Number(value)` where the code needs a `number` and the value fits in 2^53, and compare with `bigint` literals (`value === 0n`).
   - Arithmetic mixes no `number` with a `bigint`: `value + 1n`, not `value + 1`.
4. Add `@db.Int` to a field in the Prisma 6 schema only if the collection really holds 32-bit ints, for example a collection other code writes. Prisma 6 then writes new values as ints too, and the field reads as a `number` in Prisma 8.
