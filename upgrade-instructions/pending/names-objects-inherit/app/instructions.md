---
changes:
  - id: json-default-proto-key-kept
    summary: |
      A JSON column default that has a `__proto__` key now keeps that key in `contract.json` and, on Postgres and MySQL, in the storage hash; it used to be dropped. Re-emit the contract, then bring the database's default in line.
    detection:
      glob: "**/*.prisma"
      matches:
        - 'json`[^`]*__proto__'
        - '@default\("(?:[^"\\\n]|\\.)*\\"__proto__\\"'
  - id: mongo-proto-names-refused
    summary: |
      A MongoDB contract now refuses a model, field, relation, composite type or value object, enum, collection or root named `__proto__`, and an embed relation stored under that name. Choose another name.
    detection:
      glob: "**/*.{prisma,ts,mts,cts,tsx}"
      matches:
        - '__proto__'
  - id: sql-proto-names-refused
    summary: |
      A SQL contract now refuses a table, column, model, field, relation, enum or other name that is `__proto__`. A field of that name stored under another name used to be left out of the contract without an error. Rename it in the contract source.
    detection:
      glob: "**/*.{prisma,ts,mts,cts,tsx}"
      matches:
        - '__proto__'
  - id: sql-select-alias-proto-refused
    summary: |
      A SQL query builder `select` that names a result column `__proto__` is refused with `RUNTIME.AST_INVALID`. Choose another alias.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - 'select\(\s*[''"`]__proto__[''"`]'
        - '\[\s*[''"`]__proto__[''"`]\s*[\],]'
  - id: postgres-infer-proto-name-refused
    summary: |
      On Postgres, `prisma contract infer` now fails with `CONTRACT.INFER_UNSUPPORTED` when the database has a table or column named `__proto__`. Rename it in the database first.
    detection:
      glob: "{**/{package.json,*.sh,*.yml,*.yaml,Makefile,justfile},.github/workflows/*.{yml,yaml},.gitlab-ci.yml}"
      contains:
        - 'contract infer'
---

# Names and keys that JavaScript objects inherit

Names such as `constructor` and `toString` now work everywhere as model, table, column and field names, and need no action. Five cases with `__proto__` do, one section each below.

## A JSON default with a `__proto__` key

```prisma
model User {
  id   Int   @id
  meta Jsonb @default(json`{ "__proto__": { "x": 1 }, "a": 2 }`)
}
```

A Prisma 7 schema writes the same default as a string, `meta Json @default("{\"__proto__\": {\"x\": 1}, \"a\": 2}")`, and is affected in the same way.

`prisma contract emit` used to leave the `__proto__` key out of `contract.json`. On Postgres and MySQL it also left it out of the storage hash, so the database got the default `{"a": 2}`. It now keeps the key. What to do for each file the detection matches depends on the database:

- **Postgres.** Run `prisma contract emit`; the storage hash changes. Then run `prisma migration plan` and apply the migration, or run `prisma db update`. Either plans one operation per such column, `Set default on "<table>"."<column>"`.
- **MySQL.** Run `prisma contract emit`; the storage hash changes. The migration planner does not plan a change of a column's default, so create a migration with `prisma migration new` and write a raw SQL operation in it that sets the column's default.
- **SQLite.** No action. SQLite stores the default as JSON text that already kept the key, so nothing changes.

Until the default is applied, the SQL runtime logs `CONTRACT.MARKER_MISMATCH` as a warning and still runs queries. If you do not want the key in the default, remove it from the contract source instead.

## A MongoDB name `__proto__`

JavaScript reads `__proto__` as the prototype of an object rather than as a key, so a contract could not hold such a name: the client lost the model, field, relation or collection. A MongoDB contract now refuses it. The TypeScript builder raises `CONTRACT.NAME_UNUSABLE_AS_KEY`; a PSL contract reports `PSL_STORED_NAME_UNSUPPORTED`:

```text
A model is named "__proto__", which JavaScript reads as the prototype of an object rather than as a key. Choose another name.
```

Rename the model, field, relation, composite type, enum or root. What a rename does to stored documents:

