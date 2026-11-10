---
changes:
  - id: mongo-contracts-record-index-names
    summary: |
      Every index of a MongoDB contract records the name MongoDB stores it under, so every MongoDB contract with an index gets a new storage hash. An index written without a name is named after its keys and directions, such as `email_1`, which is the name earlier releases gave it in the database, so no database changes. A contract without index names is rejected with `CONTRACT.VALIDATION_FAILED`. Run `prisma contract emit`, run the colocated script, which names the indexes of the contract snapshots under `migrations/snapshots/`, then run `prisma db sign` or plan a migration, which has no operations.
    detection:
      glob: "**/*.json"
      matches:
        - '"kind"\s*:\s*"mongo-index"(?!\s*,\s*"name")'
    script: ./scripts/mongo-index-names.ts
  - id: mongo-unnamed-indexes-with-one-name-refused
    summary: |
      MongoDB PSL and TypeScript `defineContract` refuse two indexes of one collection that get one name. Two indexes written without a name on the same keys and directions, such as a unique and a plain index on `email`, a sparse and a plain one, or one `@@index([title])` on each of two variants of one base, are both named `email_1` or `title_1`. MongoDB could never hold both under that name, so no migration could create them. PSL reports `PSL_INVALID_INDEX` at the second index and TypeScript throws `CONTRACT.NAME_DUPLICATE`. Name one of them with `map:` in PSL or the index option `name` in TypeScript.
    detection:
      glob: "**/*.{prisma,ts,mts,cts}"
      matches:
        - '@@base\([\s\S]*@@(?:index|unique|textIndex)\('
        - '\bindex\(\s*\{[^}]*\}\s*,\s*\{[^}]*\b(?:sparse|partialFilterExpression|collation|expireAfterSeconds)\b'
  - id: mongo-prisma6-index-names
    summary: |
      A contract read from a Prisma 6 MongoDB schema with `prisma6Schema()` names each index as Prisma 6 named it: by `map:` (or `name:` on `@@index`), otherwise `<collection>_<fields>_key` for a unique index and `_idx` for others, such as `User_email_key`. `db verify` now checks these names against the database. The reader refuses what Prisma 6 refuses: two indexes of one model with one name (`PSL.PRISMA6_MONGO_INDEX_NAME_DUPLICATE`), and an empty `map` or one longer than 127 bytes (`PSL.PRISMA6_MONGO_INDEX_NAME_INVALID`).
    detection:
      glob: "**/*.prisma"
      matches:
        - '(?<![\s\S])(?=[\s\S]*@db\.ObjectId\b)[\s\S]*(?:@unique\b|@@(?:unique|index|fulltext)\()'
  - id: mongo-index-operations-by-name
    summary: |
      A MongoDB migration creates and drops each index by its name. `prisma migration plan` writes the name into `migration.ts`, as in `createIndex("users", [{ field: "email", direction: 1 }], { name: "User_email_key", unique: true })` and `dropIndex("users", [{ field: "email", direction: 1 }], { name: "User_email_key", unique: true })`. The operation id is `index.<collection>.<create|drop>(<name>)`, such as `index.users.create(email_1)`, where it was `index.users.create(email:1)`. A `migration.ts` written by an earlier release keeps working: an index without a name is named after its keys, as before.
    detection:
      glob: "**/*.{ts,mts,cts,js,mjs,cjs,json,sh,yml,yaml}"
      matches:
        - 'index\.[\w$-]+\.(?:create|drop)\([^)]*:'
---

# MongoDB indexes carry their names

## `mongo-contracts-record-index-names`

For this schema:

```prisma
model Post {
  id       ObjectId @id @map("_id")
  authorId ObjectId

  @@index([authorId])
  @@map("posts")
}
```

each index in `contract.json` gains its name:

```diff
 {
   "keys": [{ "direction": 1, "field": "authorId" }],
-  "kind": "mongo-index"
+  "kind": "mongo-index",
+  "name": "authorId_1"
 }
```

`authorId_1` is the name the index already has in the database, so the database needs no change. Only the storage hash changes.

1. Commit your work first, so the changes can be reviewed and undone with git.
2. Run `prisma contract emit` and commit the regenerated `contract.json` and `contract.d.ts`.
3. Run the colocated script from the project root:

   ```sh
   node <path-to-this-guide>/scripts/mongo-index-names.ts
   ```

   Node 24 or later runs the TypeScript script directly. It reads and writes files only. It rewrites every `*.json` file under the root that is a MongoDB contract with an index without a name, skipping `node_modules`, `.git`, `dist` and `build`, and the `contract.d.ts` next to it (`<name>.d.ts` next to `<name>.json`). These are the contract snapshots under `migrations/snapshots/<hash>/`, which no command regenerates. Each snapshot index takes the name that its own project's emitted contract gives the index with the same collection, keys and options, so a project whose contract comes from `prisma6Schema()` gets Prisma 6's names, such as `User_email_key`. A snapshot's project is the nearest folder, going up from the folder that holds its `migrations` folder, that holds an emitted contract, and the walk stops at the first folder with a `package.json`, the project root, so a name never comes from another project of a monorepo; contracts under a `snapshots` folder are never used as a source. When no emitted contract of the project has the index, or two of them name it differently, the index gets the name earlier releases gave it in the database, its keys and directions such as `email_1`, and the script prints one line saying so for each such index; check those names against the database with `prisma db verify` after the upgrade. The script writes each file in the layout `contract emit` writes it. The snapshot directory names stay as they are. A contract that step 2 emitted already has names and is left alone. The script prints each file it rewrote, or that nothing changed. It does not follow symbolic links: it names each one it finds and exits 1, and if a link holds migration snapshots, run the script again on the folder it points to. If it cannot match the index types of a `contract.d.ts` with its `contract.json`, it says so and exits 1; add `readonly name: '<name>'` beside `readonly kind: 'mongo-index'` in each index type by hand.

   To rewrite a file by hand instead, add `"name"` to each object whose `kind` is `mongo-index`: the name the emitted contract gives the same index, or else its keys and directions, such as `"name": "createdAt_-1_authorId_1"` for the keys `createdAt` descending and `authorId` ascending. Add the matching type in `contract.d.ts`.
