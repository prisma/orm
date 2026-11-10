---
changes:
  - id: mongo-create-returns-stored-document
    summary: |
      Mongo `create()` and `createAll()` now return each inserted document as stored, decoded like
      a read, instead of the input with the new `_id`. The ORM computes it from the document it
      sent, through the client's BSON options, without a second query. A `Bson` field comes back
      as a read returns it (a `Long` in the safe-integer range as a number, bytes as `Binary`, a
      `BSONRegExp` as a `RegExp`), and a nullable field left out comes back as `null`.
  - id: mongo-reads-decode-includes-value-objects-and-absent-fields
    summary: |
      Mongo reads now decode included documents (`include(...)`) and composite-type (value
      object) fields through their codecs, and a nullable field missing from the stored document
      reads as `null` instead of `undefined`.
  - id: mongo-where-filter-expressions-encoded
    summary: |
      A filter expression passed to the Mongo ORM's `where()` now encodes its comparison and
      `$in`/`$nin` values through the field's codec, as the object form of `where()` does, and each
      element of a whole-list comparison through the element codec. A value the codec refuses,
      such as a driver `Long` for an `Int64` field (the codec takes a `bigint`) or a fraction for
      an `Int32` field, fails with `RUNTIME.ENCODE_FAILED`. The object form of `where()` now also
      refuses a fraction or an out-of-range number for an `Int32` field. This applies to the ORM
      only: the query builder's `match()` sends values as given.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\.where\(\s*(?:MongoFieldFilter|MongoAndExpr|MongoOrExpr|MongoNotExpr)\.'
  - id: mongo-writes-check-int32-enum-and-null-values
    summary: |
      The Mongo ORM refuses, with `RUNTIME.ENCODE_FAILED` naming the field, a write of a fraction
      or an out-of-range number to an `Int32` field, of a value outside the field's enum, and of
      `null` to a field that is not nullable. Before, depending on the field's type, the field's
      codec refused it, a contract with a collection validator got a bare "Document failed
      validation" from the server, or a contract without one (TypeScript builder, Prisma 6 schema)
      stored the value. Filters still accept a value outside the enum and `null`, so they can find
      documents that hold one.
  - id: mongo-codecs-check-value-types
    summary: |
      The Mongo `String`, `Bool`, `Date`, `ObjectId` and vector codecs refuse a value of the wrong
      type with `RUNTIME.ENCODE_FAILED` naming the field, in writes and filters, as `Int32` and
      `Double` do. Before, a `null` element in a `String[]`, `Bool[]` or `Date[]` list or a
      mistyped value was stored as given, an invalid `Date` was stored as the epoch, and `null`,
      `undefined` or a number for an `ObjectId` field became a new id or a timestamp.
  - id: mongo-list-elements-encoded
    summary: |
      The Mongo ORM encodes each element of a list field through the field's codec, on writes and
      in filters. An `ObjectId[]`, `Int64[]`, `Decimal128[]` or `Binary[]` field now stores its
      elements as `ObjectId`, `long`, `decimal` and `binData`, where before the whole list reached
      the element codec and the write failed with `RUNTIME.ENCODE_FAILED`. A whole number in a
      `Double[]` field is stored as a `double`.
  - id: mongo-query-builder-bson-values-match
    summary: |
      A query-builder filter or raw command that compares with a driver class such as `ObjectId`,
      `Long`, `Decimal128` or `Binary` now sends it as that BSON value. Before, the Mongo adapter
      copied it into a plain object, so the filter matched nothing.
  - id: mongo-upsert-keeps-create-values
    summary: |
      When `create` sets a field that has an update default (`@updatedAt`,
      `temporal.updatedAt()`, `temporal.timestamp(onUpdate: now)`), `upsert()` now inserts the
      `create` value, and still applies the update default on update, in one atomic command.
      Before, the insert got the current time instead. Such an upsert refuses `pull()` by a match
      document with `ORM.OPERATION_UNSUPPORTED`.
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

