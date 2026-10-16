# Slice 3, dispatch e: defaults read and written through the column's codec

Dispatch e of `projects/data-types-completion/slices/3/plan.md`. Read the slice plan's row e, ADR 254 "Values", "Codecs" and "Reading and writing a stored value", and `design-notes.md` under "A data type owns its values". Dispatches a to d are done. `main` was merged on 2026-10-15 (`4ec1b78c80`): introspected columns now carry `reportedType`, and `contract infer` resolves types through the data types (TML-3582); keep both.

Today a stored default reaches the planner, `db verify` and introspection as text in a "canonical form" that each type computes (`toCanonicalForm`), and each target parses reported defaults with its own per-type branches. After this dispatch a default is a `DataTypeValue` everywhere: read from the contract through the column's type, read from the database through the column's codec, written to DDL through the codec, and compared as values.

## Build

1. **Contract.** The CLI's `deserializeContract` reads every literal default through its column's type (`fromContract` with the column's parameters) and refuses a value the type does not hold with `CONTRACT.VALIDATION_FAILED`, naming the space, table and column. Test with a hand-built contract JSON that stores `"1.5"` on a `numeric(10,2)` column.
2. **Introspection.** Each reported literal default is read with the column's codec: `fromWire` of the literal's body, then `toDataTypeValue`. The Postgres and SQLite targets keep only the step that takes the literal's body out of the reported text (quotes, `::type` casts, `E''` escapes); `parsePostgresDefault`'s per-type branches go. A table's codec comes from the contract of its own space when several spaces are introspected. A reported default the codec cannot read becomes a difference that names the column and carries the codec's message.
3. **Schema IR.** Default nodes hold values and compare them as values (canonical JSON of the `DataTypeValue`). Expression defaults stay text.
4. **DDL.** A default is written with `fromDataTypeValue`, then `toWire`, then the adapter's SQL literal for the wire value, in the asynchronous DDL lowering (TML-3404; read its description in Linear if you need the background). No synchronous path renders a literal default after this dispatch; if one is needed, halt and report (slice plan halt condition).
5. **Delete** `toCanonicalForm` on data types and codec descriptors, `canonicalFormOf`, `defaultInCanonicalForm`, `contractDefaultRefusal`, the normalisation in `resolvedDefaultsEqual`, the planners' `inCanonicalForm` and `plannableDefault`, `postgresDateTimeDdlText`, `isPostgresDateTimeDataType`, the SQLite planner's `SQLITE_DATETIME_CODEC_ID` branch, and the synchronous default renderers that only fed them. TML-3406 (assigned to Will) is about one of these; name in the report which deleted code was its subject.
6. **Real-database journeys**, one per target, in `test/integration`: a contract with a default on a column of every built-in type that has a codec, migrated by the CLI into PGlite and into SQLite, then `db verify` reports zero issues. Then change one default in the database by raw SQL and check verify reports exactly that column.

## Must not change

The golden planner recordings (re-record with `PLANNER_GOLDEN_WRITE=1`, then `git status` must show no change; a DDL change is a halt condition). Committed `contract.json`, `contract.d.ts`, migrations and snapshots. `pnpm fixtures:check:agent` passes.

## Done when

Tests were red first, then green. Root `typecheck:agent`; tests of schema-ir, the SQL family, both targets, both adapters and the CLI; the golden planner test; `test/integration/test/date-time-defaults/`; `test/integration/test/authoring/`; the two new journeys; `lint:agent`; `lint:deps`. The slice 3 grep check in the project `plan.md` returns nothing for the names this dispatch deletes. Do not edit `docs/`.

Report in under 400 words: commits; where a reported default's body is extracted on each target; anything the old canonical-form code did that the codecs do not, and how you handled it; TML-3406's subject.
