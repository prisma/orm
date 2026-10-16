# Slice 3, dispatch f: the Prisma 7 reader, `contract infer` and `contract print`

Dispatch f of `projects/data-types-completion/slices/3/plan.md`. Read the slice plan's row f, ADR 254 "How PSL writes a value", "Reading and writing a stored value" and "Date and time types", and decisions 3, 4 and 18 in `design-notes.md`. Dispatches a to e are done.

Since the plan was written, `main` changed two things this dispatch touches; build on them, do not undo them:
- **TML-3582** (prisma/orm#30735): `contract infer` resolves each column's type through the stack's data types and prints the constructor marked `inferred` (`packages/2-sql/9-family/src/core/psl-build/column-types.ts`, `inferred-type-constructors.ts`); the Postgres target's `infer-default-codec.ts` takes the printed constructor's `path` and arguments.
- **"Storage a model does not map"** (another project) also changes `packages/2-sql/2-authoring/contract-prisma7`. Before editing the reader, `git log bot/main -- packages/2-sql/2-authoring/contract-prisma7` and keep whatever that project has merged.

## Build

1. **Prisma 7 dates.** The reader keeps its meaning step: a `DateTime` default on a `date` column keeps the date, on a `timestamp` column the wall-clock time, as today. It then hands the resulting text to the date and time tags' `parse` (dispatch c) and stores the literal value. `storedTemporalText`'s date arithmetic in `prisma7-temporal-defaults.ts` goes (TML-3394). Test the boundary years from dispatch c's table through the reader.
2. **Prisma 7 bytes.** A `Bytes` default is stored as its base64 value.
3. **Fixtures.** Regenerate the three expected-contract fixtures in `contract-prisma7/test/fixtures/` that change (about 25 columns), and list every changed value in the report. A committed Postgres contract that was not read from a Prisma 7 schema must not change (halt condition).
4. **Infer.** `contract infer` introspects without a contract, so a reported default reaches it as raw text, and today `parseInferredDefault` reads it type by type and `infer-default-codec.ts` calls the lenient reader `readReportedValue`. Delete `parseInferredDefault` and its file: read each reported default with the codec of the constructor infer prints for the column (`fromWire` of the literal body the target extracts, then `toDataTypeValue`), and write it with its type's authoring entry: a tagged type prints its tag (`` @default(date`2024-01-01`) ``), others print as today. Then delete `readReportedValue`. A default the codec cannot read prints as the raw expression, as today.
5. **Print.** `contract print` writes a stored value with its type's authoring entry, the same way.

## Must not change

Committed `contract.json` and `contract.d.ts` other than the Prisma 7 fixtures of item 3; the golden planner recordings except the date or time defaults the Prisma 7 reader used to store as expressions, now written by their codec (allowed by the project plan; list each). `pnpm fixtures:check:agent` passes.

## Done when

Tests were red first, then green. Root `typecheck:agent`; contract-prisma7, Postgres target (`test/psl-infer`, `test/psl-print`), SQL family tests; `test/integration/test/fixtures/prisma7-source/` journeys; the infer round-trip journeys (`infer-roundtrip-*`); `test/integration/test/psl-print/`; the golden planner test; `lint:agent`; `lint:deps`. Do not edit `docs/`.

Report in under 400 words: commits; every Prisma 7 fixture value that changed, old and new; what infer and print now write for each tagged type.
