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
- **Postgres-Only Contract Extensions**: Defines Postgres-specific column defaults (e.g., sequences) used by the migration planner
- **Generated Defaults Policy**: Treats client-generated defaults as non-DB defaults when emitting DDL
- **Database Dependency Consumption**: The planner extracts database dependencies from the configured framework components (passed as `frameworkComponents`), verifies each dependency against the live schema, and only emits install operations when required. The runner reuses the same metadata for post-apply verification, so there are no hardcoded extension mappings—database dependencies stay component-owned.
- **Storage Type Planning**: The planner dispatches storage type hooks for `storage.types` and emits type operations before table creation when supported by the policy
- **Runtime List Framing**: Parses inbound Postgres array text for contract-declared list columns before applying the scalar element codec. Builtin arrays and enum arrays therefore share one target-owned decode path; fixed-scale `numeric(30,10)[]` reads database-normalized text such as `"1.5000000000"`, matching scalar numeric decoding rather than the previous driver numeric-array float spelling `"1.5"`.

This package spans multiple planes:

- **Migration plane** (`src/exports/control.ts`): Control plane entry point that exports `SqlControlTargetDescriptor` for config files
- **Runtime plane** (`src/exports/runtime.ts`): Runtime entry point for target-specific runtime code, including list decoding
- **Authoring pack ref** (`src/exports/pack.ts`): Pure data surface for contract builder workflows

## `db init`

This package provides the Postgres implementation of the SQL migration planner/runner used by `prisma db init`:

- **Planner** (`src/core/migrations/planner.ts`): produces an additive-only `MigrationPlan` to bring the database schema in line with a destination contract. Extra unrelated schema is tolerated; non-additive mismatches (type/nullability/constraint incompatibilities) surface as structured conflicts. Storage type operations (from codec-owned hooks) are emitted before table operations when `storage.types` are present. The planner respects the contract's `foreignKeys` configuration: when `foreignKeys.constraints` is `false`, FK constraint operations are skipped; when `foreignKeys.indexes` is `false`, FK-backing indexes are omitted. See [ADR 161](../../../docs/architecture%20docs/adrs/ADR%20161%20-%20Explicit%20foreign%20key%20constraint%20and%20index%20configuration.md). The planner also emits `ON DELETE` and `ON UPDATE` referential action clauses when specified on foreign keys (see [ADR 166](../../../docs/architecture%20docs/adrs/ADR%20166%20-%20Referential%20actions%20for%20foreign%20keys.md)).
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

Postgres computes `to_tsvector` per row unless an index covers the predicate's expression — the same `to_tsvector`, the same configuration literal and the same column, which it compares as parsed expressions rather than as text. `@@fullTextIndex`, contributed by this package, renders that expression from the field and the language, so you never write it by hand:

```prisma
@@fullTextIndex([text], name: "message_text_search")
```

The TypeScript contract builder has the same helper, exported from the facade's contract-builder entry:

```typescript
model('Message', { fields: { id, text } }).sql(({ cols }) => ({
  indexes: [fullTextIndex(cols.text, { name: 'message_text_search' })],
}));
```

It takes exactly one field, an optional `language` (default `english`, from the same allowlist the operations accept), an optional `where:` for a partial index, and `name:` xor `map:` like any expression index; it is repeatable, so a model may index several columns. Pass the same `language` here and to the operation: a mismatch is not an error, the query just stops using the index and falls back to a sequential scan. The column name comes from the resolved storage column, so `@map` is honoured. `@@index(expression: "to_tsvector('english', \"text\")", type: "gin", name: …)` still works for anything the attribute does not cover — but then the expression is yours to keep in step.

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

`./prisma7-binding` exports `prisma7PostgresBinding`, everything the Postgres target supplies to the Prisma 7 interpreter in `@internal/sql-contract-prisma7`: the accepted `provider` names, the index types, the 63-byte identifier limit, the `@updatedAt` generator for each codec, how `Json`, `Bytes` and `DateTime` literal defaults are read (the SQL text Postgres stores for `Bytes` and `DateTime`, with `ARRAY[...]::type[]` for lists), and the type map. The type map is the table of what Prisma 7.10.0 creates in Postgres for each Prisma 7 scalar and `@db.*` native type, expressed as the Prisma 8 type constructor that produces the same column (`DateTime` is `Timestamp(3)`, `Decimal` is `Numeric(65, 30)`, `Json` is `Jsonb`, `@db.VarChar(n)` passes its argument through); the recorded SQL Prisma 7 generated for the reference schema is what the rows were read from. A `@db.*` spelling missing from the table is a hard error for the source, never a guess. The Postgres facade and the interpreter's tests import this one instance.

## Introspection session settings

Postgres prints a `timestamptz` value in the session's time zone, and dates and intervals in the session's styles, so the same stored default can read back as different text on two servers. The adapter therefore runs the whole introspection read with `TimeZone = UTC`, `DateStyle = ISO, MDY`, and `IntervalStyle = postgres`, and restores the caller's settings when it finishes, including when the read fails. Inside a caller's transaction the settings are set and restored locally; outside one they are set and restored for the session. Column defaults, check constraint text, index predicates, and policy expressions are all read under those settings, so their text does not depend on the server, the role, or what the caller had set.

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
