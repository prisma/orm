---
changes:
  - id: mongo-prisma6-indexes-as-prisma6-reads-them
    summary: |
      A Prisma 6 MongoDB schema read by `prisma6Schema()` no longer has its indexes merged. Two indexes of one model with the same fields and the same written sort, of any kind (`@unique`, `@@unique`, `@@index`, `@@fulltext`), are refused with `PSL.PRISMA6_MONGO_INDEX_ALREADY_EXISTS`, as Prisma 6 refuses them. A unique and a plain index on the same keys that Prisma 6 accepts, such as `@unique` beside `@@index([email(sort: Asc)])`, are both kept, so the contract describes the database Prisma 6 built and gets a new storage hash. Prisma 8 PSL and TypeScript `defineContract` still merge identical and redundant indexes; their contracts do not change.
    detection:
      glob: "**/*.prisma"
      matches:
        - '(?<![\s\S])(?=[\s\S]*@db\.ObjectId\b)[\s\S]*(?:@unique\b|@@(?:unique|index|fulltext)\()'
---

# The Prisma 6 reader keeps MongoDB indexes as Prisma 6 wrote them

`prisma6Schema()` describes the database Prisma 6 built, so it no longer merges indexes. This schema is now refused, because Prisma 6 refuses it too:

```prisma
model User {
  id    String @id @default(auto()) @map("_id") @db.ObjectId
  email String @unique

  @@index([email])
}
```

## `mongo-prisma6-indexes-as-prisma6-reads-them`

1. Run `prisma contract emit` for each project that reads a Prisma 6 schema with `prisma6Schema()`.
2. If it reports `PSL.PRISMA6_MONGO_INDEX_ALREADY_EXISTS`, the schema has two indexes that Prisma 6 refuses, or two that Prisma 6 accepts but MongoDB cannot hold, because they have the same keys and options in one collection. The message names both. Remove one of them.
3. If the storage hash changed, the schema writes a unique and a plain index on the same keys with different written sorts, and the contract now holds both, as the database does. Run `prisma db sign` again.
