# Code review: slice 3 (TML-3531)

Reviewer-maintained. Contract: [ADR 254](../../../../docs/architecture%20docs/adrs/ADR%20254%20-%20Data%20types%20and%20casts.md) and `projects/data-types-completion/design-notes.md` ("A data type owns its values"). Plan: `projects/data-types-completion/slices/3/plan.md`. Briefs: `projects/data-types-completion/slices/3/briefs/`.

## Subagent IDs

- Implementer: slice 3 implementer (Opus), dispatch a rounds 1 and 2
- Reviewer: slice 3 reviewer (Opus), dispatch a rounds 1 and 2, started 2026-10-08
- Implementer and reviewer, dispatch b round 1: slice 3 implementer and reviewer (Opus)

## Orchestrator rulings

Dispatch a, given during the dispatch and recorded in `slices/3/notes/dispatch-a-rulings.md`. They are part of the brief.

1. Each Postgres date and time type's reader is its stored-text pattern (`date-time-stored-text.ts`): ISO 8601 and the text PostgreSQL prints, nothing else. Forms only `Temporal.from` accepted (no seconds, `+0530`, nine fraction digits) are refused by `fromContract`. The Date and Temporal codecs refuse only `infinity` and their range. `pg/timestamptz-date@1`'s own pattern goes.
2. `sqlite/text` reads any string; `sqlite/datetime@1` and `sqlite/json@1` keep their parse in `fromDataTypeValue` until dispatch d.
3. A codec is constructed with its `DataType` and the column's parameters (`CodecImpl(descriptor, dataType, params)`, `mongoCodec({ dataType, params })`), and `Codec` has a read-only `dataType`. `toDataTypeValue` builds through `withParams(fromContract(json, params), params)`.
4. `read` is required on `DataTypeSpec`.
5. The final grep runs with `git grep -P`.
6. Prisma 7 `Decimal` defaults (`numeric(65,30)`) store 30 fraction digits, as PostgreSQL prints them. The three `contract-prisma7` expected contracts and the golden test's manifest change; contracts read from a Prisma 7 schema may change in this slice.
7. Value parameters are not normalised in this slice (`numeric(10)` against `numeric(10,0)`); slice 4 adds parameter normal forms. `DataTypeValue` does not deep-freeze its JSON. `fromContract` does not validate parameters against the type's schema, because the contract build already does.
8. Round 1: S3-a-R1-1 as proposed, `fromContract` is strict and codecs construct through a path in the data type module. S3-a-R1-6: refuse extra fraction digits on every Postgres type with fractional-second precision, and sweep for other parameters that change or limit a value's spelling.

## Scoreboard

| Dispatch | Round | Verdict |
| --- | --- | --- |
| a | 1 (`650fff0614..def805947b`) | ANOTHER ROUND NEEDED: 1 must-fix, 1 should-fix, 4 low |
| a | 2 (`e2ecf45352^..7396cff3b8`) | ANOTHER ROUND NEEDED: 0 must-fix, 1 should-fix, 3 low |
| b | 1 (`682ee5dd54..7e742de7c9`) | ANOTHER ROUND NEEDED: 3 must-fix, 1 should-fix, 6 low |

## Findings log

### S3-a-R1-1 (must-fix): `fromContract` accepts a numeric value in a spelling its parameters do not give

