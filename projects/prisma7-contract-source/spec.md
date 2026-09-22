# Prisma 7 contract source and converter

> Shaped 2026-09-13. Every claim below was checked against the code on `main` at f2e3590ff2. Rule tables live in the slice specs under `slices/`; this file holds only what is true at the project level.

## Purpose

Prisma 7 users have a `schema.prisma`. Prisma 8 reads a `contract.prisma` in a different dialect. During the side-by-side period Prisma 7 keeps owning the database and its migrations, so the Prisma 7 schema is the source of truth until cutover. Today the only way to get a Prisma 8 contract from an existing database is `contract infer`, which loses relation field names, ORM-side defaults, and `@updatedAt`, and needs hand fixing after every Prisma 7 migration.

This project lets Prisma 8 read the Prisma 7 schema directly as a contract source, so the transition needs no second schema file, and gives users a converter that prints that contract as Prisma 8 PSL for cutover.

## At a glance

During the transition, `prisma.config.ts` points at the existing file:

```ts
// prisma.config.ts
import { definePrismaConfig } from 'prisma/config';
import { defineConfig as ormConfig, prisma7Schema } from '@prisma/orm-postgres/config';

export default definePrismaConfig({
  orm: ormConfig({
    contract: prisma7Schema('prisma/schema.prisma'),
    db: { connection: process.env['DATABASE_URL']! },
  }),
});
```

`prisma contract emit` and `prisma db sign` work unchanged. When Prisma 7 migrates, the user runs them again.

At cutover:

```bash
prisma contract convert --output src/prisma/contract.prisma
```

writes the same contract as Prisma 8 PSL. The user switches `contract:` to that file and removes Prisma 7.

## Non-goals

- Filling capability gaps. Views, Mongo defaults and automatic timestamps, Mongo `Json`/`Bytes`/`Decimal`/`BigInt`, opaque Postgres columns (`Unsupported(...)` and native types with no codec), referential-action emulation on Mongo, and `relationMode = "prisma"` are hard errors in this project. See § Deferred gaps.
- Query-code rewriting.
- Migration history and `_prisma_migrations`.
- Prisma 6 SQL schemas that are not valid Prisma 7 schemas. The Mongo slice is the exception it has to be: Prisma 7 has no MongoDB connector, so that slice reads the Prisma 6 MongoDB dialect through `prisma6Schema`.
- Extending the Prisma 7 dialect. It is frozen.
- Teaching `contract format` or the language server to read Prisma 7 files.

## Place in the larger world

- The transition story this serves is the public upgrade guides listed under § References: Prisma 7 owns migrations, Prisma 8 adopts the database read-only with `db sign`, and cutover happens once. The older note `projects/prisma-8-rc1/parallel-install.md` assumes `prisma-next` and is out of date; `design-notes.md` reads the guides instead.
- Contract sources are `ContractConfig` objects whose `source.load` returns a contract or diagnostics; the emit path calls it without caring about format (`packages/1-framework/3-tooling/cli/src/control-api/operations/contract-emit.ts:227`). The PSL source (`packages/2-sql/2-authoring/contract-psl/src/provider.ts:65`) and the TypeScript source (`packages/2-sql/2-authoring/contract-ts/src/config-types.ts:90`) are the two existing kinds. This project adds a third, one package per family, mirroring `contract-psl`.
- The Prisma 8 syntax parser (`@internal/psl-parser`) already reads the Prisma 7 grammar almost completely. See `design-notes.md`.
- Every existing PSL printer starts from the database schema description, not from a contract. The contract-to-PSL printer is new and exposed as a target-descriptor hook beside `inferPslContract`.

## Cross-cutting requirements

