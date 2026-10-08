# Project plan: data types own column types

Spec: [`spec.md`](spec.md). Design: [`design.md`](design.md). Linear project: Data types own column types.

## Slices

| # | Slice | Ticket | Branch | Design sections | Depends on |
| --- | --- | --- | --- | --- | --- |
| 1 | Each SQL data type declares its name, parameters and texts; every copy of those facts is deleted | TML-3386 | `tml-3386-data-types-declare-names` | 2 to 6 | nothing |
| 2 | The contract stores `dataType`; SQLite's data types are the ones the database stores; upgrade script; `db sign` signs every space; ADR 254 accepted | TML-3388 | `tml-3388-data-type-in-contract` | 7 to 10 | slice 1 merged |
| 3 | A data type owns its values and a codec converts them; date, time, interval and bytes tags; `sqlite/datetime` and `sqlite/json` stored as text; defaults read and written through the column's codec | to file after Will's review | to name with the ticket | ADR 254 as amended 2026-10-07; [`slices/3/plan.md`](slices/3/plan.md) | slice 2 merged |
| 4 | Introspection resolves reported types through the declarations; verify compares storage types exactly; infer prints constructors and fails on unclaimed types | TML-3387 | `tml-3387-resolve-reported-types` | 11 to 13 | slice 3 merged |
| 5 | Default function arguments, enum member values and discriminator values are checked by the cast rule | TML-3389 | `tml-3389-typed-written-values` | 14 | slice 1 merged |

Each slice is one pull request against `main`, titled `TML-NNNN: <sentence>`. Slice 5 does not depend on slices 2 to 4 and may run beside them; TML-3367, which it needed, has merged. Slice 3 was inserted on 2026-10-07, before the verify slice, because the verify slice compares defaults and would otherwise be built on the canonical-form code slice 3 deletes (design notes, 2026-10-07). Slices 1 and 2 are large but each has one outcome, and the repository prefers fewer, larger pull requests (`.agents/rules/optimize-for-human-time-on-prs.mdc`); the build loop splits them into dispatches, not pull requests.

```
main ── 1 ──┬── 2 ── 3 ── 4
            └── 5
```

## How each slice is built

One implementer and one reviewer, both on Opus, resumed across dispatches, per the Drive process. Every subagent brief says: run commands through `mise exec --`; add no AI attribution lines; stage files explicitly; sign off with both trailers. After the build loop, `/drive-code-review` runs on the slice without the walkthrough, its findings are fixed, and it runs again after substantial changes. Manual QA runs after slices 2, 3 and 4.

The slice plan with dispatches is written at build time as `slices/<n>/plan.md`. Dispatch outlines, to be confirmed against `main` when each slice starts:

**Slice 1.** (a) Framework `params`; the SQL data type module in `packages/2-sql/1-core/contract` with `sqlBaseName`, `renderSqlTypeName`, `renderSqlCatalogText`, `dataTypeParams`, `resolveReportedSqlType`, unit tests; the golden planner test recorded at the base commit. (b) Postgres, pgvector and postgis declarations and per-pack tests; codec `paramsSchema` references the data type's; registration and constructors move to the targets. (c) SQLite declarations, including the two character types; Mongo `mongoDataType`. (d) Readers switch and the copies are deleted: planners, `typeRef` writing, runtime casts and their policy set, `SAFE_WIDENINGS`, enum blocks, Mongo validator, Prisma 7 binding, contract writers of section 4, TML-3253's lookup if it has merged; assembly checks. (e) Docs, error reference, full checks.

**Slice 2.** (a) Contract types, validators, builder, descriptor, `type.*` helpers, emitter, JSON Schema, pack metadata; the refusal of old contracts; the two checks in `deserializeContract`. (b) SQLite data types and canonical forms. (c) `db sign` over every space; `withTransaction`; the `migrate` message. (d) The upgrade script for both audiences, with its proof run. (e) Regenerate every fixture, example, app, extension contract space and snapshot. (f) ADR 254, docs, instruction text, full checks; manual QA.

**Slice 3.** Planned in [`slices/3/plan.md`](slices/3/plan.md): (a) values and the renamed codec methods across every codec; (b) database JSON read with `fromWire`; (c) PostgreSQL's year text and the Postgres tags; (d) SQLite's `sqlite/datetime` and `sqlite/json`; (e) defaults read and written through the column's codec, and the canonical-form code deleted; (f) the Prisma 7 reader, `contract infer` and the language server; (g) the upgrade instruction and regeneration; (h) docs and full checks; manual QA.

**Slice 4.** (a) Introspection hands over `ReportedSqlType`; schema IR carries `dataType` and `typeText`; verify compares the id and parameters of the type each column is stored as. (b) Postcheck from catalog texts and by identity for enums; reported defaults already arrive as values from slice 3. (c) Infer receives the stack, prints marked constructors, fails on unclaimed; the Prisma 7 reader prints the marked constructor of each data type in its table (design 13.8); `Bit`, `VarBit`, `Interval`; `Unsupported` removed. (d) The test-only extension journey and the real-database matrix. (e) Docs, error reference, full checks; manual QA of the Prisma 7 side-by-side flow. The golden planner test (`test/integration/test/planner-golden/`) stays through slice 4, because slices 3 and 4 change the DDL builders' inputs and it is the only check that plans every committed contract and compares the DDL with a recording. Every dispatch that changes the planner or the committed contracts re-records its manifest (`PLANNER_GOLDEN_WRITE=1`) and compares the full recordings with the previous ones, snapshot directory names masked. The last dispatch retires it: it deletes `test/integration/test/planner-golden/` (the test, its two fixture contracts, the manifest), its fixture root in `test/integration/scripts/emit-fixture-configs.mjs`, its two ignore globs in `biome.jsonc`, and the round-trip test's expected refusal for its Postgres fixture (`test/integration/test/psl-print/every-postgres-contract-roundtrip.integration.test.ts`).

