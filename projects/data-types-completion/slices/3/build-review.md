# Code review: slice 3 (TML-3531)

Reviewer-maintained. Contract: [ADR 254](../../../../docs/architecture%20docs/adrs/ADR%20254%20-%20Data%20types%20and%20casts.md) and `projects/data-types-completion/design-notes.md` ("A data type owns its values"). Plan: `projects/data-types-completion/slices/3/plan.md`. Briefs: `projects/data-types-completion/slices/3/briefs/`.

## Subagent IDs

- Implementer: slice 3 implementer (Opus), dispatch a rounds 1 and 2
- Reviewer: slice 3 reviewer (Opus), dispatch a rounds 1 and 2, started 2026-10-08
- Implementer and reviewer, dispatch b round 1: slice 3 implementer and reviewer (Opus)
- Reviewer, dispatch b round 2 and the merge of `main`: slice 3 reviewer (Opus), 2026-10-15

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
| b | 2 (`70d3259f29..eefeaa4e37`) | ANOTHER ROUND NEEDED: 1 must-fix, 0 should-fix, 1 low |
| merge of `main` | 1 (`4ec1b78c80`) | SATISFIED: 0 must-fix, 0 should-fix, 1 low |
| b | 3 (`71aec5b333`) | SATISFIED |
| merge of `main` | 2 (`30254c5bbb`) | SATISFIED |
| c | 1 (`5a62fd7a24..2c3c9433b3`) | ANOTHER ROUND NEEDED: 1 must-fix, 1 should-fix, 2 low |
| c | 2 (`3e3aad659b`, `b423685d38`, `e0e98b5e31`, `b309ab5499`) | SATISFIED |
| d | 1 (`a39b9eddc6..6e944edb28`, `852ab43720`) | SATISFIED: 0 must-fix, 0 should-fix, 2 low |
| e | 1 (`b98310c793..9bd0dcf9d8`) | ANOTHER ROUND NEEDED: 2 must-fix, 2 should-fix, 1 low |
| e | 2 (`4a282be61f`, `fdc8a36d82`, `2afe6e7c80`, `2337a60b33`) | ANOTHER ROUND NEEDED: 0 must-fix, 2 should-fix, 1 low |
| e | 3 (`fa38436fa6`, `046e90ed5f`, `aafdb08a4f`) | SATISFIED: 0 must-fix, 0 should-fix, 1 low |
| f | 1 (`00ae4f1b7a`, `4e946a0bd5`, `782c769471`, `32be566208`) | ANOTHER ROUND NEEDED: 0 must-fix, 1 should-fix, 1 low |
| f | 2 (`f9585eb2de`, `9ccc1727e9`, `a366259970`) | SATISFIED: 0 must-fix, 0 should-fix, 1 low |
| g | 1 (`b936882cf0..651bcfa600`) | ANOTHER ROUND NEEDED: 0 must-fix, 3 should-fix, 1 low |
| f 3 and g 2 (`ebf496d7c9`, `3456573099`, `f114359776`, `18c4b8d48c`, `c3827e5eb2`) | SATISFIED |
| h | 1 (`657d5fa989..9b50409c63`, `bfd17d10ef`) | ANOTHER ROUND NEEDED: 0 must-fix, 2 should-fix, 2 low |
| h | 2 (`520c88b861`, `6e045c0e70`, `a9312e7888`) | SATISFIED |
| branch review fixes | 1 (`75bc23f592..c6d22db5c0`, `cac31046b1`, `85ca5a3261`, `4f76bfaba3`, `b76d8431aa`) | ANOTHER ROUND NEEDED: 1 must-fix, 3 should-fix, 6 low |
| branch review fixes | 2 (`9f998ba383..4ddd7fbbb8`, `71cea6b954`) | SATISFIED: 0 must-fix, 0 should-fix, 2 low |

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

## Dispatch b, round 2

Fix commits `70d3259f29` to `0e9254eb14`; status in `eefeaa4e37`. Reviewed on 2026-10-15 at `4ec1b78c80`, after `main` was merged in.

### Orchestrator rulings for round 2

5. S3-b-R1-6 is not applicable. The ORM sends no `signal` with any query, so an include has no row signal to pass on, and adding one is a public API change. Closed.
6. S3-b-R1-3 was fixed as option (a): a SQLite value a column's codec cannot read is refused by a flat read and by an include alike. The implementer chose it; the handover accepts it.

### The round 1 findings

- S3-b-R1-1: fixed. `fromWire` reads `postgres`, `postgres_verbose`, `sql_standard` and `iso_8601` text, with unit tests per style (`session-output-styles.test.ts`), five kit cases under each non-default style, and the two `notYetCanonical` marks and the deferred line gone. A probe against PGlite stored 33 intervals once (signs mixed and single, zero, fractions, a microsecond, 178 million years) and read each under all four styles: all 132 reads equal the `iso_8601` read. The probe must store first: under `sql_standard` PostgreSQL also parses a leading sign as applying to every field, so `'-1 mon 1 day'::interval` is a different value in that session.
- S3-b-R1-2: fixed. `fromWire` reads the escape format; all 256 byte values round-trip through `bytea_output = 'escape'` in PGlite. Kit cases cover it.
- S3-b-R1-3: fixed as ruling 6 records. The blob projection is `json_array(hex(x))` only when `typeof(x) = 'blob'`, so text in a BLOB column stays text and is refused, as is a number. `sqlite-mistyped-column-include.test.ts` asserts each refusal flat and through an include. See S3-b-R2-2 for dispatch g.
- S3-b-R1-4: fixed. The test pins 24 Promises per included row as well as linear growth.
- S3-b-R1-5: fixed. The kit compares the projection with the row exactly unless a case gives `projectionEquality`; only the Temporal and `Date` cases do. The new harness test fails with a projection that changes case.
- S3-b-R1-6: closed by ruling 5.
- S3-b-R1-7: fixed. The orphaned comment is gone.
- S3-b-R1-8: fixed. The refusal names the multi-dimensional array, and an integration test pins `max` of `text[]` as an array. The `min`/`max` change is in the handover's list for dispatch g.
- S3-b-R1-9: open with the orchestrator. The handover lists the `emptyResultWire` rename for dispatch g; plan row g does not name it yet.
- S3-b-R1-10: fixed. The SQLite kit reads the projection when the driver cannot read the row, and a harness test proves a wrong projection still fails; the deferred line is added.

### S3-b-R2-1 (must-fix): three include tests still expect the error the old JSON reader gave

- Where: `test/integration/test/sql-orm-client/integer-representation.test.ts` ("reading a stored value past the safe range through an include raises RUNTIME.DECODE_FAILED", "refuses a bare sum past the safe range through the include path too") and `integer-representation-sqlite.test.ts` (the first, for SQLite). Each fails in the `packaging` and `integration` projects: 6 failures.
- What is wrong: since dispatch b an include is read with `fromWire`, so the cause is now `pg/int8number@1 value must be an integer within the safe integer range, got 9007199254740992` with `received: "9007199254740992"`, where the tests expect `... JSON value must be a decimal integer string from -9007199254740991 to 9007199254740991` and the quoted JSON as `received`. The refusal and its code are unchanged; only the text and `meta.received` differ. Neither side of the merge touched these files, so the branch has been red here since round 1, whose include filter matched only file names containing include, relation or aggregate.
- Change: update the three expected error shapes to the `fromWire` refusal, asserting the whole error as now. In later rounds run every file in `test/integration/test/sql-orm-client/`.

### S3-b-R2-2 (low, for the orchestrator): dispatch g's list misses the BLOB refusals

- Where: "Carried forward" in `slices/3/handover.md`.
- What is wrong: it names SQLite REAL and INTEGER columns holding text. Under ruling 6 a flat read of a `sqlite/blob@1` column holding text or a number now throws too; before dispatch b a number passed through and text was returned as text.
- Change: add BLOB columns holding text or a number to dispatch g's upgrade instruction.

### Checks run for dispatch b round 2

Shared with the merge review below.

## The merge of `main`, commit `4ec1b78c80`

Merge base `780a8208d7`; `main` at `94fc045c62`. 44 files needed a resolution.

### What was checked

- For each of the 44 files, `main`'s changes (`780a8208d7..94fc045c62`) were compared line by line with the merge's changes to the branch (`581bce47fd..4ec1b78c80`), and the branch's changes (`780a8208d7..581bce47fd`) with the merge's changes to `main` (`94fc045c62..4ec1b78c80`). In 17 files both sets reappear unchanged. In the rest, the only differences are `main`'s new code moved to the four codec methods, and the cases below.
- `enum-members.ts` (new on `main`): `encodeJson` becomes `dataType.toContract(toDataTypeValue(v))` and `decodeJson` becomes `readContractValue(codec, stored, undefined)`, the strict read the branch already uses for enum members in `enum-block-members.ts`. `enum-block-members.ts` keeps `main`'s diagnostics and duplicate check with the branch's stored form. The test fixtures that build codecs by hand use `dataTypeValueFor`; their `toStored` returns `String(v)` where it returned `v`, which changes nothing because every member there is a string.
- `column-defaults.ts` (moved out of `build-contract.ts` on `main`): `encodeViaCodec` is the branch's body exactly: `toDataTypeValue`, `fromDataTypeValue` as the check, `toContract`.
- `contract-types.ts`: `ColumnSpecCodecOutput` infers from `fromWire`. Mutation: with `decode` put back, `test/integration` typecheck fails in `define-contract-parity.test-d.ts`, so the parity test guards it.
- `collection-dispatch.ts`: `main`'s diff applies exactly; the include cell read stays the async `fromWire` path.
- `postgres-type-map.test.ts`: `main` deleted it with `postgres-type-map.ts` (TML-3582 moved infer to the data types). The branch's only change to it was `encode`/`decode` renamed, so no slice 3 coverage is lost.
- `sql-expression.ts`: `main`'s frozen registration with the branch's required `read`. See S3-merge-R1-1.
- `data-type-default.ts`: `main`'s message and span split with the branch's `refused-by-column` name.
- `default-fidelity.integration.test.ts`: `columnCodec` returns the codec only; the branch never used the `typeParams` it returned, and the codec is still built with them.
- `deferred.md`: the line asking to reword the `inferred` mark is dropped. `main` did that rewording (`framework-authoring.ts`, codec guide "Declaring a data type"), so the drop is right.
- No code `main` added calls `encode`, `decode`, `encodeJson`, `decodeJson`, `emptyResultJson`, `canonicalFormOf` or `readReportedValue` (diff grep over `packages/**/src`).

### S3-merge-R1-1 (low, for the orchestrator): `sql/expression`'s reader reads text that is not canonical

- Where: `sqlExpressionDataType` in `packages/2-sql/1-core/contract/src/sql-expression.ts`.
- What is wrong: ADR 268 (from `main`) makes a `sql/expression` value canonical text (`canonicalizeTaggedLiteralBody`), and ADR 254 says `fromContract` refuses any spelling other than the stored one. The reader is `readJsonString`, so `fromContract('  now()\n', {})` is accepted. Today no stored contract value reaches this reader: `sql` defaults are function defaults, and the two deprecated forms ADR 268 keeps (`.defaultSql()`, `.default({ kind: 'function', expression })`) store text uncanonicalized as function defaults.
- Change: decide before dispatch e whether the reader refuses text whose `canonicalSqlText` differs, naming the canonical text, or record why `sql/expression` is exempt.

