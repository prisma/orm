# Convenience types for the other PostgreSQL scalars

Linear: TML-3715 (all types except `Json`), TML-3789 (`Json`).

## Summary

```prisma
model Account {
  id       Int     @id                               // exactly Int4
  visits   Int(storage: int2)                         // exactly Int2
  balance  BigInt                                     // exactly Int8BigInt
  rank     BigInt(as: number)                         // exactly Int8Number
  price    Decimal(precision: 10, scale: 2)           // exactly NumericString(10, 2)
  name     String                                     // exactly Text
  code     String(storage: varchar, length: 12)       // exactly Varchar(12)
  ratio    Float                                      // exactly Float8
  active   Boolean                                    // exactly Bool
  avatar   Bytes                                      // exactly Bytea
  settings Json                                       // exactly Jsonb
}
```

PostgreSQL gets convenience types for its other scalars, built the way ADR 279 built `DateTime`, `Date`, `Time` and `Duration`. Each convenience type is named for what a field means in the application: an integer, a decimal number, text. Its arguments choose one explicit type, named after the database type and, where that database type has more than one codec, the application value. The contract stores only the explicit type.

The names users already write (`Int`, `BigInt`, `Float`, `Decimal`, `String`, `Boolean`, `Bytes`, `Json`) stay. They become convenience types. The explicit types they used to name get the database's names (`Int4`, `Int8BigInt`, `Float8`, `NumericString`, `Text`, `Bool`, `Bytea`).

## Why

ADR 257 names every explicit type after what the database stores, so a schema says exactly what each column is. ADR 279 adds a layer of names for application concepts on top, so a user can write what a field means and get a working default. A name such as `Int` should mean "an integer", not "a PostgreSQL `int4`". The codec maps the concept to one database type and one application value.

A survey of 16 data tools (`wip/survey/`, not committed) supports the list of concepts. Every tool that names concepts rather than column types has separate names for an integer and a big integer (SQLAlchemy `Integer` and `BigInteger`, Django `IntegerField` and `BigIntegerField`, Rails `:integer` and `:bigint`, Gel `int32` and `int64`, Prisma 7 `Int` and `BigInt`). Most default JSON to `jsonb` (Prisma 7, Django, Ecto, MikroORM, Hibernate, Gel). Drizzle (`mode: 'bigint'`), MikroORM (`new DecimalType('number')`) and SQLAlchemy (`asdecimal=False`) choose the application value with an option, as `as:` does.

## The convenience types

Every option is optional and has a default, so the bare name is a working type. An argument that is not an option is passed on to the explicit type the row names.

| Convenience type | `as` | `storage` | Becomes |
| --- | --- | --- | --- |
| `Int(storage?)` | | `int4` (default) | `Int4` |
| | | `int2` | `Int2` |
| `BigInt(as?, storage?)` | `bigint` (default) | `int8` (default) | `Int8BigInt` |
| | `number` | `int8` | `Int8Number` |
| | `bigint` | `numeric` | `NumericBigInt` |
| `Float(storage?)` | | `float8` (default) | `Float8` |
| | | `float4` | `Float4` |
| `Decimal(storage?, precision?, scale?)` | | `numeric` (default) | `NumericString` |
| `String(storage?, length?)` | | `text` (default) | `Text` |
| | | `varchar` | `Varchar` |
| | | `char` | `Char` |
| `Boolean(storage?)` | | `bool` (default) | `Bool` |
| `Bytes(storage?)` | | `bytea` (default) | `Bytea` |
| `Json(storage?)` | | `jsonb` (default) | `Jsonb` |
| | | `json` | `PlainJson` |

A type has an `as` option only where its database types have more than one codec. Today only `BigInt` does. Adding one later, such as a decimal library value for `Decimal`, adds an option and rows without renaming anything.

`Int` covers integers read as a JavaScript `number` within 32 bits. `BigInt` covers integers that may exceed 32 bits, as every surveyed tool does. `Int8Number` is reached only through `BigInt(as: number)`, so each explicit type has one convenience call.

Two consequences of the type-choice mechanism, which is not changed (it lives in the framework domain):

