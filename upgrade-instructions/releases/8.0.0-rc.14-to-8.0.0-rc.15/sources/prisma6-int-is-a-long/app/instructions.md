---
changes:
  - id: prisma6-int-written-as-long
    summary: |
      A contract read with `prisma6Schema(...)` now gives a plain Prisma 6 `Int` field, and `Int @db.Long`,
      the `mongo/int64Number@1` codec: the application type stays `number`, and Prisma 8 now writes these
      fields as a BSON long, as Prisma 6 does, instead of an int. A document in which such a field holds a
      fractional number, which the previous contract let Prisma 8 write, now fails to read with
      `RUNTIME.DECODE_FAILED`: repair those documents, then re-emit the contract.
    detection:
      glob: "**/prisma.config.{ts,mts,cts,js,mjs}"
      matches:
        - '\bprisma6Schema\s*\('
---

# A Prisma 6 `Int` is written as a long

Prisma 6 stores a plain `Int` on MongoDB as a BSON long and presents it as a `number`. A contract read with `prisma6Schema(...)` used to give such a field the 32-bit int codec, so Prisma 8 wrote new values as BSON ints, and a fractional number was accepted and stored as a double. It now uses `mongo/int64Number@1`: a stored long reads as a `number`, Prisma 8 writes a `number` back as a long, and a value that is not a whole number within ±(2^53 − 1) is refused instead of rounded. The application type does not change.

1. Repair every document in which a plain `Int` field holds a fractional number, whether the field is on the model, in an `Int[]` list, or in a composite type the model holds once or in a list. The previous contract let Prisma 8 store such a value as a BSON double, and `mongo/int64Number@1` refuses to read it (`RUNTIME.DECODE_FAILED`, "wire value is the fractional double 2.5"), so a query that returns such a document fails as a whole. For each plain `Int` field, in the collection its model is stored in, with the MongoDB shell (`mongosh`) or the driver:
   - List the affected documents, to decide how to repair them. For a field on the model, this finds the fractional values:

     ```js
     db.Post.find({ likes: { $type: 'double' }, $expr: { $ne: ['$likes', { $trunc: '$likes' }] } })
     ```

     For a list or a composite value, this finds every document with a double in the field: `db.Post.find({ scores: { $type: 'double' } })` for an `Int[]` field, and `db.Post.find({ 'addresses.zip': { $type: 'double' } })` for `zip` in a composite type, whether `addresses` holds one value or a list.

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

   - For a field of a composite type the model holds once (`address Address?`), write its dotted path (`'address.zip'` and `'$address.zip'`) in the filter and the update above.
   - For a field of a composite type the model holds in a list (`addresses Address[]`), the dotted path fails with "$round only supports numeric types, not array". Rewrite each element of the list instead:

     ```js
     db.Post.updateMany({ 'addresses.zip': { $type: 'double' } }, [
       {
         $set: {
           addresses: {
             $map: {
               input: '$addresses',
               in: {
                 $mergeObjects: [
                   '$$this',
                   {
                     zip: {
                       $cond: [
                         { $eq: [{ $type: '$$this.zip' }, 'double'] },
                         { $toLong: { $round: ['$$this.zip', 0] } },
                         '$$this.zip',
                       ],
                     },
                   },
                 ],
               },
             },
           },
         },
       },
     ])
     ```

   Here `Post`, `likes`, `scores`, `address`, `addresses` and `zip` stand for the collection and the field names in the database, after `@@map` and `@map`.
2. Run `prisma contract emit`. In `contract.d.ts`, each plain `Int` field of the Prisma 6 schema is now typed with `mongo/int64Number@1` instead of `mongo/int32@1`; both read and write a `number`, so application code needs no change. `db sign` and `db verify` need nothing new: the contract carries no validators.