### Checks run for dispatch b round 2 and the merge

- Root `typecheck:agent`: pass. `lint:agent`: pass. `lint:deps`: pass. `lint:framework-vocabulary`: 253 at threshold 253. `pnpm build`: pass. `pnpm fixtures:check`: pass, tree clean (`fixtures:check:agent` hits its 300-second limit on this machine; the plain script finished).
- Package tests of 24 packages (framework-components, contract-authoring, language-server, the three Mongo authoring packages, mongo-runtime, sql-contract, sql-contract-psl, sql-contract-ts, sql-contract-emitter, sql-relational-core, sql-runtime, family-sql, pgvector, arktype-json, postgis, sql-orm-client, both targets, both adapters, both codec test kits with their integration files): all pass. Two timing tests failed under load and passed when run again alone: `server.membership-races.test.ts` (500 ms limit) and `render-typescript.roundtrip.test.ts`.
- Integration: `test/planner-golden` re-recorded with `PLANNER_GOLDEN_WRITE=1`, `test/authoring` and `test/date-time-defaults`: 52 files, 1136 tests, pass, `git status` clean. All of `test/sql-orm-client/`: 132 files, 916 pass, 6 fail (S3-b-R2-1). Five other include and aggregate files (`prepared-facades`, `group_by_having`, `issues-11974`, the TML-1664 enum read and `extended-where`): pass.
- Probes against PGlite: the interval and bytea reads in S3-b-R1-1 and S3-b-R1-2.
- Must-not-change: the committed contracts, migrations, snapshots and golden manifest that differ from `main` are the same set the branch changed before the merge, and the golden re-record leaves no diff.

## Dispatch b, round 3, and the merge finding

Orchestrator rulings since round 2: S3-b-R1-9 and S3-b-R2-2 are recorded in plan row g and brief g (`cba3077b82`). S3-merge-R1-1 is ruled strict: `sql/expression`'s reader refuses text that is not already canonical.

- S3-b-R2-1: fixed in `71aec5b333`. The three tests expect the `fromWire` refusal with the whole error. `integer-representation.test.ts`, `integer-representation-sqlite.test.ts` and `connection-release.test.ts` pass; the `connection-release` failure in the implementer's run did not recur, so it was the connection timeout the implementer reported.
- S3-merge-R1-1: fixed in `30254c5bbb`. The reader refuses text whose canonical text differs, naming the canonical text, and text no `sql` literal can hold. Four tests cover the canonical text, both refusals and a value that is not text; with the old reader the two refusal tests fail.

## Dispatch c, round 1

Brief: `projects/data-types-completion/slices/3/briefs/s3-dispatch-c.md`. Range `5a62fd7a24..2c3c9433b3`.

### The brief, item by item

1. Year text: built. `isoYearText` and `postgresYearText` in `postgres-year-text.ts`. Every Temporal, text and `Date` codec's `toWire`, the Temporal codecs' `fromWire`, the type readers, the DDL default text and the Prisma 7 helper use them. `adaptPostgresEra`, `TIMESTAMPTZ_TEXT` and `encodeDate`'s own conversion are gone. The shared reader in `sql-contract` still refuses ` BC`, as it should, since the Postgres wrapper converts first. The integration test writes the seven dates through all eight codecs of `pg/date`, `pg/timestamp` and `pg/timestamptz` into PGlite and reads each back; before the change Temporal `toWire` wrote a signed year, which PostgreSQL refuses.
2. Tags: built, one entry per type, `parse` the type's existing text reader, `print` the stored form (hex text for `bytea`). The unit tests cover reading, printing back, each refusal kind the ADR lists, and reading without `Temporal` or `Date`.
3. Casts: the seven casts from `pg/text` are gone; `pg/inet` keeps its own. The integration test refuses a quoted string on each of the seven types with the tag in the message.
4. `infinity`: built for the three Temporal codecs and the `Date` codec, tested in the codec and through PSL (`PSL_INVALID_DEFAULT_LITERAL`, naming the text codec).
5. Language server: built in the `@default` spec, so parsing and completion agree. A mismatched tag now fails to parse with `PSL_VALUE_TYPE_INCOMPATIBLE`, naming the tag the column takes (`Expected date\`...\``, probe through `authorSqlContractFromPsl`); a list column given one tag still gets `PSL_DEFAULT_LIST_EXPECTED`.
6. Rewrites: the remaining quoted date defaults in Prisma 8 sources are all on SQLite, which is dispatch d, or in the deliberately old `_fixture-before-canonical-form`.

### Questions the orchestrator asked