- An option's default does not depend on another option. `BigInt(as: number)` works because its default storage `int8` has a `number` row. `BigInt(storage: numeric, as: number)` is refused, because no row exists.
- An argument the chosen type does not take is refused. `String(length: 12)` chooses `Text`, which takes no length, so it is refused at `length`, with a message that says `Text`, the type `storage: text` chooses, takes no `length`. The user writes `String(storage: varchar, length: 12)`.

Types that already name one concept keep a single explicit name and get no convenience type: `Uuid`, `Inet`, `Bit`, `VarBit`, `Xml`, `Oid`, `Money`, `citext.Citext` and `pg.enum(...)`.

## The explicit types after the renames

Names follow ADR 257's token rule and ADR 279's suffix rule: the database type, plus a suffix naming the application value when the database type has more than one codec. No codec id changes.

| Explicit type | Codec id | Database type | Application value | Name today |
| --- | --- | --- | --- | --- |
| `Int2` | `pg/int2@1` | `int2` | `number` | `SmallInt` |
| `Int4` | `pg/int4@1` | `int4` | `number` | `Int` |
| `Int8BigInt` | `pg/int8@1` | `int8` | `bigint` | `BigInt` |
| `Int8Number` | `pg/int8number@1` | `int8` | `number` (safe-integer range) | `BigIntNumber` |
| `NumericString(p?, s?)` | `pg/numeric@1` | `numeric` | `string` (decimal text) | `Numeric`, `Decimal` |
| `NumericBigInt` | `pg/unboundedint@1` | `numeric` | `bigint` | `UnboundedInt` |
| `Float4` | `pg/float4@1` | `float4` | `number` | `Real` |
| `Float8` | `pg/float8@1` | `float8` | `number` | `Float` |
| `Text` | `pg/text@1` | `text` | `string` | `String` |
| `Varchar(n?)` | `sql/varchar@1` | `character varying` | `string` | `VarChar` |
| `Char(n?)` | `sql/char@1` | `character` | `string` | `Char` |
| `Bool` | `pg/bool@1` | `bool` | `boolean` | `Boolean` |
| `Bytea` | `pg/bytea@1` | `bytea` | `Uint8Array` | `Bytes` |
| `Jsonb` | `pg/jsonb@1` | `jsonb` | `JsonValue` | `Jsonb` |
| `PlainJson` | `pg/json@1` | `json` | `JsonValue` | `Json` |

`sql.String(n)` and `sql.Char(n)` stay as they are.

An explicit name that disappears (`SmallInt`, `BigIntNumber`, `Numeric`, `UnboundedInt`, `Real`, `VarChar`) stays for one release line as a deprecated alias of its new name, under ADR 257's rule: `PSL_DEPRECATED_SCALAR_NAME` as a warning, the same codec, no contract change. The names that become convenience types need no alias. At their defaults they give the same codec as today, except `Json`, below.

## `Json` changes its default storage

`Json` today is the explicit type for a `json` column. As a convenience type it defaults to `jsonb`, so a field written `Json` in an existing Prisma 8 schema changes from `json` to `jsonb`. A Prisma 7 schema is not affected: Prisma 7's `Json` was already `jsonb`. See "Slice 2 design" for how users find out, how the migration asks about it, and how to keep `json`.

## Tools

The tools already handle type choices (ADR 279), so no tool code change is expected:

- `contract infer`, `contract print` and the Prisma 7 schema reader write the convenience call that gives a column's explicit type, with only the arguments that differ from the defaults: an `int2` column is `Int(storage: int2)`, `int8` is `BigInt`, `numeric(10,2)` is `Decimal(precision: 10, scale: 2)`, `varchar(12)` is `String(storage: varchar, length: 12)`, `json` is `Json(storage: json)`.
- For each database type, the explicit type marked `inferred` is the one the convenience default gives: `Int8BigInt` for `int8`, `NumericString` for `numeric`.
- The language server completes and explains the new types, and its hover names the explicit type a call becomes.
- In a TypeScript contract, `type.Int()`, `type.BigInt({ as: 'number' })` and so on are typed as the explicit type they choose.

