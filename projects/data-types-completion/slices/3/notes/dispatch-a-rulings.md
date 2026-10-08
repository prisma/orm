# Dispatch a: implementer's report and the orchestrator's rulings

Range `650fff0614..def805947b` (10 commits).

Rulings the orchestrator gave during the dispatch:

1. Each Postgres date and time type's reader is its stored-text pattern (`date-time-stored-text.ts`): ISO 8601 and the text PostgreSQL prints, nothing else. Forms only `Temporal.from` accepted (no seconds, `+0530`, nine fraction digits) are refused by `fromContract`. The Date and Temporal codecs refuse only `infinity` and their range. `pg/timestamptz-date@1`'s own pattern goes.
2. `sqlite/text` reads any string; `sqlite/datetime@1` and `sqlite/json@1` keep their parse in `fromDataTypeValue` until dispatch d.
3. A codec is constructed with its `DataType` and the column's parameters (`CodecImpl(descriptor, dataType, params)`, `mongoCodec({ dataType, params })`), and `Codec` has a read-only `dataType`. `toDataTypeValue` builds through `withParams(fromContract(json, params), params)`.
4. `read` is required on `DataTypeSpec`.
5. The final grep runs with `git grep -P`.

After the report the orchestrator also decided:

6. Prisma 7 `Decimal` defaults (`numeric(65,30)`) now store 30 fraction digits, as PostgreSQL prints them. The three `contract-prisma7` expected contracts and the golden test's fixture-hash manifest change; contracts read from a Prisma 7 schema are allowed to change in this slice.
7. Value parameters are not normalised in this slice (`numeric(10)` against `numeric(10,0)`); slice 4 adds parameter normal forms. `DataTypeValue` does not deep-freeze its JSON. `fromContract` does not validate parameters against the type's schema, because the contract build already does.

Implementer's summary: every "Done when" check passes (typecheck, lint, lint:deps, fixtures:check, golden planner clean, `test/authoring/` and `test/date-time-defaults/` 394 tests, both test kits). `lint:framework-vocabulary` 254 (at threshold), `lint:casts` −3. Two tarball-install tests in `9-public` fail because the registry has no `temporal-utils@1.0.3` (environment). Parameter checks moved to types: `pg/int4`, `pg/int2`, `pg/char` (bare = 1), `pg/varchar`, `numeric(p,s)`, `vector(n)`, and also `pg/bit`/`pg/varbit` lengths and the `pg/float4` range. `PgCharCodec` and `PgVarcharCodec` were deleted. Behaviour changes: refusals name the type with `meta.dataType`; `pg/inet`'s `toDataTypeValue` refuses non-addresses; `unboundedint` columns get the numeric precision check. Nine package READMEs still name the old methods (dispatch h).