4. Bring each database to the new storage hash:
   - For a project kept with `db init` or `db update`, run `prisma db sign`.
   - For a project with migrations, run `prisma migration plan`. The migration it plans has no operations; apply it with `prisma db migrate`.

For a disposable example or test database whose migration chain is regenerated from its schemas, regenerate the chain with its own tooling instead of steps 3 and 4, and recreate the database. In this repository, `pnpm fixtures:emit` re-emits every contract and regenerates the example migrations, writing their snapshots under the new storage hashes; delete the snapshot directories no migration names any more. This is not a procedure for a production database: keep applied migrations and their snapshots, and follow steps 3 and 4.

A database that a Prisma 6 schema read with `prisma6Schema()` describes holds the names Prisma 6 gave its indexes, not the names after their keys; see `mongo-prisma6-index-names`.

## `mongo-unnamed-indexes-with-one-name-refused`

This schema is now refused, because both indexes would be named `email_1`:

```prisma
model User {
  id    ObjectId @id @map("_id")
  email String   @unique

  @@index([email], sparse: true)
  @@map("users")
}
```

Name one of them:

```prisma
  @@index([email], sparse: true, map: "email_sparse")
```

In TypeScript:

```ts
indexes: [index({ email: 1 }, { unique: true }), index({ email: 1 }, { sparse: true, name: 'email_sparse' })],
```

No database holds such a pair yet: earlier releases planned both under `email_1`, and MongoDB refused the second. The index you leave unnamed keeps its name, so its database index stays; the migration creates the one you named.

Two indexes of variants of one base on the same field are refused the same way; name each, such as `@@index([title], map: "bug_title")` on `Bug` and `@@index([title], map: "feature_title")` on `Feature`.

Two identical indexes with different names are refused too, because MongoDB cannot hold an index twice: PSL reports `PSL_INVALID_INDEX` at the second, and TypeScript throws `CONTRACT.NAME_DUPLICATE`. Remove one, or give both the same name, which merges them.

## `mongo-prisma6-index-names`

For this Prisma 6 schema:

```prisma
model User {
  id    String @id @default(auto()) @map("_id") @db.ObjectId
  email String @unique

  @@index([email(sort: Asc)])
}
```

the contract names the indexes `User_email_key` and `User_email_idx`, as Prisma 6 `db push` named them. Run `prisma contract emit` and `prisma db verify`; a database Prisma 6 built verifies. Then run `prisma db sign` for the new storage hash. Run the script of `mongo-contracts-record-index-names` after the emit: it gives each index of your migration snapshots the Prisma 6 name the emitted contract gives it, so the next `prisma migration plan` does not drop and recreate them.

If the emit reports `PSL.PRISMA6_MONGO_INDEX_NAME_DUPLICATE`, two indexes of one model get one name, which Prisma 6 refuses too, such as `@@index([name])` beside `@@index([name(sort: Asc)])`, both named `User_name_idx`. Give one a name with `map:`. If it reports `PSL.PRISMA6_MONGO_INDEX_NAME_INVALID`, a `map:` is empty or longer than 127 bytes; give the index a name Prisma 6 accepts.

If `db verify` reports an index whose name differs, the database holds that index under another name than Prisma 6 would give it. Write that name with `map:`, so the contract states what the database holds.

## `mongo-index-operations-by-name`

A `migration.ts` that `prisma migration plan` writes now names each index:

```ts
// before
createIndex('users', [{ field: 'email', direction: 1 }], { unique: true }),
dropIndex('users', [{ field: 'legacy', direction: 1 }]),
// after
createIndex('users', [{ field: 'email', direction: 1 }], { name: 'email_1', unique: true }),
dropIndex('users', [{ field: 'legacy', direction: 1 }], { name: 'legacy_1', unique: true }),
```

`dropIndex`'s options must list every option the index has, as `migration plan` writes them: its precheck requires an index with that name, those keys and exactly those options, so `dropIndex('users', keys, { name: 'legacy_1' })` fails for a unique index. A `dropIndex` without options checks the keys only.

Existing migration files need no change: a call without `name` uses the name after the keys, as before, and a `dropIndex` without options checks the index's keys only, as before. An applied migration's `ops.json` is applied as written.

A script or test that matches an operation id, such as `index.users.create(email:1)`, matches the name instead: `index.users.create(email_1)`.