Code that relied on getting its input objects back, such as a `Long`, `Int32`, `Double` or `Uint8Array` inside a `Bson` field, or a key missing for a nullable field it did not pass, now gets the values a read returns. Compare with what a read returns, or keep a reference to the input instead.

## `mongo-reads-decode-includes-value-objects-and-absent-fields`

This change has no detection pattern: it depends on the fields and the data.

Remove code that converted driver classes by hand in included documents or composite-type fields, such as `author._id.toHexString()`, `karma.toBigInt()` or `new Uint8Array(avatar.value())`: they now arrive as a hex string, `bigint`, decimal text and `Uint8Array`, as their types say. Replace checks like `user.name === undefined` for an optional field that Prisma 6 or the driver left out of the document with `user.name === null`.

## `mongo-where-filter-expressions-encoded`

The pattern finds filter expressions written inside `where(...)`; also check expressions built elsewhere and passed to the ORM's `where()`. Leave filters passed to the query builder's `match()` as they are.

For each field filter, pass the field's application value: a `bigint` for an `Int64` field, decimal text for a `Decimal128` field, a hex string or an `ObjectId` for an `ObjectId` field, and an integer in the signed 32-bit range for an `Int32` field. A value that is not a `MongoValue`, such as a `bigint`, an `ObjectId` or a driver `Long`, goes in a `MongoParamRef` from `@prisma/orm-mongo/value`: write `MongoFieldFilter.gt('views', new MongoParamRef(5n))` in place of `MongoFieldFilter.gt('views', Long.fromNumber(5))` or `5`. A value the field's codec refuses now fails with `RUNTIME.ENCODE_FAILED` before the query runs; before, it was sent as is. A filter on a `Bson` field with an `ObjectId`, `Long` or `Decimal128` now matches the stored value; before, it matched nothing.

## `mongo-codecs-check-value-types`

This change has no detection pattern: which writes carry such values depends on the data.

Pass each field's application type: a string for `String`, a boolean for `Bool`, a valid `Date` for `Date`, and a 24-digit hex string or an `ObjectId` for `ObjectId`. Remove `null` elements from lists before writing them; a list field's elements cannot be `null`.

## `mongo-list-elements-encoded`

This change has no detection pattern: it applies to every list field.

Remove workarounds for list fields that failed to write, such as declaring an `ObjectId[]` field as `String[]` or `Bson`.

## `mongo-query-builder-bson-values-match`

This change has no detection pattern: filters that matched nothing do not look different in code.

Remove workarounds for query-builder filters that compared with a driver class and matched nothing, such as running those queries through the driver's own collection.

## `mongo-upsert-keeps-create-values`

This change has no detection pattern: it depends on which fields `create` sets.

Remove code that corrected such a field after an upsert inserted a document. If an upsert whose `create` sets such a field pulls by a match document, pull a single value instead, or leave the field out of `create` so the update default applies.

## `mongo-writes-check-int32-enum-and-null-values`

This change has no detection pattern: which writes carry such values depends on the data.

Round a number before writing it to an `Int32` field, or declare the field `Double` or `Int64`. Map any value outside an enum, such as a Prisma 6 member name like `'ADMIN'` where the stored value is `'admin'`, to one of the enum's values. The error's `details.allowed` lists them. Instead of writing `null` to a required field, write a value, or declare the field optional (`String?`) when documents may hold `null`.

## `contract-source-warnings-are-diagnostics`

This change has no detection pattern: scripts that read the CLI's output are not TypeScript sources.

A script that read contract source warnings from `contract emit --json` or `contract print --json` message lines of the form `warning <path>:<line>:<column> <CODE> <message>` reads the result envelope's `diagnostics` instead. Each has `code: 'CONTRACT.SOURCE_DIAGNOSTIC'`, `severity: 'warn'`, `where: { path, line }` and `meta: { code, span }`, where `meta.code` is the source's code and `meta.span.start.column` the column.

## `mongo-ts-preset-field-not-optional`

Remove `.optional()` or `.many()` from each match. A field a preset fills cannot be optional or a list; to keep an optional timestamp that nothing fills, use `field.date().optional()`.