- **Doubled backslashes.** See S3-c-R1-2. In a backtick body only `` \` `` and `\\` are escapes (ADR 129; `resolvePslBacktickEscapes`), so `` bytea`\x68656c6c6f` `` reads back unchanged.
- **Text codecs and the year text.** This matches ADR 254. Its "Codecs" section gives the text codecs PostgreSQL's text as their application value, and the ADR asks only that `fromWire` reads both year forms, which a text codec does by keeping them. `toWire` must convert, because a text codec also takes ISO text, and it does. The round trip the kits assert holds: the type reader reads ` BC` and five-digit years, so `toDataTypeValue(fromWire(...))` gives the stored value back. The ADR says none of this for text codecs; see S3-c-R1-4.
- **`dataTypeOfCodec` required.** Accepted. If it were optional, a stack that forgot it would silently offer every tag. Every real stack derives it from the codec lookup (`control-stack.ts`), so only test fixtures had to change.
- **Named type aliases.** See S3-c-R1-3.
- **Tests written after the code.** Each can fail. The language-server integration test expects `date` and `bytea` alone, which no earlier build offers. With `receives` forced to `true`, the contract-psl spec test fails (mutation run). The quoted-string refusals fail while the casts exist. The `infinity` tests fail while the codecs read it. The year-text integration test fails while Temporal `toWire` writes signed years. The language-server unit test's change only adds the new tags for a stack with no constructors; it does not test the filter, which the other two do.

### S3-c-R1-1 (must-fix): eight integration tests expect a reader message that names the codec

- Where: `test/integration/test/value-objects/value-object-defaults.integration.test.ts` (2 tests), `test/integration/test/cli-journeys/stale-contract-default-existing-tables.e2e.test.ts` (4), `stale-contract-default.e2e.test.ts` (1), `test/integration/test/uuid-defaults/uuid-defaults.integration.test.ts` (1). Each fails in the `integration` and `packaging` projects: 16 failures.
- What is wrong: since dispatch a a stored value is read by its data type, so the refusal says `pg/uuid JSON value must be ...` and `sqlite/text JSON value must be a string`, where the tests expect `pg/uuid@1 ...` and `sqlite/text@1 ...`. No slice 3 dispatch ran these files. The `uuid-defaults` enum test also receives a `sourceId` and `span` it does not expect. That probably comes from `main`'s enum diagnostics, but I did not check it against `main`.
- Change: update the expected messages, and the enum diagnostic's position. Then run every integration file whose expectations hold a codec's or a type's refusal text (`git grep -l "JSON value must be" test/`), not only the files a dispatch touches.

### S3-c-R1-2 (should-fix): the tag printer doubles every backslash

- Where: `printTaggedLiteral` in `packages/1-framework/1-core/framework-components/src/shared/tagged-literal.ts`; the rewrite-hint test in `psl-date-time-defaults.integration.test.ts`, which pins the doubled form.
- What is wrong: `contract infer` and the rewrite hint print `` bytea`\\x68656c6c6f` ``. It reads back the same, but nobody writes it that way, and this dispatch makes the doubled form routine. In a backtick body a backslash needs doubling only before another backslash or at the end of the body, where it would escape the closing backtick. The printer uses backticks only when the text has none.
- Change: double a backslash only when the next character is a backslash or it is the last character, so `\x6865` prints as written and `a\\b` prints `a\\\b`. `printedTaggedLiteralReadsBack` and the stored values do not change. A `sql` body such as `E'\n'` also prints as written. Update the tests that pin `\\`, and add a printer test for a trailing backslash and a run of backslashes that reads each back.

### S3-c-R1-3 (low): a column typed by a named type alias offers every tag

- Where: `receivingDataType` in `packages/2-sql/2-authoring/contract-psl/src/sql-attribute-specs.ts`.
- What is wrong: it knows the column's type only for a `contributedType` resolution. For a `namedType` alias it returns `undefined`, so completion offers all nine tags. Parsing then accepts any tag and the cast refuses it, so only the completion list is wrong.
- Change: resolve the alias's constructor to its codec and data type, or record the gap in `deferred.md`.

### S3-c-R1-4 (low, dispatch h): ADR 254 does not say a text codec keeps PostgreSQL's year text

- Change: dispatch h adds to "Date and time types" that a text codec's `fromWire` returns PostgreSQL's text, ` BC` and five-digit years included, and its `toWire` converts ISO text through the year-text functions.

### Checks run for dispatch c round 1

- Root `typecheck:agent`, `lint:agent` and `lint:deps` pass. `lint:framework-vocabulary` is 253 at threshold 253. `pnpm fixtures:check` passes, tree clean.
- Package tests of target-postgres, adapter-postgres, sql-contract-psl, language-server, psl-parser, framework-components, family-sql, sql-contract, sql-contract-ts, mongo-contract-psl, cli and both codec test kits: all pass.
- Integration: `test/planner-golden` re-recorded with `PLANNER_GOLDEN_WRITE=1`, `test/authoring`, `test/date-time-defaults`, every integration file the dispatch changed, `integer-representation` and `connection-release`: 1975 pass, 4 fail (`value-object-defaults`, S3-c-R1-1); `git status` clean after the re-record. `stale-contract-default*` and `uuid-defaults`: 12 fail (S3-c-R1-1); `migration-ts-column-defaults` passes.
- Probes: mismatched and list tag diagnostics through `authorSqlContractFromPsl` (item 5), with the probe file deleted afterwards; the tag-filter mutation.
- Must-not-change: no committed `contract.json`, `contract.d.ts`, migration, snapshot or golden recording changed.

## Dispatch c, round 2

S3-c-R1-4 is recorded in brief h.

- S3-c-R1-1: fixed in `3e3aad659b`. The four files now expect refusals that name the data type. The `uuid-defaults` assertion uses `objectContaining`, so the source and span I reported were only in the diff display, not a difference. All pass.
- `b423685d38`: a default on a column declared with a named type now reads under the named type's parameters (`resolvedTypeParams`), tested with `Numeric(65, 30)`. I swept for the same defect: code that reads a column's parameters from its own constructor and misses a named type's. Every other reader resolves the parameters first: contract-ts `lower-column.ts`, the emitter, `codec-ref-for-column.ts`, `contract-to-schema-ir.ts`, and Postgres `psl-print`. `field-event-planner.ts` compares `typeRef` and `typeParams` as written, so it cannot miss a change. Mongo PSL refuses named types outright. A value-object member declared with a named type already took its parameters: a probe with `types { Money = Numeric(10, 2) }` gave the same diagnostics for `amount Money` as for `amount Numeric(10, 2)`.
- S3-c-R1-2: fixed in `e0e98b5e31`. A backslash is doubled only before another backslash or at the end of the body. Tests cover a trailing backslash, runs of two and three backslashes, and a multi-line body ending in a backslash, and each reads back unchanged.
- S3-c-R1-3: fixed in `b309ab5499`. `FieldAttributeSpecContext.typeConstructor` resolves through a named type, and the binder, the language server, contract-psl and the Mongo interpreter set it. A spec test and the language-server integration test cover an alias.

## Dispatch d, round 1

Brief: `projects/data-types-completion/slices/3/briefs/s3-dispatch-d.md`. Range `a39b9eddc6..6e944edb28`, plus `852ab43720`.

### Orchestrator rulings for dispatch d

1. The committed SQLite contracts are regenerated in this dispatch rather than left failing until dispatch g.

### The brief, item by item

1. `storedAs`: built. `sqlDataType` refuses a type that has `storedAs` together with texts or a claimed kind, when the type is declared, which is earlier than assembly. Assembly refuses a `storedAs` that names an unregistered type. Both are tested.
2. The two types: built, with strict readers. The codec-level `toCanonicalForm` and `CodecDescriptor.toCanonicalForm` are gone, and `sqlite/text` casts from neither type.
3. The `datetime` tag: built. A quoted string on a `DateTime` column is refused with the tag to write.
4. The `json` entry sits under `sqlite/json`. `tagEntryKey`, `isTagEntryKey`, `authoringEntryType`, the entry's `type` field and the assembly rule are all gone.
5. The value-object column: the SQLite adapter's `valueObjectStorageType` is `Json`, whose codec now represents `sqlite/json`. `contract-stack-checks.ts` compares codecs, so it needed no change.
6. The planner's change detection and the join check compare what each column is stored as. A planner test fires no `altered` event for `sqlite/text` changing to `sqlite/datetime`, and a validator test accepts the join.
7. DDL and verify are unchanged. Against `node:sqlite`, the adapter test creates the table with both new columns through the planner (both written `TEXT`), reads it back as `text`, and verifies it clean. The golden planner re-record leaves no diff.
8. The committed contracts are regenerated, per ruling 1.

### The implementer's choices

- `sqlite/datetime` and `sqlite/json` keep a type-level `toCanonicalForm` until dispatch e: accepted. Dispatch c kept it on the Postgres types for the same reason, and verify still depends on it. Against `node:sqlite`, a table created before this slice with `DEFAULT '2024-01-01T00:00:00Z'` verifies clean against a contract that stores `2024-01-01T00:00:00.000Z` (probe, reverted). See S3-d-R1-2.
- A `sqlite/json` enum member written in another spelling is refused, naming the stored text: accepted. A PSL enum member is read as a stored value, as for `pg/uuid` members written in upper case.
- `unquotedSqlBaseNameOfCodec` gives the name of the type a column is stored as: accepted. Its callers write DDL or compare it with the catalog, and the one outside DDL (the Prisma 7 reader) runs on Postgres, where no type is stored as another.
- The hand-edited `packages/3-targets/3-targets/sqlite/test/fixtures/sqlite-contract.json` and its `.d.ts`: correct. Only the two `dataType` fields and the hash change; the fixture has no datetime or JSON default. I recomputed the storage hash with `computeStorageHash` and `sqlContractCanonicalizationHooks`, first checking the method on the file before the edit, where it reproduces the old hash. It gives `1156c66d9347…` for the edited file, which matches what is committed. The emitted SQLite example and the golden fixture also match their hashes.

### S3-d-R1-1 (low): SQLite fill values are keyed by codec for the two new types

- Where: `CODEC_FILL_VALUES` in `packages/3-targets/3-targets/sqlite/src/core/migrations/planner-fill-values.ts`.
- What is wrong: a new required column gets `'1970-01-01T00:00:00.000Z'` or `'{}'` only when its codec is `sqlite/datetime@1` or `sqlite/json@1`. Now that both are data types, another codec of either type gets no fill value at all, not even the `''` a `sqlite/text` column gets.
- Change: key the two values by `sqliteDatetime.id` and `sqliteJson.id` in `DATA_TYPE_FILL_VALUES`.

### S3-d-R1-2 (low, for dispatch e): the verify test does not cover a datetime default written in the earlier spelling

- Where: "verifies integer and JSON defaults written in their earlier stored form" in `packages/3-targets/6-adapters/sqlite/test/migrations/data-type-verify.test.ts`.
- What is wrong: its datetime column uses the new spelling `.000Z`. A database created before this slice holds `'2024-01-01T00:00:00Z'`. That verifies today only through the type-level `toCanonicalForm`, which dispatch e deletes.
- Change: write the datetime default there as `'2024-01-01T00:00:00Z'`, so dispatch e must keep it verifying through `fromWire`.

### Checks run for dispatch c round 2 and dispatch d round 1

- Root `typecheck:agent`, `lint:agent` and `lint:deps` pass. `lint:framework-vocabulary` is 253 at threshold 253. `pnpm fixtures:check` passes, tree clean.
- Package tests of target-sqlite, adapter-sqlite, sqlite-codec-testkit, sql-contract-psl, framework-components, sql-contract, family-sql, psl-parser, language-server, mongo-contract-psl, target-postgres, sql-contract-ts, cli, sql-contract-emitter and adapter-postgres: all pass.
- Integration: `test/planner-golden` re-recorded with `PLANNER_GOLDEN_WRITE=1` with no diff. `test/authoring`, `test/date-time-defaults`, `test/value-objects`, `stale-contract-default*`, `uuid-defaults`, `migration-ts-column-defaults`, `bytea-defaults`, `enum-members`, `contract-parity`, `psl-print` and `scalar-lists`: 109 files, 2134 tests, pass. `test/e2e` SQLite files: 12 files, 92 tests, pass.
- Probes: the value-object named-type defaults (temporary file, deleted); the earlier-spelling datetime default (test edit, reverted); the storage hashes.
- Must-not-change: no Postgres contract or DDL changed; SQLite DDL is unchanged.

## Dispatch e, round 1

Brief: `projects/data-types-completion/slices/3/briefs/s3-dispatch-e.md`. Range `b98310c793..9bd0dcf9d8`; `efdcad699a` holds only deletions and does not build on its own, so it is reviewed together with `ed8a68c476`.

### Orchestrator rulings for dispatch e

1. The golden manifest's one change, where `_fixture-before-canonical-form/emitted-before` now records the load refusal instead of DDL, is not the halt condition: no DDL text changed. I agree. Re-recording leaves no diff, and that fixture stores date and time defaults in spellings from before the canonical form (`.000Z`, `+01:00`, `12:34`, a space separator), which item 1 refuses. See S3-e-R1-5 for brief g.

### Earlier findings

- S3-d-R1-1: fixed in `b98310c793`. Fill values are keyed by data type, with an execution test for another codec of each type.
- S3-d-R1-2: fixed in `ed8a68c476`. The verify test writes the datetime default as `'2024-01-01T00:00:00Z'` and it verifies through `fromWire`.

### The questions the orchestrator asked

- **An expression default that writes a literal.** Sound. Introspection extracts the expression's literal with the same strict patterns it uses for a reported default (anchored; a quoted, escape-string, number or parenthesised number literal with an optional cast), reads it with the column's codec, and compares the two values. Anything with an operator or a function call is not read as a literal, so `` sql`'2024-01-01'::date + 1` `` cannot falsely match a literal `2024-01-01`. It compares equal what the old `postgresResolveDefault` compared equal on the cases I traced (`'hello'::bytea` against PostgreSQL's hex, `'{}'::jsonb`, a numeric with trailing zeros, a timestamp with an offset). An expression whose literal the codec cannot read falls back to comparing text, as the old code compared a refused value. I did not test every expression the old per-type parser read.
- **Callers of introspection.** Every caller that plans or verifies passes the contract: `client.ts` verify, the `db-verify` operation, `db-run` for `db init` and `db update` (through `collectAggregateNamespaces`, which now carries each space's contract), and both targets' runners. Only `client.introspect` passes no contract, and its callers are `db schema`, which only displays, and `contract infer`. The test harness helpers pass it too.
- **`parseInferredDefault`.** It uses no deleted name: it imports the tag readers (`pgDateCanonical` and the rest) and `canonicalUuid`, which remain. Brief f does not remove it; see S3-e-R1-4.
- **`.500Z` from the `Date` codec.** PostgreSQL reads `.5Z` and `.500Z` as the same `timestamptz`. The Postgres journey's `jsDate` column (`.5Z`) verifies clean. Re-recording the golden test changes nothing, and `fixtures:check`, which regenerates the example migrations, leaves the tree clean.
- **`db verify` and `db sign` messages.** An unreadable database default is a `mismatch` at `public/<table>/<column>/default`, explained as "The column codec `<id>` cannot read the default the database reports, `<raw text>`: `<codec message>`". It offers `db update` or changing the contract source. That names the column and says what to do.
- **TML-3406's subject.** `contractDefaultRefusal`, `inCanonicalForm` and `plannableDefault` are gone from `packages/` (`git grep`). The slice 3 grep check in the project plan now finds only `storedTemporalText`, which is dispatch f's, and `SQLITE_DATETIME_CODEC_ID` where the codec is defined and used. It also matches Mongo's `encodeJsonValue` and `decodeJsonValue`, because the pattern has no word boundary; dispatch h should tighten it.
- **The two journeys.** Each checks a clean verify and then exactly one drifted column. See S3-e-R1-3 for coverage.

### S3-e-R1-1 (must-fix): seven integration tests fail

- Where:
  - `test/integration/test/cli-journeys/stale-contract-default-existing-tables.e2e.test.ts` (4 tests);
  - `stale-contract-default.e2e.test.ts` (2 tests);
  - `test/integration/test/psl-print/every-postgres-contract-roundtrip.integration.test.ts`, for `_fixture-before-canonical-form/emitted-before/contract.json`.

  Each fails in the `integration` and `packaging` projects: 14 failures.
- What is wrong:
  - The stale-default journeys expect `CONTRACT.DEFAULT_INVALID` with meta naming the table and column. Item 1 now refuses the contract at load with `CONTRACT.VALIDATION_FAILED`, `meta: undefined` and the summary "Contract validation failed". The table and column appear only in the `why` text, as a storage path (`storage.namespaces.public.entries.table.Token.columns.added`), and the space is not named.
  - `contract print` now refuses the old fixture's `.000Z` default, where it used to normalise it.
- Change:
  - Update the journeys to the load refusal. Give the refusal meta naming the space, table and column, as item 1 asks, so the CLI can show them.
  - Have the round-trip test expect the refusal for the deliberately old fixture, or leave that fixture out.
  - In later rounds run every integration file that loads a stored contract default (`git grep -l "DEFAULT_INVALID\|stale-contract\|_fixture-before-canonical-form" test/`).

### S3-e-R1-2 (must-fix): invalid type parameters are now reported as a refused default

- Where: `defaultProblems` in `packages/2-sql/9-family/src/core/contract-stack-checks.ts`; the test "reports type parameters the data type refuses as a contract error, not an unexpected one" in `stale-contract-default.e2e.test.ts`.
- What is wrong: a contract with `varchar(0)` used to be refused with `CONTRACT.TYPE_PARAMS_INVALID: pg/varchar: length must be at least 1 (was 0)`. Now the default check runs first and reads the default under the invalid parameters. It reports "the default "abc" is not a value of pg/varchar: ... a string of at most 0 characters", which blames the default for a fault in the parameters.
- Change: check a column's parameters against its type before reading its default, and skip the default when the parameters are refused, so the parameter error is the one reported. Keep the test's expectation.

### S3-e-R1-3 (should-fix): the journeys leave out some built-in types and codecs

- Where: `defaults-read-by-codec.e2e.test.ts` and `defaults-read-by-codec.sqlite.e2e.test.ts` in `test/integration/test/cli-journeys/`.
- What is wrong:
  - The Postgres journey has no column of `pg/enum`, a built-in type with a codec whose defaults PSL writes.
  - The codecs read reported defaults one by one, but `BigIntNumber` (`pg/int8number@1`) and `UnboundedInt` (`pg/unboundedint@1`) are missing, though their types are covered.
  - The SQLite journey has no `Char` or `VarChar` column (`sqlite/character`, `sqlite/character-varying`), if the SQLite stack offers those constructors.
- Change: add a native enum column with a default, the two integer codecs, and the SQLite character types where PSL can write them.

### S3-e-R1-4 (should-fix, for the orchestrator): brief f's infer item rests on two false premises

- Where: item 4 of `projects/data-types-completion/slices/3/briefs/s3-dispatch-f.md`.
- What is wrong:
  - It says dispatch e's introspection already gives `contract infer` a value. It does not: infer introspects without a contract, so a literal default keeps its raw text, and `parseInferredDefault` (`packages/3-targets/3-targets/postgres/src/core/psl-infer/infer-default-parser.ts`) reads it type by type.
  - It says dispatch e removed `readReportedValue`'s last caller. `infer-default-codec.ts` still calls it.
- Change: brief f deletes `parseInferredDefault` and `infer-default-parser.ts`, reads each reported literal with the codec of the inferred constructor (`fromWire`, then `toDataTypeValue`), and removes the `readReportedValue` call and the function.

### S3-e-R1-5 (low, for the orchestrator): brief g does not name date and time defaults stored before the canonical form

- Where: item 3 of `projects/data-types-completion/slices/3/briefs/s3-dispatch-g.md`.
- What is wrong: it names spellings that differ from what a column's parameters give. A Postgres contract emitted by a release before the canonical form can also store `"2024-01-01T00:00:00.000Z"`, `"2024-01-01T01:00:00+01:00"` or `"12:34"`, which the contract load now refuses.
- Change: add these to the Postgres paragraph, with the same fix: `contract emit`, then `db sign`.

### Checks run for dispatch e round 1

- `pnpm build`, root `typecheck:agent`, `lint:agent` and `lint:deps` pass. `lint:framework-vocabulary` is 253 at threshold 253. `pnpm fixtures:check` passes, tree clean.
- Package tests of sql-schema-ir, family-sql, both targets, both adapters, cli, framework-components, sql-contract, sql-contract-psl, migration-tools, pgvector, postgis, mongo-contract, both codec test kits, sql-contract-ts and sql-relational-core: all pass.
- Integration: `test/planner-golden` re-recorded with `PLANNER_GOLDEN_WRITE=1` with no diff. `test/authoring`, `test/date-time-defaults`, both new journeys, `uuid-defaults`, `value-objects`, `enum-members`, `scalar-lists`, `sql-builder`, `bytea-defaults`, `date-time-default-canonical-form`, `migration-ts-column-defaults`, the `infer-roundtrip-fidelity` files and `psl-print`: 174 files, 2493 pass, 14 fail (S3-e-R1-1 and S3-e-R1-2).

## Dispatch e, round 2

### Orchestrator rulings for round 2

2. S3-e-R1-4 and S3-e-R1-5 are fixed in briefs f and g, and the grep word-boundary note is in brief h (`647c0b0d45`). Closed.
3. "Space" in item 1 means the storage namespace, because the family does not know which contract space it is deserializing.

### The round 1 findings

- S3-e-R1-1: fixed in `fdc8a36d82`. The load refusal names the namespace (left out for SQLite's unbound one), the table and the column, and carries `meta.refusedDefaults`. The stale-default journeys expect it from `db init`, `db update` and `migration plan`, and the round-trip test expects it for the contract emitted before the canonical form.
- S3-e-R1-2: fixed in `4a282be61f`. A column whose parameters its type refuses has its default skipped, so `varchar(0)` is reported as `CONTRACT.TYPE_PARAMS_INVALID` again. The journey test that asserts this passes.
- S3-e-R1-3: fixed for Postgres in `2afe6e7c80` (a native enum, `BigIntNumber`, `UnboundedInt`). The commit says SQLite has no `Char` or `VarChar` PSL constructor. That holds for `Char`, but the SQL family's `sql.String(n)` is registered for every SQL target. On SQLite it authors a `sqlite/character-varying` column with codec `sql/varchar@1` and a default (probe through `authorSqliteContractFromPsl`, deleted afterwards). See S3-e-R2-1.
- `2337a60b33`: the golden manifest's one entry changes for the reworded refusal. A fresh re-record leaves no diff.

### Whether `meta` reaches the user

Every command that loads the app's emitted contract passes `meta.refusedDefaults` on: `db init`, `db update`, `db sign`, `db verify`, `db migrate`, `migration plan`, `migration show`, the snapshot types render, and the control client's verify, init, update and migrate. Three paths drop it. See S3-e-R2-2.

### S3-e-R2-1 (should-fix): the journeys leave out `sql.String(n)`

- Where: both journeys in `test/integration/test/cli-journeys/`.
- What is wrong: the family constructor `sql.String(n)` uses codec `sql/varchar@1`. On SQLite it is the only PSL path to `sqlite/character-varying`, a built-in type with a codec. On Postgres it is a second codec of `pg/varchar`. Neither journey has it, and reported defaults are read codec by codec.
- Change: add `code sql.String(10) @default("vc")` to both journeys.

### S3-e-R2-2 (should-fix): `meta` is lost when the refused contract is not the app's emitted contract

- Where:
  - `mapContractAtError`, case `MIGRATION.CONTRACT_DESERIALIZATION_FAILED`, in `packages/1-framework/3-tooling/cli/src/control-api/operations/contract-at-errors.ts`. The migration tools raise this case when a predecessor or snapshot contract fails to load (`createContractDeserializationFailed`, `meta: { filePath, message }`). The mapping builds `errorContractValidationFailed` with no `meta`.
  - `migration new` (`migration-new.ts`, around line 99), which wraps a refused contract as `MIGRATION.CONTRACT_DESERIALIZATION_FAILED` with only `cause`.
  - `migration check` (`migration-check.ts`, around line 380), which catches any load error and reports no integrity violations. This predates the dispatch, but a contract refused for its default now passes there silently.
- What is wrong: a migration snapshot or predecessor contract with a stale default is the case dispatch g's upgrade must cover. Here the user gets the refusal text but not `refusedDefaults`, and `migration check` says nothing.
- Change:
  - Carry `contractValidationMeta(cause)` through `createContractDeserializationFailed` and `mapContractAtError`, and through `migration new`'s error.
  - Have `migration check` report a contract it cannot load rather than return no violations.
  - Test one snapshot case.

### S3-e-R2-3 (low): the shape of `meta.refusedDefaults` differs from neighbouring errors

- Where: `RefusedDefault` in `packages/2-sql/9-family/src/core/contract-stack-checks.ts`.
- What is wrong:
  - It uses `namespace`. The contract builder's column errors use `namespaceId` (`columnSiteMeta`), and `namespaceId` is the more common key in `meta` across `packages/` (25 uses against 11).
  - `reason` holds prose. Elsewhere `reason` in `meta` is a kebab-case code (about 120 uses), including `'codec-refused-default'` on the `CONTRACT.DEFAULT_INVALID` error this refusal replaces.
- Change: rename to `namespaceId`, put the prose in `message`, and set `reason: 'type-refused-default'`.

### Checks run for dispatch e round 2

- `pnpm build`, root `typecheck:agent`, `lint:agent` and `lint:deps` pass. `pnpm fixtures:check` passes, tree clean.
- Package tests of family-sql, cli, contract, errors and migration-tools: all pass.
- Integration: `test/planner-golden` re-recorded with `PLANNER_GOLDEN_WRITE=1` with no diff. `test/authoring`, `test/date-time-defaults`, both default journeys, `stale-contract-default*`, `psl-print` and `uuid-defaults`: 78 files, 1986 tests, pass.

## Dispatch e, round 3

- S3-e-R2-1: fixed in `fa38436fa6`. Both journeys write `sql.String(10)`, and the Postgres journey keeps `VarChar(10)` beside it.
- S3-e-R2-3: fixed in `046e90ed5f`. Each entry is `{ namespaceId, table, column, dataType, value, message, reason: 'type-refused-default' }`.
- S3-e-R2-2: fixed in `aafdb08a4f`.
  - The migration tools keep `refusedDefaults` on `MIGRATION.CONTRACT_DESERIALIZATION_FAILED`, and the aggregate passes the family's error as the cause.
  - `mapContractAtError` and `migration new` pass the meta on.
  - `migration check` reports a contract the family refuses instead of swallowing the error.

  Is the test coverage enough without a stale snapshot in a journey? Nearly. The unit tests cover building the error, mapping it, and `migration check`, and a journey runs `migration check` on a stale emitted contract. A journey cannot easily make a snapshot stale without also rewriting its content hash, and it adds little beyond a unit test. One link is untested: passing `{ cause: error }` from `deserializeContractAtPath` in `packages/1-framework/3-tooling/migration/src/aggregate/aggregate.ts`. Removing that argument leaves every test green. See S3-e-R3-1.

### S3-e-R3-1 (low): no test covers the aggregate passing the refusal on as the cause

- Where: `deserializeContractAtPath` in `packages/1-framework/3-tooling/migration/src/aggregate/aggregate.ts`.
- Change: a migration-tools unit test that loads an aggregate whose `deserializeContract` throws a `ContractValidationError` with `refusedDefaults` for a snapshot, and expects that meta on the thrown error.

## Dispatch f, round 1

Brief: `projects/data-types-completion/slices/3/briefs/s3-dispatch-f.md`. Commits `00ae4f1b7a`, `4e946a0bd5`, `782c769471` (does not build alone) and `32be566208`.

### What was checked

- **The 27 fixture values and the golden DDL.** I put the three earlier expected contracts back in the working tree, recorded the golden output, restored them, and recorded again, then compared the two recordings. The only differences are the `CREATE TABLE` lines of `Scalars`, `Defaults` and `Lists`, and within them only the 27 date, time and bytes columns. Each was an expression default before: a bare quoted literal such as `('2024-01-02 03:04:05')`, or `(ARRAY[...]::TIMESTAMP(3)[])`. Each is now a literal cast to the column type, or `'{}'` for an empty list. I ran both versions of each table in PGlite with `TimeZone = 'America/New_York'` and inserted a row of defaults: all 42 compared columns hold the same value in both versions. Re-recording the golden test now leaves no diff, and no other contract changed.
- **The two raw-expression checks infer keeps.** Both are right to keep. A `json` or `jsonb` document whose numbers lose digits when read into JavaScript numbers would print as a different document, and the read-back proof cannot see it, because the codec has already lost the digits. A list with an SQL NULL element, on a type that has its own `null` value (JSON), would print `null` as that type's null, which reads back as a different value.
- **Async infer.** Consistent. `inferPslContract` returns a promise in the framework capability, the family instance, the target-descriptor hook, the control client, the fixture client and the CLI's `contract infer`, which awaits it. The remaining callers are tests and the Supabase generation script, and root `typecheck:agent` passes.
- **The work on `main` for `contract-prisma7`.** The local `bot/main` ref (2026-10-15 19:32 UTC, not fetched again) has no commit touching `contract-prisma7` after the merged `main`. "Storage a model does not map" has nothing on that ref yet. This dispatch changed only `defaults.ts`, `target-binding.ts` and the README in that package. The tests of `main`'s earlier work (`@ignore` keeps storage, mixins, cross-namespace enums) pass.
- **Deleted names.** `storedTemporalText`, `readReportedValue`, `parseInferredDefault` and `infer-default-parser.ts` are gone from `packages/`.

### S3-f-R1-1 (should-fix, the orchestrator decides): infer prints a numeric default at the column's full scale

- Where: the number entry's `print` (`printNumber` in `packages/3-targets/3-targets/postgres/src/core/data-type-entries.ts`), as infer and print use it.
- What is wrong: before this dispatch, `contract infer` printed `@default(-0.5)` and `@default(1.50)` for a `Numeric(65, 30)` column. It now prints `@default(-0.500000000000000000000000000000)`. ADR 254 "Printing" has no rule for the shortest text. It requires only that the printed text reads back, through `parse` and the cast, to the stored value. When PSL lowers `@default(-0.5)` on that column, `withParams` writes the same stored value, so the short text meets that rule too.
- Change: I recommend printing the shortest text that reads back to the stored value under the column's parameters. That means dropping trailing fraction zeros that `withParams` adds back. The printer keeps its read-back proof, so nothing unsafe can print. The output is what a person would write, and it matches what infer printed before. This needs the column's parameters at print time, so it is a choice for the orchestrator, not a defect.

### S3-f-R1-2 (low, for the orchestrator): more Prisma 7 `DateTime` defaults are refused than the commit says

- Where: the Prisma 7 reader's `DateTime` default, through the tag and `withParams`.
- What is wrong: the commit says a default with seven or more fraction digits, or second 60, is now refused. A probe through `interpretSchemaText` shows a wider set: any fraction digits beyond the column's precision are refused too. That includes `"2024-01-02T03:04:05.1234Z"` on a plain `DateTime`, which Prisma 7 maps to `timestamp(3)`. Prisma 7 itself writes the text into the DDL and PostgreSQL rounds it to the column's precision, and the old reader reproduced that rounding. Refusing is consistent with ADR 254: a Prisma 7 default and the same default written in Prisma 8 store the same value, and Prisma 8 refuses a value it would have to round. But the messages do not say what PostgreSQL stored. The seven-digit case says "Round it" with an unrelated example, and the four-digit case names `pg/timestamp-string@1`.
- Change: the refusal names the value PostgreSQL stores for the written text, so the user can write that into the schema. Dispatch g's upgrade text lists the case.

### Checks run for dispatch e round 3 and dispatch f round 1

- `pnpm build`, root `typecheck:agent`, `lint:agent` and `lint:deps` pass. `lint:framework-vocabulary` is 253 at threshold 253. `pnpm fixtures:check` passes, tree clean.
- Package tests of sql-contract-prisma7, target-postgres, family-sql, cli, framework-components, pgvector, postgis, migration-tools, adapter-postgres and supabase: all pass.
- Integration: `test/planner-golden` re-recorded with `PLANNER_GOLDEN_WRITE=1` with no diff. `test/authoring`, `test/date-time-defaults`, every `infer-roundtrip-*` file, `infer-roundtrip-runtime`, `native-enum-adoption`, `prisma7-source` (journey and directory), `psl-infer`, `scalar-lists`, `psl-print`, `stale-contract-default*`, both default journeys, `brownfield-infer` and `infer-cross-space-fk`: 122 files, 2170 tests, pass.
- Probes:
  - The golden recordings of the three Prisma 7 fixtures before and after, compared in PGlite.
  - Prisma 7 `DateTime` defaults with extra precision, through a temporary test file, now deleted.

## Dispatch f, round 2

The orchestrator deferred the `time` midnight case (`24:00:00`) in `deferred.md`.

- S3-e-R3-1: fixed in `f9585eb2de`. A migration-tools test loads an aggregate whose snapshot the family refuses and expects `refusedDefaults` on the error.
- S3-f-R1-1: fixed in `9ccc1727e9`. Infer and print try the number without its trailing fraction zeros first, keep it only when it reads back as the stored value under the column's parameters, and otherwise print the stored text. The read-back proof is unchanged. See S3-f-R2-1 for one path where the parameters are missing.
- S3-f-R1-2: fixed in `a366259970`. The refusal names the value PostgreSQL stores. I checked all eleven rounding cases in the unit test against PGlite (`::timestamp(3)`, `::timestamptz(3)`, `::timestamptz(6)`, `::time(0)`, `::timetz(1)`, `::timestamp(2)`), including the tie at PostgreSQL's 2000-01-01 epoch, a year before it, and an offset: each named value equals what PostgreSQL stores. For a `time` or `timetz` column the message names the full Prisma 7 text (`2024-01-02T03:04:06+02:00`), the form the user writes in that schema.

### S3-f-R2-1 (low): `contract print` cannot shorten a number default on a column declared with a named type

- Where: `buildColumnDefault` in `packages/3-targets/3-targets/postgres/src/core/psl-print/column-defaults.ts`, which passes `input.column.typeParams`.
- What is wrong: a column declared through `types { Money = Numeric(10, 2) }` has a `typeRef` and no `typeParams` of its own. Print then reads the short text under no parameters, it does not read back, and print falls back to the full stored text. The output is correct but not the shortest, and it is the same class as `b423685d38`.
- Change: pass `resolvedTypeParams(input.column, storage.types)`.

## Dispatch g, round 1

Brief: `projects/data-types-completion/slices/3/briefs/s3-dispatch-g.md`. Range `b936882cf0..651bcfa600`; proof in `wip/s3/proof/`.

### Orchestrator rulings for dispatch g

1. `b3d212401e`: the golden DDL for Prisma 7 `Decimal` defaults written with the column's full scale (`'1.5'` becomes `'1.500000000000000000000000000000'` on `numeric(65,30)`) is allowed. Checked:
   - In PGlite, all nine padded defaults in the Prisma 7 golden recordings equal the short text as `numeric(65,30)`, both as text and with `=`: `-1.5`, `-0`, `0.000000000000000001`, `00.10`, `1.50`, `12.34`, `12345678901234567890.123456789`, `42`, `007`.
   - For each, `pgNumeric.withParams` under `{ precision: 65, scale: 30 }` gives exactly the padded text, as dispatch a's rule requires.
   - No golden manifest entry changed in this range.

### The questions the orchestrator asked

- **Can the script's tests fail?** Yes, every one.
  - The main test compares the whole tree, `stdout` and `stderr` with the `after` fixture. Another test runs the script twice and expects nothing to change. Others cover a leftover temporary file, a project already upgraded, a Postgres contract the script must leave alone, an occupied snapshot directory, an invalid `migration.json`, and an unknown option.
  - The `after` fixture was written by the script itself, so the main test alone would be circular. Two things break that circle. The live test recomputes the `after` fixture's contract, snapshot and migration hashes with the framework, and loads the contract with this release's family, which refuses a non-canonical datetime default since dispatch e. And the repository proof compares the script's output with regenerated contracts.
- **The proof.** Acceptable under the skill. "Validation by execution" in `record-upgrade-instructions` compares `examples/` byte for byte, outside test folders. The one example the slice changes, `examples/prisma-8-demo-sqlite`, is equal in both `contract.json` and `contract.d.ts`. The two files that differ only in formatting are test fixtures in `packages/` and `test/integration/`, outside what the rule compares. For a user's own files, "run your formatter" is the right instruction. Two of the skill's steps are not recorded, though; see S3-g-R1-3.
- **Slice 2's upgrade fixtures.** Unchanged. `git diff 94fc045c62 HEAD -- test/integration/test/upgrade-instructions/data-type-in-contract` is empty. The script rewrote them only in the proof copy, which is the case S3-g-R1-1 asks the text to warn about.
- **The extension text.** Each "after" sample matches the branch:
  - The `PgVectorCodec` constructor, `toWire`, `fromWire`, `fromDataTypeValue` and `toDataTypeValue` match `packages/3-extensions/pgvector/src/core/codecs.ts`.
  - The vector reader matches `data-types.ts`.
  - The geometry `factory` matches `postgis/src/core/codecs.ts`.
  - `DataTypeValue`, `DataTypeReader`, `refuseJsonValue` and `CodecImpl` are exported from `@prisma/orm-framework/components/codec` (built `components__codec.d.mts`), and `DataTypeReader` is `(json, params) => JsonValue`.
  - The samples elide generics with `/* … */` and use helpers they do not define (`isFiniteNumber`, `parseVector`), so they show the change rather than compile on their own. For a guide that is fine.
- **The application text, read as a user.** I checked each message it quotes against the branch:
  - `Expected timestamptz`...`; write timestamptz`2024-01-01T00:00:00Z``, the SQLite `datetime` message, the `time` message, and the bytes message (`"AQID"` gives `Expected bytea`...``) all match.
  - The `pg/numeric` load refusal and the Prisma 7 `DateTime` message match.
  - The SQLite script steps, the order (script, `contract emit`, `db sign`) and the `db sign` section can be followed.

  Three gaps follow.

### S3-g-R1-1 (should-fix): the script's section does not warn that it rewrites old-format test fixtures

- Where: `## sqlite-contracts-name-datetime-and-json-data-types` in `upgrade-instructions/pending/data-type-values/app/instructions.md`.
- What is wrong: the script rewrites every SQLite contract in the previous release's form under the root, and that includes a test fixture kept old on purpose. The proof run did exactly this to slice 2's upgrade fixtures. Slice 2's published guide warns about it and says to restore such a fixture with `git restore`. This one does not.
- Change: add slice 2's sentence: a test fixture of an old-format contract is rewritten too; if you keep one on purpose, restore it with `git restore <file>` or keep it outside the project root.

