---
changes:
  - id: native-enum-codec-is-not-textual
    summary: |
      The native enum codec `pg/enum@1` no longer declares the `textual` trait. `pgEnumDescriptor`
      and `PgEnumCodec` declare `['equality', 'order']`, and `CodecTypes['pg/enum@1']['traits']` is
      `'equality' | 'order'`.
---

## `native-enum-codec-is-not-textual`

Postgres has no `LIKE`, `ILIKE` or `to_tsvector` for an enum type, so the native enum codec (`pgEnumDescriptor`, `PgEnumCodec` in `@internal/target-postgres/codecs`) no longer declares `textual`. Its traits are `['equality', 'order']`.

An extension operation whose `self` targets `{ traits: ['textual'] }` no longer attaches to native enum columns. That is intended when the operation passes the column where Postgres expects `text`. If an operation of yours does work on an enum, declare its `self` by codec id (`{ codecId: 'pg/enum@1' }`).

A hand-written type fixture that spells out `pg/enum@1` with `traits: 'equality' | 'order' | 'textual'` should drop `'textual'` to match the real codec.

`min` and `max` over a native enum still resolve to `pg/enum@1`: the Postgres target now lists the enum codec explicitly instead of reaching it through the `textual` fallback. Emitted `AggregateTypes` do not change.
