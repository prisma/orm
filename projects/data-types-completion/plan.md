# Project plan: data types own column types

Spec: [`spec.md`](spec.md). Design: [`design.md`](design.md). Linear project: Data types own column types.

## Slices

| # | Slice | Ticket | Branch | Design sections | Depends on |
| --- | --- | --- | --- | --- | --- |
| 1 | Each SQL data type declares its name, parameters and texts; every copy of those facts is deleted | TML-3386 | `tml-3386-data-types-declare-names` | 2 to 6 | nothing |
| 2 | The contract stores `dataType`; SQLite's data types are the ones the database stores; upgrade script; `db sign` signs every space; ADR 254 accepted | TML-3388 | `tml-3388-data-type-in-contract` | 7 to 10 | slice 1 merged |
| 3 | Introspection resolves reported types through the declarations; verify compares exactly; infer prints constructors and fails on unclaimed types | TML-3387 | `tml-3387-resolve-reported-types` | 11 to 13 | slice 2 merged; TML-3253 merged |
| 4 | Default function arguments, enum member values and discriminator values are checked by the cast rule | TML-3389 | `tml-3389-typed-written-values` | 14 | slice 1 merged; TML-3367 merged |

Each slice is one pull request against `main`, titled `TML-NNNN: <sentence>`. Slice 4 does not depend on slices 2 or 3 and may run beside them once TML-3367 has merged. Slices 1 and 2 are large but each has one outcome, and the repository prefers fewer, larger pull requests (`.agents/rules/optimize-for-human-time-on-prs.mdc`); the build loop splits them into dispatches, not pull requests.

```
main ── 1 ──┬── 2 ── 3 (after TML-3253)
            └── 4 (after TML-3367)
```

## How each slice is built

One implementer (Fable) and one reviewer (Opus), resumed across dispatches, per the Drive process. Every subagent brief says: run commands through `mise exec --`; add no AI attribution lines; stage files explicitly; sign off with both trailers. After the build loop, `/drive-code-review` runs on the slice without the walkthrough, its findings are fixed, and it runs again after substantial changes. Manual QA runs after slice 2 and after slice 3.

The slice plan with dispatches is written at build time as `slices/<n>/plan.md`. Dispatch outlines, to be confirmed against `main` when each slice starts:

**Slice 1.** (a) Framework `params`; the SQL data type module in `packages/2-sql/1-core/contract` with `sqlBaseName`, `renderSqlTypeName`, `renderSqlCatalogText`, `dataTypeParams`, `resolveReportedSqlType`, unit tests; the golden planner test recorded at the base commit. (b) Postgres, pgvector and postgis declarations and per-pack tests; codec `paramsSchema` references the data type's; registration and constructors move to the targets. (c) SQLite declarations, including the two character types; Mongo `mongoDataType`. (d) Readers switch and the copies are deleted: planners, `typeRef` writing, runtime casts and their policy set, `SAFE_WIDENINGS`, enum blocks, Mongo validator, Prisma 7 binding, contract writers of section 4, TML-3253's lookup if it has merged; assembly checks. (e) Docs, error reference, full checks.

**Slice 2.** (a) Contract types, validators, builder, descriptor, `type.*` helpers, emitter, JSON Schema, pack metadata; the refusal of old contracts; the two checks in `deserializeContract`. (b) SQLite data types and canonical forms. (c) `db sign` over every space; `withTransaction`; the `migrate` message. (d) The upgrade script for both audiences, with its proof run. (e) Regenerate every fixture, example, app, extension contract space and snapshot. (f) ADR 254, docs, instruction text, full checks; manual QA.

**Slice 3.** (a) Introspection hands over `ReportedSqlType`; schema IR carries `dataType` and `typeText`; equality everywhere. (b) Postcheck from catalog texts and by identity for enums; default parsers take the codec by design 12.4. (c) Infer receives the stack, prints marked constructors, fails on unclaimed; `Bit`, `VarBit`, `Interval`; `Unsupported` removed. (d) The test-only extension journey and the real-database matrix. (e) Docs, error reference, full checks; manual QA of the Prisma 7 side-by-side flow. The golden planner test (`test/integration/test/planner-golden/`) stays through slice 3, because slice 3 changes the DDL builders' inputs and it is the only check that plans every committed contract and compares the DDL with a recording. Every dispatch that changes the planner or the committed contracts re-records its manifest (`PLANNER_GOLDEN_WRITE=1`) and compares the full recordings with the previous ones, snapshot directory names masked. The last dispatch retires it: it deletes `test/integration/test/planner-golden/` (the test, its two fixture contracts, the manifest), its fixture root in `test/integration/scripts/emit-fixture-configs.mjs`, its two ignore globs in `biome.jsonc`, and the round-trip test's expected refusal for its Postgres fixture (`test/integration/test/psl-print/every-postgres-contract-roundtrip.integration.test.ts`).