### S3-g-R1-2 (should-fix): "The schema does not change" is wrong for some of the Postgres cases

- Where: `## postgres-defaults-stored-in-another-spelling`.
- What is wrong: `contract emit` fixes a stored spelling only where the schema's default already reads to a value the column holds. Two kinds of earlier default emit now refuses, so the schema must change:
  - A default with more fraction digits than its column holds. `Time(3) @default(time`12:34:56.1234`)` gives `pg/time JSON value must be a value with at most 3 fraction digits of a second, which precision 3 holds without rounding`, and `Numeric(10, 2) @default(1.234)` gives `... a decimal string that numeric(10, 2) stores without rounding` (probe, deleted). The fraction-digit limit applies to every type with a precision, `timestamp`, `timestamptz` and `interval` too, not only `time`.
  - A date or time default written as a quoted string, which the tags section requires the user to rewrite.
- Change:
  - Say that a default the column cannot hold without rounding is refused by `contract emit` with that message, and that the user writes the rounded value, as PostgreSQL stores it.
  - Widen "a time default" to every date and time type with a precision.
  - Point the quoted-date case at the tags section, which is to be done before `contract emit`.

### S3-g-R1-3 (should-fix): two steps of the skill's validation by execution are not recorded

- Where: `wip/s3/proof/notes.txt`; "Validation by execution" in `skills-contrib/record-upgrade-instructions/SKILL.md`.
- What is wrong:
  - The proof covers the app entry's file equality. It does not record step 6, the touched example's tests (`examples/prisma-8-demo-sqlite`).
  - It does not record the extension entry. The skill restores `packages/3-extensions/` to the base, applies the extension text to it, and compares with the head outside test folders. The slice changed ten source files there: pgvector, postgis and arktype-json codecs and data types, plus sql-orm-client and the Supabase script. The notes say only "their changes are code, covered by the instruction text".