- Where: `packages/3-targets/3-targets/postgres/src/core/data-types.ts` (`readNumeric`, `spellNumeric`); `packages/1-framework/1-core/framework-components/src/shared/data-type.ts` (`fromContract` in `dataType()`, `dataTypeValueFor`); the test `fromContract constructs a value of the type with its parameters and its stored JSON` in `packages/1-framework/1-core/framework-components/test/data-type-value.test.ts`.
- What is wrong: ADR 254 "Values" says a `numeric(10,2)` value stores `"1.50"`, and "the step that creates a value writes that spelling, and `fromContract` refuses any other". Against the built target, `pgNumeric.fromContract('1.5', { precision: 10, scale: 2 })` returns a value with JSON `"1.5"` and those parameters. `withParams` writes `"1.50"`, but a contract that stores `"1.5"` for such a column is accepted, and `dataTypeValuesEqual` then says that value differs from the `"1.50"` the PSL path stores. Dispatch e's `deserializeContract` check would let `"1.5"` through. The framework test asserts the deviation. No committed `contract.json` stores an unpadded `numeric(p,s)` default (checked by script), so refusing it changes no committed file.
- Change: `fromContract` refuses JSON that is not already in the spelling its parameters give (for a type with `spell`, `spell(json, params) !== json`), with the `refuseJsonValue` convention and the spelled text in the message, as `readNumeric` does for `"1e5"`. `dataTypeValueFor` then cannot go through `fromContract(json, params)` first: it reads and spells under `params` inside the data type module. That amends ruling 3's construction order, so the orchestrator confirms it. Rewrite the framework test to expect the refusal, and add a `pg/numeric` reader test.

### S3-a-R1-2 (should-fix): the TypeScript builder's `.default()` through `withParams` has no test

- Where: `packages/2-sql/2-authoring/contract-ts/src/build-contract.ts` (`encodeViaCodec`); `packages/2-sql/2-authoring/contract-ts/test/`.
- What is wrong: brief item 5 says the builder reaches `withParams` through `toDataTypeValue`. The code does: `pgNumericColumn({ precision: 10, scale: 2 }).codecFactory({}).toDataTypeValue('1.5')` gives `"1.50"` and refuses `'1.234'` and `'123456789.5'`. But no test covers it, so a codec built without the column's parameters (the default `dataTypeParams = {}` in `CodecImpl`) would store `"1.5"` with every test green. Only the PSL path has the TML-3479 tests.
- Change: add a contract-ts test that a `numeric(10,2)` column with `.default('1.5')` stores `"1.50"` and that `.default('1.234')` is refused, asserting the whole default.

### S3-a-R1-3 (low): the test kits' new round-trip check has no test that it can fail

- Where: `packages/3-targets/6-adapters/postgres-codec-testkit/src/index.ts` (`valuesNotRoundTripped`, failure kind `value-round-trip`); `packages/3-targets/6-adapters/sqlite-codec-testkit/src/index.ts` (the same check).
- What is wrong: every real codec passes the check, and no test hands the harness a codec whose `toDataTypeValue(fromDataTypeValue(v))` differs from `v`. Deleting the check leaves every test green (`.agents/rules/non-vacuous-verification.mdc`).
- Change: in each kit, a test with a codec that changes the value on the way back, expecting failure kind `value-round-trip`.

### S3-a-R1-4 (low): no type test pins the contract value channel to `toDataTypeValue`

- Where: `packages/2-sql/4-lanes/relational-core/src/ast/codec-types.ts` (`DescriptorCodecJson`).
- What is wrong: brief item 7 changed the channel to infer `J` from `DataTypeValue<J>`. If the inference failed it would give `never`, and no test would notice: no codec narrows its return and no type test reads `ExtractCodecTypes[...]['json']`. Unchanged committed `contract.d.ts` files do not show the member's resolved type.
- Change: a `.test-d.ts` in relational-core asserting the member is `JsonValue` for a codec that does not narrow, and `string` for a test codec whose `toDataTypeValue` returns `DataTypeValue<string>`.

### S3-a-R1-5 (low): nothing checks that a codec receives a value of its own type