- **A model's field.** Keep its stored name with `@map("…")`, or `.mongo({ field })` in TypeScript, and no document changes. A field stored as `__proto__` cannot keep that stored name; give it another one. The TypeScript builder and Mongo PSL already refused such a field. A Prisma 6 schema with a field named `__proto__` and no `@map` lost the field from the contract without an error; documents may hold its values under a top-level `__proto__` key, so move them with the top-level update in the relation bullet below.
- **A member of a composite type or value object.** It is always stored under its own name, so renaming it changes the key in the embedded documents. Documents may already hold values under `__proto__`, and a rename leaves them under the old key. Move them to the new key. For a member of an embedded document:

  ```js
  db.getCollection("<collection>").updateMany(
    { "<field>.__proto__": { $exists: true } },
    [{ $set: { "<field>.<new name>": "$<field>.__proto__" } }, { $unset: "<field>.__proto__" }],
  )
  ```

  For a list of composite values, rename the key in each element:

  ```js
  db.getCollection("<collection>").updateMany(
    { "<field>.__proto__": { $exists: true } },
    [{ $set: { "<field>": { $map: { input: "$<field>", as: "e", in: { $arrayToObject: { $map: {
      input: { $objectToArray: "$$e" }, as: "kv",
      in: { k: { $cond: [{ $eq: ["$$kv.k", "__proto__"] }, "<new name>", "$$kv.k"] }, v: "$$kv.v" },
    } } } } } } }],
  )
  ```
- **A relation.** A reference relation's name is not stored, so no document changes. An embed relation is stored under its name, or under the name the TypeScript contract gives it with `storageRelations`. The client never read or wrote an embed relation named `__proto__`, and a create dropped the value of one stored as `__proto__`; that stored name is now refused with `CONTRACT.ARGUMENT_INVALID`. Give the relation another name or stored name. An embed relation is stored at the top level of the document, so to move embedded documents that another writer stored under `__proto__`, use this update:

  ```js
  db.getCollection("<collection>").updateMany(
    { ["__proto__"]: { $exists: true } },
    [{ $set: { "<new name>": "$__proto__" } }, { $unset: "__proto__" }],
  )
  ```

  Write the filter key as `["__proto__"]`. Written as `"__proto__":` it sets the filter's prototype, the filter matches every document, and the update removes `<new name>` from documents that have no `__proto__`.

The TypeScript builder also refuses an object literal with a `__proto__` key, such as `models: { __proto__: Post, User }`, which used to drop the entry without an error.

For a collection, name another collection with `@@map`. `@@map` only changes which collection the client reads and writes: documents already in a collection named `__proto__` stay there. In `mongosh`, `db.__proto__` is not the collection, so name it with `db.getCollection("__proto__")`. Stop every writer to the collection named `__proto__` before you rename or copy it. Restart a writer only once it uses the new name and, on the `migration plan` path, the copy has finished, including any run you repeat. A write that reaches `__proto__` afterwards is lost, because `db update` drops that collection, or you drop it after the copy; and a repeated copy overwrites a document the writer changed in the new collection in the meantime. How to move the documents depends on the command you apply changes with:

- **`prisma db update`.** Rename the collection in the database first, then emit the contract and run `db update`. If you run `db update` first, it plans to drop the collection named `__proto__`, with its documents.

  ```js
  db.getCollection("__proto__").renameCollection("<new name>")
  ```

- **`prisma migration plan`.** Emit the contract and apply the migration, which creates the new collection. Then copy the documents into it, and drop the old collection when the application reads the new one correctly. The copy checks each document against the new collection's validator and stops at one it rejects; fix that document and run the copy again.

  ```js
  db.getCollection("__proto__").aggregate([{ $merge: { into: "<new name>" } }])
  db.getCollection("__proto__").drop()
  ```

## A SQL name `__proto__`

A SQL contract now refuses `__proto__` as the name of a table, column, model, field, relation, enum, namespace or any other name it keys an object by, with `CONTRACT.NAME_UNUSABLE_AS_KEY`:

```text
The namespace of table "users" is named "__proto__", which JavaScript reads as the prototype of an object rather than as a key. Choose another name.
```

What happened before:

- A table or column stored as `__proto__`, and a model named `__proto__`, already failed `prisma contract emit` with an unrelated error. They now fail with this one.
- A field named `__proto__` and stored under another name, as in `__proto__ String @map("label")`, emitted, but the field was missing from the model. So was an entry written as a `__proto__:` key in a TypeScript object literal. Both are now refused; the object literal has its own message, which says the record is not a plain object.

Rename the field in the contract source and keep its stored name with `@map`; no database change is needed. If the database has a table or column named `__proto__`, rename it in the database too.

## A SQL `select` alias `__proto__`

A SQL query builder `select` that names a result column `__proto__`, as in `select('__proto__', …)` or a `select` callback that returns a record with that key, is refused with `RUNTIME.AST_INVALID` while the query is built. Such a column could never come back as a key of the row. Choose another alias.

## Postgres `contract infer` on a table or column named `__proto__`

`prisma contract infer` now fails with `CONTRACT.INFER_UNSUPPORTED` when the database has a table or column named `__proto__`, and names it. It used to leave such a table out of the inferred contract without a word, so the next plan would have dropped it. No contract source accepts the name, so rename the table or column in the database before running `contract infer` again.
