# @internal/target-postgres

Postgres target pack for Prisma 8.

## Package Classification

- **Domain**: targets
- **Layer**: targets
- **Plane**: multi-plane (migration, runtime)

## Purpose

Provides the Postgres target descriptor (`SqlControlTargetDescriptor`) for CLI config. The target descriptor includes capabilities and type information directly as properties, as well as factories for creating migration planners and runners.

## Responsibilities

- **Target Descriptor Export**: Exports the Postgres `SqlControlTargetDescriptor` for use in CLI configuration files
- **Descriptor-First Design**: All declarative fields (version, capabilities, types, operations) are properties directly on the descriptor, eliminating the need for separate manifest files
- **Multi-Plane Support**: Provides both migration-plane (control) and runtime-plane entry points for the Postgres target
- **Planner Factory**: Implements `migrations.createPlanner()` to create Postgres-specific migration planners
- **Runner Factory**: Implements `migrations.createRunner()` to create Postgres-specific migration runners
- **Contract-to-Schema**: Implements `migrations.contractToSchema()` which converts a contract's `SqlStorage` to `SqlSchemaIR` via the SQL family's `contractToSchemaIR`. Used by `migration plan` for offline planning without a database connection
- **Schema Verification Normalization**: Normalizes Postgres default expressions (for example, `nextval(...)`, `now()`) when verifying the post-apply schema
- **Date and time canonical forms**: each date and time data type declares its canonical form ([ADR 254](../../../../docs/architecture%20docs/adrs/ADR%20254%20-%20Data%20types%20and%20casts.md#date-and-time-types)) with `pgDateCanonical`, `pgTimeCanonical`, `pgTimetzCanonical`, `pgTimestampCanonical` and `pgTimestamptzCanonical` in `src/core/data-types.ts` and `pgIntervalCanonical` in `src/core/codec-helpers.ts`. Both DDL paths write a default's year as PostgreSQL reads it through `postgresDateTimeDdlText` in `src/core/date-time-ddl-text.ts`.
- **Postgres-Only Contract Extensions**: Defines Postgres-specific column defaults (e.g., sequences) used by the migration planner
- **Generated Defaults Policy**: Treats client-generated defaults as non-DB defaults when emitting DDL
- **Database Dependency Consumption**: The planner extracts database dependencies from the configured framework components (passed as `frameworkComponents`), verifies each dependency against the live schema, and only emits install operations when required. The runner reuses the same metadata for post-apply verification, so there are no hardcoded extension mappings—database dependencies stay component-owned.
- **Storage Type Planning**: The planner dispatches storage type hooks for `storage.types` and emits type operations before table creation when supported by the policy
- **Contract-to-PSL Printing**: Implements the `buildPslContract` descriptor hook, which `prisma contract print` uses. It takes a Postgres contract the contract serializer accepted, from any source, and returns the Prisma 8 PSL document that reads back as the same contract. It does not check the contract's structure again; a broken structure is an internal error. It writes models, value objects, named types, domain and native enums, keys with their names, indexes, checks, relations, polymorphism, control policies, row-level security (`@@rls`, policies, and roles in `namespace unbound`) and defaults. A column is written as a type constructor the configured stack contributes that reads back with its codec, native type and type parameters: the type `contract infer` writes for the native type when the stack's constructor of that name does, or else the first constructor in the stack that does, such as `DateTime` or `Timestamptz(3)` for a `Temporal`-backed `timestamptz` column, or an extension's `pgvector.Vector(3)`. A value-object member has no column, so its type goes through the stack the same way: the stack's codec names the native type for the member's type parameters, and the member is written as the type constructor for that native type, called with those parameters (`Numeric(10, 2)`); a member typed by a domain enum is written by the enum's name. The contract does not record which named type a member used, so a member written `code Short`, with `types { Short = VarChar(10) }`, is printed as the type it stands for, `code VarChar(10)`; a model field keeps `Short`, because its column names the named type. A literal default is written by the data type of the column's codec. The family passes the stack's type constructors, codecs and data types to the hook for this. Anything it cannot write so that it reads back the same is refused by name with `CONTRACT.PRINT_UNSUPPORTED` (the full list is in `docs/reference/error-reference.md`, one function per case in `src/core/psl-print/refusals.ts`); nothing is dropped. It lives in `src/core/psl-print/`, the counterpart of the `inferPslContract` hook in `src/core/psl-infer/`, which writes PSL from a live database. Both build with the shared builders in `src/core/psl-build/`: literals, index and check attributes, the native enum block, and the type map. Model and field names come from the contract; `@@map` and `@map` appear only where the name the PSL source would derive differs. A unique constraint prints as `@@unique` and a unique index as `@@index(..., unique: true)`; every index prints explicitly, and a relation writes `index: false` when nothing backs its foreign key, no `index` argument when a relation that says nothing would be backed by the same object (`defaultForeignKeyIndex`), and otherwise `index: "<name>"` naming the index, or the key whose first columns are the foreign key's. Execution generators join back onto their columns: an id generator prints as its `@default` call, and a wall-clock-now pair prints as the `temporal.*` preset of the column's codec.
- **`Temporal` for the target's own code**: The `Temporal`-backed codecs (`pg/date-temporal@1`, `pg/time-temporal@1`, `pg/timestamp-temporal@1` and `pg/timestamptz-temporal@1`), when they decode, and the `instantNow` and `plainDateTimeNow` generators get `Temporal` from `requireTemporal()` (`src/core/require-temporal.ts`): the runtime's global `Temporal` when it has one, else the fallback `Temporal`, else it throws `RUNTIME.TEMPORAL_UNAVAILABLE`. The text codecs (`pg/date-string@1`, `pg/time-string@1`, `pg/timestamp-string@1`, `pg/timestamptz-string@1` and `pg/timetz@1`), `pg/timestamptz-date@1` and the `timestampNow` generator do not use `Temporal`, so an application that uses only them reads and writes its date and time columns without one. The target's control entry (`@internal/target-postgres/control`) sets the fallback `Temporal`, from `temporal-polyfill`, when it is loaded. Nothing sets `globalThis.Temporal`. No other entry of this package imports `temporal-polyfill`. `temporal-polyfill` is a required peer dependency of this package and of the published `@prisma/orm-target-postgres` and `@prisma/orm-postgres`, so a project that already installs it for its own code has one copy. npm, pnpm and bun install it automatically; a project that uses Yarn adds `temporal-polyfill` to its own dependencies. In the published package, `@prisma/orm-target-postgres/target` is the aggregate of every entry of this package, the control entry included, so it loads the control entry too; an application imports the entry it needs, for example `@prisma/orm-target-postgres/target/runtime`. The fallback is held once per process, and every `Temporal`-backed codec in the process uses it. An application process that loads no control-plane code and has no global `Temporal` gets `RUNTIME.TEMPORAL_UNAVAILABLE` when one of those codecs decodes or one of those generators runs. An application that loads control-plane code in its own process, such as server code under `vite dev` with the Prisma Vite plugin or a script that calls the control client, decodes dates without its own `Temporal`, and then fails in production. An application that uses the Temporal codecs must load its own `Temporal`.
- **Runtime List Framing**: Parses inbound Postgres array text for contract-declared list columns before applying the scalar element codec. Builtin arrays and enum arrays therefore share one target-owned decode path; fixed-scale `numeric(30,10)[]` reads database-normalized text such as `"1.5000000000"`, matching scalar numeric decoding rather than the previous driver numeric-array float spelling `"1.5"`.

This package spans multiple planes:

- **Migration plane** (`src/exports/control.ts`): Control plane entry point that exports `SqlControlTargetDescriptor` for config files
- **Runtime plane** (`src/exports/runtime.ts`): Runtime entry point for target-specific runtime code, including list decoding
- **Authoring pack ref** (`src/exports/pack.ts`): Pure data surface for contract builder workflows

## `db init`

This package provides the Postgres implementation of the SQL migration planner/runner used by `prisma db init`:

- **Planner** (`src/core/migrations/planner.ts`): produces an additive-only `MigrationPlan` to bring the database schema in line with a destination contract. Extra unrelated schema is tolerated; non-additive mismatches (type/nullability/constraint incompatibilities) surface as structured conflicts. Storage type operations (from codec-owned hooks) are emitted before table operations when `storage.types` are present. A foreign key's backing index is an ordinary entry of the table's `indexes`, created like any other; a foreign key the source declares with `constraint: false` has no `foreignKeys` entry, so no constraint is created. See [ADR 161](../../../docs/architecture%20docs/adrs/ADR%20161%20-%20Explicit%20foreign%20key%20constraint%20and%20index%20configuration.md). The planner also emits `ON DELETE` and `ON UPDATE` referential action clauses when specified on foreign keys (see [ADR 166](../../../docs/architecture%20docs/adrs/ADR%20166%20-%20Referential%20actions%20for%20foreign%20keys.md)).
- **Runner** (`src/core/migrations/runner.ts`): executes a plan under an advisory lock, verifies the post-state schema, then writes the contract marker and appends a ledger entry in the `prisma_contract` schema.

For the CLI orchestration, see `packages/1-framework/3-tooling/cli/src/commands/db-init.ts`.

## Usage

### Control Plane (CLI)

```typescript
import postgres from '@internal/target-postgres/control';
import sqlFamilyDescriptor from '@internal/family-sql/control';
import postgresAdapter from '@internal/adapter-postgres/control';
import postgresDriver from '@internal/driver-postgres/control';

// postgres is a SqlControlTargetDescriptor with:
// - kind: 'target'
// - familyId: 'sql'
// - targetId: 'postgres'
// - id: 'postgres'
// - version: '0.0.1'
// - capabilities, types, operations (directly on descriptor)
// - migrations.createPlanner(): creates a Postgres migration planner
// - migrations.createRunner(): creates a Postgres migration runner

// Create family instance with target, adapter, and driver
const family = sqlFamilyDescriptor.create({
  target: postgres,
  adapter: postgresAdapter,
  driver: postgresDriver,
  extensions: [],
});

// Include the active framework components so planner/runner can resolve
// component-owned database dependencies (e.g., extension installs).
const frameworkComponents = [postgres, postgresAdapter];

// Create planner and runner from target descriptor
const planner = postgres.migrations.createPlanner(family);
const runner = postgres.migrations.createRunner(family);

// Plan and execute migrations
const planResult = planner.plan({ contract, schema, policy, frameworkComponents });
if (planResult.kind === 'success') {
  const executeResult = await runner.execute({
    plan: planResult.plan,
    driver,
    destinationContract: contract,
    policy,
    frameworkComponents,
  });
  if (!executeResult.ok) {
    // Handle structured failure (e.g., EXECUTION_FAILED, PRECHECK_FAILED)
    console.error(executeResult.failure.code, executeResult.failure.summary);
  }
} else {
  // Handle planner failure (e.g., unsupportedOperation)
  console.error(planResult.conflicts);
}
```

### Pack refs for TypeScript contract authoring

```typescript
import postgresPack from '@internal/target-postgres/pack';
import pgvector from '@internal/extension-pgvector/pack';
import sqlFamily from '@internal/family-sql/pack';
import { defineContract } from '@internal/sql-contract-ts/contract-builder';

export const contract = defineContract({
  family: sqlFamily,
  target: postgresPack,
  extensions: { pgvector },
});
```

Pack refs are pure JSON-friendly objects that make TypeScript contract authoring work in both emit and no-emit workflows without requiring separate manifest files.

### Full-text search

This package contributes the built-in Postgres query operations — `ilike`, and the three full-text search operations below — through `queryOperations` on its runtime descriptor, with their types on `./operation-types`. Emitted `contract.d.ts` files import them from there.

`fullTextMatches` is a predicate, `fullTextRank` scores a row for ordering, and `fullTextHeadline` returns the matched text with `<b>` around the matching words. All three take a `tsquery` as their first argument. A bare string is a type error: Postgres would read it as `tsquery` syntax without lowercasing or stemming it, so a search-box string would match nothing or fail. Build the query with a helper from `./full-text`:

- `websearchToTsquery(text)` for a search box: quotes, `or` and `-` work, and it never errors. `plaintoTsquery` requires every word, and `phrasetoTsquery` requires the words in order.
- `` tsquery`${term}:*` `` for `tsquery` operator syntax around user input, such as a typeahead prefix match. The literal parts are trusted syntax the application writes. Each interpolated value becomes exactly one quoted term, so user input cannot add operators or break the syntax. An empty value adds no words, like a stop word. A value with several words becomes a phrase: `` tsquery`${'new y'}:*` `` gives `'new':* <-> 'y':*`, so the words must be adjacent and in order, and `:*` applies to each word. Do not put quotes around the interpolation yourself: `` tsquery`'${term}':*` `` is a syntax error for every input. Postgres `to_tsquery` then lowercases and stems every word. `` tsquery({ language: 'german' })`...` `` picks the configuration.
- `toTsquery(text)` for operator syntax the application writes in full, such as `'zebra' & !'graze'`. Malformed text fails at execution, so never pass user input; use the `tsquery` tag instead.

The four parsers take text (a string, or a column of any `textual` type such as `text` or `varchar`) and `{ language? }`, bind the text as a parameter, and lower to the Postgres function of the same name. They are also registered as query operations that attach to no column, so the SQL builder's `fns` has them by name; the ORM reaches them, and the `tsquery` tag, through the import. A `tsquery` value read back from a query can be passed straight back as the query; it binds as a `tsquery` parameter.

Each operation takes an options object as its second argument. `language` is common to all three, defaults to `english`, and is the configuration of the column-side `to_tsvector` the index covers (the parser's or tag's own `language` governs the query side); `fullTextRank` adds `normalization` (the `ts_rank` bitmask, 0 to 63) and `coverDensity` (which selects `ts_rank_cd`); `fullTextHeadline` adds `startSel`, `stopSel`, `maxWords`, `minWords` and `highlightAll`, which become `ts_headline`'s fourth argument:

```typescript
row.text.fullTextRank(websearchToTsquery(query, { language: 'german' }), {
  language: 'german',
  normalization: 32,
  coverDensity: true,
});
row.text.fullTextHeadline(websearchToTsquery(query), {
  startSel: '<mark>',
  stopSel: '</mark>',
  maxWords: 20,
});
```

Postgres takes no parameter in any of those positions, so every option is written into the SQL as a literal and is therefore checked first: an unknown configuration, a normalization outside 0 to 63, a word count that is not a positive integer, a `minWords` above `maxWords`, or a marker carrying `ts_headline`'s own `"` `,` `=` delimiters all raise `RUNTIME.ARGUMENT_INVALID` before a statement is built.

Through the ORM:

```typescript
import { tsquery, websearchToTsquery } from '@internal/target-postgres/full-text';

const q = websearchToTsquery(query);
const hits = await db.orm.public.Message.select('id', 'text')
  .where((row) => row.text.fullTextMatches(q))
  .orderBy((row) => row.text.fullTextRank(q).desc())
  .limit(20)
  .all();

const suggestions = await db.orm.public.Message.select('id', 'text')
  .where((row) => row.text.fullTextMatches(tsquery`${term}:*`))
  .all();
```

Through the SQL builder, with one query for the filter, the order and the snippet, so the snippet highlights what selected the row:

```typescript
const q = websearchToTsquery(query);
const snippets = db.sql.public.message
  .select('id')
  .select('snippet', (f, fns) => fns.fullTextHeadline(f.text, q))
  .where((f, fns) => fns.fullTextMatches(f.text, q))
  .orderBy((f, fns) => fns.fullTextRank(f.text, q), { direction: 'desc' })
  .build();
```

Postgres computes `to_tsvector` per row unless an index covers the predicate's expression — the same search document over the same columns, configuration and weights, which it compares as parsed expressions rather than as text. `@@fullTextIndex`, contributed by this package, declares that index from the fields and the language, so you never write the expression by hand:

```prisma
@@fullTextIndex([text], name: "message_text_search")
@@fullTextIndex([text], where: sql`archived_at IS NULL`, name: "message_text_search_live")
@@fullTextIndex([[title, subtitle], body], name: "post_search")
```

The fields are one field, or a list whose items are fields or lists of fields. Each top-level item is a weight group, strongest first: `title` and `subtitle` weigh `A`, `body` weighs `B`. There are at most four groups, `A` to `D`. A single field has no weight. The contract stores the index as data: an index of type `fullText` over the covered columns, whose `options` hold the weight groups (as storage column names) and the language. `fullText` is registered in this package's index type registry beside the access methods, with `gin` as its access method; in the database it is a `gin` index over the search document. Its `columns` are always the fields of its groups, in order, and a contract where they differ is refused:

```json
{ "columns": ["title", "subtitle", "body"], "type": "fullText", "options": { "weightGroups": [["title", "subtitle"], ["body"]], "language": "english" } }
```

One renderer turns those options into the search document, for the index DDL, for the schema that migrations and verification compare, and for the queries. With more than one group each field is weighted with `setweight`; with more than one field every column is wrapped in `coalesce(column, '')`, so the document does not depend on whether a column is nullable; one field alone is `to_tsvector('english', "text")`, the expression the column operations use.

The TypeScript contract builder has the same helper, exported from the facade's contract-builder entry:

```typescript
model('Post', { fields: { id, title, subtitle, body } }).sql(({ cols }) => ({
  indexes: [fullTextIndex([[cols.title, cols.subtitle], cols.body], { name: 'post_search' })],
}));
```

Both take an optional `language` (default `english`, from the same allowlist the operations accept), an optional `where:` for a partial index (a `sql` value in TypeScript), and `name:` xor `map:`; both are repeatable. The column names come from the resolved storage columns, so `@map` is honoured. With `map:` the index keeps the exact database name you give it, and `db verify` compares the rendered search document with the text Postgres prints back for the index exactly, character for character. Postgres prints it in its own form (`to_tsvector('english'::regconfig, title)`), so a `map:` full-text index reports drift; `@@fullTextIndex` and `fullTextIndex` warn about this with `PN_EXACT_NAME_BODY_COMPARISON`. Use `name:` unless the database already has the index under that name.

To search a full-text index from the SQL builder, pass the index itself, read from the table's `indexes` by the name the contract gave it. `fullTextMatches` and `fullTextRank` then search the document the index was built over, with its weight groups and its language, so the query always matches the index:

```typescript
const q = websearchToTsquery(query);
const post = db.sql.public.post;
post
  .select('id')
  .where((_f, fns) => fns.fullTextMatches(post.indexes.post_search, q))
  .orderBy((_f, fns) => fns.fullTextRank(post.indexes.post_search, q), { direction: 'desc' })
  .build();
```

The index states its language, so passing `language` with one is a type error and raises `RUNTIME.ARGUMENT_INVALID`; so is an index of another type. An index read from an aliased table, `post.as('p').indexes.post_search`, searches that alias's columns.

The document is one of three things: a full-text index, one column, or a document built by `fullTextDocument` from `./full-text`, which takes weight groups of columns, checks them by the same rules as an index, and searches several columns no index covers: `fns.fullTextMatches(fullTextDocument([[f.title, f.subtitle], [f.body]]), q, { language: 'english' })`. With a column or a `fullTextDocument`, Postgres uses an index only when the groups, their order and the `language` are the index's; a mismatch is not an error, the query just falls back to a sequential scan. ``@@index(expression: sql`to_tsvector('english', "text")`, type: "gin", name: …)`` still works for anything the attribute does not cover — but then the expression is yours to keep in step.

Every argument that holds raw SQL (`where:`, `expression:`, and a policy's `using` and `withCheck`) takes a `sql` literal in PSL and a `sql` value in the TypeScript builder; a plain string is refused. See [ADR 268](../../../../docs/architecture%20docs/adrs/ADR%20268%20-%20Raw%20SQL%20is%20a%20value%20of%20the%20data%20type%20sql-expression.md).

## Codec descriptor authoring

PostgreSQL-bound codecs use the public `PostgresCodecDescriptor` protocol, `postgresCodec(...)` adapter, and `definePostgresCodecs(...)` tuple helper exported from `@internal/target-postgres/codec-descriptor`. See the [codec authoring guide](../../../../docs/reference/codec-authoring-guide.md#target-owned-sql-codec-descriptors) for subclassing, generic adaptation, stack contribution, validation, array projection, and the current renderer transition.

## List framing

Inbound Postgres list framing is target-owned; see [ADR 251](../../../../docs/architecture%20docs/adrs/ADR%20251%20-%20Target-owned%20Postgres%20list%20framing.md). The Postgres runtime contributes the selected list-decoder strategy, which receives raw array text, parses the frame, and invokes the same scalar element codec for each non-null element. The contribution is optional at the SQL-family boundary, but row decoding always runs with an explicit selected strategy; non-Postgres paths use the SQL native-array default. Element codecs that can be used in list columns must accept the raw text spellings Postgres emits for their scalar values; the built-in numeric, boolean, integer, and float codecs also retain their scalar native-wire compatibility. Outbound array parameters are intentionally asymmetric: `pg` still serializes JavaScript arrays under the SQL type context emitted by the adapter.

## Architecture

This package provides both control and runtime entry points for the Postgres target. All declarative fields (version, capabilities, types, operations) are defined directly on the descriptor, so the published entry points never touch the filesystem. The `./pack` entry point provides a pure pack ref for contract authoring. The runtime entry point provides target-specific runtime behavior such as Postgres list decoding.

## Error Handling

Both the planner and runner return structured results instead of throwing:

**Planner** returns `PlannerResult` with either:

- `kind: 'success'` with a `MigrationPlan`
- `kind: 'failure'` with a list of `PlannerConflict` objects (e.g., `unsupportedOperation`, `policyViolation`)

**Runner** returns `MigrationRunnerResult` (`Result<MigrationRunnerSuccessValue, MigrationRunnerFailure>`) with either:

- `ok: true` with operation counts
- `ok: false` with a `MigrationRunnerFailure` containing error code, summary, and metadata

Runner error codes include: `EXECUTION_FAILED`, `PRECHECK_FAILED`, `POSTCHECK_FAILED`, `SCHEMA_VERIFY_FAILED`, `POLICY_VIOLATION`, `MARKER_ORIGIN_MISMATCH`, `DESTINATION_CONTRACT_MISMATCH`.

See `@internal/family-sql/control` README for full error code documentation.

## Prisma 7 binding

`./prisma7-binding` exports `prisma7PostgresBinding`, everything the Postgres target supplies to the Prisma 7 interpreter in `@internal/sql-contract-prisma7`: the accepted `provider` names, the index types, the 63-byte identifier limit, the `@updatedAt` generator for each codec, how `Json`, `Bytes` and `DateTime` literal defaults are read (the SQL text Postgres stores for `Bytes` and `DateTime`, with `ARRAY[...]::type[]` for lists), and the type map. The type map is the table of what Prisma 7.10.0 creates in Postgres for each Prisma 7 scalar and `@db.*` native type, expressed as the Prisma 8 type constructor that produces the same column (`DateTime` is `TimestampString(3)`, `Decimal` is `Numeric(65, 30)`, `Json` is `Jsonb`, `@db.VarChar(n)` passes its argument through); the recorded SQL Prisma 7 generated for the reference schema is what the rows were read from. A `@db.*` spelling missing from the table is a hard error for the source, never a guess. The Postgres facade and the interpreter's tests import this one instance.

## Introspection session settings

Postgres prints a `timestamptz` value in the session's time zone, and dates, intervals and `bytea` values in the session's styles, so the same stored default can read back as different text on two servers. The adapter therefore runs the whole introspection read with `TimeZone = UTC`, `DateStyle = ISO, MDY`, `IntervalStyle = postgres`, and `bytea_output = hex`, and restores the caller's settings when it finishes, including when the read fails. Inside a caller's transaction the settings are set and restored locally; outside one they are set and restored for the session. Column defaults, check constraint text, index predicates, and policy expressions are all read under those settings, so their text does not depend on the server, the role, or what the caller had set.

## Exports

- `./control`: Control plane entry point for `SqlControlTargetDescriptor`
- `./runtime`: Runtime entry point for target-specific runtime code
- `./pack`: Pure pack ref for `defineContract({ family, target: postgresPack, ... })`
- `./operation-types`: `QueryOperationTypes` for the built-in Postgres query operations, and the types their signatures name (`TsqueryArgument`, the `FullText*Options` types, `FullTextSearchLanguage`)
- `./full-text`: what an application calls to build a full-text query: the four parsers, the `tsquery` tag, and their types
- `./prisma7-binding`: `prisma7PostgresBinding`, this target's view for the Prisma 7 contract source (see above)

## Tests

This package ships a mix of fast planner unit tests and slower runner integration tests that require a dev Postgres instance (via `@prisma/dev`).

- **Default (`pnpm --filter @internal/target-postgres test`)**: runs all tests including integration tests
- **Test files**:
  - `test/migrations/planner.behavior.test.ts`: Planner unit tests (classification, conflicts, dependency ops)
  - `test/migrations/planner.fk-config.test.ts`: Planner unit tests for FK constraint/index configuration combinations
  - `test/migrations/planner.referential-actions.test.ts`: Planner unit tests for ON DELETE/ON UPDATE DDL emission
  - `test/migrations/planner.integration.test.ts`: Planner integration tests
  - `test/migrations/runner.*.integration.test.ts`: Runner integration tests (basic, errors, idempotency, policy)

```bash
pnpm --filter @internal/target-postgres test
```
