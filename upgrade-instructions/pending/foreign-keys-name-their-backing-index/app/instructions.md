---
changes:
  - id: foreign-keys-name-their-backing-index
    summary: |
      Each foreign key in `contract.json` now names the index, unique constraint or primary key that backs it, in a new `index` field, so every SQL contract with a foreign key gets a new storage hash, and so does the Supabase extension's contract space. Re-emit the contract. When `prisma migration plan` then finds nothing to change in the database, follow its advice: write a migration with no operations with `prisma migration new --from <hash>`, or run `prisma db sign` on a database you manage with `prisma db init` or `prisma db update`.
    detection:
      glob: "**/contract.json"
      matches:
        - '"foreignKeys"\s*:\s*\[\s*\{'
  - id: partial-or-typed-index-no-longer-backs-a-foreign-key
    summary: |
      A relation used to get no backing index when its table had any index on the same columns, including a partial index (`where:`) or an index with a `type` or `options`. Such an index does not serve every lookup a foreign key needs, so the relation now gets its own backing index, and `prisma migration plan` creates it. To keep the database as it is, point the relation at your index with `index: "<name>"`, or opt out with `index: false`.
    detection:
      glob: "**/*.{prisma,ts,mts,cts}"
      matches:
        - '@@index\([^)]*\b(?:where|type)\s*:'
        - 'constraints\.index\([^)]*\b(?:where|type)\s*:'
  - id: unnamed-index-on-unique-columns-left-out
    summary: |
      An `@@index` without `name` or `map`, with no `where`, `type` or `options`, whose columns are exactly those of a unique constraint, a unique index or the primary key, is now left out of the contract, because the unique one already serves its lookups. `prisma migration plan` drops it from the database. To keep it, give it a `name` or `map`; `prisma contract emit` then warns that it duplicates the unique one.
---

## `foreign-keys-name-their-backing-index`

A foreign key in `contract.json` now says which index serves its lookups:

```jsonc
"foreignKeys": [
  { "name": "post_author_id_fkey", "source": { "columns": ["author_id"] }, "target": { … },
    "index": "post_author_id_idx_4d0f3a1c" }
]
```

A relation still gets its own backing index unless it says `index: false`. When the table already declares an identical index, or a unique constraint, unique index or primary key on the same columns, the contract keeps one index and the foreign key names that one. The `index` field is absent with `index: false`, and also when the backing object is a unique constraint or primary key without a name in the contract.

1. Run `prisma contract emit`. Every contract with a foreign key gets a new storage hash.
2. Run `prisma migration plan`. If nothing else in this upgrade changes your database, it reports that the contract changed but nothing in the database did. Do what it says:
   - If you deploy with migrations, run the `prisma migration new --from <hash>` command it prints, which writes a migration with no operations, then `prisma db migrate`.
   - If you manage a database with `prisma db init` or `prisma db update`, run `prisma db sign` against it.
3. If your project composes the Supabase extension, its contract space also gets a new storage hash: run `prisma db sign` against each database signed with the previous one.

`prisma contract emit` now also warns when two indexes of a table that both carry a `name` or `map` are identical (`PN_INDEX_DUPLICATE`), or when a named plain index has the same columns as a unique constraint, unique index or the primary key (`PN_INDEX_REDUNDANT`). The contract keeps both indexes; remove the one you do not need.

## `partial-or-typed-index-no-longer-backs-a-foreign-key`

Deleting or updating a referenced row looks up the referencing rows by the foreign key columns. A partial index only covers the rows its predicate selects, and an index with another access method or options may not serve that lookup, so the relation now gets a plain backing index beside it. For example:

```prisma
model Post {
  id       Int  @id
  authorId Int
  author   User @relation(fields: [authorId], references: [id])

  @@index([authorId], where: "archived_at IS NULL", name: "post_author_live")
}
```

The next `prisma migration plan` creates `post_authorId_idx_…`. If that is what you want, apply it. Otherwise choose one:

- To use your index, name it on the relation. No backing index is derived; `prisma contract emit` refuses a name the table does not declare:

  ```prisma
  author User @relation(fields: [authorId], references: [id], index: "post_author_live")
  ```

  In a TypeScript contract, pass the same name: `rel.belongsTo(User, { from: 'authorId', to: 'id' }).sql({ fk: { index: 'post_author_live' } })` or `constraints.foreignKey(cols.authorId, User.refs.id, { index: 'post_author_live' })`.
- To have no backing index at all, write `index: false` on the relation, or `fk: { index: false }` in TypeScript.

The name is the `name` or `map` you gave the index, the unique constraint or the primary key.

## `unnamed-index-on-unique-columns-left-out`

For example, with `email String @unique`, an `@@index([email])` is left out of the contract, and `prisma migration plan` drops the index from the database. The unique constraint keeps serving the lookups. If you want to keep the index, write `@@index([email], name: "user_email_lookup")`; `prisma contract emit` then warns with `PN_INDEX_REDUNDANT` on each emit.