- Change: run the example's tests. Apply the extension text to the base's pgvector, postgis and arktype-json sources, then record the comparison with the head and the extensions' test results. If the orchestrator rules that sql-orm-client's and Supabase's internal changes need no consumer instruction, record that ruling in the notes.

### S3-g-R1-4 (low): the bytes sentence in the tags section is too broad

- Where: "For bytes, the message names only the tag" in `## date-time-interval-and-bytes-defaults-use-tags`.
- What is wrong: that is true for base64 text (`"AQID"`). For a quoted string already in hex (`"\\x0102"`), the message names the full rewrite: `Expected bytea`...`; write bytea`\x0102``.
- Change: "For bytes written in base64, the message names only the tag."

### Checks run for dispatch f round 2 and dispatch g round 1

- `pnpm build`, root `typecheck:agent`, `lint:agent` and `lint:deps` pass. `check:upgrade-coverage --mode pr --prev bot/main --head HEAD` passes. `pnpm fixtures:check` passes, tree clean.
- Package tests of sql-contract-prisma7, target-postgres, family-sql and migration-tools: all pass.
- Integration: `test/planner-golden` re-recorded with `PLANNER_GOLDEN_WRITE=1` with no diff. `test/upgrade-instructions` (the script's tests and slice 2's), `psl-infer`, `psl-print`, every `infer-roundtrip-*` file, `prisma7-source` (directory and journey), `date-time-defaults` and `authoring`: 120 files, 2262 tests, pass.
- Probes:
  - The Prisma 7 rounding cases and the padded decimals, in PGlite.
  - `withParams` for the padded decimals.
  - The messages the application text quotes, through a temporary test file, now deleted.

