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
      A MongoDB contract now refuses a model, field, composite type or value object, enum, collection or root named `__proto__`. Choose another name.
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
---

# Names and keys that JavaScript objects inherit

Names such as `constructor` and `toString` now work everywhere as model, table, column and field names, and need no action. Four cases with `__proto__` do.

## A JSON default with a `__proto__` key

```prisma
model User {
  id   Int   @id
  meta Jsonb @default(json`{ "__proto__": { "x": 1 }, "a": 2 }`)
}
```

A Prisma 7 schema writes the same default as a string, `meta Json @default("{\"__proto__\": {\"x\": 1}, \"a\": 2}")`, and is affected in the same way.

`prisma contract emit` used to leave the `__proto__` key out of `contract.json` and out of the storage hash, so the database got the default `{"a": 2}`. It now keeps the key. What to do for each file the detection matches depends on the database:

- **Postgres.** Run `prisma contract emit`; the storage hash changes. Then run `prisma migration plan` and apply the migration, or run `prisma db update`. Either plans one operation per such column, `Set default on "<table>"."<column>"`.
- **MySQL.** Run `prisma contract emit`; the storage hash changes. The migration planner does not plan a change of a column's default, so write it by hand in a migration created with `prisma migration new`.
- **SQLite.** No action. SQLite stores the default as JSON text that already kept the key, so nothing changes.

Until the default is applied, the SQL runtime logs `CONTRACT.MARKER_MISMATCH` as a warning and still runs queries. If you do not want the key in the default, remove it from the contract source instead.

## A MongoDB name `__proto__`

JavaScript reads `__proto__` as the prototype of an object rather than as a key, so a contract could not hold such a name: the client lost the model, field or collection. A MongoDB contract now refuses it. The TypeScript builder raises `CONTRACT.NAME_UNUSABLE_AS_KEY`; a PSL contract reports `PSL_STORED_NAME_UNSUPPORTED` at the declaration:

```text
A model is named "__proto__", which JavaScript reads as the prototype of an object rather than as a key. Choose another name.
```

Rename the model, field, composite type, enum or root. A renamed field can keep its stored name with `@map("…")`, or `.mongo({ field })` in TypeScript, unless the stored name is itself `__proto__`, which was already refused. The TypeScript builder also refuses an object literal with a `__proto__` key, such as `models: { __proto__: Post, User }`, which used to drop the entry without an error.

For a collection, name another collection with `@@map`. `@@map` only changes which collection the client reads and writes: documents already in a collection named `__proto__` stay there. To move them, in this order:

1. Emit the contract with the new collection name and apply the migration, which creates the new collection.
2. Copy the documents into it. In `mongosh`, `db.__proto__` is not the collection, so name it with `getCollection`:

   ```js
   db.getCollection("__proto__").aggregate([{ $merge: { into: "<new name>" } }])
   ```

3. When the application reads the new collection correctly, drop the old one with `db.getCollection("__proto__").drop()`.

## A SQL `select` alias `__proto__`

A SQL query builder `select` that names a result column `__proto__`, as in `select('__proto__', …)` or a `select` callback that returns a record with that key, is refused with `RUNTIME.AST_INVALID` while the query is built. Such a column could never come back as a key of the row. Choose another alias.

## Postgres `contract infer` on a table or column named `__proto__`

`prisma contract infer` now fails with `CONTRACT.INFER_UNSUPPORTED` when the database has a table or column named `__proto__`, and names it. It used to leave such a table out of the inferred contract without a word, so the next plan would have dropped it. No contract source accepts the name, so rename the table or column in the database before running `contract infer` again.