Fixtures, examples and printer goldens that use these names are re-emitted; their `contract.json` files do not change, except for fields written `Json`.

## Scope

In scope: PostgreSQL. The type declarations in `packages/3-targets/postgres/1-target/src/core/type-constructors.ts` and `authoring.ts`, their tests, the `inferred` marks, fixtures and examples, `docs/reference/scalar-types.md`, the codec authoring guide and subsystem docs that list these names, the `prisma-8` skill references, the `app` and `extension` upgrade instructions, and ADR 316, which records the decision and amends ADR 279's "Not decided here".

Out of scope:

- **SQLite, MySQL and MongoDB.** Each uses some of these names for explicit types today. They get the same convenience types, over their own explicit types, in TML-3790.
- **The type-choice mechanism.** It is in the framework domain and does not change. The two limits above are accepted.
- **Convenience types for `Uuid`, `Inet` and the other single-concept types.**

## The `json` type's name

The naming rule gives `Json` for `pg/json@1`, which the convenience type takes, and no value suffix separates it from `jsonb`, because both read a `JsonValue`. Will named it `PlainJson` on 2026-11-06: plain `json`, not `jsonb`. `JsonText` was rejected because it reads as JSON kept in a text column, which is what SQLite's `Json` is. A name in the `pg` namespace, such as `pg.Json`, is not possible: a type choice row names a type constructor at its own level of the namespace, and changing that changes the framework domain.

## Slice 2 design: `Json` (TML-3789)

Reviewed before building by an architect and a principal engineer (Fable), 2026-11-06. Both said build after the changes now folded in below.

```prisma
model Event {
  payload Json                 // Jsonb: a jsonb column
  raw     Json(storage: json)  // PlainJson: a json column
  legacy  PlainJson            // the same as raw
}
```

### Declarations

- In `packages/3-targets/postgres/1-target/src/core/type-constructors.ts`, the `pg/json@1` type constructor is renamed `PlainJson`. It stays marked `inferred` for `pg/json`. Its documentation says "plain `json`, not `jsonb`", because `Plain` also appears in Temporal names such as `Temporal.PlainDate`.
- `Json` becomes a type choice with one option, `storage`: `jsonb` (default) chooses `Jsonb`, and `json` chooses `PlainJson`. There is no `as` option, because both codecs read a `JsonValue`. `Jsonb` keeps its name.
- `Json` gets no deprecation warning. The type choice mechanism has no deprecation mark and requires every option to have a default, so a warning or a forced `storage` argument is not possible without changing the framework. A warning on every `Json` field would also fire on the name users should write.

### What changes for users, and how they find out

- **History.** Before 0.16, PostgreSQL `Json` meant `jsonb`. The 0.16-to-0.17 upgrade (`postgres-json-rebound-to-native-json`) bound `Json` to `json` and added `Jsonb`. It told users who meant `jsonb` to write `Jsonb`, so their contracts do not change now. It also told users to rewrite `Json @db.Json` as `Json`; those fields, and every field written `Json` since, change now. The TypeScript preset `field.json()` was removed later, and its refusal message points at `Jsonb`.
- **Contract change.** A field written `Json` changes from `pg/json@1` (storage `json`) to `pg/jsonb@1` (storage `jsonb`). `contract emit` writes a new storage hash with no diagnostic. `db verify` reports the column.
- **Migration.** `migration plan` and `db update` do not change the column on their own. `json` to `jsonb` is not in the safe-widening table (`packages/3-targets/postgres/1-target/src/core/migrations/safe-widenings.ts`), so the planner classes the type change as destructive, records a `typeChange` data loss, and asks `accept lossy type change of field "Event.payload"`. The user answers `--delete Event.payload` to accept the in-place cast (`ALTER COLUMN "payload" TYPE jsonb USING "payload"::jsonb`), or `--convert Event.payload` on `migration plan` to write the conversion. This stays destructive: `jsonb` drops duplicate keys and normalizes whitespace and key order, it refuses the `\u0000` escape that `json` accepts, and PostgreSQL refuses to alter a column that a view depends on.
- **Keeping `json`.** A user who wants no change writes `Json(storage: json)` or `PlainJson`, and the contract is unchanged.
- **Exception to ADR 257.** ADR 257 keeps a renamed name as a deprecated alias so that a rename never changes a contract silently. Here the name stays and its codec changes, which that rule exists to prevent, and it is the second change to `Json` in the release-candidate line. ADR 316 records this as an exception, with the reason (no deprecation is possible for a type choice without a framework change) and the checks that catch it: the storage hash, `db verify`, and the planner's data-loss question.
- **Upgrade instructions.** New pending fragments under `upgrade-instructions/pending/postgres-json-convenience-type/{app,extension}/`, following `upgrade-instructions/README.md` (each PR adds its own fragment; no release number). The app fragment states the change, the two paths (keep `json` with `Json(storage: json)`, or re-emit and migrate, answering the data-loss question), and the failure cases above. Its detection matches bare `Json`, `Json?`, `Json[]` and a `types {}` alias `= Json`, and not `Json(`. Like slice 1's, it cannot tell PostgreSQL schemas from SQLite or MongoDB ones, and says so. The extension fragment covers `jsonColumn` becoming `plainJsonColumn` and `Json` becoming a type choice in the namespace.

