---
changes:
  - id: mongo-contracts-record-stored-field-names
    summary: |
      A MongoDB contract keys each model's fields by their names in the schema and records the key each is stored under in `model.storage.fields`, as a SQL contract records each field's column. `id ObjectId @id @map("_id")` is the field `id`, stored as `_id`; it used to be the field `_id`. A contract without `storage.fields` is rejected with `CONTRACT.VALIDATION_FAILED`. Run `prisma contract emit`, then run the colocated script, which rewrites the contract snapshots under `migrations/snapshots/` and any other MongoDB contract in the old form. Storage hashes do not change, so no migration is needed and database markers stay valid.
    detection:
      glob: "**/*.json"
      matches:
        - '"storage"\s*:\s*\{\s*(?:"collection"\s*:\s*"[^"]*"\s*)?\}'
        - '"storage"\s*:\s*\{\s*"collection"\s*:\s*"[^"]*"\s*,\s*"relations"'
    script: ./scripts/mongo-field-storage-names.ts
  - id: mongo-orm-uses-field-names
    summary: |
      The MongoDB ORM names every field by its name in the schema: a field declared `id ObjectId @id @map("_id")` is `user.id` in rows and `where({ id })`, `select('id')`, `orderBy({ id: 1 })` and create, update and upsert data, where it was `_id`. Passing a stored name such as `_id` fails with `ORM.FIELD_UNKNOWN`, and a row no longer carries a key that no field stores. The pipeline builder (`db.query`) works on documents and keeps naming stored names (`_id`).
    detection:
      glob: "**/*.{ts,tsx,mts,cts,js,mjs,cjs}"
      matches:
        - '\._id\b'
        - '(?<![\w$])_id\s*:'
  - id: mongo-statements-name-fields
    summary: |
      A MongoDB `--rename` or `--delete` statement names a field by its name in the schema, as on SQL: `id @map("_id")` is `User.id`, where it was `User._id`. A rename that keeps the stored name, such as `--rename User.name:User.title` with both stored as `display_name`, plans nothing; a field whose `@map` changes while its name stays is asked about as a removal, as a column is on SQL; to keep its values, write `renameField(...)` into the planned `migration.ts`.
    detection:
      glob: "**/*.{sh,json,yml,yaml,ts,mts,cts,js,mjs,cjs,md}"
      matches:
        - '--(?:rename|delete)[ =][^\s]*\._id\b'
  - id: mongo-composite-field-map-refused
    summary: |
      MongoDB PSL refuses `@map` on a field of a composite type (`type Address { street String @map("st") }`) with `PSL_MONGO_TYPE_FIELD_MAP_UNSUPPORTED`. It used to be ignored silently, so the field was stored under its own name all along: remove `@map`, or rename the field to the name it is stored under.
    detection:
      glob: "**/*.prisma"
      matches:
        - '(?<![\w$])type\s+\w+\s*\{[^}]*@map\('
  - id: mongo-typescript-stored-field-names
    summary: |
      The MongoDB TypeScript builder names a field's stored name with `.mongo({ field })`, as the SQL builder names a column with `.sql({ column })`: `id: field.objectId().mongo({ field: '_id' })`. Relations, the discriminator and indexes name fields; the builder writes stored names into indexes, validators and execution defaults. A field without it is stored under its own name, so `_id: field.objectId()` keeps working unchanged. Two fields stored under one name fail with `CONTRACT.NAME_DUPLICATE`, and `.mongo({ field })` on a field of a value object fails with `CONTRACT.ARGUMENT_INVALID`.
---

# MongoDB fields keep their own names

## `mongo-contracts-record-stored-field-names`

For this schema:

```prisma
model User {
  id          ObjectId @id @map("_id")
  displayName String   @map("display_name")

  @@map("users")
}
```

the model's entry in `contract.json` changes like this:

```diff
 "User": {
   "fields": {
-    "_id": { ... },
-    "display_name": { ... }
+    "id": { ... },
+    "displayName": { ... }
   },
   "relations": {},
-  "storage": { "collection": "users" }
+  "storage": {
+    "collection": "users",
+    "fields": { "displayName": { "field": "display_name" }, "id": { "field": "_id" } }
+  }
 }
```

Relations name fields too: `"on": { "localFields": ["authorId"], "targetFields": ["id"] }`, where they named `_id`. So does a base model's `discriminator`. Indexes, validators and `execution` keep naming stored names, so neither the storage hash nor the execution hash changes. The documents in the database do not change.

