---
changes:
  - id: mongo-create-returns-stored-document
    summary: |
      Mongo `create()` and `createAll()` now read the inserted documents back by `_id` and return
      them decoded like a read, instead of returning the input with the new `_id`. A `Bson` field
      comes back as a read returns it (a `Long` in the safe-integer range as a number, bytes as
      `Binary`, a `BSONRegExp` as a `RegExp`), and a nullable field left out comes back as `null`.
  - id: mongo-reads-decode-includes-value-objects-and-absent-fields
    summary: |
      Mongo reads now decode included documents (`include(...)`) and composite-type (value
      object) fields through their codecs, and a nullable field missing from the stored document
      reads as `null` instead of `undefined`.
  - id: mongo-where-filter-expressions-encoded
    summary: |
      A `MongoFieldFilter` passed to the Mongo ORM's `where()` now encodes its comparison and
      `$in`/`$nin` values through the field's codec, as the object form of `where()` does. Pass
      application values: a `bigint` for an `Int64` field, a hex string or an `ObjectId` for an
      `ObjectId` field.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\bMongoFieldFilter\.(?:eq|neq|gt|gte|lt|lte|in|nin|of)\('
  - id: mongo-writes-check-int32-enum-and-null-values
    summary: |
      The Mongo ORM refuses, with `RUNTIME.ENCODE_FAILED` naming the field, a write of a fraction
      or an out-of-range number to an `Int32` field, of a value outside the field's enum, and of
      `null` to a field that is not nullable. Before, depending on the field's type, the field's
      codec refused it, a contract with a collection validator got a bare "Document failed
      validation" from the server, or a contract without one (TypeScript builder, Prisma 6 schema)
      stored the value. Filters still accept a value outside the enum and `null`, so they can find
      documents that hold one.
  - id: contract-source-warnings-are-diagnostics
    summary: |
      `prisma contract emit` and `prisma contract print` report contract source warnings, such as
      `PSL_DEPRECATED_SCALAR_NAME`, as `warn` diagnostics of the result instead of free-text
      `warning …` messages. With `--json` they are in the result envelope's `diagnostics`. Their
      file, and the file of a source error from either command, is shown relative to the working
      directory.
  - id: mongo-ts-preset-field-not-optional
    summary: |
      In a Mongo TypeScript contract, `.optional()` or `.many()` on a field a preset fills, such
      as `field.temporal.createdAt()`, is now a type error that says "A preset fills this field on
      write, so it cannot be optional" (or "a list"); it always failed when the contract was built.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\btemporal\.(?:createdAt|updatedAt|timestamp)\([^)]*\)\s*\.(?:optional|many)\('
---

## `mongo-create-returns-stored-document`

This change has no detection pattern: it depends on what the code does with the value `create()` or `createAll()` returns.

Code that relied on getting its input objects back, such as a `Long`, `Int32`, `Double` or `Uint8Array` inside a `Bson` field, or a key missing for a nullable field it did not pass, now gets the values a read returns. Compare with what a read returns, or keep a reference to the input instead. Each create also reads the documents back, which adds one query per call.

## `mongo-reads-decode-includes-value-objects-and-absent-fields`

This change has no detection pattern: it depends on the fields and the data.

Remove code that converted driver classes by hand in included documents or composite-type fields, such as `author._id.toHexString()`, `karma.toBigInt()` or `new Uint8Array(avatar.value())`: they now arrive as a hex string, `bigint`, decimal text and `Uint8Array`, as their types say. Replace checks like `user.name === undefined` for an optional field that Prisma 6 or the driver left out of the document with `user.name === null`.

## `mongo-where-filter-expressions-encoded`

For each match, pass the field's application value: a `bigint` for an `Int64` field (`MongoFieldFilter.gt('views', 5n)`, not `5`), decimal text for a `Decimal128` field, a hex string or an `ObjectId` for an `ObjectId` field. A value the field's codec refuses now fails with `RUNTIME.ENCODE_FAILED` before the query runs; before, it was sent as is. A filter on a `Bson` field with an `ObjectId`, `Long` or `Decimal128` now matches the stored value; before, it matched nothing.

## `mongo-writes-check-int32-enum-and-null-values`

This change has no detection pattern: which writes carry such values depends on the data.

Round a number before writing it to an `Int32` field, or declare the field `Double` or `Int64`. Map any value outside an enum, such as a Prisma 6 member name like `'ADMIN'` where the stored value is `'admin'`, to one of the enum's values. The error's `details.allowed` lists them. Instead of writing `null` to a required field, write a value, or declare the field optional (`String?`) when documents may hold `null`.

## `contract-source-warnings-are-diagnostics`

This change has no detection pattern: scripts that read the CLI's output are not TypeScript sources.

A script that read contract source warnings from `contract emit --json` or `contract print --json` message lines of the form `warning <path>:<line>:<column> <CODE> <message>` reads the result envelope's `diagnostics` instead. Each has `code: 'CONTRACT.SOURCE_DIAGNOSTIC'`, `severity: 'warn'`, `where: { path, line }` and `meta: { code, span }`, where `meta.code` is the source's code and `meta.span.start.column` the column.

## `mongo-ts-preset-field-not-optional`

Remove `.optional()` or `.many()` from each match. A field a preset fills cannot be optional or a list; to keep an optional timestamp that nothing fills, use `field.date().optional()`.
