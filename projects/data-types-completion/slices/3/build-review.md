# Code review: slice 3 (TML-3531)

Reviewer-maintained. Contract: [ADR 254](../../../../docs/architecture%20docs/adrs/ADR%20254%20-%20Data%20types%20and%20casts.md) and `projects/data-types-completion/design-notes.md` ("A data type owns its values"). Plan: `projects/data-types-completion/slices/3/plan.md`. Briefs: `projects/data-types-completion/slices/3/briefs/`.

## Subagent IDs

- Implementer: slice 3 implementer (Opus), dispatch a round 1
- Reviewer: slice 3 reviewer (Opus), dispatch a round 1, started 2026-10-08

## Orchestrator rulings

Dispatch a, given during the dispatch and recorded in `wip/s3/report-a.md`. They are part of the brief.

1. Each Postgres date and time type's reader is its stored-text pattern (`date-time-stored-text.ts`): ISO 8601 and the text PostgreSQL prints, nothing else. Forms only `Temporal.from` accepted (no seconds, `+0530`, nine fraction digits) are refused by `fromContract`. The Date and Temporal codecs refuse only `infinity` and their range. `pg/timestamptz-date@1`'s own pattern goes.
2. `sqlite/text` reads any string; `sqlite/datetime@1` and `sqlite/json@1` keep their parse in `fromDataTypeValue` until dispatch d.
3. A codec is constructed with its `DataType` and the column's parameters (`CodecImpl(descriptor, dataType, params)`, `mongoCodec({ dataType, params })`), and `Codec` has a read-only `dataType`. `toDataTypeValue` builds through `withParams(fromContract(json, params), params)`.
4. `read` is required on `DataTypeSpec`.
5. The final grep runs with `git grep -P`.
6. Prisma 7 `Decimal` defaults (`numeric(65,30)`) store 30 fraction digits, as PostgreSQL prints them. The three `contract-prisma7` expected contracts and the golden test's manifest change; contracts read from a Prisma 7 schema may change in this slice.
7. Value parameters are not normalised in this slice (`numeric(10)` against `numeric(10,0)`); slice 4 adds parameter normal forms. `DataTypeValue` does not deep-freeze its JSON. `fromContract` does not validate parameters against the type's schema, because the contract build already does.

## Scoreboard

| Dispatch | Round | Verdict |
| --- | --- | --- |
| a | 1 (`650fff0614..def805947b`) | ANOTHER ROUND NEEDED: 1 must-fix, 1 should-fix, 4 low |

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
