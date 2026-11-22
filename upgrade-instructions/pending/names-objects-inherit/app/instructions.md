---
changes:
  - id: json-default-proto-key-kept
    summary: |
      A JSON column default that has a `__proto__` key now keeps that key in `contract.json` and in the storage hash; it used to be dropped. Re-emit the contract, then plan and apply a migration.
    detection:
      glob: "**/*.prisma"
      matches:
        - 'json`[^`]*__proto__'
  - id: mongo-proto-names-refused
    summary: |
      A MongoDB contract now refuses a model, composite type or value object, enum, collection or root named `__proto__`. Choose another name.
    detection:
      glob: "**/*.{prisma,ts}"
      matches:
        - '__proto__'
---

# Names and keys that JavaScript objects inherit

Names such as `constructor` and `toString` now work everywhere as model, table, column and field names, and need no action. Two cases with `__proto__` do.

## A JSON default with a `__proto__` key

```prisma
model User {
  id   Int   @id
  meta Jsonb @default(json`{ "__proto__": { "x": 1 }, "a": 2 }`)
}
```

`prisma contract emit` used to leave the `__proto__` key out of `contract.json` and out of the storage hash, so the database got the default `{"a": 2}`. It now keeps the key. For each file the detection matches:

1. Run `prisma contract emit`. The storage hash changes.
2. Run `prisma migration plan` and apply the migration, or run `prisma db update`. Either plans one operation per such column, `Set default on "<table>"."<column>"`.

Until the operation is applied, the SQL runtime logs `CONTRACT.MARKER_MISMATCH` as a warning and still runs queries. If you do not want the key in the default, remove it from the contract source instead.

## A MongoDB name `__proto__`

JavaScript reads `__proto__` as the prototype of an object rather than as a key, so a contract could not hold such a name: the client lost the model or collection. A MongoDB contract now refuses it. The TypeScript builder raises `CONTRACT.NAME_UNUSABLE_AS_KEY`; a PSL contract reports `PSL_STORED_NAME_UNSUPPORTED` at the declaration:

```text
A model is named "__proto__", which JavaScript reads as the prototype of an object rather than as a key. Choose another name.
```

Rename the model, composite type, enum or root. For a collection, name another collection with `@@map`. The TypeScript builder also refuses an object literal with a `__proto__` key, such as `models: { __proto__: Post, User }`, which used to drop the entry without an error.

A SQL query builder `select` that names a result column `__proto__` is refused with `RUNTIME.AST_INVALID`; choose another alias.