### Tools

No tool code changes. Tests that encode today's binding change with the declaration.

- `contract infer` and `contract print` write `Json` for a `jsonb` column and `Json(storage: json)` for a `json` column. Every printed schema that showed `Jsonb` now shows `Json`.
- The Prisma 7 reader keeps both contracts: Prisma 7 `Json` reads as `Jsonb` and `Json @db.Json` as `PlainJson`. `@db.Json` joins `prisma7PostgresRenamedNativeTypes`, so its message says `use PlainJson in type position`.
- The fill-value check names `pg/jsonb@1` `Json` and `pg/json@1` `PlainJson`.
- The language server's hover names the explicit type a `Json` call becomes.

### TypeScript

- `type.Json()` is typed as `Jsonb`, and `type.Json({ storage: 'json' })` as `PlainJson`.
- The PostgreSQL column helper `jsonColumn` (`packages/3-targets/postgres/2-adapter/src/exports/column-types.ts`) is renamed `plainJsonColumn`, with no alias, following slice 1's rule that a helper takes its explicit type's name. `jsonbColumn` keeps its name. Call sites: `test/e2e/framework/test/fixtures/contract.ts` and `test/integration/test/planner-golden/fixtures/postgres/contract.ts`. SQLite's own `jsonColumn` is not changed.
- The removed-preset refusals for `field.json()` change from `Jsonb` to `Json` / `type.Json()`, like their neighbours `Int` and `BigInt`: `packages/2-sql-family/2-authoring/contract-psl/src/removed-field-presets.ts` and `packages/2-sql-family/2-authoring/contract-ts/src/removed-field-presets.ts`, with their tests.

### Repository schemas

Rule: a PostgreSQL schema that mirrors a real database or tests the `json` type keeps `json` by writing `Json(storage: json)`. Every other PostgreSQL `Json` field moves to `jsonb` and is re-emitted.

- Keep `json`: the Supabase contract (`types { Payload = Json }` mirrors `auth.audit_log_entries.payload`), the engines native-types port (`test/integration/test/ports/engines/queries/data_types/native/postgres/_fixture/other/contract.prisma`), and the collection-methods fixture (`test/integration/test/sql-orm-client/fixtures/collection-methods/contract.prisma`), whose `as_of` method is keyed on `pg/json@1` in `packages/3-extensions/sql-orm-client/test/collection-methods-fixture.ts`.
- The Supabase generator's alias key in `packages/3-extensions/supabase/scripts/generate-contract.ts` changes from `Json` to `Json(storage: json)`, and the contract is regenerated so a second run leaves no diff. Its `Jsonb` fields print as `Json`. `CONTRACT-FIDELITY.md` is updated.
- Move to `jsonb`: the four Prisma port fixtures that translate upstream Prisma's `Json`, which is `jsonb` (`json-fields`, `issues-21454-type-in-json`, `issues-29174-jsonb-parameter-regression`, `issues-29267-uint8array-in-json`), and fixtures with no storage intent, such as `without-conflict-target`. Whole-shape assertions on those may see JSON key order change.
- The `legacy-json` port already writes `Jsonb`. Its comment that says Prisma 8's `Json` is `pg/json@1` is deleted.
- SQLite, MySQL and MongoDB are not changed.