## Dispatch f, round 3, and dispatch g, round 2

- S3-f-R2-1: fixed in `ebf496d7c9`. Print resolves a named type's parameters (`resolvedTypeParams`), and an integration test covers it; `psl-print` passes.
- S3-g-R1-1: fixed in `3456573099`, with slice 2's sentence about old-format test fixtures and `git restore`.
- S3-g-R1-2: fixed in `f114359776`.
  - The Postgres section now says what the schema needs before `contract emit`: tags for quoted defaults, and the rounded value for a default finer than its column, on `time`, `timestamp`, `timestamptz`, `interval` or `numeric`.
  - The quoted message matches the branch.
  - Both rounded values are what PostgreSQL stores: `.1234` gives `.123`, and `1.234` gives `1.23`.
- S3-g-R1-3: fixed in `c3827e5eb2` and the proof notes.
  - The example ran from its base state: two files rewritten, `examples/` clean outside its tests, and its typecheck, `emit:check`, `db:init`, seed and start passed.
  - The extension check mapped each hunk of the base-to-head diff onto the text. It found two gaps, which the text now covers: `read` is required, and the JSON helpers are renamed.
  - I checked the renames: `readJsonString`, `readJsonMatching`, `readJsonInteger`, `readJsonIntegerText`, `readJsonFloat`, `readJsonBoolean` and `floatToJson` are in the built `components__codec.d.mts`, and `decodeJson*` and `encodeJsonFloat` are not. The PostGIS `read` sample matches `postgis/src/core/data-types.ts`.
  - sql-orm-client and the Supabase script are internal only, as the orchestrator judged. The one changed signature, `emptyAggregateResult` now `async`, is not re-exported from `src/exports/index.ts`. Supabase's `scripts/` folder is not in the package's `files`.
- S3-g-R1-4: fixed in `18c4b8d48c`.

## Dispatch h, round 1

Brief: `projects/data-types-completion/slices/3/briefs/s3-dispatch-h.md`. Range `657d5fa989..9b50409c63`, plus the orchestrator's `bfd17d10ef` (the `postgis.geometry` tag removed from the table, and the "Adding a type" sample marked as an example).

### What was checked

- **ADR 254 as a whole.** Every section was checked statement by statement against `packages/`, and all twelve relative links and anchors resolve. Six mismatches remain; see S3-h-R1-1. Each of these is accurate:
  - the Values table and readers, Codecs, Casts, and the tag table, which is complete in both directions;
  - both number classifiers, Reading a written default, introspection and DDL;
  - How a data type names its database type, SQLite's types, and Columns and type constructors;
  - Date and time types, including the text codecs' year text and `isoYearText` and `postgresYearText`;
  - all eleven Assembly checks with their codes, Printing, Adding a type, and Consequences.
- **The codec authoring guide.** Every sample and API name was checked against the branch, and the samples were compiled in scratch copies inside extension packages (deleted afterwards). Nine mismatches; see S3-h-R1-2. The prose about `CodecImpl`, `dataTypeValueOf`, `fromCodec`, the readers, `refuseJsonValue`, the projections, `emptyResultWire`, `enumRefusalOf`, the `sqlDataType` spec fields and the adapter options matches the code.
- **The full checks.** The logs are `wip/s3/h-*.txt`.
  - `build`, `typecheck:agent`, `lint:agent`, `lint:deps`, `lint:docs` and `fixtures:check` pass.
  - `lint:framework-vocabulary` is 253 at threshold 253, and `lint:throws` has a delta of 0.
  - `check:error-reference` lists all 388 codes, and `check:upgrade-coverage` passes.
  - Coverage: 0 failures against the per-package `coverage.config.json` thresholds. 30 packages pass. The 6 warnings are the tracked technical-debt entries, which name their own reasons.
  - `test:packages`: 1850 files pass and 3 fail. The coverage run exits 1 for the same three, which are the tarball tests below.
- **The slice 3 grep check** (now `-w`) finds none of the deleted names in `packages/`. `SQLITE_DATETIME_CODEC_ID` appears where the codec is defined, registered and used (columns, aggregates, type constructors, marker ledger) and in two adapter tests.

### The three tarball tests

The tests are `all-shells-tarball` and `module-identity` (`@prisma/orm-framework`) and `cross-shell-tarball` (`@prisma/orm-target-postgres`). They fail in the scratch `pnpm install` that packs the shells and installs them outside the workspace, before any of the branch's code runs. That install resolves `temporal-polyfill: ^1.0.4` from the registry, not from the lockfile. It now gets 1.0.5, published 2026-10-13, which depends on `temporal-utils@1.0.3` (published 2026-09-11, dist-tag `latest`). pnpm reports no matching version for it under the scratch project's supply-chain settings. `trustPolicy: no-downgrade` refusing a release without provenance would explain that, but I did not confirm the cause. The lockfile pins `temporal-polyfill@1.0.4` and `temporal-utils@1.0.2`, which is why the workspace itself installs.

Nothing that feeds this install differs from `bot/main`: no `package.json`, no `pnpm-workspace.yaml`, no `packages/0-config/tsdown/shell-testkit.ts`. The only branch change under the affected packages is a test, `temporal-fallback-entries.test.ts`. So `bot/main` fails the same way on this machine today, and CI will too until the registry or the workspace settings change. I concluded this by reasoning from what the tests install, not by running them on `bot/main`. It is not this branch's to fix. It needs its own change on `main`: a `trustPolicyExclude` entry for `temporal-utils@1.0.3`, mirrored in the shell test kit's scratch settings, or a pin of `temporal-polyfill` to 1.0.4 there.

### S3-h-R1-1 (should-fix): six statements in ADR 254 do not match the code

- Lines 24 and 103: "`pg/timestamptz@1` … a `Date`". No codec has that id; the `Date` codec is `pg/timestamptz-date@1` (`postgres/src/core/codec-ids.ts:33`).
- Line 25: "On the wire and in the `DEFAULT` clause: `2024-01-01 00:00:00+00`". The Temporal codec's `toWire` writes `2024-01-01T00:00:00Z` and the `Date` codec writes `2024-01-01T00:00:00.000Z` (`temporal-codec-helpers.ts`). `2024-01-01 00:00:00+00` is what PostgreSQL prints when the value is read back.
- Line 76: "takes the column's parameters through `withParams(value, params)`". Construction goes through `fromCodec(json, params)` (`dataTypeValueFor`, as in `contract-psl/src/data-type-default.ts:202`). `DataType.withParams` has no caller in production code, and line 191 of the ADR already says `fromCodec`. See S3-h-R1-4.
- Line 109: the test kits assert `toDataTypeValue(fromWire(toWire(fromDataTypeValue(v))))`. The Postgres kit (`postgres-codec-testkit/src/index.ts:395-540`) checks three other things:
  - `toDataTypeValue(fromDataTypeValue(v))` equals `v`;
  - `fromWire` of the row written by `toWire` equals the case's value;
  - `fromWire` of the projection equals `fromWire` of the row.
- Line 208: "`CAST(x AS text)` for every type whose row arrives as text". The Postgres driver returns every value as text. But `pg/text`, `varchar`, `uuid`, `inet`, `bit`, `varbit`, `enum`, `tsquery`, `timetz`, `int2`, `int4`, `float` and `bool` project the column itself, and their `fromWire` reads both forms. `pg/char` has its own unpadding projection. The rule is correct in effect, because the kit cases for these types pass against PGlite, `timetz` included. The sentence needs to say which types are cast to text and that the others enter as themselves.
- Line 176: bytes "written there in base64, as the stored value". The Prisma 7 reader converts the base64 to hex and reads it through the `bytea` tag's `parse` (`postgres/src/core/prisma7-binding.ts:76`, `contract-prisma7/src/defaults.ts:267`).
- Change: correct the six statements.

### S3-h-R1-2 (should-fix): the codec authoring guide's samples do not match the branch's API

- Lines 110, 166 and 264 call `column(...)` with a fourth argument. `column` takes three (`framework-components/src/shared/column-spec.ts:88`), and TypeScript reports TS2554.
- Lines 320, 361 and 798: `postgresCodec(...)` and `sqliteCodec(...)` leave out the required `factory` option (`postgres/src/core/codec-descriptor.ts:128`, `sqlite/src/core/codec-descriptor.ts:84`), so none of them compiles. Lines 326 and 804 say the adapter keeps the wrapped descriptor's factory, but it builds codecs with the one it is given.
- Line 820: `new SqlCharCodec(this)`. `CodecImpl` takes `(descriptor, dataType, params)`. Lines 800 and 811 use the column itself as `pg/char`'s projection, but the code unpads it with `CAST(x AS text)` (`codecs.ts:182`). Line 854 still says `super(descriptor)`.
- Lines 623-633: the `pgEnum` sample has no `read`, which is now required (`postgres/src/core/data-types.ts:380`).
- Case 3 (lines 205-267):
  - It imports `arktypeJson` from a `./data-types` module that does not exist, and uses `pgJsonb` without importing it.
  - It uses `Type` and `ColumnSpec` without imports.
  - It calls `serializeToJsonSafe(...).wire` and `serializeJson`, which line 64 does not list among the elided helpers; the code uses `serializeWire`.
- Case 2 (lines 121-173) describes a generic `VectorCodec<N>` and `factory<N>`. The real `PgVectorCodec` works with `number[]` and its `factory` is not generic. The literal length lives only in `pgVectorColumn`'s `typeParams`, and `Vector<N>` comes from the type map.
- Change:
  - Fix each sample so it compiles, or mark it as shortened, as line 64 does for its helpers.
  - Rewrite the Case 2 prose about where the literal type comes from.
  - Re-run the scratch typecheck of each sample.

