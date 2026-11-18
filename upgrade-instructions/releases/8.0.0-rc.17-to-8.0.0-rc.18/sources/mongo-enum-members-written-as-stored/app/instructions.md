---
changes:
  - id: mongo-enum-member-written-as-stored
    summary: |
      A Mongo contract now refuses an enum member that its codec stores as a value it reads back differently, with `CONTRACT.ENUM_INVALID` in TypeScript and `PSL_EXTENSION_INVALID_VALUE` in PSL and Prisma 6 schemas. The built-in Mongo codecs store every enum member as written, so only an enum typed by your own codec can be refused. Write each refused member as the message says, or fix the codec so `decodeJson(encodeJson(value))` gives the value back.
---

## `mongo-enum-member-written-as-stored`

`contract.json` holds each enum member in the form its codec stores, and `db.enums` reads it back through the codec. Both must give the member as written, so a Mongo contract now refuses a member whose stored form the codec reads back as another value, and says what to write:

```text
CONTRACT.ENUM_INVALID: enumType("Volume"): member "Quiet" is written "quiet", but the field stores "QUIET". Write the member as "QUIET".
```

In a PSL or Prisma 6 schema the same member is reported at the member:

```text
enum "Volume" member "Quiet" is written "quiet", but its codec stores "QUIET". Write the member as "QUIET".
```

In TypeScript, a codec that throws on a member is now reported as `CONTRACT.ENUM_INVALID` naming the member, with the codec's error as the cause.

1. Run `prisma contract emit`. Each refused member is reported with the value to write.
2. If the codec is yours and should store the value as written, fix its `encodeJson` or `decodeJson` so `decodeJson(encodeJson(value))` returns `value`. Otherwise write each refused member as the message says.
3. Re-emit.
