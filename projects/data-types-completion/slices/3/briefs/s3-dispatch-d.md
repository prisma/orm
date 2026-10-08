# Slice 3, dispatch d: SQLite's `sqlite/datetime` and `sqlite/json`

Dispatch d of `projects/data-types-completion/slices/3/plan.md`. Read the slice plan, ADR 254 "SQLite's types", "How a data type names its database type", "Date and time types" (the `sqlite/datetime` row and the fraction rule) and "Assembly", and decisions 5, 7, 8, 9 and 16 in `design-notes.md`. The map is `wip/s3/inventory-authoring.md` sections 4 and 8. Prior art: the SQLite declarations before commit b32ec30b6d (`git show b32ec30b6d~1:packages/3-targets/3-targets/sqlite/src/core/data-types.ts`).

Today SQLite's datetime and JSON codecs represent `sqlite/text`, and each carries its own canonical form, so one data type's values have two owners. After this dispatch they represent `sqlite/datetime` and `sqlite/json`, each stored as `sqlite/text`, and the type owns the value.

## Build

1. **`storedAs`.** `SqlDataType` (`packages/2-sql/1-core/contract/src/sql-data-type.ts`) gains `storedAs`, the id of the type a column of this type is stored as. A type with `storedAs` declares no texts of its own. Its schema type text (the name DDL writes and `db verify` compares) is its storage type's written text. Assembly refuses a `storedAs` naming a type not registered in the stack, and a type that declares both `storedAs` and texts (ADR 254 "Assembly"); test both refusals.
2. **The two types.** `sqlite/datetime` and `sqlite/json` are declared in the SQLite target, stored as `sqlite/text`. `sqlite/datetime@1` represents `sqlite/datetime` and `sqlite/json@1` represents `sqlite/json`. Their readers hold the stored forms ADR 254 gives: the datetime value is the instant in UTC with exactly three fraction digits (`2024-01-01T00:00:00.000Z`), what `toISOString()` writes; the JSON value is the document's JSON text with sorted keys and no added whitespace. The codec-level `toCanonicalForm` on both descriptors goes, and so does `CodecDescriptor.toCanonicalForm` and the codec branch of `canonicalFormOf`. `sqlite/text` casts from neither.
3. **The `datetime` tag** is registered under `sqlite/datetime` with `parse`, `print` and documentation. It reads ISO 8601 with or without a fraction, and with any offset, and stores the instant in the three-digit form. `sqlite/datetime` keeps no cast from `sqlite/text`: a quoted string on a `DateTime` column is refused with the tag to write.
4. **The `json` entry** sits under `sqlite/json`. Delete `tagEntryKey`, `isTagEntryKey`, `authoringEntryType`, the entry's `type` field and `CONTRACT.DATA_TYPE_ENTRY_KEY_INVALID`, with their tests and the assembly rule in `control-stack.ts` that reads them. `String @default(json`...`)` on SQLite is refused (`sqlite/text` does not cast from `sqlite/json`).
5. **The value-object column on SQLite is `sqlite/json`**: `valueObjectStorageType` and the stack check that reads it (`contract-stack-checks.ts`), and `contract-psl/src/value-object-default.ts`.
6. **Storage comparisons.** `sameStorageColumn` in `packages/2-sql/9-family/src/core/migrations/field-event-planner.ts` and `sameStorageType` in `packages/2-sql/1-core/contract/src/validators.ts` compare what columns are stored as, so changing a column from `sqlite/text` with the datetime codec to `sqlite/datetime` reports no `altered` event, and a foreign key from a `sqlite/datetime` column to a `sqlite/text` column is accepted as it is today. Test both.
7. **DDL and verify are unchanged on SQLite.** A `sqlite/datetime` or `sqlite/json` column is written `TEXT` and verifies against a `TEXT` column. Prove it with the golden planner test (SQLite DDL identical) and a SQLite integration test that creates a table with both columns and verifies it clean.
8. **Committed contracts.** SQLite contracts that use these codecs now store `dataType: "sqlite/datetime"` or `"sqlite/json"` and the new datetime form, so their hashes change. Do not regenerate committed contracts, snapshots or upgrade fixtures; dispatch g does that with the upgrade script. List every test that fails because a committed SQLite contract has the old form, with the file it reads.

## Must not change

Postgres contracts and DDL; SQLite DDL (golden planner recordings for SQLite identical, apart from contract hashes in snapshot names if any).

## Done when

Tests were red first, then green, apart from the committed-contract failures you list. Root `typecheck:agent`; the SQLite target and adapter tests; the SQLite codec test kit; contract-psl; framework-components; `test/integration/test/date-time-defaults/sqlite-date-time-defaults.integration.test.ts`; `test/integration/test/authoring/`; `lint:agent`; `lint:deps`. Do not edit `docs/`.

Report in under 400 words: commits; the failing tests that dispatch g's regeneration must fix, by file; anything the ADR left undecided.
