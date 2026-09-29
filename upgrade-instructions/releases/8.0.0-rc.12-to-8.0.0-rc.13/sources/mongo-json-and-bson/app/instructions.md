---
changes:
  - id: mongo-json-field-semantics
    summary: |
      A Mongo `Json` field now admits only JSON values. Its collection validator lists the
      JSON-representable BSON types, which changes the validator and `storageHash` of every Mongo
      contract with a `Json` field, and a document whose `Json` field holds a `Date`, `ObjectId`,
      `Decimal128`, `Binary`, or another non-JSON BSON value at any depth fails to decode.
  - id: mongo-variant-field-codecs
    summary: |
      Through `.variant(...)`, a field declared only on the variant model is now written and read
      through its codec, as base-model fields always were. An `ObjectId` field there is stored as
      an `ObjectId` and read back as a hex string; an `Int64`, `Decimal128` or `Binary` field reads
      back as its application type; `Json` and `Bson` fields refuse values outside their type.
---

## `mongo-json-field-semantics`

This change has no detection pattern: which `Json` fields hold non-JSON values depends on the data, which a search of the source cannot see.

A Mongo `Json` field (`field.json()` in TypeScript) means a JSON value, no more. Its validator admits BSON `object`, `array`, `string`, `double`, `int`, `long`, `bool` and `null`. Reading a document fails with `RUNTIME.DECODE_FAILED` when the field holds a `Date`, `ObjectId`, `Decimal128`, `Binary`, regular expression, timestamp, or a 64-bit integer outside the safe-integer range, at any depth; the message names the path inside the field. Writing such a value fails with `RUNTIME.ENCODE_FAILED`.

To find the affected fields, query each collection with a `Json` field for documents whose field holds a non-JSON value at its top level: a BSON type outside the JSON types, a `long` outside the safe-integer range, or a `NaN` or infinite `double`:

```js
db.<collection>.find({
  $or: [
    { <field>: { $exists: true, $not: { $type: ['object', 'array', 'string', 'double', 'int', 'long', 'bool', 'null'] } } },
    { <field>: { $type: 'long', $gt: 9007199254740991 } },
    { <field>: { $type: 'long', $lt: -9007199254740991 } },
    { <field>: { $in: [NaN, Infinity, -Infinity] } },
  ],
})
```

The last three clauses also match such a value when it is a direct element of an array field. A non-JSON value nested deeper, inside an object or an array of objects, is not visible to this query; reading every document through the ORM finds it, because the read fails with the path of the first such value.

1. For each Mongo `Json` field whose documents hold such values, change its type to `Bson` in PSL (`field.bson()` in TypeScript), which admits any BSON value. A project whose contract source is a Prisma 6 schema (`prisma6Schema`) cannot declare `Bson`: keep its `Json` fields JSON-only, or move the contract source to a Prisma 8 schema and change the type there.
2. Run `prisma contract emit`. Every Mongo contract written in Prisma 8 PSL with a `Json` field changes: its validator lists the JSON types and its `storageHash` moves, whether or not step 1 changed anything. A contract built with the TypeScript builder or read from a Prisma 6 schema has no validator, so it does not change; the codec's checks on read and write still apply to it.
3. If the contract changed in step 2, run `prisma db update` so each collection's validator matches the contract. It reports the validator change as destructive and asks for confirmation: type the database name, or pass `--confirm <database>` when nobody is there to ask. A project that deploys with migrations runs `prisma migration plan` instead and applies the new migration the way it applies any other.

## `mongo-variant-field-codecs`

This change has no detection pattern: it applies to every model with `@@base` whose own fields are written or read through `.variant(...)`, and the effect depends on the field types.

Before, a field declared only on a variant model (`model Photo { ownerId ObjectId  @@base(Asset, "photo") }`) was passed to the driver as the application wrote it and returned as the driver read it. An `ObjectId` field written as a hex string was refused by the collection validator when the contract was written in Prisma 8 PSL; a contract built with the TypeScript builder or read from a Prisma 6 schema has no validator, so there the hex string was stored as a string. A where filter on such a field passed its value unencoded, so a hex string matched nothing where an `ObjectId` was stored; it is now encoded and matches. A stored `ObjectId`, `Long`, `Decimal128` or `Binary` came back as the driver's class instead of the application type.

1. Remove any workaround that converted such values by hand, for example passing `new ObjectId(hex)` for a variant `ObjectId` field or calling `.toHexString()` on what a read returned; pass and expect the application types listed in the scalar types reference instead.
2. Documents written before this change by a TypeScript-builder or Prisma 6 contract may hold a variant `ObjectId` field as a string; a filter with a hex string now looks for an `ObjectId` and does not match them. Convert the ones that are 24-character hex strings with `db.<collection>.updateMany({ <field>: { $type: 'string', $regex: /^[0-9a-fA-F]{24}$/ } }, [{ $set: { <field>: { $toObjectId: '$<field>' } } }])`. The regex matters: without it, one string that is not an `ObjectId` in hex makes `$toObjectId` fail the whole command. Other strings, `ObjectId` values and documents without the field are left as they are.
3. A read through the base collection (without `.variant(...)`) still returns variant-only fields as the driver read them.