1. **Hard errors, never warnings.** Every Prisma 7 construct is either expressible in the family contract or rejected with a diagnostic that names the construct, points at its span, and states the fix or that the construct is not yet supported. The interpreter never changes behaviour silently. Diagnostics use the `ContractSourceDiagnostic` shape with codes prefixed `PSL.PRISMA7_`.
2. **Fidelity is defined by `db verify`.** The interpreter must produce a contract that `db sign` verifies with zero findings, in lenient mode, against the database Prisma 7 built. `db verify` (`packages/2-sql/9-family/src/core/diff/schema-verify.ts`) compares: column native type string and nullability (never the codec); column defaults structurally; primary key columns but not the name; foreign key `onDelete` and `onUpdate` with `noAction` equal to absent, but not the name; unique constraints by columns, not the name; indexes by name plus uniqueness, type, and columns; check constraints by name; native enums by type name and ordered member list. Consequences: reproduce Prisma 7's default index names, always set both referential actions explicitly, keep enum member order, and leave key, foreign key, and unique names to Prisma 8.
3. **No Prisma 7 packages in the product.** No framework, family, target, or extension package depends on `prisma`, `@prisma/prisma7`, `@prisma/get-dmmf`, or `@prisma/prisma-schema-wasm`. Parsing uses `@internal/psl-parser`.
4. **Layering.** Family-specific rules live in the family authoring packages (`packages/2-sql/2-authoring/contract-prisma7`, and `packages/2-mongo-family/2-authoring/contract-prisma6` for the Mongo slice). Everything a target must answer arrives through a binding the target pack supplies (`Prisma7TargetBinding`); the authoring package holds no target facts. The Prisma 7 source is a `ContractConfig`, and `defineConfig` in both `@prisma/orm-postgres/config` and `@prisma/orm-mongo/config` accepts `contract: string | ContractConfig`. Nothing family-specific enters `packages/1-framework`.
5. **Round trip is a hash equality.** For every fixture, interpreting the Prisma 7 file and interpreting the converted Prisma 8 file produce the same contract hashes, so the signed marker survives cutover.
6. **Multi-file schemas.** A directory path reads every `.prisma` file in it, matching Prisma 7's multi-file layout.

## Transitional-shape constraints

None. Each slice lands a complete, usable surface: slice 1 ships the Postgres source end to end, slice 2 the Mongo source, slice 3 the converter.

## Contract impact

New contract sources only. No change to the contract JSON shape, `contract.d.ts`, or any migration artefact. The Postgres contract produced from a Prisma 7 schema uses only entity kinds and codecs that exist today.

## Adapter impact

Postgres and Mongo. SQLite is not a Prisma 7 side-by-side target in this project.

## ADR pointer

[ADR 252 — An earlier Prisma version's schema is a contract source](<../../docs/architecture docs/adrs/ADR 252 - An earlier Prisma version's schema is a contract source.md>) records the decisions: the earlier dialect as a first-class contract source, hard errors instead of relaxed Prisma 8 checks, fidelity defined by `db verify`, the opt-in parser grammar, where dialect rules and target facts live, the public names, and the diagnostic code space. The extension point itself is [ADR 163](<../../docs/architecture docs/adrs/ADR 163 - Provider-invoked source interpretation packages.md>), which this project follows rather than changes.

## Project Definition of Done

Inherits `drive/calibration/dod.md`. Project-specific:

- Every rule row and every error code in the slice specs has a fixture that passes through the real parser and interpreter.
- The Postgres and Mongo end-to-end proofs emit, sign, and verify with zero findings in lenient mode against databases shaped by Prisma 7 migrations.
- For every fixture, `hash(interpret(prisma7)) === hash(interpret(convert(prisma7)))`.
- A schema using any unsupported construct fails emit with one diagnostic per construct and no partial output.
- No framework, family, target, or extension package depends on `prisma`, `@prisma/prisma7`, `@prisma/get-dmmf`, or `@prisma/prisma-schema-wasm`. The adoption example app (slice 4) intentionally installs Prisma 7, because showing both side by side is its purpose.
- CLI README documents `contract convert`, and each facade's config reference documents its reader (`prisma7Schema` for Postgres, `prisma6Schema` for Mongo).

## Plan-time verification items

Each is resolved by a test inside the slice that depends on it, before the dependent rule is written.

1. `autoincrement()` lowering versus Prisma 7's sequence default (slice 1).
2. `now()` default equality against Prisma 7's `CURRENT_TIMESTAMP` (slice 1).
3. Contract validator acceptance of a column default together with execution generators, and of generators on nullable columns (slice 1).
4. The version at which the implicit junction gained a primary key (slice 1). Resolved: Prisma 6.0.0; 7.10.0 emits `_AToB_AB_pkey`.
5. Whether Mongo verify compares index names (slice 2).
6. The exact Prisma 7 Postgres native type table (slice 1). Resolved: `test/integration/test/fixtures/prisma7-source/reference/migration.sql`.
7. Whether lenient `db verify` tolerates an extra table, an extra column, and an extra foreign key, which `@ignore` and `@@ignore` rely on because Prisma 7 still creates that schema (slice 1).

## Deferred gaps

Recorded so they are not lost; each becomes its own project when scheduled.