- Where: `packages/1-framework/1-core/framework-components/src/shared/codec.ts` (`CodecImpl`); every `fromDataTypeValue(value: DataTypeValue<string>)` in the codec files; `ownValue` in `data-type.ts`.
- What is wrong: `fromDataTypeValue` reads `value.value` without checking `value.type`, and the narrowed parameter types (`DataTypeValue<string>`) are accepted only because TypeScript checks method parameters bivariantly, so they assert the JSON's kind without a check. A `pg/int4` value handed to `pg/int8@1` gives a `bigint` silently. `ownValue` in `toContract` and `withParams` compares type ids, so a second `dataType('pg/int8', …)` declared elsewhere constructs values the real type accepts.
- Change: no change needed for dispatch b. If the orchestrator wants the guarantee, `CodecImpl` checks `value.type === this.dataType.id` before calling the subclass, and `ownValue` compares the constructing type object, not its id.

### S3-a-R1-6 (low, design gap for the orchestrator): date and time readers ignore the precision parameter

- Where: `readDateTime` in `packages/3-targets/3-targets/postgres/src/core/data-types.ts`; `pg/time`, `pg/timetz`, `pg/timestamp`, `pg/timestamptz` and `pg/interval` all take `precision`.
- What is wrong: PostgreSQL rounds a fraction past the column's precision (`'00:00:00.5'::time(0)` is `00:00:01`). ADR 254 "Values" says `fromContract` refuses a value its parameters exclude, rather than rounding, as for `numeric(10,2)`. The readers accept `.5` on a precision-0 column, so the contract and the database hold different values. No codec checked this before, so it is outside brief item 4; it is the same defect as TML-3479 for another parameter.
- Change: the orchestrator places the precision check in a later dispatch (b narrows these readers) or records why it is not wanted.

## Checks run for dispatch a round 1

- Root `typecheck:agent`: pass. `lint:agent`: pass. `lint:deps`: pass. `lint:framework-vocabulary`: 254 at threshold 254. `lint:casts`: −3 against the merge base. `fixtures:check:agent`: pass, working tree clean afterwards.
- Package tests of all 37 touched packages (`pnpm --filter <pkg> test`), including both codec test kits with their PGlite and SQLite conformance files: all pass.
- Integration: `test/planner-golden`, `test/authoring`, `test/date-time-defaults` and every integration file the diff touches: 70 files, 1248 tests, all pass. The golden test compares against the committed manifest; the only manifest change is the three Prisma 7 contracts of ruling 6.
- `git grep -nP '\b(encodeJson|decodeJson)\b' -- packages test examples`: only nine package READMEs, which dispatch h rewrites.
- Probes against the built packages: `withParams` gives `"1.50"` for `1.5` on `numeric(10,2)` and refuses `1.234` and `123456789.5`; a bare `pg/char` refuses `"ab"`; `pg/int4` refuses 2^31; `toContract` refuses another type's value; a value is frozen.
- Must-not-change: no committed `contract.json`, `contract.d.ts`, migration or snapshot changed outside ruling 6.

## Round 2 of dispatch a: the round 1 findings

- S3-a-R1-1: fixed. `fromContract` reads, spells under `params` and refuses JSON whose spelling differs, naming the spelling (`data-type.ts`). Codecs construct through `dataTypeValueFor`, which calls the new `DataType.fromCodec`. Tests: the framework test now expects the refusal, and `data-type-readers.test.ts` has a `pg/numeric` refusal test.
- S3-a-R1-2: fixed. `packages/3-extensions/postgres/test/contract-builder/numeric-default-scale.test.ts` asserts `"1.50"` and the two refusals with the whole default and the whole error.
- S3-a-R1-3: fixed. Each kit has `value-round-trip.integration.test.ts` with a codec that changes the value, expecting failure kind `value-round-trip`.
- S3-a-R1-4: fixed. `codec-json-channel.types.test-d.ts` asserts `string` and `JsonValue`, each with a `not.toBeNever()` sentinel.
- S3-a-R1-5: fixed. `CodecImpl` and `mongoCodec` refuse a value of another data type with an `InternalError`, tested in both. `ownValue` still compares ids, which is right while the CLI can load two copies of the module.
- S3-a-R1-6: fixed for the types with a `precision` parameter (`time`, `timetz`, `timestamp`, `timestamptz`, `interval`), with refusal and acceptance tests and a `withParams` test. One instance is missed: S3-a-R2-1.

