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
prisma contract print --output src/prisma/contract.prisma
```

writes the same contract as Prisma 8 PSL. The user switches `contract:` to that file and removes Prisma 7.

## Non-goals

- Filling capability gaps. Views, Mongo defaults and automatic timestamps, Mongo `Json`/`Bytes`/`Decimal`/`BigInt`, opaque Postgres columns (`Unsupported(...)` and native types with no codec), referential-action emulation on Mongo, and `relationMode = "prisma"` are hard errors in this project. See § Deferred gaps.
- Query-code rewriting.
- Migration history and `_prisma_migrations`.
- Prisma 6 SQL schemas that are not valid Prisma 7 schemas. The Mongo slice is the exception it has to be: Prisma 7 has no MongoDB connector, so that slice reads the Prisma 6 MongoDB dialect through `prisma6Schema`.
- Extending the Prisma 7 dialect. It is frozen.
- Teaching the language server to read Prisma 7 files. `contract format` formats a Prisma 7 schema with the Prisma 8 formatter when it parses, because the Prisma 7 source is a `psl` source.

## Place in the larger world

- The transition story this serves is the public upgrade guides listed under § References: Prisma 7 owns migrations, Prisma 8 adopts the database read-only with `db sign`, and cutover happens once. The older note `projects/prisma-8-rc1/parallel-install.md` assumes `prisma-next` and is out of date; `design-notes.md` reads the guides instead.
- Contract sources are `ContractConfig` objects whose `source.load` returns a contract or diagnostics; `contract emit` and `contract print` call it without caring about format (`packages/1-framework/3-tooling/cli/src/control-api/operations/load-contract-source.ts`). The framework knows two source formats, `psl` and `typescript`: the PSL source (`packages/2-sql/2-authoring/contract-psl/src/provider.ts`) and the TypeScript source (`packages/2-sql/2-authoring/contract-ts/src/config-types.ts`). The Prisma 7 source is a `psl` source in its own package per family, mirroring `contract-psl`.
- The Prisma 8 syntax parser (`@internal/psl-parser`) already reads the Prisma 7 grammar almost completely. See `design-notes.md`.
- Every existing PSL printer starts from the database schema description, not from a contract. The contract-to-PSL printer is new and exposed as a target-descriptor hook beside `inferPslContract`.

## Cross-cutting requirements

1. **Hard errors, never warnings.** Every Prisma 7 construct is either expressible in the family contract or rejected with a diagnostic that names the construct, points at its span, and states the fix or that the construct is not yet supported. The interpreter never changes behaviour silently. Diagnostics use the `ContractSourceDiagnostic` shape with codes prefixed `PSL.PRISMA7_`.
2. **Fidelity is defined by `db verify`.** The interpreter must produce a contract that `db sign` verifies with zero findings, in lenient mode, against the database Prisma 7 built. `db verify` (`packages/2-sql/9-family/src/core/diff/schema-verify.ts`) compares: column native type string and nullability (never the codec); column defaults structurally; primary key columns but not the name; foreign key `onDelete` and `onUpdate` with `noAction` equal to absent, but not the name; unique constraints by columns, not the name; indexes by name plus uniqueness, type, and columns; check constraints by name; native enums by type name and ordered member list. Consequences: reproduce Prisma 7's default index names, always set both referential actions explicitly, keep enum member order, and leave key, foreign key, and unique names to Prisma 8.
3. **No Prisma 7 packages in the product.** No framework, family, target, or extension package depends on `prisma`, `@prisma/prisma7`, `@prisma/get-dmmf`, or `@prisma/prisma-schema-wasm`. Parsing uses `@internal/psl-parser`.
4. **Layering.** Family-specific rules live in the family authoring packages (`packages/2-sql/2-authoring/contract-prisma7`, and `packages/2-mongo-family/2-authoring/contract-prisma6` for the Mongo slice). Everything a target must answer arrives through a binding the target pack supplies (`Prisma7TargetBinding`); the authoring package holds no target facts. The Prisma 7 source is a `ContractConfig`, and `defineConfig` in both `@prisma/orm-postgres/config` and `@prisma/orm-mongo/config` accepts `contract: string | ContractConfig`. Nothing family-specific enters `packages/1-framework`.
5. **Round trip is a hash equality.** For every fixture `contract print` can write, interpreting the Prisma 7 file and interpreting the printed Prisma 8 file produce the same contract hashes, so the signed marker survives cutover.
6. **Multi-file schemas.** A directory path reads every `.prisma` file in it, matching Prisma 7's multi-file layout.

## Transitional-shape constraints

None. Each slice lands a complete, usable surface: slice 1 ships the Postgres source end to end, slice 2 the Mongo source, slice 3 the converter.

## Contract impact

New contract sources only. No change to the contract JSON shape, `contract.d.ts`, or any migration artefact. The Postgres contract produced from a Prisma 7 schema uses only entity kinds and codecs that exist today.

## Adapter impact

Postgres and Mongo. SQLite is not a Prisma 7 side-by-side target in this project.

## ADR pointer

[ADR 252 — An earlier Prisma version's schema is a contract source](<../../docs/architecture docs/adrs/ADR 252 - An earlier Prisma version's schema is a contract source.md>) records the decisions: the earlier dialect as a first-class contract source, hard errors instead of relaxed Prisma 8 checks, fidelity defined by `db verify`, one parser grammar for every PSL document, where dialect rules and target facts live, the public names, and the diagnostic code space. The extension point itself is [ADR 163](<../../docs/architecture docs/adrs/ADR 163 - Provider-invoked source interpretation packages.md>), which this project follows rather than changes.

## Project Definition of Done

Inherits `drive/calibration/dod.md`. Project-specific:

- Every rule row and every error code in the slice specs has a fixture that passes through the real parser and interpreter.
- The Postgres and Mongo end-to-end proofs emit, sign, and verify with zero findings in lenient mode against databases shaped by Prisma 7 migrations.
- For every fixture `contract print` can write, `hash(interpret(prisma7)) === hash(interpret(print(prisma7)))`. The two fixtures that declare one model name in two namespaces are refused.
- A schema using any unsupported construct fails emit with one diagnostic per construct and no partial output.
- No framework, family, target, or extension package depends on `prisma`, `@prisma/prisma7`, `@prisma/get-dmmf`, or `@prisma/prisma-schema-wasm`. The adoption example app (slice 4) intentionally installs Prisma 7, because showing both side by side is its purpose.
- CLI README documents `contract print`, and each facade's config reference documents its reader (`prisma7Schema` for Postgres, `prisma6Schema` for Mongo).

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
- `Bytes` and `DateTime` literal defaults are carried as the SQL literal of the default Postgres stores (`'\x68656c6c6f'`, `'2024-01-01 00:00:00'`), not the text Prisma 7 writes, in the raw-expression form the schema IR already models, because their codec JSON forms are not what introspection reads back. Verification is exact; the cost is that `contract print` writes them as `sql` tagged literals rather than typed literals.
- **Cross-namespace and cross-contract-space enum references: a feature to build.** Any user contract whose column is typed by a Supabase enum (for example a `public` table using `auth.factor_type`) needs it, and Prisma 7 `multiSchema` schemas do the same across schemas. The parser and AST already carry the qualifier (`space:ns.Name` on `PslField.typeContractSpaceId`/`typeNamespaceId`, printer round-trips it), but the SQL interpreter consumes it only for `@relation` (`psl-field-resolution.ts:455`, `interpreter.ts:1228-1240`) and resolves types by bare name (`psl-column-resolution.ts:803-809`, `interpreter.ts:585`). ADR 226 defines cross-space ownership and the `@relation` form only. Needs an ADR extending ADR 226 to enum and entity type references, then the interpreter change; until then the Prisma 7 source reports `PSL.PRISMA7_ENUM_NAMESPACE_MISMATCH`.
- Partial indexes (`@@index(where: raw(...))` with the `partialIndexes` preview feature). The Prisma 7 source reports a hard error; mapping them is new capability with its own Prisma 7 evidence.
- **Most of the Postgres PSL printer is SQL family logic.** Pairing models with tables, polymorphism, relations, `@@map`, value objects, named types and domain enums need no Postgres knowledge, but they live in `packages/3-targets/3-targets/postgres/src/core/psl-print/`. A second SQL target would have to copy them. The target state: the SQL family builds the PSL document and calls a narrower target hook for column types, defaults, native enums, derived checks and row-level security.
- **`contract print` cannot write an entity kind a pack contributes.** A pack can add an entity kind and its PSL block, but the entity type descriptor has no way back from entity to block, so the printer refuses every kind it does not know. Lifted by an optional inverse on the descriptor, probably with an ADR.
- **The default-function registry cannot map a generator back to its PSL call.** The printer keeps its own table from generators to `uuid()`, `cuid(2)`, `nanoid(n)` and the rest. Lifted by letting each registry entry state which calls produce which generator.
- **The contract does not record which `native_enum` block produced a value set.** The printer rebuilds that link from column references and member lists. Lifted by recording the link on the native enum entity at the next contract shape change.
- **`contract print` refuses a relation into another contract space**, such as a Supabase app's relation to `supabase:auth.AuthUser`. PSL can write it, but the printer would need the composed extension contracts to find the target's columns and foreign key.
- **Setting a default control policy on a PSL source needs `prismaContract(...)` with its full Postgres options.** The facade `defineConfig` has no option for it.
- **The storage hash covers neither the domain nor the default control policy**, so after cutover `db verify` and the signed marker cannot see a difference there. The round-trip tests compare the whole serialized contract; changing what the hash covers is a contract design decision.
- **The PSL reader drops the enum value set from a list field, and the TypeScript builder keeps it.** A TypeScript contract with an enum list field is therefore refused by `contract print`. Decide which is right, then align the other.
- **`contract print` cannot protect a config file named with `--config`**, because the CLI engine does not tell a command which file it loaded. It protects `prisma.config.ts` in the working directory.

### What `contract print` cannot write

`contract print` loads the contract the config names, from any source, and writes it as Prisma 8 PSL that reads back as the same contract. The command does not read its own output back; the printer is held to that promise by tests. The broadest is `test/integration/test/psl-print/every-postgres-contract-roundtrip.integration.test.ts`: it finds every Postgres contract tracked in the repo when it runs, composes the extension packs each one names (the test lists the few packs that exist only inside one example or test, which it cannot load), prints it, reads the text back through the PSL source with the default control policy the printer names for the config, and requires either the same contract as `contract emit` writes it (leaving out `capabilities` and `extensions`, which come from the composed stack) or a refusal the test lists with its reason. Migration snapshots are left out: they are frozen copies of contracts, many in retired formats. Beside it: every Prisma 7 fixture (`contract-prisma7/test/print-roundtrip.test.ts`); emitted and PSL-authored contracts that carry what a Prisma 7 schema cannot, including value objects and lists of them, polymorphism, named types, domain enums, control policies, every index argument, checks named by prefix, primary key names, non-default codecs, row-level security with roles and policies, and the Supabase contract (`adapter-postgres/test/psl-print-roundtrip.test.ts`); every default function and temporal preset the stack registers (`adapter-postgres/test/psl-print-generated-values.test.ts`); TypeScript-authored contracts (`test/integration/test/psl-print/typescript-contract-roundtrip.integration.test.ts`); a pgvector column, with and without a literal default, with the extension in the stack (`test/integration/test/psl-print/extension-types-roundtrip.integration.test.ts`); and a unit test for each refusal the Postgres printer raises (`target-postgres/test/psl-print/`). Each round trip prints through the SQL family instance, the path the command uses, with one helper (`adapter-postgres/test/helpers/psl-print.ts`). Where PSL has no form for part of the contract, the printer refuses it by name with `CONTRACT.PRINT_UNSUPPORTED` and writes no file. Besides walking the models, the printer checks every part of the contract the models do not reach (tables, columns, value sets, namespaces, generated values, `meta` and `roots`) and refuses any part the PSL source would not derive again as it is. The full list of refusals is under that code in `docs/reference/error-reference.md`. A PSL file cannot carry the contract's default control policy; the command names it so the config can set it on the PSL source.

The refusals that a reader or language change would lift:

- One model name declared in two namespaces. The PSL reader groups relations by bare model name (`contract-psl/src/psl-relation-resolution.ts`, `fkRelationsByDeclaringModel`, `modelIdColumns`), so the two models would get each other's relations. Lifted by keying those on (namespace, model).
- A domain enum or value object outside the default namespace. The PSL reader refuses an `enum` block inside a `namespace` block, and reads every `type` block into the default namespace. Lifted by reader changes.
- A foreign key no relation travels, and a to-one relation with no foreign key behind it. The PSL reader derives every foreign key from a `@relation`, and every `@relation(fields:, references:)` lowers to one. Lifted by a relation argument that declines the constraint.
- A relation to a model in another contract space, such as a Supabase app's `supabase:auth.AuthUser`. PSL has the syntax and the reader reads it; the printer does not write it yet, because the printer hook is not given the composed extension contracts.
- A many-to-many relation whose junction table's model has no relation back to it. The PSL reader resolves a many-to-many list field through the junction model's relations.
- A value-object field with type parameters or a value set, such as `pgvector.Vector(3)` in a `type` block. The PSL reader keeps only the codec of a value-object field's type (`contract-psl/src/interpreter.ts`, where it builds value objects). Lifted by a reader change.
- A column whose codec and native type no PSL type in the configured stack produces, such as a `bit` column, or a pgvector column with no length. Lifted by a type constructor, in the target or an extension, that produces it.
- A union or dictionary field, a column or native enum with its own control policy, and a model with an owner. None has PSL syntax.
- A generator no PSL default function of the Postgres adapter produces, and a generator on update other than the wall-clock-now generator. None of the Prisma 7 generators meets either.

The other refusals guard against contracts the sources in this repo do not produce, such as a table with no model, a column no field is stored in, or top-level `meta` entries. The printer refuses them so that a hand-edited or future contract is never changed without a word.

A `Json` object or array literal default was refused in the first version and now prints as a `json` tagged literal through the data types of ADR 254; the `defaults` fixture round-trips. With `dbgenerated` removed (#30380), every other function default prints as a `sql` tagged literal. Three list-column cases were refused in the first version and now print: a nullable list type (`Tag[]?`, printed since #30313), a database-side default on a list column (read since #30325), and type parameters on a list field (`Decimal @db.Numeric(65,30)[]`; the PSL reader now keeps them on the domain field, in `contract-psl/src/interpreter.ts`, `patchModelDomainFields`). Every list fixture round-trips. A policy expression holding a tab or another control character was refused and now prints: the printer writes the expression as a JSON string, as the PSL printer writes every block value, and the policy reader now decodes every JSON escape, `\t` and `\uXXXX` included. A literal default on a column whose codec an extension contributes, such as a pgvector column's `@default([1, 2, 3])`, was refused and now prints: the printer finds the column's data type through the stack's codecs and data types, as the PSL reader does.

### Found outside this project's scope

Each exists on `main` unless the line says otherwise, so none is a regression this project caused. Each needs its own piece of work.

- The PSL source loses any name `__proto__`: a model, field, block or enum member so named. The parser and readers keep names as keys of plain objects, where assigning `__proto__` sets the prototype instead of adding a key (for example `symbol-table.ts` and `block-reconstruction.ts` in `@internal/psl-parser`). `contract print` refuses the name rather than write a file that reads back without it. In the PSL parser and readers.
- The string form of the facade `defineConfig` passes no composed extension packs to the PSL source, so a PSL contract with a ParadeDB `bm25` index fails to emit with an unregistered index type. In `packages/3-extensions/postgres/src/config/define-config.ts`.
- `contract infer` prints a PascalCase table as a model of the same name with no `@@map`, and Prisma 8 then maps that model to the lower-first table name, so `db verify` reports the table missing. Every Prisma 7 table is PascalCase, so this blocks adopting a Prisma 7 database through infer. In the Postgres target's infer code.
- `db init` failed on a `dbgenerated` date or time default, because the CLI process has no global `Temporal`. In the CLI. Recorded before #30380 replaced `dbgenerated` with `sql` tagged literals; not rechecked since.
- `db init` fails on an enum list default. In the Postgres target's planner.
- A list default Postgres reports as `'{a,b}'::text[]` or `'{t,f}'::boolean[]` inferred as `dbgenerated(...)`, and `contract emit` then stopped at that field. In the Postgres default reader. Recorded before #30380; not rechecked since.
- `interval`, `timetz`, `bytea`, and `jsonb` list defaults fail `db verify` or Postgres itself; for a `bytea` list, base64 text is stored as the bytes. True of single values on `main` too.
- A timestamp default is compared through a JavaScript `Date`, which drops microseconds, so a one-microsecond difference is not reported; `BC` values and offsets carrying seconds are compared as text rather than as instants. In the SQL family's default comparison.
- The string timestamp presets (`pg/timestamp-string@1`, `pg/timestamptz-string@1`) pair a text codec with `timestampNow`, which hands a JavaScript `Date` to `encode` and `encodeJson` instead of text. In the SQL family's authoring presets.
- A `Timestamp(3)[]` default cannot be created through the CLI at all: the CLI process has no global `Temporal`, so no form of a temporal list default reaches the database.
- TypeScript authoring has no typed way to write a `BigInt` default beyond 2^53, and a quoted PSL `BigInt @default("9007199254740993")` is refused. In `contract-ts` and the PSL number default rule.
- SQLite `Decimal` defaults still lose digits; SQLite `BigInt @default(0)` and `@default(-5)` fail `db init`; and a `BigInt` past the `int8` range fails at `db init` rather than at emit. In the SQLite target.
- `docs/reference/error-reference.md`'s `CONFIG.VERSION_MARKER_MISSING` entry tells users to export the result of `defineConfig` from `@prisma/orm-postgres/config`, which is the shape that raises that very error. Belongs with the config loader's documentation.
- When `db sign` fails verification, its next action tells the user to bring the database up to the contract with `db update`. During a side-by-side period that tells the user to let Prisma 8 change a database Prisma 7 owns. Belongs with the `db sign` command or the upgrade guide.
- The CLI engine's terminal renderer prints a finding's code and summary but nothing of its `where`. It lives in the `prisma-cli` repository, which is why every Prisma 7 finding puts its location at the start of the summary.
- `test/integration/test/cli-journeys/infer-roundtrip-fidelity.e2e.test.ts` matches CLI failure output with a regular expression that can never match. It predates this project.

## Product findings for hand-off

Found by the adoption example (slice 4). Each is outside this project's scope and needs an owner.

- **Raw SQL in the contract, state of play (researched 2026-09-14; since then #30325 implemented ADR 129 tagged literals for column defaults and #30380 removed `dbgenerated`).** Prisma 8 carries opaque target SQL in three content-addressed places under ADR 234/244 (`@@index` expression and predicate, `@@check`, Postgres RLS predicates); column defaults are the only raw-SQL site compared by normalised text; TS authoring has `.defaultSql(expression)` producing the same arm as `dbgenerated`; ADR 129 (template-tagged literals, `pg.sql\`...\``) is the accepted design for opaque textual payloads in PSL and was never implemented (no backtick token in the tokenizer, no tagged-literal node anywhere); the three existing raw-SQL attribute arguments were built as plain strings instead of ADR 129 literals; generated columns do not exist at all. Whether to remove raw-expression defaults everywhere or design one under ADR 244 is an open decision.
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
- `slices/01-postgres-source/spec.md`, `slices/02-mongo-source/spec.md`, `slices/03-contract-to-psl-and-print/spec.md`.
