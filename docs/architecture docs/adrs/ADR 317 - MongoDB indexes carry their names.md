# ADR 317 — MongoDB indexes carry their names

**Status:** Accepted
**Builds on:** [ADR 188 — MongoDB migration operation model](ADR%20188%20-%20MongoDB%20migration%20operation%20model.md), [ADR 306 — One plain-data definition and one builder per family](ADR%20306%20-%20One%20plain-data%20definition%20and%20one%20builder%20per%20family.md)

## At a glance

A Prisma 6 schema like this one built two indexes on `email` in MongoDB:

```prisma
model User {
  id    String @id @default(auto()) @map("_id") @db.ObjectId
  email String @unique

  @@index([email(sort: Asc)])
}
```

MongoDB holds them as `User_email_key` (unique) and `User_email_idx`. The contract now records each index's name:

```json
"indexes": [
  { "kind": "mongo-index", "name": "User_email_key", "keys": [{ "field": "email", "direction": 1 }], "unique": true },
  { "kind": "mongo-index", "name": "User_email_idx", "keys": [{ "field": "email", "direction": 1 }] }
]
```

`db verify` checks both names, a migration creates each under its name, and a drop removes an index by the name the database holds it under.

## Context

Before this decision a MongoDB contract stored no index name. Migrations named every index after its keys (`email_1`), gave each operation an id built from the keys, and checked whether an index exists by its keys alone. So two indexes on the same keys with different options could not both be created: a unique and a plain index, a plain and a sparse one, or the indexes two variants of one base write on the same field. A drop removed the index named `email_1`, which fails for an index held under another name and can remove the wrong index when two share keys.

## Decision

1. **`MongoIndex` has a required `name`.** It is the name MongoDB stores the index under. The builder refuses two indexes with one name in one collection (`indexNameDuplicate`).
2. **The sources fill the name.**
   - Prisma 8 PSL takes it from `map:` on `@@index`, `@@unique`, `@@textIndex` and `@unique`; TypeScript `defineContract` from the index option `name`. An index written without one gets the name MongoDB gives an index created without one: its stored keys and directions, such as `email_1` or `title_text`. `nameIndexes` does this for both sources, before `mergeRedundantIndexes`, so the builder still builds the definition it is given (ADR 306). Every database Prisma 8 built keeps its index names, and a migration plans nothing for them.
   - Two indexes of one collection that would get the same name are refused, and the message asks for a name with `map:` or `name`. Choosing a name automatically would either rename an existing index when a second one appears, or depend on the order the indexes are written in. MongoDB cannot rename an index, so a rename is a drop and a rebuild.
   - `mergeRedundantIndexes` merges only indexes with the same name. Two identical indexes that the user named apart are kept, and the builder refuses them, because MongoDB cannot hold both.
   - The Prisma 6 reader gives each index the name Prisma 6 gives it: `map:` (or `name:` on `@@index`) when written, otherwise `<collection>_<stored fields>_key` for a unique index and `_idx` for any other, cut to 127 bytes, as prisma-engines 6.19.3 `ConstraintNames` builds it. It refuses what Prisma 6 refuses: two indexes of one model with one name, an empty `map`, and a `map` longer than 127 bytes.
3. **The schema IR reads the name.** `MongoSchemaIndex` has `name`, and its `id` is the name, which MongoDB keeps unique within a collection. Introspection reads it from `listIndexes`.
4. **The planner pairs indexes by content.** It pairs an origin index with a destination index when `indexLookupKey`, which leaves the name out, is the same. Between two contracts the content compares exactly. A database does not report every index as it was written: it lists a text index's keys as `_fts` and `_ftsx` and fills in its weights and languages, and it fills in a collation's unwritten fields. So when the origin was read from a database (`db update`, `db init`), the planner first undoes these changes, as the verifier does, with `canonicalizeSchemasForVerification`; `MongoSchemaIR.fromDatabase` tells the two origins apart. A pair whose names differ is a drop and a create, because MongoDB cannot rename an index. Drops run before creates, which MongoDB needs: it refuses an index with the content of one it already holds.
5. **Operations use the name.**
   - `createIndex(collection, keys, options)` creates the index under `options.name`. Its prechecks require that the collection holds no index with that name and none with the same keys and options; its postcheck requires an index with that name, keys and options.
   - `dropIndex(collection, keys, options)` drops the index named `options.name`, the name the origin contract or the introspected database holds it under. `options` lists every option the index has. Its precheck requires an index with that name, those keys and exactly those options; its postcheck requires that no index with that name is left.
   - The operation id is `index.<collection>.<create|drop>(<name>)`.
   - A call without a name, as migration files written by earlier releases have, names the index after its keys, and a `dropIndex` without options checks the keys only, as it did before. Those files keep working.
6. **`db verify` reports a name difference.** An index of the contract whose content the database holds under another name is a failure, with the contract index as `expected` and the database index as `actual`. The canonicalization that strips server defaults pairs a live index with the contract index of the same name when several share its keys.

## Consequences

- Every MongoDB contract with an index gets a new storage hash, because each index records its name. Databases need no change, because the names already match: users re-emit the contract and sign the database again, or plan a migration that has no operations.
- A schema with two unnamed indexes on the same keys and different options, which no migration could create before, is now refused until one is named.
- Contract snapshots written by earlier releases have indexes without names and fail validation. The upgrade note's script adds the names they always had: the name the newly emitted contract gives the same index, or else the name after its keys. It rewrites each snapshot in place and keeps its old storage hash on purpose, because database markers, the ledger and every migration's `from` and `to` name that hash; so a rewritten snapshot's content no longer recomputes to its hash. Nothing recomputes a MongoDB snapshot's hash today, and a future content check of MongoDB snapshots must accept these.

## Alternatives considered

- **Content-hash names, as SQL's ADR 243 does (`email_1_<8 hex>`).** SQL needs the hash because Postgres reprints expression text, so the content cannot be compared. MongoDB reports index options as written, so content compares exactly. And MongoDB has no index rename, so moving existing databases to hashed names would rebuild every index.
- **No names in the contract; drop by content when the migration runs.** This needs a new runner command that looks up an index by content and drops it, it leaves names unchecked, and it still cannot describe the names Prisma 6 gave.
- **An optional name, where a missing one means the default.** This keeps storage hashes, but the contract would no longer state what the database holds, and every reader of the contract would have to know the default rule.
