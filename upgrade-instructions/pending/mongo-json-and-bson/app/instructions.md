---
changes:
  - id: mongo-json-field-semantics
    summary: |
      A Mongo `Json` field now admits only JSON values. Its collection validator lists the
      JSON-representable BSON types, which changes the validator and `storageHash` of every Mongo
      contract with a `Json` field, and a document whose `Json` field holds a `Date`, `ObjectId`,
      `Decimal128`, `Binary`, or another non-JSON BSON value at any depth fails to decode.
---

## `mongo-json-field-semantics`

This change has no detection pattern: which `Json` fields hold non-JSON values depends on the data, which a search of the source cannot see.

A Mongo `Json` field (`field.json()` in TypeScript) means a JSON value, no more. Its validator admits BSON `object`, `array`, `string`, `double`, `int`, `long`, `bool` and `null`. Reading a document fails with `RUNTIME.DECODE_FAILED` when the field holds a `Date`, `ObjectId`, `Decimal128`, `Binary`, regular expression, timestamp, or a 64-bit integer outside the safe-integer range, at any depth; the message names the path inside the field. Writing such a value fails with `RUNTIME.ENCODE_FAILED`.

To find the affected fields, query each collection with a `Json` field for documents whose field holds a non-JSON value at its top level:

```js
db.<collection>.find({ <field>: { $exists: true, $not: { $type: ['object', 'array', 'string', 'double', 'int', 'long', 'bool', 'null'] } } })
```

A non-JSON value nested inside an object or array is not visible to this query; reading every document through the ORM finds it, because the read fails with the path of the first such value.

1. For each Mongo `Json` field whose documents hold such values, change its type to `Bson` in PSL (`field.bson()` in TypeScript), which admits any BSON value. A project whose contract source is a Prisma 6 schema (`prisma6Schema`) cannot declare `Bson`: keep its `Json` fields JSON-only, or move the contract source to a Prisma 8 schema and change the type there.
2. Run `prisma contract emit`. Every Mongo contract with a `Json` field changes: its validator lists the JSON types and its `storageHash` moves, whether or not step 1 changed anything.
3. Run `prisma db update` so each collection's validator matches the contract. It reports the validator change as destructive and asks for confirmation: type the database name, or pass `--confirm <database>` when nobody is there to ask. A project that deploys with migrations runs `prisma migration plan` instead and applies the new migration the way it applies any other.
