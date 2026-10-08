---
changes:
  - id: foreign-keys-name-their-backing-index
    summary: |
      Each foreign key in `contract.json` now states what backs it in a new `index` field: `{ "name": "<index>" }` for an index, `{ "primaryKey": true }` or `{ "unique": true }` for a primary key or unique constraint whose first columns are its columns, absent for `index: false`. Every SQL contract with a foreign key gets a new storage hash, and so does the Supabase extension's contract space. Re-emit the contract. When `prisma migration plan` then finds nothing to change in the database, follow its advice: write a migration with no operations with `prisma migration new --from <hash>`, or run `prisma db sign` on a database you manage with `prisma db init` or `prisma db update`.
    detection:
      glob: "**/contract.json"
      matches:
        - '"foreignKeys"\s*:\s*\[\s*\{'
  - id: partial-or-typed-index-no-longer-backs-a-foreign-key
    summary: |
      A relation used to get no backing index when its table had any index on the same columns, including a partial index (`where:`), an index with a non-default `type` such as `hash` or `gin`, or one with `options`. Such an index does not serve every lookup a foreign key needs, so the relation now gets its own backing index, and `prisma migration plan` creates it. An index with `type: "btree"` and no options or predicate still counts as the same index. To keep the database as it is, point the relation at your index with `index: "<name>"`, or opt out with `index: false`.
    detection:
      glob: "**/*.{prisma,ts,mts,cts}"
      matches:
        - '@@index\([^)]*\b(?:where|type|options)\s*:'
        - 'constraints\.index\([^)]*\b(?:where|type|options)\s*:'
  - id: unnamed-index-on-unique-columns-left-out
    summary: |
      An `@@index` without `name` or `map`, with no `where`, `options` or non-default `type`, whose columns are exactly those of a unique constraint, a unique index or the primary key, is now left out of the contract, because the unique one already serves its lookups. `prisma migration plan` drops it from the database. To keep it, give it a `name` or `map`; `prisma contract emit` then warns that it duplicates the unique one.
    detection:
      glob: "**/*.{prisma,ts,mts,cts}"
      matches:
        - '@@index\(\s*\[[^\]]*\]\s*\)'
        - 'constraints\.index\(\s*\[[^\]]*\]\s*\)'
  - id: infer-and-print-write-the-relation-index-argument
    summary: |
      `prisma contract infer` now writes `index: false` on a relation whose only index on its columns is partial, has a non-default type (such as `hash` or `gin`) or has options, where it used to write nothing. `prisma contract print` writes `index: "<name>"` on a relation backed by such an index, nothing on a relation backed by its default index or a key, and `index: false` only where nothing backs the foreign key. Re-running either command can change the `@relation` lines it writes; review the diff.
    detection:
      glob: "**/*.prisma"
      matches:
        - '@relation\([^)]*\bindex\s*:'
---

## `foreign-keys-name-their-backing-index`

A foreign key in `contract.json` now says what serves its lookups:

```jsonc
"foreignKeys": [
  { "name": "post_author_id_fkey", "source": { "columns": ["author_id"] }, "target": { … },
    "index": { "name": "post_author_id_idx_4d0f3a1c" } },
  { "source": { "columns": ["user_id"] }, "target": { … }, "index": { "unique": true } }
]
```

A relation still gets its own backing index unless it says `index: false`. When the table already declares an identical index, or a unique constraint, unique index or primary key on the same columns, the contract keeps one index and the foreign key names it, or names the key by kind. The field is absent only with `index: false`. A `contract.json` from Prisma Next 0.15, which stored `"index": true` or `false` on each foreign key, still loads; the boolean is read as absent.

1. Run `prisma contract emit`. Every contract with a foreign key gets a new storage hash.
2. Run `prisma migration plan`. If nothing else in this upgrade changes your database, it reports that the contract changed but nothing in the database did. Do what it says:
   - If you deploy with migrations, run the `prisma migration new --from <hash>` command it prints, which writes a migration with no operations, then `prisma db migrate`.
   - If you manage a database with `prisma db init` or `prisma db update`, run `prisma db sign` against it.
3. If your project composes the Supabase extension, its contract space also gets a new storage hash: run `prisma db sign` against each database signed with the previous one.

`prisma contract emit` now also warns when two indexes of a table that both carry a `name` or `map` are identical (`PN_INDEX_DUPLICATE`), or when a named plain index has the same columns as a unique constraint, unique index or the primary key (`PN_INDEX_REDUNDANT`). The contract keeps both indexes; remove the one you do not need. Two identical indexes both named with `name:` are refused, because the planner could not tell their wire names apart: remove one, or name one with `map:`.

## `partial-or-typed-index-no-longer-backs-a-foreign-key`

Deleting or updating a referenced row looks up the referencing rows by the foreign key columns. A partial index covers only the rows its predicate selects, and an index with another access method or options may not serve that lookup, so the relation now gets a plain backing index beside it. For example:

```prisma
model Post {
  id       Int  @id
  authorId Int
  author   User @relation(fields: [authorId], references: [id])

  @@index([authorId], where: "archived_at IS NULL", name: "post_author_live")
}
```

The next `prisma migration plan` creates `post_authorId_idx_…`. If that is what you want, apply it. Otherwise choose one:

- To use your index, name it on the relation. No backing index is derived:

  ```prisma
  author User @relation(fields: [authorId], references: [id], index: "post_author_live")
  ```

  In a TypeScript contract, pass the same name: `rel.belongsTo(User, { from: 'authorId', to: 'id' }).sql({ fk: { index: 'post_author_live' } })` or `constraints.foreignKey(cols.authorId, User.refs.id, { index: 'post_author_live' })`.
- To have no backing index at all, write `index: false` on the relation, or `fk: { index: false }` in TypeScript.

The name is the `name` or `map` you gave the index, unique constraint or primary key, or an index's stored name from `contract.json`. The default name of an index you did not name does not count. `prisma contract emit` refuses a name that the table does not have, that an index and a key share, or whose object's first columns are not the foreign key's columns.

## `unnamed-index-on-unique-columns-left-out`

For example, with `email String @unique`, an `@@index([email])` is left out of the contract, and `prisma migration plan` drops the index from the database. The unique constraint keeps serving the lookups. If you want to keep the index, write `@@index([email], name: "user_email_lookup")`; `prisma contract emit` then warns with `PN_INDEX_REDUNDANT` on each emit.

## `infer-and-print-write-the-relation-index-argument`

Nothing to change in your source. If you re-run `prisma contract infer` or `prisma contract print`, expect `@relation` lines to differ from what an earlier release wrote: `index: false` beside a hash, gin, optioned or partial index, and `index: "<name>"` or no `index` argument where `contract print` used to write `index: false` on every relation. Emitting either result gives the same contract.
