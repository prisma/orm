# Design notes: data types own column types

Working notes while the design is settled with Will. Evidence for every statement is in [`research.md`](research.md). Each question lists the options, what the code says, and a recommendation. A question moves to "Settled" with Will's answer and the reason; the spec is written only from settled answers.

## The project in one paragraph

[ADR 254](../../docs/architecture%20docs/adrs/ADR%20254%20-%20Data%20types%20and%20casts.md) says a data type owns every fact about its database type, and that a codec only says which data type it represents. Today the name of a column's database type is written or computed in eight places that do not agree (research section 2), type constructors name a codec and a type name but never a data type (section 7), and no function argument goes through the cast rule (section 8). This project makes each data type the one source of its database name, the other names a database may report for it, its parameters and how its name is written with them; makes type constructors name data types; and types function arguments by data type.

## Questions to settle

### Q1. Does `contract.json` stop storing a column's `nativeType`? (settled below)

ADR 254 says yes ("the contract loses a redundant field"). The cost, from research section 3: the storage hash covers `nativeType`, so removing it changes the storage hash of every SQL contract. That hash is each migration's `from` and `to`, each `migrationHash`, each snapshot directory name, and the `core_hash`, `origin_core_hash` and `destination_core_hash` already written into users' databases. Every user's committed migration history and every database marker would need rewriting before GA. The runtime never reads the stored value; planners and verify can compute it from the data type once the data type owns the name.

- **(a) Remove it.** Matches ADR 254. Needs an upgrade that rewrites `migration.json` files and snapshot directories, and a way for databases whose marker and ledger hold old hashes to keep working.
- **(b) Keep it, derived.** Nobody authors it: `contract emit` writes it from the data type and its parameters, and the tools that have the stack check it matches. No hash moves, no upgrade. ADR 254's consequence is amended to "derived, never authored".
- **(c) Remove it and keep old hashes.** Not possible: hashing would then need the stack.

Checked for (b): for every codec in every committed contract, the name a data type would produce equals the stored name on Postgres. One exception on SQLite: `sql/char@1` columns store `character` (`examples/prisma-8-demo-sqlite/src/prisma/contract.json`), but that codec represents `sqlite/text`, whose name would be `text`. Either SQLite registers a separate `sqlite/character` data type, or those contracts' hashes move.

**Recommendation: (b).** Everything else the project wants works without removing the field, and (a) makes every RC user rewrite migration history and database state.

### Q1a. How do databases that recorded old hashes keep working? (settled below)

Each database stores its current storage hash in the marker and, per applied migration, the `migration_hash`, `origin_core_hash` and `destination_core_hash` (`packages/3-targets/6-adapters/postgres/src/core/control-adapter.ts:143-145, 294, 406, 434`). `migrate` looks up the marker's hash as a node of the migration graph (`packages/1-framework/3-tooling/cli/src/control-api/operations/migrate.ts:395-470`), and `migration status` matches ledger rows by `migrationHash` (`migration-status-overlay.ts:56-58`). After the file rewrite, none of the old hashes are in the graph, so every command that reads a database would treat it as unknown. A file-only upgrade script cannot change database rows.

- **(a) Rename map, applied automatically.** The upgrade script writes a map of every old hash to its new hash next to the migrations. Every command that reads a marker or ledger row translates an old hash through the map. Commands that already write to the database (`migrate`, `db sign`, `db update`, `db init`) also rewrite the translated rows in the same transaction. Deploy pipelines need no new step.
- **(b) A one-time database command.** A new command rewrites the marker and ledger rows of one database from the map. Every environment runs it once before its next `migrate`; until then commands fail with a message naming the command.
- **(c) `db sign`.** Resets the marker only. The ledger keeps old hashes, so `migration status` shows every applied migration as not applied.

**Recommendation: (a).**

### Q1b. Does a contract in the old format still load? (settled below)

The loader rejects unknown keys (`packages/2-sql/1-core/contract/src/ir/storage-entry-schemas.ts:37-70`), and a contract's stored hash no longer matches after the field is dropped, which the snapshot check refuses (#30086). The test that loads the Supabase contract from before `dbgenerated` was removed (`test/integration/test/contract-format/`) carries `nativeType`.

- **(a)** Refuse it, with a message that names the upgrade script. Old-format contracts are always rewritten, never read.
- **(b)** Accept it by dropping `nativeType` on load and ignoring its stored hash.