### S3-h-R1-3 (low): three ADRs still describe current behaviour with the old method names

- Where: ADR 126 (lines 63 and 75: a block `value` read by `decodeJson`), ADR 157 (line 292: `db.enums` reads members with `decodeJson`), ADR 186 (`encodeJson`/`decodeJson`). In ADR 204, the earlier retrospective note (line 7) still states a rule "on `Codec.decodeJson`", with a link to `codec.ts`.
- Change: a one-line retrospective note naming `toDataTypeValue` and `fromDataTypeValue`, as ADRs 204 and 207 now have, and reword ADR 204's older note.

### S3-h-R1-4 (low, for the orchestrator): `DataType.withParams` has no production caller

- Where: `withParams` in `packages/1-framework/1-core/framework-components/src/shared/data-type.ts`; the header comment of `packages/2-sql/2-authoring/contract-psl/src/data-type-default.ts` (lines 3-6), which says defaults go through it.
- What is wrong: since dispatch a, codecs and PSL lowering construct values through `fromCodec`. `withParams` remains public API with only tests calling it, and ADR 254 describes it as the step that writes a column's spelling.
- Change: either remove `withParams` and describe `fromCodec` alone, or keep it and say in ADR 254 what it is for. Fix the header comment either way.

## Dispatch h, round 2

The orchestrator accepted that the tests of `withParams` were converted to `fromCodec` rather than deleted.

- **S3-h-R1-1:** fixed in `520c88b861`. Each corrected statement checked against the code:
  - The `Date` codec is `pg/timestamptz-date@1` in both places (`codec-ids.ts:33`).
  - The wire text: the `Temporal` codec writes `postgresYearText(Instant.toString())`, which is `2024-01-01T00:00:00Z`. The `Date` codec writes `utcTimestamptzText`, which is `toISOString()` through `postgresYearText`: `2024-01-01T00:00:00.000Z`. PostgreSQL prints the value back as `2024-01-01 00:00:00+00`.
  - A value written for a column is constructed through `fromCodec(json, params)`, as `dataTypeValueFor` and `dataTypeValueOf` do, and `withParams` no longer exists.
  - The test kits' three assertions now match `postgres-codec-testkit/src/index.ts` and the SQLite kit.
  - The Prisma 7 reader converts base64 bytes to hex and reads them through the `bytea` tag (`prisma7-binding.ts`).
  - The projection paragraph matches the descriptors. `json`, `jsonb`, vectors and the other types whose JSON form differs from their row text are cast to text. Numbers, booleans and text such as a uuid or an enum label enter as the column itself, and their `fromWire` reads both forms; the conformance cases of these types, `timetz` among them, pass against PGlite. `pg/char` enters unpadded.
- **S3-h-R1-3:** fixed in `520c88b861`. ADRs 126, 157 and 186 have retrospective notes naming `toDataTypeValue` and `fromDataTypeValue`, and ADR 204's older note no longer states a rule on `decodeJson`.
- **S3-h-R1-4:** fixed in `6e045c0e70`. `DataType.withParams` is deleted. The only `withParams` left in `packages/` is the Mongo vector codec's own option, which is unrelated. The comment in `data-type-default.ts` follows.
- **S3-h-R1-2:** fixed in `a9312e7888`. The guide has 27 TypeScript blocks, and the proof in `wip/s3/guide-samples/` builds 32 files from them for Postgres, SQLite and integration, each of which `tsc` passes with no output. The samples I reported are corrected: `column(...)` takes three arguments, the adapters get `factory`, `SqlCharCodec` takes its data type and parameters, `pgEnum` has `read`, and Case 2's prose says where the literal length comes from.

### Checks run for dispatch h round 2

- `pnpm build`, root `typecheck:agent`, `lint:agent`, `lint:deps` and `lint:docs` pass.
- Package tests of framework-components, target-postgres, sql-contract-psl, pgvector, postgis and target-sqlite: all pass. The tree is clean.

Dispatch h is closed, and with it the slice 3 build loop: every finding from dispatch a to h is fixed or ruled on. What remains is outside the review log: the three tarball tests that fail on the registry's `temporal-utils@1.0.3` (the same on `main`), and the slice's `/drive-code-review` and manual QA.

## Branch review fixes, round 1

Findings: `slices/3/reviews/`. Rulings: `slices/3/briefs/s3-review-fixes.md`. Items 1 to 19, 21 and 22 were built one commit each in `75bc23f592..c6d22db5c0`, plus `cac31046b1`, `85ca5a3261` and `4f76bfaba3`. The orchestrator updated ADR 254 in `b76d8431aa` and design decision 22.

### Orchestrator rulings

1. Item 20 (D11, the enum accessor) is deferred in `deferred.md`. Moving it changes a public import path, and members are already read correctly with no parameters.

### The items

Each was checked against its finding, its ruling and the code at HEAD.

1. C01: closed. Values are compared when both sides have one, and text only as a fallback, keeping case and spaces inside quotes (`sql-column-default-ir.ts:125-145`). Tests on Postgres and SQLite fail with the old code.
2. C02: closed. The load refuses a non-list default on a list column, naming the column (`contract-stack-checks.ts:133-144`).
3. C03: closed. The load says "at element N" and introspection "element N of the default", both counting from 1, which matches the PSL reader, the builder and the Prisma 7 reader.
4. T01: closed. A SQLite `X'..'` default is read as its bytes (`sqlite/src/core/default-normalizer.ts:100-106`). The verify test writes `DEFAULT X'6869'`.
5. T02: closed. One message is wrong; see S3-RF-R1-5.
6. T03: closed as ruled. It conflicts with how `read` and `spell` now work; see S3-RF-R1-4.
7. T04: closed. The `blob` tag has `parse`, `print` and documentation, and reads back what it prints. The cast from `sqlite/text` is gone. The refusal names the tag. No SQLite schema or test still writes a quoted `Bytes` default.
8. T05: closed. The test runs under two `TZ` values. It narrowed what a row may hold; see S3-RF-R1-2.
9. T06: closed. The Postgres journey writes:
   - BC and five-digit years, and `infinity` and `-infinity` on the text codecs;
   - mixed and negative intervals, and bytes and text holding a quote and a backslash;
   - `NaN` and both infinities, and list defaults.

   The SQLite journey covers `Bytes`, including a quote, a backslash and empty bytes, and years outside 1 to 9999.
10. D01: closed. Every listed type declares `spell`: `pg/uuid`, `pg/inet`, the six Postgres date and time types, `pg/interval`, `sqlite/datetime` and `sqlite/json`, beside `pg/numeric` and `pg/char`. `valueFrom` and `fromContract` apply `read` then `spell`, and no codec spells a value. A probe of about 60 inputs against the built packages: spelling twice gives the same text as spelling once, and `fromContract` accepts every spelled value.
11. D02: closed. The Postgres data types import from their own `data-type-values.ts`, not from `codec-helpers.ts`. The moved functions are unchanged. One placement is off; see S3-RF-R1-7.
12. D03: closed. Tag `parse`, the number classifier and every cast build their value through the type (`written-value.ts`), and `default-mapping.ts` uses the shared `readWrittenValue` and `castTypedValue`.
13. D04: closed. `valueFrom` replaces `fromCodec`, and neither `fromCodec` nor `dataTypeValueFor` is left in `packages/` or `docs/`.
14. D05: closed. Mongo's `toDataTypeValue` returns a `DataTypeValue`, and `requireValueOf` is the one check. It throws `InternalError`, and every caller that catches errors rethrows those.
15. D06: closed. One `dataTypeParams`, in the framework (`data-type.ts:199`).
16. D07: closed. A `Date` default goes through its type to `toWire`, the `Date` branch of the schema IR comparison is gone, and the comment in `ddl-types.ts` is fixed.
17. D08: not closed; see S3-RF-R1-3.
18. D09: closed. `sqlStorageTypeId` throws where `sqlStorageType` does, and assembly refuses a chain of stored-as types. Both are tested.
19. D10: closed. The Prisma 7 binding takes each type's tag from its authoring entry.
20. D11: deferred by ruling 1.
21. G01: closed. The `mongoCodec()` section names the options and the required `dataType`. Its sample's imports exist on the public `@prisma/orm-family-mongo/codec` and `/contract/data-type` paths, and the options match `MongoCodecConfig`. Detection matches the object form.
22. G02: closed. The quoted message starts `Namespace "public", table "product", column "price":`.

No package in `packages/2-sql` or `packages/1-framework` imports a target.

### `side-by-side-contracts`

Run alone (`test/authoring/side-by-side-contracts`), with the machine's load average about 140: 2 files and 10 tests pass. A load of 370 to 570 explains the implementer's timeout. In the full package run, `language-server`'s `server.membership-races.test.ts` timed out at its 500 ms limit too. Run alone, its 20 tests pass.

### S3-RF-R1-1 (must-fix): the `uuid-defaults` enum test expects the old refusal

- Where: "in a PSL enum, refuse a member written in upper case or braces" in `test/integration/test/uuid-defaults/uuid-defaults.integration.test.ts`. It fails in both the `integration` and `packaging` projects.
- What is wrong: since item 10, the refusal names the stored spelling, `pg/uuid JSON value must be "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11", as pg/uuid stores this value`. The test still expects `… a UUID as PostgreSQL writes it, in lower case and hyphenated 8-4-4-4-12`. No other file in the integration run fails.
- Change: update the expected reason for both members.

### S3-RF-R1-2 (should-fix): SQLite datetime `fromWire` now refuses rows it used to read

- Where: `decodeSqliteDatetime` in `packages/3-targets/3-targets/sqlite/src/core/codecs.ts:561`, which now reads through `sqliteDatetimeText`, which allows at most three fraction digits.
- What is wrong:
  - T05 asked only that text without an offset be read as UTC. Before it, `fromWire` read any text `Date` reads. Now a row of `2024-01-01 00:00:00.123456`, as Python's `sqlite3` writes, fails with `RUNTIME.DECODE_FAILED`.
  - A row holding a number fails too: `new Date(number)` used to read it. That matters if databases written by earlier Prisma versions, which may store a `DateTime` as integer milliseconds, are meant to be read. I did not confirm how those versions store it.
  - Dispatch b's brief says what a query returns must not change.
- Change: in `fromWire`, read the fraction to millisecond precision without refusing extra digits, and decide whether a number is read as milliseconds. Test both. Dispatch g's upgrade text lists whatever is refused.

### S3-RF-R1-3 (should-fix): item 17 left names that say "canonical" for the stored form

- Where:
  - the `canonical?: boolean` flag on an authored literal default (`contract-ts/src/contract-definition.ts:55`, `column-defaults.ts:146`, `contract-prisma7/src/defaults.ts:113`, `contract-psl/src/psl-column-resolution.ts:731,799,801`);
  - the `canonical` parameter and its comments in `postgres/src/core/data-types.ts:300-338`;
  - `CANONICAL_NUMERIC_TEXT` (`data-types.ts:121,124`) and Mongo's `CANONICAL_DECIMAL_TEXT` (`bson-scalar-helpers.ts:18`);
  - `date-codecs.ts:49,62` and `sqlite/src/core/data-types.ts:132-139`;
  - the test files `canonical-uuid.test.ts` and `canonical-uuid.integration.test.ts`, which test `storedUuid` and record no history.
- Change: rename them as the ruling says.

