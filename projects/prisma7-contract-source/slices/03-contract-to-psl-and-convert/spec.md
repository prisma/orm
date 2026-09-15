# Slice 3: contract-to-PSL printer and `prisma contract convert`

_Parent project: `projects/prisma7-contract-source/`. Outcome: a user on a Prisma 7 source runs one command and gets a Prisma 8 `contract.prisma` that produces the identical contract._

## At a glance

```bash
prisma contract convert --output src/prisma/contract.prisma
```

Output begins:

```prisma
// use prisma-8
// Converted from prisma/schema.prisma by `prisma contract convert`.
```

## Chosen design

- **Contract-to-PSL printer.** A new target-descriptor hook beside `inferPslContract`, implemented for Postgres in this slice, that takes the family contract and returns a `PslDocumentAst`. Text comes from the existing `printPsl`, which gains one option: the comment lines that follow `// use prisma-8` (today that text is hard-coded to infer's wording in `packages/1-framework/2-authoring/psl-printer/src/ast-to-print-document.ts`; infer passes its own text, convert passes the line above).
- **Command** `contract convert` in `packages/1-framework/3-tooling/cli/src/orm/contract/convert.ts`, registered in `family.ts` and `cli.ts`. It requires the configured contract source to be a Prisma 7 source (`source.format === 'prisma7'`), loads the contract through the same path `contract emit` uses, prints, and writes with `publishTextArtifact`. Output path resolution reuses `inferredContractPathFor`. Refusals write nothing.
- **Round trip test.** For every Prisma 7 fixture: interpret the Prisma 7 file, print, interpret the output with the PSL source, compare `storageHash`, `executionHash`, and `profileHash`, and deep-compare the `domain` plane. The domain comparison is required because no hash covers the domain plane, and the domain is what `contract.d.ts` and the user's client code see.

## Printing rules (Postgres)

Every rule inverts a rule of the PSL interpreter in `packages/2-sql/2-authoring/contract-psl/`, so the printed file interprets back to the same contract.

| Contract | Prisma 8 PSL |
|---|---|
| Model, field, relation field names | Verbatim from the domain plane. |
| Namespace | `namespace <id> { … }` around its models and enum blocks. |
| Table name | `@@map("<table>")` unless the table equals `lowerFirst(modelName)`, which is what the PSL interpreter derives. A Prisma 7 model `User` has table `User`, so nearly every converted model carries `@@map`. |
| Column name | `@map("<column>")` unless it equals the field name. |
| Native type | The bare Prisma 8 constructor for the column's `nativeType` and `typeParams` (`VarChar(255)`, `Timestamp(3)`, `Uuid`, …), the scalar keyword where one exists (`text` → `String`, `int4` → `Int`, `bool` → `Boolean`, `float8` → `Float`, `int8` → `BigInt`, `numeric(65,30)` → `Decimal`, `jsonb` → `Json`, `bytea` → `Bytes`), `?` for nullable, `[]` for `many`. List columns carry `@noCheck(elementNotNull)` when the contract's `noCheck` says so. |
| Native enum | `native_enum <Handle> { <member> = "<value>" … }` with `@@map("<typeName>")` when the type name differs from the handle; the handle is the `valueSet` entry name (the only place the block name survives). Fields reference it as `pg.enum(<Handle>)`. |
| Primary key | `@id` on a single column, `@@id([…])` otherwise; `map:` only when the contract names it. |
| Unique index | `@@index([…], unique: true, map: "<name>")`, never `@unique`/`@@unique`: Prisma 7 creates unique indexes, and the PSL interpreter lowers `@unique` to a unique constraint, which `db verify` distinguishes. |
| Index | `@@index([…], map: "<name>")` for exact names (no `prefix`), `name:` for wire names; `type:` when present. |
| Storage default | `autoincrement()`, `now()`, literals, list literals, enum member storage value as a string literal; the raw-expression arm prints through the same Postgres default mapping table `contract infer` uses (`postgres-default-mapping.ts`), so today it prints `dbgenerated("…")`. The dbgenerated removal brief (tracked outside this project) replaces that table's output for infer and convert in one place. |
| Execution generator | `@default(uuid(4))`, `uuid(7)`, `cuid(2)`, `ulid()`, `nanoid(n)`. A create-and-update timestamp generator pair becomes the field preset `temporal.timestamp(<precision>, onCreate: now, onUpdate: now)` or `temporal.timestamptz(…)` by codec. |
| Foreign key | `@relation(fields: […], references: […], onDelete: <Action>, onUpdate: <Action>)`, plus `name:` when the domain relation is named, on the field the domain plane marks as the owning side. |
| Junction model (implicit many-to-many) | An ordinary model `AToB` with `@@map("_AToB")`, `@@id([A, B])`, `@@index([B], map: "_AToB_B_index")`, two relation fields with `Cascade` both ways; the two list fields on the joined models stay bare lists, which the PSL interpreter pairs through the junction into the same `N:M` domain relations. |
| `@@control` | `@@control(<policy>)` when the table sets one. |

## Edge cases

| Case | Disposition |
|---|---|
| Config uses a PSL or TypeScript source | Structured error saying convert only applies to a Prisma 7 source. Nothing written. |
| Output file exists | Warn and overwrite, as `contract infer` does. |
| A construct the Prisma 8 PSL cannot spell | The printer throws an internal error naming the construct; the round trip test catches it. None is expected; dispatch 1 proves it by hand before the printer exists. If one appears, it is a feature to build in the PSL interpreter, never a relaxed check (operator rule, `design-notes.md`). |
| Mongo | The Mongo printer needs the Mongo source and its fixtures and moves to slice 2 (amended 2026-09-14). |

## Cutover in the guide's terms

The docs describe cutover as phase 4 of the public guide (https://www.prisma.io/docs/guides/upgrade-prisma-orm/postgresql): run `prisma contract convert`, point `contract:` at the written file, run `prisma contract emit`, then `prisma migration plan --name baseline`, `prisma db sign`, `prisma migration ref set db <timestamp>_baseline`, and remove Prisma 7.

## Slice Definition of Done

Inherits `drive/calibration/dod.md`. Slice-specific:

- [ ] Round trip (three hashes and the domain plane) holds for every fixture under `packages/2-sql/2-authoring/contract-prisma7/test/fixtures/` that has an `expected-contract.json`, and for `test/integration/test/fixtures/prisma7-source/{supported-verify,relations}`.
- [ ] The printed output for `supported-verify` emits with the PSL source and `db verify` reports zero findings against the database Prisma 7 built.
- [ ] `packages/1-framework/3-tooling/cli/README.md` documents `contract convert`; the Prisma 7 source README and the Postgres extension README describe cutover in phase 4 terms; `examples/prisma7-adoption` runs the cutover in its test.
- [ ] `--json` output carries the written path.