### Docs

- ADR 316 is amended in place, with a dated amendment note. Line 71 is replaced by the `Json` decision. It adds the `Json` rows, the `PlainJson` naming clause (below), the ADR 257 exception (above), and a Consequences line handing SQLite's and MongoDB's `Json` (explicit types that now carry a convenience name, against ADR 315 rule 5) and MySQL's missing `Json` to TML-3790, with SQLite's `jsonColumn` following its explicit type's new name.
- Naming clause for ADR 316: when a database type's only codec would take the convenience name, and no application-value suffix separates it from a sibling type, the explicit type takes a qualifier that names it by contrast with that sibling. `PlainJson` is plain `json`, as opposed to `jsonb`. This departs on purpose from "named after the database type"; PostgreSQL has no type called "plain json".
- ADR 257 gets a dated amendment note for lines 13 and 87, which describe `Json` as an explicit type that stores JSON text.
- `docs/reference/scalar-types.md`: the convenience table gets `Json`, line 84's "no convenience type yet" goes, the explicit row `Json` becomes `PlainJson`, the cross-target concept row says `Json` (a `Jsonb`) for PostgreSQL, and the Prisma 7 mapping table is updated.
- `packages/2-sql-family/2-authoring/contract-psl/README.md`, the PostgreSQL adapter README, the `postgresExplicitTypes` doc comment and the `prisma-8` skill reference are updated.

### Tests

| Claim | Test |
| --- | --- |
| `Json` emits what `Jsonb` emits, and `Json(storage: json)` what `PlainJson` emits, in PSL | `test/integration/test/convenience-scalar-types/convenience-scalar-types.integration.test.ts` |
| the same in TypeScript | `packages/3-targets/postgres/9-facade/test/scalar-convenience-type-helpers.test.ts`, `scalar-convenience-types.test-d.ts` |
| `PlainJson` and `Jsonb` are the marked types for `pg/json` and `pg/jsonb` | `type-choice-inferred-marks.test.ts` |
| infer and print write `Json` and `Json(storage: json)` | `infer-column-types.test.ts`, `infer-parse-emit.test.ts`, the convenience-types infer integration test, the print round-trip suites |
| Prisma 7 `Json` and `Json @db.Json` keep their contracts | `native-types-accepted/expected-contract.json` unchanged; a `Json @db.Json` row in the Prisma 7 print integration test; `prisma7-type-map.test.ts` |
| fill-value naming | `fill-value-check.test.ts`, a row per codec |
| the planner classes `json` to `jsonb` as destructive and asks | `planner.data-loss.test.ts`; one CLI journey: a database built from the old contract, a bare `Json` field, `db verify`, then `migration plan --delete` |
| hover names the explicit type | `test/integration/test/authoring/lsp-postgres-convenience-types.test.ts` |
| `Json` never warns | the "current type name" block of the convenience-types integration test |
| upgrade detection matches bare `Json` only | `test/integration/test/upgrade-instructions/postgres-json-convenience-type/detection.test.ts` |
| fixtures emit byte-identical except moved `Json` fields | `pnpm fixtures:check` |

## Acceptance criteria

- [ ] Each row of the convenience table resolves to its explicit type, in PSL and in a TypeScript contract, and each refused combination named above is refused at its argument.
- [ ] A schema written with the convenience types and one written with the explicit types emit the same `contract.json`.
- [ ] Existing fixtures and examples emit byte-identical `contract.json` files, except fields written `Json`.
- [ ] `contract infer`, `contract print` and the Prisma 7 reader write the convenience calls listed under Tools, and the print round-trip tests pass.
- [ ] Each removed explicit name is a deprecated alias that warns and emits the same contract.
- [ ] `docs/reference/scalar-types.md`, ADR 316 and the upgrade instructions describe the final names, and `pnpm lint:deps` and the CI-only checks pass.