## Round 2 of dispatch a: the implementer's choices

- `DataType.fromCodec(json, params)`: accepted. It reads under `params`, refuses what they exclude and writes their spelling, so it can do nothing `withParams(fromContract(json, {}), params)` could not already do. It is a public method ADR 254 does not name; dispatch h adds it to the ADR and the codec authoring guide.
- `readReportedValue` callers: the ORM include read (`collection-dispatch.ts`) and the empty aggregate read (`aggregate-empty-result.ts`) go in dispatch b, which reads them with `fromWire`. The two test kits' projection reads go in dispatch b, which rewrites those assertions. The default-fidelity test's read of a reported literal goes in dispatch e, where introspection reads with `fromWire`. `contract infer`'s `readsBack` (`infer-default-codec.ts`) is removed by neither b nor e; the plan gives it to dispatch f. No caller lets a non-canonical value into a contract: the ORM reads produce application values, the kits are tests, and `readsBack` only decides whether infer prints the reported literal into PSL, which PSL lowering then spells through `withParams`.
- `pg/char` without padding: correct. Against PGlite, a `char(3)` row holding `'a'` returns `"a  "` as a row value and in `row_to_json`, and `"a"` through `::text`; the reported default is `'a  '::bpchar`. Both codecs of `pg/char` (`pg/char@1` and `sql/char@1`) are `SqlCharCodec`, whose `fromWire` drops the padding, so each returns `"a"` for the row. `fromDataTypeValue(pgChar.fromContract("a", { length: 3 }))` is `"a"`, equal to what the query returns. The old behaviour (storing `"a  "`) broke that equality. `fromContract("a  ", { length: 3 })` is refused, naming `"a"`.
- `postgis/geometry` with an SRID: correct, and tested for another SRID, no SRID, and a column without an SRID. See S3-a-R2-3 for malformed hex.

## Round 2 findings

### S3-a-R2-1 (should-fix): `pg/interval` without a precision accepts fraction digits PostgreSQL rounds away

- Where: `readInterval` in `packages/3-targets/3-targets/postgres/src/core/data-types.ts`; `ISO_DURATION` in `codec-helpers.ts` takes any number of fraction digits.
- What is wrong: the ruling says refuse extra fraction digits on every Postgres type with fractional-second precision. An interval with no precision holds microseconds, six digits. `pgInterval.fromContract('PT1.1234567S', {})` is accepted, and PGlite prints `'PT1.1234567S'::interval` as `00:00:01.123457`. The time types are safe: their stored-text pattern allows at most six digits (`fromContract('00:00:00.1234567', {})` on `pg/time` is refused). `pgIntervalCanonical` refuses seven digits, but `fromContract` does not.
- Change: `readInterval` refuses more than six fraction digits when the column sets no precision (for example, `refuseFinerThanPrecision` with a default of 6 for `pg/interval`). Add a refusal test for `PT1.1234567S` under `{}`.

### S3-a-R2-2 (low): the `readCharacter` doc comment is orphaned

- Where: `packages/3-targets/3-targets/postgres/src/core/data-types.ts`, above `spellCharacter`.
- What is wrong: `spellCharacter` was inserted between `readCharacter` and its doc comment, so two doc blocks sit stacked on `spellCharacter` and `readCharacter` has none (`.agents/rules/jsdoc-line-width.mdc`).
- Change: move the first block back above `readCharacter`.

### S3-a-R2-3 (low): under an SRID, the geometry reader refuses malformed hex with the decoder's wire error

- Where: `readGeometry` in `packages/3-extensions/postgis/src/core/data-types.ts`.
- What is wrong: with an SRID, `decodeEWKBHex` runs on any even-length hex. Hex that is not EWKB (`"00"`) throws the decoder's `Geometry wire value: …` error, which names no data type and has no `meta.received`, not the `refuseJsonValue` refusal the brief requires. Without an SRID the same hex is accepted.
- Change: the reader catches the decoder's refusal and refuses through `refuseJsonValue('postgis/geometry', …)`, or decodes the header in both cases. Add a malformed-hex test.