1. Commit your work first, so the changes can be reviewed and undone with git.
2. Run `prisma contract emit` and commit the regenerated `contract.json` and `contract.d.ts`.
3. Run the colocated script from the project root:

   ```sh
   node <path-to-this-guide>/scripts/mongo-field-storage-names.ts
   ```

   Node 24 or later runs the TypeScript script directly. It reads and writes files only. It rewrites every `*.json` file under the root that is a MongoDB contract with a model whose `storage` has no `fields`, skipping `node_modules`, `.git`, `dist` and `build`, and the `contract.d.ts` next to it (`<name>.d.ts` next to `<name>.json`). These are the contract snapshots under `migrations/snapshots/<hash>/`, which no command regenerates, and any other contract you keep in the old form, such as a test fixture; if you keep one on purpose, restore it with git afterwards. A contract that step 2 emitted is already in the new form and is left alone. The script prints each file it rewrote, or that nothing changed.

   A snapshot cannot be rebuilt as a re-emit would write it, because the old contract does not say what the schema called the field (`_id` could have been `id @map("_id")` or `_id`). So the script keeps every field's name and records it as stored under that name, which is what the old contract meant: `"_id"` stays the field `_id`, stored as `_id`. The snapshot directory names stay as they are. Planning from such a snapshot to the re-emitted contract plans nothing and asks nothing, because the planner compares stored names.

   The script edits the type of `storage` in each `contract.d.ts` in place, on one line; run your formatter afterwards. If it cannot find a model's storage type in a `contract.d.ts`, it says so and exits 1; add the type by hand there: for each model, `readonly fields: { readonly <field>: { readonly field: '<field>' }; ... }` inside `readonly storage: { ... }`, or `readonly fields: Record<string, never>` for a model without fields.

To rewrite a file by hand instead: in each model under `domain.namespaces.<namespace>.models`, add `"fields": { "<field>": { "field": "<field>" } }` to `storage`, one entry for each key of the model's `fields`, and the matching type in `contract.d.ts`. Change nothing else.

## `mongo-orm-uses-field-names`

ORM code names fields by their names in the schema:

```ts
// before
const user = await db.orm.users.create({ name: 'Alice' });
await db.orm.users.where({ _id: user._id }).update({ name: 'Ada' });
const posts = await db.orm.posts.where({ authorId: user._id }).include('author').all();

// after
const user = await db.orm.users.create({ name: 'Alice' });
await db.orm.users.where({ id: user.id }).update({ name: 'Ada' });
const posts = await db.orm.posts.where({ authorId: user.id }).include('author').all();
```

The same holds for every field with `@map`: `firstName String @map("first_name")` is `firstName` in the ORM, where it was `first_name`, and for the fields of a raw filter expression passed to `where`, such as `MongoFieldFilter.eq('id', ...)`. A type that picks or omits `_id` from `FieldInputTypes` or `FieldOutputTypes` names the field instead, for example `Omit<FieldInputTypes['__unbound__']['User'], 'id'>`. The type checker finds most places: run it after you re-emit.

The pipeline builder reads documents, so it names stored names, and its rows have them: `db.query.from('users').match((f) => f._id.eq(id))` and `foreign._id` in a lookup stay as they are. Code that hands a pipeline row to code that expects an ORM row renames the stored names, for example `({ _id, ...rest }) => ({ ...rest, id: _id })`.

## `mongo-statements-name-fields`

```sh
# before
prisma migration plan --name tidy --rename User._id:User.userId
# after
prisma migration plan --name tidy --rename User.id:User.userId
```

A statement that renames the field stored as `_id` to a field still stored as `_id` plans nothing; one that would change `_id` is refused, as before.

The first migration you plan after running the script starts from a rewritten snapshot, which names each field by its stored name (see `mongo-contracts-record-stored-field-names`). A statement in that migration names the old field by its stored name, and the new field by its name in the schema. For a schema that had `name String @map("display_name")` and now has `title String`, which renames the stored field to `title`:

```sh
# the first migration after the upgrade
prisma migration plan --name rename-title --rename User.display_name:User.title
# every later migration
prisma migration plan --name rename-headline --rename User.title:User.headline
```

Data-loss questions in that first migration name the old fields by their stored names too. A field that keeps its stored name needs no statement at all: planning from the rewritten snapshot to the re-emitted contract compares stored names and plans nothing for it.

## `mongo-composite-field-map-refused`

Remove `@map` from the field of the composite type, or rename the field to the name in `@map`. Either way the stored documents do not change: the field was always stored under its own name.

## `mongo-typescript-stored-field-names`

To read the document id as `id` in a TypeScript contract, as a PSL contract does, store it under `_id`:

```ts
// before
const User = model('User', {
  collection: 'users',
  fields: { _id: field.objectId(), name: field.string() },
});
const Post = model('Post', {
  collection: 'posts',
  fields: { _id: field.objectId(), authorId: field.objectId() },
  relations: { author: rel.belongsTo(User, { from: 'authorId', to: User.ref('_id') }) },
});

// after
const User = model('User', {
  collection: 'users',
  fields: { id: field.objectId().mongo({ field: '_id' }), name: field.string() },
});
const Post = model('Post', {
  collection: 'posts',
  fields: { id: field.objectId().mongo({ field: '_id' }), authorId: field.objectId() },
  relations: { author: rel.belongsTo(User, { from: 'authorId', to: User.ref('id') }) },
});
```

This is optional, and it does not change the storage hash. Code that reads the field then follows `mongo-orm-uses-field-names`.
