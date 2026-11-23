---
changes:
  - id: mongo-proto-field-and-relation-names-refused
    summary: |
      A MongoDB contract now refuses a field, a relation, or a member of a composite type or value object named `__proto__`, an embed relation stored under that name, and, in a PSL contract, an enum named `__proto__` and a wildcard index path `__proto__`. Choose another name, and move the values that documents hold under the old key.
    detection:
      glob: "**/*.{prisma,ts,mts,cts,tsx}"
      matches:
        - '__proto__'
---

# A MongoDB field, relation or enum named `__proto__`

## `mongo-proto-field-and-relation-names-refused`

JavaScript reads `__proto__` as the prototype of an object rather than as a key. The previous release refused a MongoDB model, composite type, collection or root of that name, but not a field or a relation: depending on the contract source, such a field or relation was left out of the contract or out of every row the client read, without an error. A PSL contract also left an enum named `__proto__` out of the contract. All of these are now refused. The TypeScript builder raises `CONTRACT.NAME_UNUSABLE_AS_KEY`; a PSL contract reports `PSL_STORED_NAME_UNSUPPORTED` at the field, relation or enum:

```text
A field of model "Item" is named "__proto__", which JavaScript reads as the prototype of an object rather than as a key. Choose another name.
```

A PSL contract also refuses `__proto__` as an `include` or `exclude` path of a wildcard index, with `PSL_INVALID_INDEX`; the path used to be dropped from the index without an error. Remove it.

Rename the field, relation, member or enum. Renaming an enum changes no document. What the other renames do to stored documents is listed below. Two rules hold for every update in this section. Stop every process that writes to the collection before you start, and restart one only when the update has finished, including any run you repeat, and the process uses the new names. And where an update moves a value to `<new name>`, choose a name that no document already uses as a key in that place; otherwise one of the two values is lost.

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