**Recommendation: (a).** A contract whose hash cannot be checked is the failure #30086 exists to prevent.

### Q2. Where do a data type's database name, other names and parameters live?

The repository forbids family words (`nativeType`, `table`, `column`, dialect names) in `packages/1-framework` (research section 10), so these facts cannot be fields of the framework `DataType`.

- **(a)** The framework `DataType` gains a parameter schema, which is not SQL-specific (Mongo's `vector` has a length too). The SQL family defines a SQL data type that adds the database name, the other names, and how the name is written with parameters. Mongo later adds its own extension for BSON names. This follows the repository's three-layer pattern (framework interface, family base, target concrete).
- **(b)** Everything on the SQL family's data type, including parameters.

**Recommendation: (a).**

### Q3. Which name is the data type's name, and which are other names?

Postgres has three names for several types: the stored and rendered one (`int4`, `character varying`, `timestamptz`), the one the codec hook uses for parameter casts (`integer`, `double precision`), and the one `format_type` prints (`integer`, `timestamp(3) with time zone`).

- **(a)** The name is today's stored name, so DDL and hashes do not change. Every other name the database may report is listed as another name. Runtime parameter casts use the name, so SQL text changes from `$1::integer` to `$1::int4`, with the same meaning.
- **(b)** As (a), but parameter casts keep a separate name, which leaves two facts.

**Recommendation: (a).**

### Q4. How does verify compare a column's type?

Today it compares strings exactly after normalising only the database side (research section 6), so `decimal`, `integer` or `varchar` in a contract reports drift, and the ALTER TYPE postcheck compares `timestamptz(3)` with `timestamp(3) with time zone`.

- **(a)** Resolve both sides to a data type and parameters through the names and other names, and compare those. A database type no data type claims falls back to comparing strings. This also absorbs the SQLite `character` case in Q1.
- **(b)** Keep string comparison, only generating the expected string from the data type.

**Recommendation: (a).** It is a behaviour change: some differences that report drift today stop reporting.

### Q5. Database parameters and codec parameters

A column has one `typeParams` object. Most parameters belong to the database type (`precision`, `length`). Some belong only to the codec: `arktype/json@1` stores `expression` and `jsonIr` for its TypeScript type, and the column is plain `jsonb` (research section 5).

- **(a)** Keep one `typeParams` object. The data type declares a schema for the keys it owns and renders only those; a codec may declare more keys. No contract format change.
- **(b)** Split into two fields. Contract format change, hashes move.

**Recommendation: (a).**

### Q6. What does a type constructor name?

Today `output: {codecId, nativeType, typeParams}`. ADR 254 says a constructor "names a data type, maps its arguments onto the type's parameters, and picks the codec".

- **(a)** It names a codec and maps arguments onto parameters. The data type follows from the codec, because every codec names exactly one. `nativeType` is deleted from the template. Assembly checks the codec is registered, which today nothing does outside tests.
- **(b)** It names both, and assembly checks they agree.

Arguments are validated by the data type's parameter schema, which removes the per-constructor minimum and maximum copies.

**Recommendation: (a).** ADR 254's sentence is amended to say the data type follows from the codec.

### Q7. Who registers Postgres and SQLite data types and scalar constructors?

The Postgres and SQLite **adapters** register the data types and the main constructor tables, while the codecs live in the **targets** (research sections 1 and 7). ADR 254 says the pack that owns a database type registers its data type, codecs and constructor together.

- **(a)** Move data types and constructors into the target that holds the codecs. TypeScript column helpers keep their public import paths.
- **(b)** Leave them where they are.

**Recommendation: (a).**

### Q8. `contract infer`'s inverse tables

`postgres-type-map.ts` and `infer-default-codec.ts` restate by hand what the data types and constructors will say. Several constructors can name one data type (`BigInt` and `BigIntNumber` for `pg/int8`), so infer needs to know which one to print.

- **(a)** Derive the tables from data types and constructors. Each data type has exactly one constructor marked as the one `contract infer` prints; the marks are chosen so infer's output does not change for any type it prints today. `vector` and `geometry`, which print `Unsupported(...)` today, start printing `pgvector.Vector(n)` and `postgis.Geometry(srid)`.
- **(b)** Keep the hand tables.

**Recommendation: (a).**

### Q9. Function arguments and the SQL expression literals project

ADR 254 says a function parameter names a data type and an argument is admitted by the cast rule. The SQL expression literals project plans a `dataTypeValue` building block for attribute arguments (TML-3288), and is on hold until #30381 merges. Its design is in another worktree, not on `main`.

- **(a)** This project's function-argument slice runs after TML-3288 lands `dataTypeValue`, and uses it.
- **(b)** This project builds `dataTypeValue` first, to TML-3288's design, and TML-3288 reuses it.

In both: a parameter names a data type (`nanoid`'s size is `pg/int4` on Postgres, `sqlite/integer` on SQLite) plus a limit the function owns (2 to 255, or the values 4 and 7). A value of the wrong type reports the cast error; a value outside the limit reports the function's own message, which the outer `@default` choice must no longer replace with "Expected one of". The Prisma 7 source goes through the same parameters, so `nanoid(1000)` and `uuid(5)` stop being accepted.

**No recommendation yet**; it depends on when #30381 is expected to merge.

### Q10. Other written values that are not function arguments

- Enum block member values are read by `JSON.parse` then the codec's `decodeJson`, which is the "codec reads schema text" pattern ADR 254 retires.
- `@@base(Model, "value")` discriminator values are never checked against the discriminator column's type.
- Policy `permissive` is declared `pg/bool@1` but checked by hand.

**Recommendation:** enum member values and discriminator values in scope, read through the same literal rule; `permissive` out, because it is a policy setting and belongs with the block work in #30381.

### Q11. Mongo

Mongo stores no type name in fields. Its BSON type names come from codec `targetTypes` and are copied into collection validators (research section 9). Mongo has no defaults and no function arguments.

- **(a)** In scope only as far as this project's framework changes force it: if `targetTypes` leaves codec descriptors (Q12), the eleven Mongo data types take their BSON names, and Mongo constructors drop their unused `nativeType`. No Mongo casts, written values or validator changes.
- **(b)** Out entirely, keeping `targetTypes` for Mongo.

**Recommendation: (a).**

### Q12. Removing the duplicate sources

`targetTypes` on codec descriptors, the Postgres codec `nativeType(params)` hook, the `expandNativeType` rendering hooks, pack metadata `types.storage[].nativeType`, the dead `normalizeNativeType` and `typeMetadataRegistry`, and the hand tables in Q8 all restate what the data type will own.

**Recommendation:** delete all of them in this project, so each fact has one source.

### Q13. `types {}` aliases and field presets

TML-3055 plans to retire both in favour of mixins. This project changes the template they lower through.

**Recommendation:** keep both working on the new template; retiring them stays TML-3055's decision.

### Q14. A data type writing its own values into migration SQL (TML-3283)

**Answered by Will in the TML-3253 discussion:** no. Values are the codec's job. See the section below. TML-3283 should be closed with that answer.

## Input from the TML-3253 discussion (read 2026-09-28)

TML-3253 is a separate bug slice: literal defaults of `interval`, `bytea` and `timetz` fail `db verify`, and list defaults skip the codec when rendered, so a `bytea[]` default stores the wrong bytes. Its design discussion with Will settled points that bind this project:

1. **Values belong to codecs, not data types (Will).** A codec's sole job is translating between the database representation and the in-memory representation of a column's value. Reading a default the database reports is `codec.decode(text)` then `codec.encodeJson(value)`; writing one into migration SQL is `codec.decodeJson(json)` then `codec.encode(value)`, then quoting. A data type does not parse or print SQL value literals. This answers Q14: a data type never writes values into migration SQL, and TML-3283's question is answered by the codec.
2. **What a data type does own is unchanged:** its id, its casts, and, from this project, its database name, other names, parameters and how the name is written with them. Those are facts about the type's name, not about values.
3. **The adapter knows SQL syntax only.** `parsePostgresDefault` becomes syntax-only (strip casts, unquote, split lists, recognise a short list of function names) and hands each value's text to a codec. The per-type regex cases for numeric, int8 and json go.
4. **TML-3253 needs a lookup this project must supply.** It maps an introspected database type name to a codec, and planned to use codec `targetTypes`, which Q12 deletes. After this project the path is: database type name, to data type (through its name and other names), to a codec of that type. All codecs of one data type share the canonical form, so any of them gives the same JSON; the rule for which one is picked still has to be written down (Q15).
5. **Shared files.** TML-3253 changes `renderDefaultLiteral`, `pgRenderDdlColumnDefault`, `parsePostgresDefault`, `default-normalizer.ts` and the introspection session settings. This project changes the same functions where they branch on `nativeType`. The two must be sequenced (Q16).

### Q15. Which codec reads a default the database reports?

- **(a)** When verifying, the contract column's own codec. When inferring, where no contract exists, the codec of the constructor `contract infer` prints for that data type (Q8).
- **(b)** Each data type names one codec for this purpose.

**Recommendation: (a).** It adds no new declaration.

### Q16. Order relative to TML-3253

- **(a)** TML-3253 lands first on today's `targetTypes` lookup; this project then replaces the lookup when it deletes `targetTypes`.
- **(b)** This project lands the name-to-data-type lookup first, and TML-3253 builds on it.

**Recommendation: (a).** TML-3253 fixes stored wrong data and should not wait for a project.

## Settled

### Q1. `contract.json` stops storing a column's `nativeType` (Will, 2026-09-27)

Option (a). The column keeps `codecId` and `typeParams`; its database name is derived from the codec's data type and the parameters wherever it is needed. The same applies to named `storage.types` entries.

**Why:** 8.0 has not shipped, so this is the last point at which the contract format can change without a major version. Leaving a derived copy in the file keeps two sources for one fact forever.

**Accepted cost:** every SQL contract's storage hash changes, and with it every migration's `from`, `to` and `migrationHash`, every snapshot directory name, and the hashes recorded in users' databases. Users get a mechanical upgrade that rewrites their files, so nobody edits hashes by hand.

**Assumes:** the rewrite needs no network and no database, so it can ship as an upgrade-instruction script. A migration hash is a pure function of `migration.json` without its own hash and `ops.json` (`packages/1-framework/3-tooling/migration/src/hash.ts:89-100`), and a storage hash is a pure function of the contract JSON, so both can be recomputed from files alone.

**Follow-up questions this opens:** how databases that recorded the old hashes keep working (Q1a); whether a contract in the old format still loads (Q1b).

### Q1a. Databases are re-signed with `db sign` (Will, 2026-09-27)

After the upgrade script rewrites a project's files, the user runs `db sign` once against every database. `db sign` verifies that the database schema matches the new contract and writes the new storage hash into the marker. There is no hash map and no automatic translation.

**Why:** it reuses a command that exists and does exactly this job; no new mechanism has to be built, tested and later removed.

**Accepted cost:** ledger rows keep the old migration hashes. `migration status` works out pending migrations from the marker (`packages/1-framework/3-tooling/cli/src/control-api/operations/migration-status-overlay.ts:19-54`), so nothing shows as pending, but migrations applied before the upgrade lose their "applied" label. Until a database is re-signed, commands that read its marker find a hash that is not in the migration graph; the upgrade instruction tells users to sign every environment before its next `migrate`.

### Q1b. A contract in the old format is refused (Will, 2026-09-27)

Loading a SQL contract whose columns or `storage.types` entries carry `nativeType` fails like any other invalid contract: the message names the entry that carries the field and says contracts no longer store it. The message does not mention the upgrade script; telling users how to rewrite their files is the upgrade instruction's job, not the loader's. Old-format contracts are rewritten, never read.

**Why:** after the field is dropped, the contract's stored hash no longer matches its content, and accepting it would bypass the snapshot hash check from #30086.

**Consequence:** the test `test/integration/test/contract-format/supabase-before-dbgenerated-removal.test.ts` changes from "the old contract loads" to "the old contract is refused, naming an entry that carries `nativeType`".

## Engineering decisions (made by the orchestrator, 2026-09-29)

Will asked for these to be decided without him. Each closes the question named in brackets.

1. **Where the facts are declared (Q2).** The SQL family exports a helper, `sqlDataType(id, spec)`. Targets and extensions call it to declare their own types; the family declares none. The framework `DataType` gains one field, the parameter schema. The database name, the other names and the rendering are SQL facts held by the family's SQL data type, because the framework layer may not contain SQL words.
2. **Which name is the name (Q3).** A data type's name is the name contracts store today (`int4`, `character varying`, `timestamptz`), so migration SQL does not change. Every other name a database may report is listed as another name (`integer`, `varchar`, `timestamp with time zone`). The Postgres codec hook `nativeType(params)` is deleted; runtime parameter casts use the data type's rendered name, so `$1::integer` becomes `$1::int4`.
3. **The column stores the data type id.** A column and a `storage.types` entry replace `nativeType` with `dataType`, for example `{"codecId":"pg/int8number@1","dataType":"pg/int8"}`. Code that has no stack, such as the contract validator's junction-column check, compares `dataType` and parameters. The rendered name is derived, never stored. Loading a contract checks that each column's codec represents its `dataType`. An enum column's data type is `pg/enum`; the enum's own name stays in `typeParams.typeName`.
4. **One parameter object (Q5).** A column keeps one `typeParams` object. The data type's parameter schema owns the keys the database type has and renders only those. A codec may declare further keys of its own, as `arktype/json@1` does.
5. **What a type constructor names (Q6).** A constructor names a codec and maps its arguments onto parameters. The data type follows from the codec. The template's `nativeType` is deleted. Assembly refuses a constructor whose codec is not registered. Arguments are validated by the data type's parameter schema, so the per-constructor minimum and maximum are deleted.
6. **Who registers (Q7).** The pack that holds the codecs registers the data types and the type constructors: the Postgres and SQLite targets, not their adapters. TypeScript column helpers keep their public import paths.
7. **One source per fact (Q12).** Deleted: codec `targetTypes`, the Postgres codec `nativeType(params)` hook, the `expandNativeType` hooks, pack metadata `types.storage[].nativeType`, `normalizeNativeType`, `typeMetadataRegistry`, the `storageTypes` annotations, and the hand tables in `postgres-type-map.ts`, `infer-default-codec.ts`, `normalizeFormattedType` and `FORMAT_TYPE_DISPLAY`.
8. **Aliases and presets (Q13).** `types {}` aliases and field presets keep working and lower through the new template. Retiring them is TML-3055's decision.
9. **Values in migration SQL (Q14).** Not a data type's job; answered by Will in the TML-3253 discussion. TML-3283 closes with that answer.
10. **Which codec reads a reported default (Q15).** When verifying, the contract column's own codec. When inferring, the codec of the constructor `contract infer` prints for that data type.
11. **Mongo (Q11).** Mongo changes only where the framework changes force it: the eleven Mongo data types take their BSON type names when `targetTypes` is deleted, the collection validator reads the name from the data type, and Mongo constructors drop their unused `nativeType`. No Mongo casts, written values or validator format changes.
12. **Other written values (Q10).** Enum member values and `@@base` discriminator values are read through the same rule as a default: the written value has a data type, and the receiving column's type must be that type or cast from it. Policy `permissive` is not changed.

## Settled with Will, 2026-09-29

### Order against TML-3253 (Q16)

TML-3253 is fixed as soon as possible, on its own, and does not wait for this project. This project starts from whatever `main` holds then and replaces TML-3253's lookup from a database type name to a codec when it deletes codec `targetTypes`.

### Function arguments (Q9)

The SQL expression literals project is planned in parallel and builds the argument building block that applies the cast rule (TML-3296, then TML-3288). This project's function-argument slice depends on it and reuses it. It is this project's last slice.

### Verify compares identifiers exactly (Q4)

The contract is unambiguous: a column requires one data type, named by its id, with its parameters. Verify compares the contract's data type id and parameters with the database's by exact equality. Nothing is treated as "close enough".

A database reports one type under several texts (`format_type` prints `integer` for `int4` and `timestamp(3) with time zone` for `timestamptz(3)`). Resolving that text to a data type id and parameters is introspection's job, done once when the database is read, through the data type's name and other names. Other names are never consulted when comparing. A reported type that no data type claims has no id, and it is a mismatch against any contract column.

Consequence for SQLite: `sql/char@1` columns were created as `CHARACTER(n)`. The SQLite target declares a data type named `character` for that codec, so rendering does not change and the comparison stays exact.

### `contract infer` and unknown types (Q8)

`contract infer` prints the type constructor for every column whose type a data type in the stack claims, including extension types (`pgvector.Vector(1536)`, `postgis.Geometry(4326)`). Where several constructors name one data type, the data type marks the one infer prints, and the marks reproduce today's output. `Unsupported(...)` is removed: it is not a Prisma 8 type. A column whose type no data type claims makes `contract infer` fail, naming the table, the column and the reported type.

### Resolving a reported type is family code, not target code (Will, 2026-09-29)

One function in the SQL family resolves the type text a database reports to a data type id and parameters. It reads only what the stack's SQL data types declare: each type's name, its other names, and how its name is written with parameters. Every SQL target's introspection calls it; no target carries a table or a resolver of its own. `normalizeFormattedType` in the Postgres adapter and `normalizeSqliteNativeType` in the SQLite target are deleted.

Because parameters can sit inside the reported text (`timestamp(3) with time zone`, `numeric(10,2)`), a SQL data type declares the reading of its texts next to the writing: `render(params)` gives the text, and the declaration also says how each of its texts yields parameters. The family function tries the declared types; exactly one may claim a text, and assembly refuses two data types in one stack that claim the same text.

### Extensions extend introspection by declaring data types (Will, 2026-09-29)

An extension's data types are recognised by introspection with no change outside the extension. The family resolver reads the data types of the whole assembled stack, so a type declared by pgvector or postgis resolves exactly like a target's own. Requirements that follow:

- The resolver, verify and `contract infer` contain no list of type names and no extension-specific branch.
- With the extension in the stack, a `vector(1536)` column resolves to `pgvector/vector` with `{length: 1536}`, verifies by exact equality, and infers as `pgvector.Vector(1536)`.
- Without the extension in the stack, the same column's type is claimed by no data type: verify reports a mismatch and `contract infer` fails naming the column.
- The proof is a test that declares a data type in a test-only extension and introspects, verifies and infers a column of it, with no production code naming that type.

### Agreement with the SQL expression literals project (2026-09-29)

Their order: TML-3296 (the `sql/expression` data type; removes the lowering-entry kind), then a new ticket for the argument building block `dataTypeValue` (number to follow), then TML-3288 (the six SQL positions). All six of our requirements match their design (`projects/sql-expression-literals/design.md` sections 4 to 7, in their worktree). This project's function-argument slice starts only after the building-block ticket merges.

Two constraints they set, which our design must obey:

1. **`dataTypeValue` is never a direct arm of `oneOf`.** It works as a parameter inside a function call signature, and their slice tests that. So `uuid`'s version parameter, today `optional(oneOf(num(4), num(7)))`, becomes one `dataTypeValue` parameter with a further check that the value is 4 or 7. `nanoid`'s size becomes one `dataTypeValue` parameter with a further check of 2 to 255. `cuid`'s version likewise with the value 2.
2. **The named data type must be registered in the stack, or `dataTypeValue` throws an internal error.** A spec shared by targets never hard-codes one target's id. Each target's function registry passes its own id (`pg/int4` on Postgres, `sqlite/integer` on SQLite) into the shared signature builder the SQL family exports. This also removes the duplicated signature definitions in the two adapters.

One problem stays ours: `@default`'s value is a `oneOf`, and a failing arm's message is replaced by "Expected one of: …". When the written call names a registered function, that function's own diagnostics must be reported instead. The function-argument slice specifies this.

## Decisions from the data type inventory (orchestrator, 2026-09-30)

Source: [`inventory/data-types.md`](inventory/data-types.md), which tested a real Postgres and SQLite. The building block from the SQL expression literals project is ticket TML-3367.

1. **Corrections to earlier notes.** SQLite `sql/char@1` columns were created as `CHARACTER`, with no length. Mongo has twelve data types, not eleven. The Mongo validator reads the whole `targetTypes` list, not only its first entry.
2. **Parameters have a declared normal form.** A SQL data type declares how its parameters are normalised, and both sides are normalised before the exact comparison. `pg/numeric`: a precision with no scale equals scale 0, because the database reports `numeric(10)` as `numeric(10,0)`. `pg/char` and `pg/bit`: no length equals length 1, because the database reports `character` as `character(1)`. No stored contract changes.
3. **One bound per parameter, the database's.** `numeric` precision 1 to 1000; `numeric` scale 0 to 1000 and only with a precision; `char` and `varchar` length 1 to 10485760; `bit` and `varbit` length 1 to 83886080; temporal and interval precision 0 to 6; `vector` length required, 1 to 16000; `geometry` srid optional, integer 0 or more.
4. **SQLite gets two new data types.** `sqlite/character` for `sql/char@1` and `sqlite/character-varying` for `sql/varchar@1`, each casting from `sqlite/text` unchanged. Their `length` parameter is accepted and not written into DDL, as today, so existing columns keep matching.
5. **A data type may claim a kind of type instead of a text.** Introspection gives the resolver the reported text and the kind of the type (for Postgres, `pg_type.typtype`). `pg/enum` claims the kind "enum" and builds `typeName` as the bare name for a type in `public` and `schema.name` otherwise, the same rule the contract builder uses. The resolver has no enum branch. Introspection reads the type's schema and name from the catalog, not from `format_type`, so the result does not depend on `search_path`.
6. **Known limit, recorded.** A column in the unbound namespace whose enum type lives outside `public` is a mismatch, because its contract does not say which schema is meant.
7. **A data type's name is optional.** `pg/text-array` declares no name and claims no text, so `text[]` always reads as a list of `pg/text`. `pg/tsquery` declares its name and has no type constructor, so a user column of that type makes `contract infer` fail like an unclaimed type.
8. **Unclaimed Postgres types.** `money`, `xml`, `cidr`, `macaddr`, `tsvector`, ranges, geometric built-ins, domains, composite types, interval with fields, `halfvec`, `sparsevec`, `geography` and the rest listed in the inventory section F.2 are claimed by no data type. The quoted text `"char"` is read with its quotes and does not resolve to `pg/char`.
9. **Mongo.** A Mongo data type declares a list of BSON type names, which may be empty. `mongo/json` lists eight, `mongo/bson` none. The validator keeps its three cases.
10. **`SERIAL`.** The planner chooses `SERIAL`, `BIGSERIAL` or `SMALLSERIAL` by data type id (`pg/int4`, `pg/int8`, `pg/int2`), not by name.
11. **A stale codec id.** `apps/telemetry-backend/migrations/snapshots/41700ef5…/contract.json` names `pg/timestamptz@1`, which no longer exists. The upgrade script carries a table of retired codec ids and their data types for such snapshots.

### SQLite's data types are the ones the database has (Will, 2026-09-30)

A data type is what the database stores. SQLite stores `TEXT`, `INTEGER`, `REAL` and `BLOB`, so the SQLite target declares `sqlite/text`, `sqlite/integer`, `sqlite/real` and `sqlite/blob`, plus `sqlite/character` and `sqlite/character-varying` for columns declared with those names. `sqlite/json`, `sqlite/datetime` and `sqlite/bigint` are deleted as data types; `sqlite/json@1` and `sqlite/datetime@1` become codecs of `sqlite/text`, and `sqlite/bigint@1` and `sqlite/bigintnumber@1` become codecs of `sqlite/integer`. Verify compares data type ids exactly, with no special rule for SQLite.

The shipped code and ADR 254 contradict this: ADR 254 says a target "declares the types it distinguishes rather than one per storage class". That paragraph is a defect in the ADR and is rewritten. There is no "stored as" concept.

Consequences:

- **One stored form per data type.** `sqlite/text` stores a string; a JSON default on SQLite is stored as JSON text and a datetime default as its text. `sqlite/integer` stores digit text for every integer, so 64-bit values keep their precision.
- **The codec refuses what it cannot read.** A `Json` column given `@default("hello")` is refused by the codec, because `hello` is not JSON, not by a missing cast.
- **A `String` column accepts a `json` literal on SQLite**, because the value is text.
- **The `json` tag and the number classifier on SQLite** yield `sqlite/text` and `sqlite/integer` or `sqlite/real`.
- SQLite contracts that hold such defaults change stored form. Their hashes change in this project in any case.

## Decisions from the constructor, change-list and upgrade inventories (orchestrator, 2026-09-30)

Sources: [`inventory/type-constructors.md`](inventory/type-constructors.md), [`inventory/change-list.md`](inventory/change-list.md), [`inventory/upgrade-rewrite.md`](inventory/upgrade-rewrite.md). Where an inventory recommends a "stored as" concept or passing a list of enum names to the resolver, the decisions above replace that recommendation.

1. **TypeScript column descriptor.** `ColumnTypeDescriptor` carries `codecId` and `typeParams`, and no type name. The contract builder requires a codec lookup and writes the codec's data type id into the column. A hand-written `{ codecId, nativeType }` object in a user's `contract.ts` stops compiling; the upgrade instruction tells users to delete the `nativeType` property.
2. **Checks that need the stack run where the stack is.** The contract validator without a stack checks shape only, including that `dataType` is present, and compares junction columns by `dataType` and normalised parameters. The check that a column's codec represents its `dataType`, and the check that a value-object column uses the stack's value-object storage type, run in the target's contract serializer, which has the stack. The hard-coded set `json`, `jsonb` is deleted.
3. **Default comparison.** `resolvedDefaultsEqual`, `DefaultNormalizer`, `parsePostgresDefault` and `parseSqliteDefault` are changed by TML-3253 to take a codec. This project changes only what still takes a type text after that, and passes the data type id.
4. **Runtime.** Each SQL target exports its SQL data types from a shared-plane entry point. The runtime stack holds them by id, and the parameter cast renderer renders the name of the codec's data type.
5. **`ALTER COLUMN TYPE` postcheck.** Each SQL data type marks which of its texts the database catalog prints (`format_type`). The planner renders the postcheck text from that mark. `FORMAT_TYPE_DISPLAY`, `buildExpectedFormatType`, `normalizeFormattedType` and `normalizeSchemaNativeType` are deleted.
6. **New type constructors.** `Bit(length?)`, `VarBit(length?)` and `Interval(precision?)` are added to the Postgres target, because their data types, codecs and TypeScript helpers exist and `contract infer` must be able to print them. `pg/tsquery` gets none.
7. **`pgvector.Vector` and `postgis.Geometry`.** `length` stays required; a `vector` column with no dimension is claimed by nothing. `srid` becomes optional on `postgis.Geometry`; the data type claims `geometry` and `geometry(Geometry,<srid>)`; a column with another subtype is claimed by nothing.
8. **`enum` blocks.** An `enum` block whose `@@type` codec represents a data type with a required parameter is refused, naming the parameter.
9. **`contract infer` receives the stack.** `inferPslContract` takes the same `SqlPslBuildContext` as `buildPslContract`.
10. **Generators say which data types they apply to.** `applicableCodecIds` is replaced by data type ids, passed by each target. Text generators apply to `pg/text`, `pg/char`, `pg/varchar` on Postgres and to `sqlite/text`, `sqlite/character`, `sqlite/character-varying` on SQLite; the UUID generators add `pg/uuid`. This also makes `String @default(uuid())` work on SQLite, which the codec list refuses today.
11. **Pack metadata.** `extensions.<pack>.types.storage[].nativeType` in `contract.json` is deleted with the metadata it is copied from. It is outside every hash.
12. **Upgrade script.** It needs no database, no network and no stack. It maps each `codecId` to a data type id from a fixed table that includes retired codec ids; the `sql/*` codecs map by the contract's target. For a codec id it does not know, and for a contract whose stored hash does not recompute from its content, it changes no file, lists each case with its file, and exits with a failure status.
13. **`db sign` signs every contract space.** Today it signs the app space only, so a database that uses pgvector or postgis would keep an old marker for that space and `migrate` would fail. `db sign` verifies and signs each extension space too.
14. **`migrate` names `db sign`.** The refusal "Database marker is not reachable in the on-disk migration graph" lists `db sign` among its fixes, as `migration status` already does.
15. **In-repository snapshots that do not recompute** (46, in `examples/prisma-8-demo/fixtures/` and `apps/telemetry-backend/`) are regenerated from their sources, not rewritten by the script.

## Decisions from the design review (orchestrator, 2026-09-30)

A verification of the design against the code ran and found 54 issues, and every finding was applied in `design.md`. The three that change the plan's shape:

1. **Slice order.** The contract-format slice (TML-3388) comes before the verify slice (TML-3387). If verify moved to exact comparison first, every SQLite column would report drift until SQLite's data types were corrected. The new order also gives TML-3253 more time. `resolveReportedSqlType` is written in slice 1 as a plain function, so TML-3253's lookup can use it whenever TML-3253 lands.
2. **The upgrade script rehashes contracts whose stored hash does not recompute**, instead of refusing them. The repository's own `apps/telemetry-backend` has two such snapshots in its migration history, written under older rules; any project of that age has the same, and refusing them would leave those users no upgrade path. This replaces upgrade decision 12 above.
3. **The SQL data type module lives in `packages/2-sql/1-core/contract`**, not the family, because the contract builder and the schema readers sit below the family and may not import from it.

Also changed from earlier notes: the SQL text collision check runs in the SQL family's assembly, not the framework's; a codec's parameter schema references its data type's instead of losing its keys; runtime casts render the base name without parameters; `srid` must be 1 or more; `db sign` signs every space that verifies and reports the rest; the framework requires at most one `inferred` mark per data type, and infer fails on a data type with none.
