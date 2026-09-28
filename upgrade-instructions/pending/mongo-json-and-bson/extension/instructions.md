---
changes:
  - id: mongo-validator-reads-all-target-types
    summary: |
      Mongo collection validators now read a codec's whole `targetTypes` list, not only its first
      entry: one entry gives `bsonType: '<entry>'`, several give `bsonType: [...entries]`. A codec
      that declared more than one BSON type had only the first enforced; it now has all of them.
      An enum's codec must declare exactly one.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - 'targetTypes\s*:\s*\[[^\]]*,'
  - id: mongo-bson-codec-added
    summary: |
      The Mongo target gains the codec `mongo/bson@1` for any BSON value, typed `BsonValue` in
      `CodecTypes`; `mongo/json@1` now admits only JSON values.
---

## `mongo-validator-reads-all-target-types`

The Mongo validator derivation reads every entry of a codec descriptor's `targetTypes`. For a list field the list applies to `items`, and a nullable field prepends `'null'` unless the list already has it. An empty list still gives an unconstrained validator (`{}`).

For each Mongo codec descriptor in the extension whose `targetTypes` has more than one entry, check that every entry is a BSON type the codec's `encode` can produce, because each one is now admitted by the validator. Remove any entry the codec does not write. Then re-emit the extension's contracts and any test fixtures; their validators list every entry.

An enum's `@@type` codec must declare exactly one entry: the Mongo enum factory reports `enum "<name>" @@type codec "<id>" declares <n> BSON types; an enum needs exactly one` otherwise.

## `mongo-bson-codec-added`

The Mongo target adds the codec `mongo/bson@1` (data type `mongo/bson`, PSL `Bson`, `field.bson()`), whose `CodecTypes` entry reads `BsonValue` and writes `BsonInputValue` (a `BsonValue`, or a `Uint8Array` at any depth), both from `@internal/target-mongo/codec-types`. `BsonValue` covers every value the driver returns with its default settings, `Code`, `MinKey`, `MaxKey`, `BSONSymbol` and a native `RegExp` (what a stored regex reads back as) included; `BSONRegExp` appears only with a driver configured with `bsonRegExp: true`. A `DBRef` is never returned, because decode turns it back into its `{ $ref, $id[, $db], ...fields }` document. It declares an empty `targetTypes`, so its validator is `{}`. An extension that lists every Mongo codec id, or keys a map by `CodecTypes`, adds `mongo/bson@1`. An extension that stores arbitrary BSON in a field of its own contract types it `mongo/bson@1`, because `mongo/json@1` now refuses non-JSON values on encode and decode.