### S3-a-R2-4 (low, for the orchestrator): the sweep's other parameters, and contracts emitted before this slice

- `mongo/vector` takes `length`, and its TypeScript type is `Vector<length>`, but `readVectorJson` ignores it, so a `Vector(3)` value of four numbers is accepted. MongoDB does not enforce it, as SQLite does not enforce character lengths, but ADR 254 gives `vector(3)` refusing four numbers as the example. The orchestrator decides whether the reader checks it. No other parameter in the repository changes or limits a value's spelling unchecked: `pg/varchar` and `pg/bit`/`pg/varbit` refuse values that do not fit; `pg/enum`, `sqlite/character` and `sqlite/character-varying` parameters do not limit values.
- A Postgres contract emitted by an earlier release can store `"1.5"` on `numeric(10,2)` (TML-3479), a padded `char` default, or a time with more fraction digits than its precision. DDL now reads defaults strictly (`ddl-default.ts`), so such a contract is refused until it is emitted again. Dispatch g's instruction should tell Postgres users to run `contract emit` and `db sign`, not only SQLite and Prisma 7 users.

## Checks run for dispatch a round 2

- Root `typecheck:agent`: pass. `lint:agent`: pass. `lint:deps`: pass. `lint:framework-vocabulary`: 254 at threshold 254. `lint:casts`: −3 against the merge base. `fixtures:check:agent`: pass, working tree clean.
- Package tests of 23 packages (the 12 the fixes touch, and every package that reads contract values: contract-psl, contract-ts, emitter, contract, SQLite target and adapter, pgvector, arktype-json, Mongo target, family-sql, cli): all pass.
- Integration: `test/planner-golden` re-recorded with `PLANNER_GOLDEN_WRITE=1`, `test/authoring` and `test/date-time-defaults`: 48 files, 1104 tests, pass, and `git status` clean. The adapter's two list and cast default files, both kits' new and changed integration files, and the Postgres default-fidelity file: pass.
- Probes against PGlite and the built packages: the `pg/char` read-back above; `pg/interval` and `pg/time` fraction limits (S3-a-R2-1).
- Must-not-change: no committed `contract.json`, `contract.d.ts`, migration, snapshot or golden recording changed in the range.

## Dispatch a, round 3 (orchestrator)

`bcf3a33c78` fixes S3-a-R2-1 to R2-4, each with a test: an unset fractional-second precision means microseconds, invalid geometry hex is refused through `refuseJsonValue`, `mongo/vector` checks its `length`, and the `readCharacter` doc comment is back. Dispatch a is closed. Carried forward: dispatch f removes `contract infer`'s `readsBack` use of `readReportedValue`; dispatch g's upgrade instruction covers Postgres contracts with a default in another spelling than their parameters give; dispatch h documents `DataType.fromCodec`.

## Dispatch b, round 1

Brief: `projects/data-types-completion/slices/3/briefs/s3-dispatch-b.md`. Range `682ee5dd54..7e742de7c9`.

### Orchestrator rulings for dispatch b

1. The `jsonb`, `json`, `arktype/json@1` and `pg/vector@1` projections are `CAST(x AS text)`, not the column itself. Accepted; the ADR text is corrected separately.
2. `sqlite/datetime@1` and `sqlite/json@1` readers are narrowed in dispatch d, not here.
3. An include of an interval column failing under `IntervalStyle = sql_standard` is not accepted. It is finding S3-b-R1-1.
4. `docs/reference/aggregate-descriptor-guide.md` and `error-reference.md` still say `emptyResultJson`; the orchestrator updates docs.

### Checks of the implementer's claims

