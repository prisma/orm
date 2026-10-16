# Slice 3: fixes from the branch review

Read `common-rules.md` first. The findings are in `slices/3/reviews/`: `system-design-review.md` (D01 to D12), `code-review-core.md` (C01 to C03), `code-review-targets.md` (T01 to T06), `code-review-tooling.md` (G01, G02). Read each finding before its ruling. The orchestrator edits ADR 254 and the design notes; do not. Tests first wherever behaviour changes. One commit per item below, in this order, branch green at each.

## Correctness

1. **C01.** `SqlColumnDefaultIR.isEqualTo` compares values when both sides have one; it falls back to comparing text only when the column's codec could not read the reported default, and that text comparison keeps case and spaces inside quotes. Test: contract `'Hello'::text`, database `'hello'::text`, verify reports the column, on Postgres and SQLite.
2. **C02.** Loading a contract refuses a default on a list column that is not a list, naming the column.
3. **C03.** A refused element of a list default is named by its index in the CLI's load refusal and in introspection's message, as the builder and PSL reader already do.
4. **T01.** On SQLite, a blob default (`X'..'`) is read through the column's codec, so `db init` then `db verify` is clean for a `Bytes` default.
5. **T02.** A pgvector value with a number `real` cannot hold exactly (`0.123456789`, `1e-50`) is refused when it is written, naming the element and what PostgreSQL would store, rather than changed by PostgreSQL.
6. **T03.** One spelling per value: PostGIS geometry hex is upper case and little-endian only; base64 with non-zero padding bits is refused for `pg/bytea` and `mongo/binary`; Mongo ObjectId hex is lower case only. Each reader refuses the other spellings and names the stored one.
7. **T04.** On SQLite a quoted string on a `Bytes` column is refused, as on Postgres. Add a `blob` tag to the SQLite target whose body is hex (`` blob`68656c6c6f` ``), with `parse`, `print` and documentation like Postgres's `bytea`; the refusal names it. Rewrite the SQLite schemas and tests that write a quoted bytes default.
8. **T05.** SQLite's datetime `fromWire` reads text without an offset as UTC, never the machine's local time. Test under two `TZ` values.
9. **T06.** Both default journeys use several values per type, including the edge cases the targets review probed (years outside 1 to 9999, `infinity`, mixed intervals, bytes with a quote or backslash, `NaN` and infinities, list defaults); the SQLite journey covers `Bytes`.

## Design

10. **D01.** A data type's `spell` is its whole spelling step: uuid lower case, inet, every date and time type, interval, SQLite datetime and JSON. The 15 codec call sites that spell before handing a value over stop doing so; `DataType.fromCodec` applies `spell`.
11. **D02.** The Postgres data types no longer import from `codec-helpers.ts`. Move the value readers the types use into a module the types own (or `@internal/sql-contract/data-type-support` where both targets use them); codecs import from there.
12. **D03.** A tag's `parse`, the number classifier and every cast produce their value through the receiving or source type's constructor, not a bare `TypedValue` that skips it. `default-mapping.ts` uses the shared read-and-cast function instead of its own copy.
13. **D04.** Rename `DataType.fromCodec` to `DataType.valueFrom(json, params)`: it builds a value of the type from JSON, under the parameters, writing the stored spelling. Remove the `dataTypeValueFor` wrapper; callers call `valueFrom`.
14. **D05.** Mongo's codec config `toDataTypeValue` returns a `DataTypeValue` like every other codec; one type check, not three.
15. **D06.** One function for a value's data type parameters: keep the framework's and delete the SQL copy, or the reverse, whichever has more callers.
16. **D07.** A `Date` default goes to `toWire` with its type, and schema IR compares it as a value, not through `toISOString()`. Fix the stale doc comment in `ddl-types.ts`.
17. **D08.** Rename what still says "canonical form" for the stored value (`pg*Canonical`, `date-time-canonical-form.ts`, and the like) to say "stored". Test file and fixture folder names that record history (`_fixture-before-canonical-form`) stay.
18. **D09.** `sqlStorageTypeId` throws where `sqlStorageType` does; assembly refuses a type stored as a type that is itself stored as another.
19. **D10.** The Prisma 7 binding takes its type-to-tag mapping from the authoring entries instead of its own table.
20. **D11.** The foundation layer's enum accessor uses the codec interface type and reads members with the column's parameters.
21. **G01.** The extension instruction covers `mongoCodec()` from `@prisma/orm-family-mongo/codec`: renamed options and the required `dataType`, with a before-and-after sample; its detection patterns also match the object form (`encodeJson: (`).
22. **G02.** The Postgres section quotes the message as the CLI prints it, `Namespace "public", table "product", column "price": …`.

## Checks

Root `typecheck:agent`, `lint:agent`, `lint:deps`, `lint:docs`, `lint:framework-vocabulary`, `check:error-reference`, `fixtures:check:agent`, the golden planner test (no DDL change), the touched packages' tests, both codec test kits, `test/integration/test/authoring/`, `date-time-defaults/`, both default journeys, the stale-default journeys, `psl-print/`, `psl-infer/`, the `infer-roundtrip-*` journeys and the upgrade-instruction tests.

Report in under 500 words: one line per item with its commit, anything you could not do as ruled, and the checks.