- Views: no schema node, introspection selects `BASE TABLE` only (`control-adapter.ts:702-709`), verify reports a missing table.
- Mongo execution defaults: the Mongo contract validator rejects `execution` (`contract-schema.ts:444-472`); the runtime generator machinery lives only in `packages/2-sql/5-runtime/src/sql-context.ts`; no Mongo timestamp generator; the default's reference shape is SQL-specific.
- Mongo codecs for BSON binary, Decimal128, Int64, embedded documents.
- A `pg/opaque` codec carrying the native type name, which also repairs `contract infer` emitting `Unsupported(...)` that nothing reads back.
- A cuid v1 generator, if mapping `cuid()` to cuid2 turns out to matter.
- Referential-action emulation on Mongo.
- `Bytes` and `DateTime` literal defaults are carried as the SQL literal of the default Postgres stores (`'\x68656c6c6f'`, `'2024-01-01 00:00:00'`), not the text Prisma 7 writes, in the raw-expression form the schema IR already models, because their codec JSON forms are not what introspection reads back. Verification is exact; the cost is that the converter (slice 3) prints them as `dbgenerated("...")` rather than `@default("...")`.
- **Cross-namespace and cross-contract-space enum references: a feature to build.** Any user contract whose column is typed by a Supabase enum (for example a `public` table using `auth.factor_type`) needs it, and Prisma 7 `multiSchema` schemas do the same across schemas. The parser and AST already carry the qualifier (`space:ns.Name` on `PslField.typeContractSpaceId`/`typeNamespaceId`, printer round-trips it), but the SQL interpreter consumes it only for `@relation` (`psl-field-resolution.ts:455`, `interpreter.ts:1228-1240`) and resolves types by bare name (`psl-column-resolution.ts:803-809`, `interpreter.ts:585`). ADR 226 defines cross-space ownership and the `@relation` spelling only. Needs an ADR extending ADR 226 to enum and entity type references, then the interpreter change; until then the Prisma 7 source reports `PSL.PRISMA7_ENUM_NAMESPACE_MISMATCH`.
- Partial indexes (`@@index(where: raw(...))` with the `partialIndexes` preview feature). The Prisma 7 source reports a hard error; mapping them is new capability with its own Prisma 7 evidence.
- Not deferred, assigned to slice 2: the Mongo PSL interpreter silently ignores unknown top-level blocks (`view` included); slice 2 adds the diagnostic.

### Found outside this project's scope

Each exists on `main` unless the line says otherwise, so none is a regression this project caused. Each needs its own piece of work.

- `contract format` deletes a `//` comment written between a block's name and its `{`. In `@internal/psl-parser`'s formatter.
- `contract infer` prints a PascalCase table as a model of the same name with no `@@map`, and Prisma 8 then maps that model to the lower-first table name, so `db verify` reports the table missing. Every Prisma 7 table is PascalCase, so this blocks adopting a Prisma 7 database through infer. In the Postgres target's infer code.
- `contract infer` prints a nullable list column as required; it never prints `Int[]?`, the form that emits and verifies. Every Prisma 7 list column is nullable. In the Postgres target's infer code.
- `db init` fails on a `dbgenerated` date or time default, because the CLI process has no global `Temporal`. In the CLI.
- `db init` fails on an enum list default. In the Postgres target's planner.
- A list default Postgres reports as `'{a,b}'::text[]` or `'{t,f}'::boolean[]` infers as `dbgenerated(...)`, and `contract emit` then stops at that field. In the Postgres default reader.
- `interval`, `timetz`, `bytea`, and `jsonb` list defaults fail `db verify` or Postgres itself; for a `bytea` list, base64 text is stored as the bytes. True of single values on `main` too.
- A timestamp default is compared through a JavaScript `Date`, which drops microseconds, so a one-microsecond difference is not reported; `BC` values and offsets carrying seconds are compared as text rather than as instants. In the SQL family's default comparison.
- The string timestamp presets (`pg/timestamp-string@1`, `pg/timestamptz-string@1`) pair a text codec with `timestampNow`, which hands a JavaScript `Date` to `encode` and `encodeJson` instead of text. In the SQL family's authoring presets.
- A `Timestamp(3)[]` default cannot be created through the CLI at all: the CLI process has no global `Temporal`, so no spelling of a temporal list default reaches the database.
- TypeScript authoring has no typed way to write a `BigInt` default beyond 2^53, and a quoted PSL `BigInt @default("9007199254740993")` is refused. In `contract-ts` and the PSL number default rule.
- SQLite `Decimal` defaults still lose digits; SQLite `BigInt @default(0)` and `@default(-5)` fail `db init`; and a `BigInt` past the `int8` range fails at `db init` rather than at emit. In the SQLite target.
- `docs/reference/error-reference.md`'s `CONFIG.VERSION_MARKER_MISSING` entry tells users to export the result of `defineConfig` from `@prisma/orm-postgres/config`, which is the shape that raises that very error. Belongs with the config loader's documentation.
- When `db sign` fails verification, its next action tells the user to bring the database up to the contract with `db update`. During a side-by-side period that tells the user to let Prisma 8 change a database Prisma 7 owns. Belongs with the `db sign` command or the upgrade guide.
- The CLI engine's terminal renderer prints a finding's code and summary but nothing of its `where`. It lives in the `prisma-cli` repository, which is why every Prisma 7 finding puts its location at the start of the summary.
- `test/integration/test/cli-journeys/infer-roundtrip-fidelity.e2e.test.ts` matches CLI failure output with a regular expression that can never match. It predates this project.
- Removing `dbgenerated(...)` from Prisma 8 is its own project. When it happens it must cover this source, which maps several Prisma 7 defaults onto it.