- `CAST(x AS text)` for `json` and `jsonb`: confirmed. With both projections set back to the column itself and the target rebuilt, five kit cases fail: the four new string-document cases (`'42'` and `'hello'`, `json` and `jsonb`) and the array case `string document elements`. Restored and rebuilt afterwards.
- `pg/vector@1`: with the old widened `array_to_json(...float8[])` projection, all nine pgvector cases fail, but with `fromWire rejects the projected [ 1, 2, 3 ]`, not because of the widened numbers. See S3-b-R1-5.
- Widened `fromWire`s, against a real database (`node:sqlite` and PGlite, built packages). `pg/text-array@1` reads `{a,"b c",NULL,"\"q\""}`, `{}`, `[0:1]={a,b}`, quoted `"NULL"` and backslashes correctly, and refuses a two-dimensional array (S3-b-R1-8). The SQLite results are in S3-b-R1-3.
- The linear Promise-count check: it does not fail when per-cell work grows. See S3-b-R1-4.
- PostGIS: unit test only, and `deferred.md` names the missing conformance file. Accepted.

### S3-b-R1-1 (must-fix, orchestrator ruling): `pg/interval@1`'s `fromWire` reads two of PostgreSQL's four interval styles

- Where: `pgIntervalDecode` and `intervalTextFields` in `packages/3-targets/3-targets/postgres/src/core/codec-helpers.ts`; the two `notYetCanonical` "hostile session" interval cases in `packages/3-targets/6-adapters/postgres-codec-testkit/test/codec-conformance/cases.ts`; the interval line in `projects/data-types-completion/deferred.md`.
- What is wrong: against PGlite, `fromWire` reads the `postgres` and `iso_8601` text and refuses every `postgres_verbose` text (`@ 1 year 2 mons 3 days 4 hours 5 mins 6.5 secs`, `@ 1 year 2 mons -3 days 4 hours ago`, `@ 0`) and every `sql_standard` text with a year-month or day part (`+1-2 +3 +4:05:06.5`, `+0-1 -1 +0:00:00`, `0`). `-0:00:01.5` reads only because it matches the `postgres` pattern. Since this dispatch an include reads that text, so an include fails where it read the ISO duration before.
- Change: `fromWire` reads the text of all four styles, for rows and includes. In `sql_standard` a single leading sign applies to every field when no other field has a sign (`-1 2:03:04` is minus one day, two hours, three minutes, four seconds), so test that case. Add a kit case per style with a mixed-sign and a zero interval, remove the two `notYetCanonical` marks, and remove or rewrite the deferred line (it also names `DateStyle`, which is unchanged by this dispatch because the date and time projections were already `CAST(x AS text)`).

### S3-b-R1-2 (must-fix, the same defect as S3-b-R1-1): `pg/bytea@1` refuses the text `bytea_output = escape` prints

- Where: `PgByteaDescriptor.jsonProjection` and `pgByteaDecodeWire` in `packages/3-targets/3-targets/postgres/src/core/`.
- What is wrong: the old projection, `encode(x, 'base64')`, gave the same text in every session. `CAST(x AS text)` follows `bytea_output`. Against PGlite with `SET bytea_output = 'escape'`, the cast gives `\000\377A` and `fromWire` throws `pg/bytea@1 wire value must be a bytea hex string or Uint8Array`. So an include of a `bytea` column now fails in that session, as an ordinary row already did. It is the class the interval ruling names: a session setting changes the text PostgreSQL prints, and `fromWire` reads only the default.
- Change: `fromWire` also reads the escape format (octal `\nnn`, `\\`, and printable bytes as themselves). Add a kit case with `bytea_output = escape` in `setupSql`.

### S3-b-R1-3 (must-fix, a "must not change" item): plain SQLite reads that returned a value now throw, and a BLOB column's text can change type silently

