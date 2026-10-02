---
changes:
  - id: foreign-key-backing-index-for-partial-and-search-indexes
    summary: |
      A partial index, or a Postgres gin, gist, spgist or brin index, no longer stands in for a foreign key's backing index. A contract whose foreign key columns were covered only by such an index now gets a backing index: re-emit the contract and plan a migration, which creates it.
    detection:
      glob: "**/*.{prisma,ts,mts}"
      matches:
        - '@@index\s*\([^)]*\bwhere\s*:'
        - '@@index\s*\([^)]*\btype\s*:\s*"(gin|gist|spgist|brin)"'
        - "type:\\s*'(gin|gist|spgist|brin)'"
        - '\.index\s*\([\s\S]*?\bwhere\s*:'
---

# An index backs a foreign key only if it can serve its lookups

## `foreign-key-backing-index-for-partial-and-search-indexes`

A foreign key gets a backing index, named `<table>_<columns>_idx`, unless an index of the table already covers its columns in the same order. That covering index now counts only if it can serve the foreign key's lookups:

- it has no `where:` predicate, and
- it has no `type:`, or its type is one the target declares able to back a foreign key. On Postgres those are `btree` and `hash`. `gin`, `gist`, `spgist` and `brin` cannot, and neither can ParadeDB's `bm25`.

Unique constraints and the primary key count as before. SQLite has no index types and refuses partial indexes, so nothing changes there.

If a foreign key's columns were covered only by such an index, for example:

```prisma
model Post {
  id       Int    @id
  authorId Int
  author   User   @relation(fields: [authorId], references: [id])

  @@index([authorId], where: "archived_at IS NULL", name: "post_author_live")
}
```

then the re-emitted contract gains the backing index `post_authorId_idx_<hash>`, and `prisma migration plan` creates it. Apply that migration. If you do not want the index, declare the relation with `index: false` (`@relation(fields: [...], references: [...], index: false)`, or `fk: { index: false }` in TypeScript) and re-emit; the plan then has no operation for it.

`prisma contract infer` follows the same rule: for a live foreign key covered only by such an index, the inferred `@relation` now carries `index: false`.