## Product findings for hand-off

Found by the adoption example (slice 4). Each is outside this project's scope and needs an owner.

- **Raw SQL in the contract, state of play (researched 2026-09-14).** Prisma 8 carries opaque target SQL in three content-addressed places under ADR 234/244 (`@@index` expression and predicate, `@@check`, Postgres RLS predicates); column defaults are the only raw-SQL site compared by normalised text; TS authoring has `.defaultSql(expression)` producing the same arm as `dbgenerated`; ADR 129 (template-tagged literals, `pg.sql\`...\``) is the accepted design for opaque textual payloads in PSL and was never implemented (no backtick token in the tokenizer, no tagged-literal node anywhere); the three existing raw-SQL attribute arguments were built as plain strings instead of ADR 129 literals; generated columns do not exist at all. Whether to remove raw-expression defaults everywhere or design one under ADR 244 is an open decision.
- **`dbgenerated("...")` must be removed from Prisma 8.** It was ADR 167's temporary escape hatch and was never meant to ship; the Postgres and SQLite registries accept it, infer emits it, the Supabase contract carries 21 uses, and the Prisma 7 source maps onto it. Proposed replacement: named storage functions and typed literal defaults; arbitrary expressions become a reported gap.
- **Infer and verify should ignore `_prisma_migrations`.** The public guide has users delete the inferred `PrismaMigrations` model by hand, and strict verify flags the ledger as foreign. Proposed fix: an ignore list supplied by the Postgres facade and passed into both evaluators.

- **Wrong CLI through peer resolution.** `@prisma/client@7.10.0` declares a peer dependency on `prisma`; with pnpm auto-installing peers and no explicit Prisma 8 `prisma` dev dependency, `prisma` resolves to Prisma 7 and `prisma contract emit` runs the wrong CLI. The guide should tell users to keep an explicit Prisma 8 `prisma` dev dependency; the example README does.
- **Provenance policy refuses `prisma@7.10.0`.** Earlier releases had provenance and 7.10.0 does not, so a `trustPolicy: no-downgrade` workspace needs an exact-version exemption. Worth raising with the Prisma 7 release process.
- **The guide's `prisma7.config.ts` snippet** (`url: process.env["DATABASE_URL"]`) does not type-check under `exactOptionalPropertyTypes`. Docs fix for prisma/web.
- **Prisma 8's `temporal.timestamp(onUpdate: now)` failed at write time** (`RUNTIME.ENCODE_FAILED`: the generator yielded an `Instant`, the codec encodes a `PlainDateTime`). Fixed in slice 4.
- **`orm init` writes `definePrismaConfig` from `@prisma/cli-engine`** while the public docs and the published `prisma` package use `prisma/config`. Not changed here; needs a decision from the CLI owners.
- **Prisma 8's own timestamp presets record two clocks in one row.** `temporal.createdAt()` lowers to a database `now()` default, while `temporal.updatedAt()` lowers to the ORM's UTC generator. In a session whose time zone is not UTC the two write different wall-clock values into the same row, so a row can appear to have been updated before it was created. This is Prisma 8 preset design, not the Prisma 7 source, and it needs a product owner.

## References

- The public upgrade guides: [PostgreSQL, 7 to 8](https://www.prisma.io/docs/guides/upgrade-prisma-orm/postgresql) and [MongoDB, 6 to 8](https://www.prisma.io/docs/guides/upgrade-prisma-orm/mongodb). The Postgres guide's phase 2 (`contract infer` plus hand edits) is what the Prisma 7 source replaces; its phase 4 is the cutover routine slice 3 must fit.
- `design-notes.md` for alternatives considered.
- `slices/01-postgres-source/spec.md`, `slices/02-mongo-source/spec.md`, `slices/03-contract-to-psl-and-convert/spec.md`.