- Where: `safeIntegerWire`, `floatWire` and `SqliteBlobCodec.fromWire` in `packages/3-targets/3-targets/sqlite/src/core/codecs.ts`; `test/integration/test/sql-orm-client/sqlite-float-non-finite-include.test.ts`, whose flat-read assertions were rewritten from a returned value to a refusal.
- What is wrong: the brief says what a query returns does not change. Outside a STRICT table SQLite keeps text and blobs in any column. Against `node:sqlite`, a flat read that returned the stored value before now throws `RUNTIME.DECODE_FAILED` for:
  - `sqlite/real@1` and `sql/float@1` holding `'abc'` or `x'00ff'` (the implementer's report names these two);
  - `sqlite/integer@1` and `sql/int@1` holding `'abc'` or `x'00ff'` (the report does not name these);
  - `sqlite/blob@1` holding text that is not uppercase hex, such as `'hello'`.
  Worse, a `sqlite/blob@1` column holding the text `'ABCD'` used to read as the string `'ABCD'` and now reads as the bytes `[171, 205]`, with no error. A number in a BLOB column still passes through as a number. Numbers, infinities and blobs in their own column types read as before. The text `'Infinity'` in a REAL column now reads as the number, where it read as the string.
- Change: the orchestrator rules. Either (a) the refusals are wanted, as they make a flat read and an include agree; then record them for dispatch g's upgrade instruction and the ADR, and keep the integration test as rewritten; or (b) flat reads keep passing a value they cannot read through, as before. In both cases the BLOB reinterpretation goes: an include cannot tell hex text from row text, so the projection must carry something a row never holds, for example `json_array(hex(x))` for a blob, which `fromWire` reads as bytes while a row's string stays a string (or is refused under (a)).

### S3-b-R1-4 (should-fix): the Promise-count test passes when per-cell work grows

- Where: `creates Promise resources in proportion to the included cells it reads` in `packages/3-extensions/sql-orm-client/test/collection-row-query.test.ts`.
- What is wrong: `hundred - one === 99 * (two - one)` catches growth faster than linear but not more Promises per cell. With two extra `await Promise.resolve()` calls added before `codec.fromWire` in `decodeIncludedJsonValue`, the test still passes.
- Change: also assert `two - one` equals the exact number of Promises one included row costs today (its two cells and one nested include), so a change to per-row work has to update the number.

### S3-b-R1-5 (low): the pgvector conformance file compares the projection with the row as `real`s

- Where: `vectorsEqualAsReals` as the case's `valueEquality` in `packages/3-extensions/pgvector/test/codec-conformance.integration.test.ts`; `valuesAgree` in `packages/3-targets/6-adapters/postgres-codec-testkit/src/index.ts`.
- What is wrong: the kit uses `valueEquality` for the projection against the row as well as for the row against the case. For vectors that comparison rounds both sides to `real`, so a projection that printed widened doubles (`0.10000000149011612` where the row reads `0.1`), the defect this dispatch's projection fixes, would pass.
- Change: compare the projection with the row by deep equality, and use `valueEquality` only for the row against the case value. Where a case needs `valueEquality` for both (Temporal values have no own properties for deep equality to compare), give the case a separate projection comparison.

### S3-b-R1-6 (low): an include's call context drops the row's `signal`

- Where: `resolveIncludedColumnBinding` and `consumeScalarInclude` in `packages/3-extensions/sql-orm-client/src/collection-dispatch.ts`.
- What is wrong: brief item 1 asks for the call context an ordinary row gets. `decodeField` in `packages/2-sql/5-runtime/src/codecs/decoding.ts` gives a cell `{ ...rowCtx, column }`, where `rowCtx` carries the query's `signal`. An include cell gets `{ column }` and a scalar include `{}`, so a codec that honours `signal` cannot cancel inside an include.
- Change: pass the query's `signal` into the include read if the ORM has it; otherwise record that the ORM has none and the context is otherwise the row's.

### S3-b-R1-7 (low): an orphaned doc comment in `codec-helpers.ts`

- Where: `/** Reads the ISO-8601 duration `pg/interval` stores. */` above `intervalTextFields` in `packages/3-targets/3-targets/postgres/src/core/codec-helpers.ts`.
- What is wrong: its function, `readPgIntervalJson`, was deleted and the comment left behind (`.agents/rules/jsdoc-line-width.mdc`).
- Change: delete it.

### S3-b-R1-8 (low): `pg/text-array@1` refuses a multi-dimensional array

- Where: `readTextArrayWire` in `packages/3-targets/3-targets/postgres/src/core/codecs.ts`.
- What is wrong: a `text[]` column may hold `{{a,b},{c,d}}`. A plain read returned that text before; now it throws `pg/text-array@1 wire value must be text[] text`. Separately, `min`/`max` of a `text[]` column now returns an array where it returned the array's text, which matches the codec's declared type, so it is a fix, but it changes what a query returns.
- Change: refuse with a message naming the multi-dimensional array, or read it; and list the `min`/`max` change in the report for dispatch g.

### S3-b-R1-9 (low, for the orchestrator): `emptyResultWire` is missing from dispatch g's extension instruction

- Where: plan row g in `projects/data-types-completion/slices/3/plan.md`.
- What is wrong: an extension's aggregate descriptor with `emptyResultJson` is now refused by `isAggregateDescriptor`, and the value's meaning changed from stored JSON to a wire value (`emptyResultJson: 0` under `pg/int8number@1` must become what that codec's `fromWire` reads). Row g lists the codec methods, `DataTypeValue`, parameter limits and projections, not this field.
- Change: add the rename and its meaning to dispatch g's extension instruction.

### S3-b-R1-10 (low): the SQLite kit no longer checks the projection of an integer past 2^53

- Where: the three `sqlite/bigint@1` cases marked `row-execution` in `packages/3-targets/6-adapters/sqlite-codec-testkit/test/codec-conformance/cases.ts`.
- What is wrong: the runtime driver does not ask `node:sqlite` for bigints, so the row read throws and the case stops there. Before, these cases checked the projection's decimal text. The underlying gap is older: a plain read of a `sqlite/bigint@1` column holding such a value fails in the runtime, while an include reads it.
- Change: when the row cannot be read, the kit still checks that `fromWire` reads the projection to the case's value. Add a deferred line for the runtime driver's reading of integers past 2^53.

### Checks run for dispatch b round 1

- Root `typecheck:agent`: pass. `lint:agent`: pass. `lint:deps`: pass. `lint:framework-vocabulary`: 254 at threshold 254. `pnpm build`: pass. `fixtures:check:agent`: pass, working tree clean.
- Package tests of the 14 touched packages (framework-components, sql-relational-core, sql-builder, sql-contract-emitter, sql-runtime, target-postgres, target-sqlite, both codec test kits with their integration files, extension-pgvector and extension-arktype-json with their conformance files, extension-postgis, postgres, sql-orm-client): all pass.
- Integration: the 26 `test/sql-orm-client/` files whose names contain include, relation or aggregate, plus `json-projection-variants.test.ts` (54 files with the filter's substring matches, 372 tests), pass. `test/planner-golden` re-recorded with `PLANNER_GOLDEN_WRITE=1`, `test/authoring` and `test/date-time-defaults`: 48 files, 1104 tests, pass, and `git status` clean.
- Sweeps: no `emptyResultJson` outside `docs/`, `projects/` and the historical rc.1 to rc.2 upgrade instruction; no `canonicalFormOf` in either kit; no `any`, `@ts-expect-error`, lint suppression or bare `as` added in production code.
- Must-not-change: no committed `contract.json`, `contract.d.ts`, migration, snapshot or golden recording changed. The SQL snapshot `json-projection-variants.test.ts.snap` changed for the vector projection, as ruling 1 accepts. What queries return changed in S3-b-R1-3 and S3-b-R1-8.
- Commits: the two `test(...)` commits carry the implementation with the tests, so the history cannot show the tests red first; the mutations above show the new tests can fail.