### S3-RF-R1-4 (should-fix, for the orchestrator): item 6 refuses in `read`, unlike the rest of the spelling step

- Where: `readGeometry` (`postgis/src/core/data-types.ts:33-52`), Mongo `readObjectIdJson` and `readBinaryJson` (`bson-scalar-helpers.ts:173,441`), `readPgByteaJson` (`postgres/src/core/data-type-values.ts:345`).
- What is wrong: since item 10, `read` accepts every spelling and `spell` writes the stored one, as `pg/uuid` does. These four readers refuse the other spellings in `read` itself. So `valueFrom` refuses where it would otherwise write the stored spelling. An upper-case ObjectId member of a Mongo enum (`mongo/9-family/src/core/authoring-entity-types.ts:147`) is refused, while an upper-case uuid member is rewritten. Item 6's ruling literally says the reader refuses, so this is a design call.
- Change, if the orchestrator agrees: `read` checks the pattern and `spell` writes the stored spelling (upper case and little-endian for geometry, lower case for ObjectId, zero padding bits for base64). `fromContract` then still refuses any other spelling and names the stored one.

### S3-RF-R1-5 (low): pgvector names a value PostgreSQL never stores

- Where: `pgvector/src/core/data-types.ts:73-83`.
- What is wrong: for an element past `real`'s range, such as `3.5e38`, `Math.fround` gives `Infinity`, and the message says it "would be stored as Infinity". pgvector refuses a non-finite element; it does not store it.
- Change: when `Math.fround(element)` is not finite, say the element is outside the range `real` holds. Add the case to the test.

### S3-RF-R1-6 (low): refusals of readers that now accept every spelling describe only the stored one

- Where: `readUuid` and `readInet` (`postgres/src/core/data-types.ts:253-270`) and SQLite's `readDatetime`.
- What is wrong: text that is no uuid at all is told it must be "a UUID … in lower case and hyphenated", and text that is no instant is told it needs "three fraction digits", although the reader accepts other spellings.
- Change: describe what the reader accepts, as the Postgres date and time readers do.

### S3-RF-R1-7 (low): interval wire conversion moved into the types' module

- Where: `intervalTextFields`, its verbose and SQL-standard parsers, and `pgIntervalFromIso` in `postgres/src/core/data-type-values.ts:95-102,326-338`, used only by `codec-helpers.ts:192`. Also `postgres/README.md:24`, which places `pgIntervalStoredText` in `codec-helpers.ts`.
- What is wrong: these read the wire text into the application value, and their errors name the codec `pg/interval@1`. Item 11 moved value functions to the types, not codec code.
- Change: move them back to `codec-helpers.ts`, keep `pgIntervalStoredText` and its helpers in the types' module, and fix the README.

### S3-RF-R1-8 (low, for the orchestrator): tag `parse` still spells, before `valueFrom` spells again

- Where: `dateTimeTag` in `postgres/src/core/data-type-entries.ts:70-76,114-143` (`pg*StoredText`), and `parse: sqliteDatetimeText` in `sqlite/src/core/data-type-entries.ts:73`.
- What is wrong: harmless, because spelling twice gives the same text, but the spelling step still runs outside the type.
- Change: if item 10 is meant to cover tags, `parse` checks the text and returns it, and `spell` alone writes the stored spelling.

### S3-RF-R1-9 (low): ADR 254 after `b76d8431aa`

The tag table, the eleven assembly checks, the links and anchors, and the absence of old names are all correct. These statements are not:

- Line 74, "`read` accepts every spelling of a value the type holds": true only for the twelve types with `spell`. A type without `spell` accepts only its stored spelling.
- Line 78, "whatever spelling it hands over, the type writes the one it stores": for a type without `spell` (`pg/int8` and `sqlite/integer` through `readJsonIntegerText`, `pg/bytea`, `postgis/geometry`, Mongo ObjectId, `sqlite/blob`), `valueFrom` refuses another spelling and names the stored one.
- Line 76: the list of stored spellings leaves out `sqlite/blob` (upper-case hex) and `pg/char` (no pad spaces).
- Line 265: `spell` is described as giving "the spelling the parameters require". It is the type's whole spelling step: a uuid in lower case, `pg/char` without its pad, `sqlite/json` with sorted keys.
- Line 383: Alternatives rejects "a canonical-form function per type that codecs and verification call", which is close to what `spell` now is. Say that the rejected design is a canonical form a codec defines, or why `spell` differs.
- Line 211: "no codec is needed" when no database is in reach. A `Date` default is read through the codec's `toDataTypeValue` (`contract-to-schema-ir.ts:133-141`).
- Line 297: the contract validator compares the types columns are stored as (`validators.ts:1177-1185`).
- Line 352, check 11: a type stored as a type that is itself stored as another is an `InternalError`, not `CONTRACT.DATA_TYPE_UNREGISTERED`.
- Line 22: the framework value omits `params`.

### S3-RF-R1-10 (low, for the orchestrator): a JSON document that is a number or a boolean has no printed literal

- Where: `classifications` in `packages/2-sql/9-family/src/core/psl-build/default-mapping.ts:146-162`.
- What is wrong: `classifications` tries the tags only for values that are not numbers or booleans. So a `json` or `jsonb` default whose document is `42` or `true` gets no literal. Infer falls back to a `sql` expression, and `contract print` refuses the default. No test covers it. I found this by reading the code and did not run it.
- Change: try the column type's tag for any JSON value, and add infer and print tests.

### Checks run for branch review fixes round 1

- `pnpm build`, root `typecheck:agent`, `lint:agent`, `lint:deps` and `lint:docs` pass. `lint:framework-vocabulary` passes, and `check:error-reference` lists every code. `pnpm fixtures:check` passes, tree clean.
- Package tests of the 34 touched packages: all pass, except `language-server`'s timing test, which passes when run alone.
- Integration: `test/planner-golden` re-recorded with `PLANNER_GOLDEN_WRITE=1` with no diff. Also run: `authoring`, `date-time-defaults`, both default journeys, `stale-contract-default*`, `psl-print`, `psl-infer`, every `infer-roundtrip-*` file, `upgrade-instructions`, `value-objects`, `uuid-defaults`, `enum-members`, `prisma7-source` and `scalar-lists`. Result: 156 files, 2362 tests pass, 2 fail (S3-RF-R1-1).
- Probes: spelling stability over about 60 values, against the built packages.

## Branch review fixes, round 2

Range `9f998ba383..4ddd7fbbb8`, one commit per finding. `5dc309db0b` fixes a test type error, and `4ddd7fbbb8` adds the SQLite UTC note to the upgrade text. The orchestrator's `71cea6b954` handles S3-RF-R1-9. S3-RF-R1-8 stays as ruled.

- **S3-RF-R1-1:** fixed in `9f998ba383`. The test expects the refusal that names the stored spelling, and passes.
- **S3-RF-R1-2:** fixed in `112157e753`. `fromWire` reads text with `Date`, unmarked text as UTC, and a number as milliseconds since 1970. Probed under `TZ=Asia/Kolkata` against the built package:
  - `2024-01-01 00:00:00`, as `CURRENT_TIMESTAMP` writes it, reads as midnight UTC.
  - `2024-01-01 00:00:00.123456` keeps `.123`.
  - `2024-01-01T00:00:00.000+00:00`, `…Z`, `+02:00` and a bare date read as the instant they name.
  - `1704067200000` reads as 2024-01-01.
  - The text `"1704067200000"` is refused.
  - Nothing in the repository shows what earlier Prisma versions write: the SQLite driver adapters are not installed, and Prisma 7.10's client leaves the formatting to them. So the implementer's list rests on memory, and so does my check. It matches what I know: the query engine wrote integer milliseconds, the driver adapters write ISO 8601 text with `+00:00` (or milliseconds under `timestampFormat: 'unixepoch-ms'`), SQLite's `CURRENT_TIMESTAMP` writes unmarked text, and Python's `sqlite3` writes microseconds.
  - See S3-RF-R2-2.
- **S3-RF-R1-3:** fixed in `93931bf94a`. None of the names listed remain. The "canonical" left in `packages/` means something else: canonical JSON, canonical strings for hashing, the contract's canonical on-disk shape.
- **S3-RF-R1-4:** fixed in `4026e8a13e`. Geometry, ObjectId, Mongo binary and `pg/bytea` read every spelling and `spell` writes the stored one, so `valueFrom` rewrites and `fromContract` still refuses the other spellings. Tested per type.
- **S3-RF-R1-5:** fixed in `8a4e069ffc`, with a test of an element past `real`'s range.
- **S3-RF-R1-6:** fixed in `8eab0a95bb`. The refusals of uuid, inet and SQLite datetime describe what each reader takes, and the tests that quote them follow.
- **S3-RF-R1-7:** fixed in `35c47526dd`. The interval wire reading is back in `codec-helpers.ts`, and the README is fixed.
- **S3-RF-R1-9:** fixed in `71cea6b954`. Every statement I listed is corrected. One new statement is wrong; see S3-RF-R2-1.
- **S3-RF-R1-10:** fixed in `01e51da8ed`. A JSON default that is a number, a boolean or `null` prints with the `json` tag, with unit, infer and print tests.

### S3-RF-R2-1 (low): ADR 254 says `pg/char` stores its text padded

- Where: line 76, "`pg/char` stores its text padded to its length".
- What is wrong: `pg/char` stores the text without its pad. With `{ length: 3 }`, `fromContract("a")` is accepted, `fromContract("a  ")` is refused naming `"a"`, and `valueFrom("a")` stores `"a"` (probe against the built package). This matches dispatch a's ruling and `spellCharacter`.
- Change: "`pg/char` stores its text without the spaces that pad it to its length".

### S3-RF-R2-2 (low, for the orchestrator): a number of seconds or a Julian day reads as milliseconds, without an error

- Where: `decodeSqliteDatetime` in `packages/3-targets/3-targets/sqlite/src/core/codecs.ts`.
- What is wrong: any number is taken as milliseconds. A row written by SQLite's `unixepoch()` or `strftime('%s')` (seconds), or `julianday()` (a fraction such as `2460310.5`), reads as a date in January 1970 instead of being refused. Prisma never writes these, so it matters only for rows written outside the application.
- Change, if wanted: refuse a number that is not a whole number. Either way, the manual QA should read a `DateTime` row written by Prisma 7 on SQLite, since nothing in the repository confirms its format.

### Checks run for branch review fixes round 2

- `pnpm build`, root `typecheck:agent`, `lint:agent`, `lint:deps`, `lint:docs` and `check:error-reference` pass. `pnpm fixtures:check` passes, tree clean.
- Package tests of framework-components, both targets, both adapters, pgvector, postgis, target-mongo, mongo-codec, family-mongo, family-sql, sql-contract, sql-contract-ts, sql-contract-psl, sql-contract-prisma7, both codec test kits, mongo-contract-psl and mongo-contract-ts: all pass.
- Integration: `test/planner-golden` re-recorded with `PLANNER_GOLDEN_WRITE=1` with no diff. Also run: `authoring`, `date-time-defaults`, both default journeys, `stale-contract-default*`, `psl-print`, `psl-infer`, every `infer-roundtrip-*` file, `upgrade-instructions`, `value-objects`, `uuid-defaults`, `enum-members`, `prisma7-source`, `scalar-lists`, `test/mongo` and the SQLite `sql-orm-client` files. Result: 288 files, 3162 tests, all pass.

The branch review fixes are closed. The slice is ready for manual QA.