**Slice 4.** (a) Shared signatures and limits; reporting of a registered function's own diagnostics. (b) Prisma 7 reader; generators' applicable data types. (c) Enum member values; discriminator values. (d) Docs, error reference, full checks.

## Checks every slice runs

Through `mise exec --` and the `:agent` variants, reading the log file each prints: `pnpm build`, `pnpm typecheck`, `pnpm test:packages`, `pnpm test:integration`, `pnpm test:e2e`, `pnpm lint`, `pnpm lint:deps`, `pnpm lint:docs`, `pnpm lint:throws`, `pnpm lint:framework-vocabulary`, `pnpm check:error-reference`, `pnpm coverage:packages`, `pnpm fixtures:check`, `pnpm check:upgrade-coverage --mode pr`.

## Grep checks

| After slice | Command | Allowed output |
| --- | --- | --- |
| 1 | `git grep -n "targetTypes\|targetTypesFor\|byTargetType\|expandNativeType\|nativeTypeFor\|typeMetadataRegistry\|normalizeNativeType\|validateScalarTypeCodecIds" -- packages` | nothing |
| 2 | `git grep -n "nativeType" -- packages examples apps test` | the Prisma 6 and Prisma 7 schema readers where it names `@db.*` attributes; `SqlColumnIR.nativeType` and its readers and writers until slice 3; the old-contract refusal and its test, including `test/integration/test/fixtures/contract-format/supabase-before-dbgenerated-removal.contract.json`; the upgrade script and its fixtures; comments in the pgvector and postgis `migration.ts` files, which the upgrade proof requires unchanged |
| 3 | `git grep -n "normalizeFormattedType\|normalizeSchemaNativeType\|normalizeSqliteNativeType\|FORMAT_TYPE_DISPLAY\|buildExpectedFormatType\|formatUserDefinedTypeName\|POSTGRES_TO_PSL\|PRESERVED_NATIVE_TYPES\|PARAMETERIZED_NATIVE_TYPES\|CODEC_ID_BY_INFERRED_TYPE\|resolvedNativeType\|codecBaseNativeType" -- packages` | nothing |
| 3 | `git grep -n "nativeType" -- packages examples apps test` | the Prisma 6 and Prisma 7 schema readers where it names `@db.*` attributes; the old-contract refusal and its test and fixture; the upgrade script and its fixtures |
| 3 | `git grep -nE '(^\|[^A-Za-z])Unsupported\(' -- packages test examples` | the Prisma 6 and Prisma 7 schema readers, their fixtures and tests; `packages/3-extensions/postgres/README.md`, which documents the Prisma 7 reader |
| 4 | `git grep -n "applicableCodecIds\|FUNCTION_ARGUMENT_KEYS" -- packages` | nothing |

## Halt conditions

Stop and report to the orchestrator; do not choose an alternative.

- Any committed `contract.json` changes in slice 1, or any `contract.d.ts` changes other than the SQLite aggregate rows of design 2.7 item 9.
- The golden planner test finds a DDL change in slices 1 to 3 other than the two allowed ones: the `typeRef` quoting fix (slice 1) and SQLite `BigInt` literal defaults written `DEFAULT 42` (slice 2).
- A reported text from a real database that no claiming text of design 2.6 or section 9 covers, for a type that has a data type.
- A column in a committed contract whose codec's data type does not reproduce its stored `nativeType` in slice 1.
- The upgrade script's output differs from regeneration for any file.
- `pnpm lint:framework-vocabulary` would need its threshold raised.
- The design is silent on a choice the implementation needs.

## Retro triggers

Any halt condition; a reviewer round that finds a class of defect the design should have prevented; a slice needing more than ten dispatches.

## Close-out

After slice 4 merges: final retro; map every decision in `design-notes.md` to its durable home (ADR 254, ADR 129, the codec authoring guide, package READMEs, Linear) and list the mapping in the close-out pull request; close TML-3283 with the recorded answer; delete `projects/data-types-completion/`.
