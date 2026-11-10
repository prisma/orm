---
changes:
  - id: mongo-merged-redundant-indexes
    summary: |
      Every MongoDB contract source now merges identical and redundant indexes in a collection. Identical indexes, which TypeScript and PSL refused before (`CONTRACT.NAME_DUPLICATE`, `PSL_INVALID_INDEX`), become one index. So do two indexes that differ only in an option set to `false`, such as `{ unique: false }` beside the same index without it. A unique and a plain index on the same keys, such as `@unique` and `@@index` on one field, become one unique index. Before, a TypeScript or PSL contract held both indexes of such a pair, and the migration that created them failed. No source change is needed. Run `prisma contract emit`; a contract that held such a pair gets a new storage hash. Delete a migration planned earlier that creates both indexes, and plan it again.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,prisma}"
      matches:
        - '(?<![\s\S])(?=[\s\S]*(?:\bObjectId\b|"mongodb"))[\s\S]*\n\s*(\w+)\s[^\n]*@unique\b(?!\()[\s\S]*@@index\(\[\1\]\)'
        - '(?<![\s\S])(?=[\s\S]*(?:\bObjectId\b|"mongodb"))[\s\S]*@@unique\((\[[^\]]*\])\)[\s\S]*@@index\(\1\)'
        - '(?<![\s\S])(?=[\s\S]*(?:\bObjectId\b|"mongodb"))[\s\S]*@@index\((\[[^\]]*\])\)[\s\S]*@@unique\(\1\)'
        - '@prisma/orm-(?:mongo|family-mongo/contract-ts)/contract-builder[\x27"][\s\S]*\bindex\(\s*(\{[^}]*\})\s*,\s*\{\s*unique\s*:\s*true\s*\}\s*\)[\s\S]*\bindex\(\s*\1\s*\)'
        - '@prisma/orm-(?:mongo|family-mongo/contract-ts)/contract-builder[\x27"][\s\S]*\bindex\(\s*(\{[^}]*\})\s*\)[\s\S]*\bindex\(\s*\1\s*,\s*\{\s*unique\s*:\s*true\s*\}\s*\)'
---

# MongoDB merges identical and redundant indexes

Two indexes in one collection are identical when they have the same keys and the same options, counting an option set to `false` as unset. A plain index is redundant beside a unique index that is otherwise identical. The contract keeps the unique index, or the first of two identical ones, where it was written:

```prisma
model User {
  id    ObjectId @id @map("_id")
  email String   @unique

  @@index([email])
}
```

This now gives one unique index on `{ email: 1 }`. Indexes on the same keys with a different collation, partial filter or other option stay separate.

## `mongo-merged-redundant-indexes`

The detection matches a MongoDB schema or `defineContract` file that writes a unique and a plain index on the same keys. Identical indexes are not matched: the contract builder refused them before, so no working project has them.

1. Run `prisma contract emit`. If the storage hash changed, the contract held two indexes on the same keys that are now one: a unique and a plain index, or two indexes that differ only in an option set to `false`, such as `{ unique: false }` or `{ sparse: false }` beside the same index without it.
2. For a TypeScript or PSL contract, a migration planned before this upgrade that creates both indexes of such a pair never applied: its second `createIndex` fails with `MIGRATION.PRECHECK_FAILED`. Delete it and run `prisma migration plan` again.
3. If `prisma migration apply` stopped part way on that migration, what it created is still in the database:
   - If that migration also created the collection, for example the first migration of a new model, the new migration stops again at `collection.<Name>.create`, because creating a collection is never skipped. Drop it in `mongosh` (`db.User.drop()`) and apply the new migration. It creates the collection and the unique index. The collection is new, so it holds data only if something wrote to it after the failed apply. To keep that data, first find documents that share a value the unique index will refuse: `db.User.aggregate([{ $group: { _id: "$email", count: { $sum: 1 } } }, { $match: { count: { $gt: 1 } } }])`. Change or remove them until that returns nothing. Then export the collection (`mongodump --uri "$DATABASE_URL" --collection User --out backup`), drop it, apply the new migration, and load the data back (`mongorestore --uri "$DATABASE_URL" --noIndexRestore --stopOnError backup`). `--noIndexRestore` keeps the plain index the failed migration created out of the collection. `--stopOnError` makes `mongorestore` stop instead of skipping a document the unique index refuses.
   - If the collection existed before and the index created first is the unique one, do nothing. The new migration finds it and skips creating it.
   - If the collection existed before and the index created first is the plain one, drop it before you apply the new migration, or its `createIndex` fails again with `MIGRATION.PRECHECK_FAILED`. This happens when the plain index was written first, for example `index({ email: 1 })` before `index({ email: 1 }, { unique: true })`, or `@@index([email])` on a model before `email String @unique` on a later model in the same collection. In `mongosh`, drop it by its key pattern, so its name does not matter: `db.User.dropIndex({ email: 1 })`.

In the `mongosh` commands above, replace `User` with your collection's name. It is the model name unless `@@map` changes it.