**Slice 5.** (a) Shared signatures and limits; reporting of a registered function's own diagnostics. (b) Prisma 7 reader; generators' applicable data types. (c) Enum member values; discriminator values. (d) Docs, error reference, full checks.

## Checks every slice runs

Through `mise exec --` and the `:agent` variants, reading the log file each prints: `pnpm build`, `pnpm typecheck`, `pnpm test:packages`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm lint`, `pnpm lint:deps`, `pnpm lint:docs`, `pnpm lint:throws`, `pnpm lint:framework-vocabulary`, `pnpm check:error-reference`, `pnpm coverage:packages`, `pnpm fixtures:check`, `pnpm check:upgrade-coverage --mode pr`.

## Grep checks

| After slice | Command | Allowed output |
| --- | --- | --- |
| 1 | `git grep -n "targetTypes\|targetTypesFor\|byTargetType\|expandNativeType\|nativeTypeFor\|typeMetadataRegistry\|normalizeNativeType\|validateScalarTypeCodecIds" -- packages` | nothing |
| 2 | `git grep -n "nativeType" -- packages examples apps test` | the Prisma 6 and Prisma 7 schema readers where it names `@db.*` attributes; `SqlColumnIR.nativeType` and its readers and writers until slice 4; the old-contract refusal and its test, including `test/integration/test/fixtures/contract-format/supabase-before-dbgenerated-removal.contract.json`; the upgrade script and its fixtures; comments in the pgvector and postgis `migration.ts` files, which the upgrade proof requires unchanged |
| 3 | `git grep -nE "toCanonicalForm\|canonicalFormOf\|defaultInCanonicalForm\|contractDefaultRefusal\|resolvedDefaultsEqual\|tagEntryKey\|isTagEntryKey\|authoringEntryType\|DATA_TYPE_ENTRY_KEY_INVALID\|encodeJson\|decodeJson\|SQLITE_DATETIME_CODEC_ID\|isPostgresDateTimeDataType\|postgresDateTimeDdlText\|storedTemporalText" -- packages` | nothing; `SQLITE_DATETIME_CODEC_ID` where the codec is defined and registered |
| 4 | `git grep -n "normalizeFormattedType\|normalizeSchemaNativeType\|normalizeSqliteNativeType\|FORMAT_TYPE_DISPLAY\|buildExpectedFormatType\|formatUserDefinedTypeName\|POSTGRES_TO_PSL\|PRESERVED_NATIVE_TYPES\|PARAMETERIZED_NATIVE_TYPES\|EXISTING_COLUMN_DATE_TIME_TYPES\|INFERRED_PSL_TYPE_NAMES\|TYPE_NAME_ALIASES\|WITH_TIME_ZONE\|resolvedNativeType\|codecBaseNativeType" -- packages` | nothing |
| 4 | `git grep -n "nativeType" -- packages examples apps test` | the Prisma 6 and Prisma 7 schema readers where it names `@db.*` attributes; the old-contract refusal and its test and fixture; the upgrade script and its fixtures |
| 4 | `git grep -nE '(^\|[^A-Za-z])Unsupported\(' -- packages test examples` | the Prisma 6 and Prisma 7 schema readers, their fixtures and tests; `packages/3-extensions/postgres/README.md`, which documents the Prisma 7 reader |
| 5 | `git grep -n "applicableCodecIds\|FUNCTION_ARGUMENT_KEYS" -- packages` | nothing |

## Halt conditions

Stop and report to the orchestrator; do not choose an alternative.

- Any committed `contract.json` changes in slice 1, or any `contract.d.ts` changes other than the SQLite aggregate rows of design 2.7 item 9.
- The golden planner test finds a DDL change in slices 1 to 4 other than the allowed ones: the `typeRef` quoting fix (slice 1), SQLite `BigInt` literal defaults written `DEFAULT 42` (slice 2), and in slice 3 a date or time default the Prisma 7 reader used to store as an expression, now written by its codec.
- A reported text from a real database that no claiming text of design 2.6 or section 9 covers, for a type that has a data type.
- A column in a committed contract whose codec's data type does not reproduce its stored `nativeType` in slice 1.
- The upgrade script's output differs from regeneration for any file.
- `pnpm lint:framework-vocabulary` would need its threshold raised.
- The design is silent on a choice the implementation needs.

## Retro triggers

Any halt condition; a reviewer round that finds a class of defect the design should have prevented; a slice needing more than ten dispatches.

## Close-out

After slice 5 merges: final retro; map every decision in `design-notes.md` to its durable home (ADR 254, ADR 129, the codec authoring guide, package READMEs, Linear) and list the mapping in the close-out pull request; close TML-3283 with the recorded answer; delete `projects/data-types-completion/`.
