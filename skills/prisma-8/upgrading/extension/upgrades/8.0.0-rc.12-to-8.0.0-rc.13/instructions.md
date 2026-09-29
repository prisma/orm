---
from: "8.0.0-rc.12"
to: "8.0.0-rc.13"
changes:
  - id: execution-ref-entry-field
    summary: |
      Each entry in `contract.execution.mutations.defaults` now names its target as
      `ref: { namespace, entry, field }` instead of `ref: { namespace, table, column }`. The values
      are the same table and column names. Re-emit the contract; code and types that read `.ref.table` or
      `.ref.column` read `.ref.entry` and `.ref.field`.
    detection:
      glob: "**/*.{json,ts,mts,cts}"
      matches:
        - '"ref"\s*:\s*\{(?![^{}]*"kind")[^{}]*"(?:table|column)"\s*:'
        - '\.ref\??\.(?:table|column)\b'
        - '\bref\s*:\s*\{(?![^{}]*\bkind\b)[^{}]*\b(?:table|column)\s*:[^{}]*\b(?:table|column)\s*:'
  - id: mutation-default-generator-types-move-to-framework
    summary: |
      `GeneratorStability` and `RuntimeMutationDefaultGenerator` are no longer exported by the SQL
      runtime (`@prisma/orm-family-sql/runtime`, `@prisma/orm-postgres/family-runtime`,
      `@prisma/orm-sqlite/family-runtime`). Import them from `@prisma/orm-framework/components/runtime`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\bimport\s+(?:type\s+)?\{[^}]*\b(?:GeneratorStability|RuntimeMutationDefaultGenerator)\b[^}]*\}\s*from\s*[''"](?:@internal/sql-runtime|@prisma/orm-family-sql/runtime|@prisma/orm-(?:postgres|sqlite)/family-runtime)[''"]'
  - id: mutation-defaults-options-entry-field
    summary: |
      `applyMutationDefaults` options name the storage entry as `entry` instead of `table`, and each
      applied default names its field as `field` instead of `column`. `MutationDefaultsOptions`,
      `AppliedMutationDefault` and `MutationDefaultsOp` now come from
      `@prisma/orm-framework/components/runtime`, not from the SQL `relational-core/query-lane-context` subpath.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\bapplyMutationDefaults\s*\(\s*\{[^{}]*\btable\s*:'
        - '\bimport\s+(?:type\s+)?\{[^}]*\b(?:AppliedMutationDefault|MutationDefaultsOptions|MutationDefaultsOp)\b[^}]*\}\s*from\s*[''"](?:@internal/sql-relational-core/query-lane-context|@prisma/orm-(?:family-sql|postgres|sqlite)/relational-core/query-lane-context)[''"]'
  - id: temporal-presets-move-to-framework
    summary: |
      `TIMESTAMP_NOW_GENERATOR_ID`, `temporalAuthoringPresets` and `temporalCodecPreset` moved from
      the SQL family's `family/control` subpath to the framework's `components/authoring`, and
      `timestampNowControlDescriptor` moved to `components/control`. `temporalCodecPresetWithPrecision`
      and `temporalStringAuthoringPresets` stay in `family/control`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\b(?:TIMESTAMP_NOW_GENERATOR_ID|temporalAuthoringPresets|temporalCodecPreset|timestampNowControlDescriptor)\b[^;]*?from\s*[''"](?:@internal/family-sql/control|@prisma/orm-(?:family-sql|postgres|sqlite)/family/control)[''"]'
  - id: temporal-preset-builders-take-storage-template
    summary: |
      `temporalAuthoringPresets`, `temporalStringAuthoringPresets` and `temporalCodecPreset` take the
      codec's storage template as one type parameter (`<Storage, GeneratorId>`, or `<Storage>` for
      `temporalCodecPreset`) instead of `<CodecId, NativeType, GeneratorId>`. Calls that let
      TypeScript infer the type arguments are unchanged.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\b(?:temporalAuthoringPresets|temporalStringAuthoringPresets|temporalCodecPreset)\s*<'
  - id: ts-defaults-encoded-by-codec
    summary: |
      `defineContract` from the Postgres and SQLite packages now encodes every literal `.default(value)` through the column's codec. The literal is the codec's input type. TypeScript checks it for fields built inside the `defineContract` factory, and the build fails with `CONTRACT.DEFAULT_INVALID` for a value the codec refuses. Pass a value of the codec's input type, or choose the field preset whose codec takes the value you have.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\.default\(\s*(?!now\(\)|autoincrement\(\)|sql`)'
  - id: contract-source-format-is-psl-or-typescript
    summary: Every contract source declares format 'psl' or 'typescript'; format is required, and OpaqueContractSourceProvider is removed.
  - id: prisma7-schema-source-declares-psl
    summary: The prisma7Schema() contract source declares format 'psl' instead of 'prisma7'.
  - id: print-psl-description-option
    summary: printPsl() from @internal/psl-printer opens every file with only the // use prisma-8 marker unless the caller passes description.
  - id: family-sql-psl-build-export
    summary: mapDefault, its option types, the PslTypeMap types and toEnumMemberName moved from @internal/family-sql/psl-infer to @internal/family-sql/psl-build.
  - id: cursor-rejects-expression-orders
    summary: "cursor() now throws ORM.ARGUMENT_INVALID when an active orderBy item is not a plain column (extension-operation orders such as vector distance were previously dropped from the keyset silently)"
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\.cursor\('
  - id: order-by-item-nulls
    summary: "OrderByItem from @internal/sql-relational-core/ast carries a nulls placement: its constructor takes a required third argument, withExpr rebuilds an item around a new expression, and every renderer must emit nulls wherever it emits dir"
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - 'new OrderByItem\('
        - '\.dir\.toUpperCase\('
  - id: include-expr-join-column-lists
    summary: |
      `IncludeExpr.localColumn` and `IncludeExpr.targetColumn` are now `localColumns` and
      `targetColumns`: ordered string arrays paired by index, with one entry per column of the
      relation's key.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\.(?:localColumn|targetColumn)\b'
  - id: mongo-codec-subpaths-move-to-target
    summary: |
      The Mongo codecs moved from `@internal/adapter-mongo` to `@internal/target-mongo`: the
      `codec-types`, `codecs`, `codec-ids` and `data-types` subpaths of the adapter are gone and
      live under the target. The same move applies to the published `adapter/*` subpaths of
      `@prisma/orm-mongo` and `@prisma/orm-target-mongo`, which are now `target/*`.
    detection:
      glob: "**/*.{ts,mts,cts,md}"
      matches:
        - '@internal/adapter-mongo/(?:codec-types|codecs|codec-ids|data-types)(?![\w-])'
        - '@prisma/orm-(?:target-)?mongo/adapter/(?:codec-types|codecs|codec-ids|data-types)(?![\w-])'
  - id: create-mongo-runner-deps-removed
    summary: |
      `createMongoRunnerDeps(...)` is removed from `@internal/adapter-mongo/control`. Build the
      runner dependencies with `new MongoControlAdapterImpl().createRunnerDependencies(controlDriver)`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\bcreateMongoRunnerDeps\b'
  - id: mongo-runner-dependency-types-move-to-family
    summary: |
      `MongoRunnerDependencies` and `MarkerOperations` are exported from
      `@internal/family-mongo/control-adapter`, no longer from `@internal/adapter-mongo/control` or
      `@internal/target-mongo/control`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\b(?:MongoRunnerDependencies|MarkerOperations)\b[^;]*?from\s*[''"]@internal/(?:adapter|target)-mongo/control[''"]'
        - '\b(?:MongoRunnerDependencies|MarkerOperations)\b[^;]*?from\s*[''"]@prisma/orm-(?:target-)?mongo/(?:adapter|target)/control[''"]'
  - id: mongo-control-adapter-creates-runner-dependencies
    summary: |
      The `MongoControlAdapter` SPI gains `createRunnerDependencies(driver)`, and
      `MongoControlFamilyInstance` gains `createRunnerDependencies({ driver })`. A custom
      implementation of either must add the method.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\bimplements\s+(?:[\w.]+\s*,\s*)*MongoControlAdapter\b'
        - ':\s*MongoControlFamilyInstance\s*=\s*\{'
  - id: mongo-create-runner-needs-adapter-on-stack
    summary: |
      `mongoTargetDescriptor.migrations.createRunner(family)` reaches the database through the
      control adapter on the family's control stack. A family instance created from an empty stack,
      or from a `createControlStack(...)` with no `adapter`, fails with "Mongo family requires an
      adapter descriptor in ControlStack" when the runner executes.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - 'createMongoFamilyInstance\(\s*\{\s*\}'
        - 'createControlStack\(\s*\{(?:(?!adapter)[^}])*mongoTargetDescriptor(?:(?!adapter)[^}])*\}\s*\)'
  - id: mongo-execution-context-applies-mutation-defaults
    summary: |
      `MongoExecutionContext` gains a required `applyMutationDefaults(options)` method, which fills
      the contract's execution defaults on ORM writes. Contexts built with
      `createMongoExecutionContext` have it; an object literal typed as a `MongoExecutionContext`
      (usually a test double) must add it.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '(?:\)|\b\w+)\s*:\s*MongoExecutionContext\b(?:<[^>]*>)?\s*(?:=\s*\{|\{)'
        - '\bsatisfies\s+MongoExecutionContext\b'
  - id: mongo-field-builder-execution-defaults-parameter
    summary: |
      The Mongo `FieldBuilder` type gains a fifth type parameter, the field's execution defaults,
      defaulting to `undefined`, so a bare `FieldBuilder` constraint rejects preset fields such as
      `field.temporal.createdAt()`; widen it to
      `FieldBuilder<ContractFieldType, boolean, boolean, EnumTypeHandle | undefined, ExecutionMutationDefaultPhases | undefined>`.
  - id: mongo-bson-codec-added
    summary: |
      The Mongo target gains the codec `mongo/bson@1` for any BSON value, typed `BsonInputValue`
      on write and `BsonValue` on read in `CodecTypes`; `mongo/json@1` now admits only JSON values.
      Collection validators now read a codec's whole `targetTypes` list, not only its first entry,
      and an enum's codec must declare exactly one.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - 'targetTypes\s*:\s*\[\s*[^\]\s,][^\],]*,\s*[^\]\s]'
---

# 8.0.0-rc.12 → 8.0.0-rc.13 — Extension author upgrade instructions

## `execution-ref-entry-field`

A contract with generated defaults (`temporal.createdAt()`, `temporal.updatedAt()`, `@default(uuid())` and the like) carries them under `execution.mutations.defaults`. Each entry's `ref` changes keys; the values do not:

```json
// before
{ "ref": { "namespace": "public", "table": "user", "column": "updated_at" }, "onUpdate": { "kind": "generator", "id": "timestampNow" } }

// after
{ "ref": { "entry": "user", "field": "updated_at", "namespace": "public" }, "onUpdate": { "kind": "generator", "id": "timestampNow" } }
```

1. Run `prisma contract emit` so `contract.json` and `contract.d.ts` use the new keys. The runtime rejects a contract whose refs still say `table` and `column` with `Contract structural validation failed: execution.mutations.defaults[0].ref.entry must be a string`.
2. Contract snapshots under `migrations/snapshots/<hash>/` that carry an `execution` section have the old keys too. In each `execution.mutations.defaults[].ref`, in both `contract.json` and `contract.d.ts`, rename `table` to `entry` and `column` to `field`, and write the keys in the order `entry`, `field`, `namespace`, which is the order `prisma contract emit` writes. Leave the snapshot's existing `executionHash` as it is. It no longer matches the renamed content, but the snapshot loader re-hashes only the storage section, so nothing checks it. `storageHash` and `profileHash` do not move, so snapshot directory names stay the same.
3. Code that reads the section directly changes `.ref.table` to `.ref.entry` and `.ref.column` to `.ref.field`.

`executionHash` changes for every contract with generated defaults, because the canonical JSON changes. Nothing compares it against the database, so no migration or re-sign is needed.

### For extension authors

- The framework type `ExecutionMutationDefault['ref']` from `@internal/contract/types` is `{ namespace: string; entry: string; field: string }`. A type that matches refs by shape (for example a create-input type that checks whether a column has a generated default) matches `entry` and `field`.
- A pack that ships a contract with generated defaults re-emits it with `prisma contract emit`, and updates its pinned contract-space snapshots as in step 2.
- The options passed to `applyMutationDefaults` change separately: see `mutation-defaults-options-entry-field` below for the rename of `table` to `entry`.

## `mutation-default-generator-types-move-to-framework`

The mutation-default generator runtime now lives in the framework and serves every family. A pack that contributes generators (`mutationDefaultGenerators: () => [...]` on a runtime target, adapter, or extension descriptor) types them with the framework type:

```ts
// before
import type { RuntimeMutationDefaultGenerator } from '@prisma/orm-family-sql/runtime';

// after
import type { RuntimeMutationDefaultGenerator } from '@prisma/orm-framework/components/runtime';
```

Do the same for `GeneratorStability`. The shape is unchanged: `{ id, generate(params?), stability: 'field' | 'row' | 'query' }`.

## `mutation-defaults-options-entry-field`

Code that calls `applyMutationDefaults` on an execution context, or stubs it in tests, renames two keys:

```ts
// before
const applied = context.applyMutationDefaults({ op: 'create', table: tableName, namespace, values });
for (const def of applied) row[def.column] = def.value;

// after
const applied = context.applyMutationDefaults({ op: 'create', entry: tableName, namespace, values });
for (const def of applied) row[def.field] = def.value;
```

1. In every `applyMutationDefaults({ ... })` call, rename the `table` key to `entry`. The value is the same table name.
2. Where the result is read, rename `.column` to `.field`. A stub that returns applied defaults returns `{ field, value }`.
3. Import `MutationDefaultsOptions`, `AppliedMutationDefault` and `MutationDefaultsOp` from `@prisma/orm-framework/components/runtime`; the SQL `relational-core/query-lane-context` subpath no longer exports them.

A key present in `values` counts as explicit whatever its value, `undefined` included, and gets no default. That rule is unchanged; drop `undefined` values before the call if they should be defaulted.

## `temporal-presets-move-to-framework`

The target-neutral temporal preset builders now live in the framework, so a non-SQL target can build `temporal.*` presets too. Change the import source; the functions behave the same.

```ts
// before
import {
  TIMESTAMP_NOW_GENERATOR_ID,
  temporalAuthoringPresets,
  temporalCodecPreset,
  timestampNowControlDescriptor,
} from '@prisma/orm-family-sql/family/control';

// after
import {
  TIMESTAMP_NOW_GENERATOR_ID,
  temporalAuthoringPresets,
  temporalCodecPreset,
} from '@prisma/orm-framework/components/authoring';
import { timestampNowControlDescriptor } from '@prisma/orm-framework/components/control';
```

The same applies to the `family/control` subpaths of `@prisma/orm-postgres` and `@prisma/orm-sqlite` (move to their `components/authoring` and `components/control` subpaths), and to `@internal/family-sql/control` (move to `@internal/framework-components/authoring` and `@internal/framework-components/control`). Keep importing `temporalCodecPresetWithPrecision` and `temporalStringAuthoringPresets` from `family/control`.

## `temporal-preset-builders-take-storage-template`

The builders now carry the codec's whole storage template through, so their type parameters changed. Drop explicit type arguments and let TypeScript infer them:

```ts
// before
temporalAuthoringPresets<'pg/timestamptz@1', 'timestamptz'>({ codecId: 'pg/timestamptz@1', nativeType: 'timestamptz' });

// after
temporalAuthoringPresets({ codecId: 'pg/timestamptz@1', nativeType: 'timestamptz' });
```

If you need to name them, the first type parameter is the storage template object type (`{ readonly codecId: ...; readonly nativeType: ... }`).

## `ts-defaults-encoded-by-codec`

A TypeScript contract used to store the value passed to `.default(value)` as it stood. The column's codec now encodes it, so the value must be the codec's input type. For a field built inside the `defineContract` factory, `.default()` is typed with that input type, so a wrong value is a type error in `contract.ts`. PSL contracts, `.default(now())`, `.default(autoincrement())` and `` .default(sql`...`) `` are not affected.

What now fails, on Postgres:

```typescript
// before: emitted, although the codec of field.dateTime() holds a Temporal.Instant
createdAt: field.dateTime().default('2024-01-01T00:00:00Z'),
```

```text
CONTRACT.DEFAULT_INVALID: Field "Event.createdAt" has a default that its codec refuses: Codec 'pg/timestamptz-temporal@1' encodes a Temporal.Instant, but received a string.
```

1. Search your contract files for `.default(` with a literal argument.
2. Type-check the contract file, then run `prisma contract emit`. TypeScript reports a default of the wrong type; the emit reports each default the codec refuses, with its model and field.
3. For each one, either pass the codec's type or change the preset:

| You have | Write |
| --- | --- |
| an ISO 8601 string | `field.temporal.timestamptzString().default('2024-01-01T00:00:00Z')` |
| a JavaScript `Date` | `field.temporal.timestamptzJsDate().default(new Date('2024-01-01T00:00:00Z'))` |
| a `Temporal.Instant` | `field.dateTime().default(Temporal.Instant.from('2024-01-01T00:00:00Z'))` |

Changing the preset changes the column's codec, and so the type your queries read and write for that field. On Postgres, `field.bigint()` takes a `bigint` and `field.bytes()` takes a `Uint8Array`. On SQLite, `field.temporal.datetime()` takes a `Date`, `field.column(bigintColumn)` takes a `bigint` and `field.column(blobColumn)` takes a `Uint8Array`.

On Node 24 there is no global `Temporal`. A contract file that creates a `Temporal` value must load an implementation itself, for example with `import 'temporal-polyfill/full/global'` as its first import. The type check on a `Temporal` field needs the `Temporal` type declarations in the project, for example from `temporal-polyfill/global`; without them the parameter is unchecked. The error shown above is the one you get with an implementation loaded; without one, the codec reports that the runtime has no global `Temporal` implementation.

`.default(null)` used to store `null`. It is now a type error on a field whose codec input type does not include `null`, which is every built-in codec except the JSON codecs: `field.json().optional().default(null)` still compiles and stores `null`. When the contract is built, the codec receives the `null`: a codec that checks its input, such as `pg/int8@1`, refuses it with `CONTRACT.DEFAULT_INVALID`, and a codec that passes any value through, such as `pg/text@1`, still stores `null`. A column without a default already defaults to `NULL` in the database, so remove the call.

A JavaScript `number` on a `bigint` field (codec `pg/int8@1`), such as `field.bigint().default(1)` inside the `defineContract` factory, is now a type error. Write a `bigint` literal: `field.bigint().default(1n)`. The default is stored as `"1"`, as the table below shows.

A default that gets past the type check, for example from an untyped caller, is stored in a different form than before:

| Default | Stored before | Stored now |
| --- | --- | --- |
| `field.bigint().default(1)` (also SQLite `bigintColumn`) | `1` | `"1"` |
| `field.bytes().default('x')` | `"x"` | `"eA=="` (base64) |
| SQLite `blobColumn` with `.default('x')` | `"x"` | `"78"` (hex) |

A contract with such a default emits a different `contract.json` and a different storage hash. Re-emit the contract and review the diff of `contract.json`.

A literal default on a column whose codec no pack in the contract declares now fails with `CONTRACT.DEFAULT_INVALID`, because nothing can check it. List the pack that owns the codec in the `extensions` of `defineContract`.

### For extension authors

- A pack passed in `extensions` contributes its codecs to this lookup through `types.codecTypes.codecDescriptors`. A default on a column of your codec is now passed to your codec's `encodeJson`, built with the column's `typeParams`. Make `encodeJson` throw for a value it cannot encode; the build reports your message.
- A codec descriptor that the target's codec registry refuses (for Postgres, one that does not extend `PostgresCodecDescriptor` and is not wrapped with `postgresCodec()`), or that reuses a built-in codec id, now fails `defineContract` as it already failed when the control stack was assembled.
- A caller who passes `codecLookup` to `defineContract` keeps that lookup; the facade does not add to it.
- A column helper that is a function, such as `varcharColumn(n)`, `timeTemporalColumn()` or pgvector's `vector(n)`, now declares its literal codec id in its return type. One variable can no longer be reassigned between the results of different helpers; annotate such a variable as `ColumnTypeDescriptor`.

## `contract-source-format-is-psl-or-typescript`

`ContractSourceProvider` from `@internal/config/config-types` is now the union of `PslContractSourceProvider` (`format: 'psl'`) and `TypeScriptContractSourceProvider` (`format: 'typescript'`). `format` is required on both. `OpaqueContractSourceProvider` and every other `format` value are gone, and config validation reports a source with no `format`, or any other value, as an issue on `contract.source.format`.

Give every contract source an extension defines a `format`: `'psl'` when its inputs are PSL text, and `'typescript'` when it builds the contract in TypeScript. Replace imports of `OpaqueContractSourceProvider` with `ContractSourceProvider`.

## `prisma7-schema-source-declares-psl`

The source returned by `prisma7Schema()` now declares `format: 'psl'`, because a Prisma 7 schema is PSL text. It still does not implement `interpret`. Code that compared `source.format` with `'prisma7'` must stop doing so; nothing in the framework tells a Prisma 7 schema from a Prisma 8 one by its format.

## `print-psl-description-option`

`printPsl()` from `@internal/psl-printer` used to open every file with the `// use prisma-8` marker and a line saying the contract was inferred from the live database. It now writes only the marker, and a second comment line only when the caller passes `description`. Code that prints an inferred contract and wants the old second line passes it:

```ts
printPsl(ast, {
  pslBlockDescriptors,
  description:
    'Contract inferred from the live database schema. Edit as needed, then run `prisma contract emit`.',
});
```

## `family-sql-psl-build-export`

`contract print` uses some of what `@internal/family-sql/psl-infer` exported, so those exports moved to the new subpath `@internal/family-sql/psl-build`: `mapDefault`, `DefaultMappingOptions`, `DefaultMappingResult`, `PslTypeMap`, `PslTypeReference`, `PslTypeResolution` and `toEnumMemberName`. Import them from `@internal/family-sql/psl-build`. Everything else stays in `@internal/family-sql/psl-infer`.

## `cursor-rejects-expression-orders`

A SQL ORM `cursor()` builds its keyset from plain model columns. It throws `ORM.ARGUMENT_INVALID`, naming the 1-based `orderBy` position, when an active order is any of these:

- an extension-operation result, such as `(p) => p.embedding.cosineDistance(v).asc()` or `(m) => m.text.fullTextRank(q).desc()`;
- a relation field, such as `(p) => p.author.name.asc()`;
- a relation count, such as `(u) => u.posts.count().desc()`;
- an order with null placement, such as `(p) => p.title.asc({ nulls: 'last' })`.

The check runs when `cursor()` is called and again when the query is planned, so an order added after `cursor()` is refused too. Before this change an extension-operation order was left out of the keyset without an error, which returned wrong pages.

For each `.cursor(` call in a chain that also calls `.orderBy(`, look at every `orderBy` lambda in the chain. If any of them is one of the orders above, do one of these:

- Paginate with `.limit(n).offset(n)` and remove `.cursor(...)`.
- Keep the cursor and order by plain columns only, for example `(p) => p.createdAt.desc()` and `(p) => p.id.desc()`.

`distinctOn()` throws the same error when one of the first N orders, where N is the number of `distinctOn` columns, is not a plain column: Postgres needs those leading orders to match the `DISTINCT ON` columns, so such a query already failed in the database; it now fails earlier, with `ORM.ARGUMENT_INVALID`. Put the `distinctOn` columns first; a relation order, a count or an operation result may follow them. For example, `.orderBy([(post) => post.title.asc(), (post) => post.author.name.asc()]).distinctOn('title')` is accepted.

## `order-by-item-nulls`

`OrderByItem` has a `nulls` field of type `'first' | 'last' | undefined`, and `undefined` means the database default. The constructor refuses any other value, and any direction other than `'asc'` / `'desc'`, with `RUNTIME.AST_INVALID`.

Constructing an item:

- `new OrderByItem(expr, dir)` no longer compiles. Pass the placement as the third argument, `new OrderByItem(expr, dir, undefined)`, or use `OrderByItem.asc(expr, { nulls })` / `OrderByItem.desc(expr, { nulls })`.
- To reorder by a different expression while keeping an existing item's direction and placement, write `item.withExpr(expr)` instead of `new OrderByItem(expr, item.dir)`. The hand-written form drops `nulls`.

Rendering an item: an adapter or renderer that writes `ORDER BY` itself must write the placement after the direction, `NULLS FIRST` for `'first'` and `NULLS LAST` for `'last'`, in every position it renders an `OrderByItem` (query, window and aggregate `ORDER BY`). A renderer that ignores `nulls` compiles and returns rows in the wrong order. Map `dir` and `nulls` through a fixed table rather than interpolating the string. A dialect without `NULLS FIRST` / `NULLS LAST` must emulate the placement, for example with a leading `expr IS NULL` key, and must not drop it.

## `include-expr-join-column-lists`

An ORM include now joins the related rows on every column of the relation's key, not only the first. So `IncludeExpr` (exported from `@prisma/orm-family-sql/orm-client`, and the element type of `Collection.state.includes`) carries the key as two lists instead of two strings:

- `localColumn: string` is now `localColumns: readonly string[]`, the key columns in the parent table.
- `targetColumn: string` is now `targetColumns: readonly string[]`, the matching columns in the related table.

Both lists have the same length, and `localColumns[i]` joins to `targetColumns[i]`. A single-column relation has one entry in each list.

Update code that reads these fields to use the whole lists and pair them by index. Code that builds an `IncludeExpr` by hand passes arrays, for example `{ localColumns: ['id'], targetColumns: ['user_id'] }` instead of `{ localColumn: 'id', targetColumn: 'user_id' }`. Do not keep only the first entry of each list: for a composite key that matches every related row that shares the first key column, which is the bug this change fixes.

## `mongo-codec-subpaths-move-to-target`

Rewrite each specifier. The exported names are unchanged.

| Before | After |
| --- | --- |
| `@internal/adapter-mongo/codec-types` | `@internal/target-mongo/codec-types` |
| `@internal/adapter-mongo/codecs` | `@internal/target-mongo/codecs` |
| `@internal/adapter-mongo/codec-ids` | `@internal/target-mongo/codec-ids` |
| `@internal/adapter-mongo/data-types` | `@internal/target-mongo/data-types` |
| `@prisma/orm-mongo/adapter/<same four>` | `@prisma/orm-mongo/target/<same four>` |
| `@prisma/orm-target-mongo/adapter/<same four>` | `@prisma/orm-target-mongo/target/<same four>` |

Then re-sort the import block with the package's formatter (the new specifier sorts after `@internal/mongo-*`). A package that imports from `@internal/target-mongo` for the first time needs it in `dependencies`. A pack that emits a Mongo `contract.d.ts` re-emits it with `prisma contract emit`, or applies the same rewrite to the committed file; the contract JSON and hashes do not change.

`@internal/target-mongo/codecs` also exports `mongoStandardCodecs` and `buildStandardCodecRegistry`, which the adapter used internally before.

## `create-mongo-runner-deps-removed`

```ts
// before
import { createMongoRunnerDeps, extractDb } from '@internal/adapter-mongo/control';
import { MongoDriverImpl } from '@internal/driver-mongo';
const deps = createMongoRunnerDeps(controlDriver, MongoDriverImpl.fromDb(extractDb(controlDriver)), family);

// after
import { MongoControlAdapterImpl } from '@internal/adapter-mongo/control';
const deps = new MongoControlAdapterImpl().createRunnerDependencies(controlDriver);
```

Drop imports that are now unused and any family instance built only to pass as the third argument.

## `mongo-runner-dependency-types-move-to-family`

Change the import of `MongoRunnerDependencies` or `MarkerOperations` to `@internal/family-mongo/control-adapter`. The shapes are unchanged.

## `mongo-control-adapter-creates-runner-dependencies`

Add the method to a custom control adapter. It returns the `MongoRunnerDependencies` the migration runner uses for that driver:

```ts
createRunnerDependencies(driver: ControlDriverInstance<'mongo', 'mongo'>): MongoRunnerDependencies
```

A custom family instance forwards `createRunnerDependencies({ driver })` to the control adapter it resolves from the stack.

## `mongo-create-runner-needs-adapter-on-stack`

Create the family instance from a control stack that includes the Mongo adapter:

```ts
createMongoFamilyInstance(
  createControlStack({ family: mongoFamilyDescriptor, target: mongoTargetDescriptor, adapter: mongoAdapterDescriptor }),
);
```

## `mongo-execution-context-applies-mutation-defaults`

Mongo contracts can now carry execution defaults (`temporal.createdAt()`, `temporal.updatedAt()`), and the execution context applies them. The ORM calls `context.applyMutationDefaults(...)` on every create and update, so `MongoExecutionContext` has a new required method.

Build contexts with `createMongoExecutionContext({ contract, stack })` and nothing changes. A hand-written context, typically a test double, adds a method that applies nothing:

```ts
// before
const context: MongoExecutionContext = { contract, codecs, stack };

// after
const context: MongoExecutionContext = { contract, codecs, stack, applyMutationDefaults: () => [] };
```

## `mongo-field-builder-execution-defaults-parameter`

Code that constrains on a bare `FieldBuilder` (for example `Fields extends Record<string, FieldBuilder>`) accepts only builders without execution defaults; pass `ExecutionMutationDefaultPhases | undefined` as the fifth type argument to accept preset fields. There is no detection pattern: a bare `FieldBuilder` reference is too common to tell which uses need the wider type.

## `mongo-bson-codec-added`

The Mongo target adds the codec `mongo/bson@1` (data type `mongo/bson`, PSL `Bson`, `field.bson()`), whose `CodecTypes` entry reads `BsonValue` and writes `BsonInputValue` (a `BsonValue`, or a `Uint8Array` at any depth), both exported from `@internal/target-mongo/codec-types` (declared in `@internal/mongo-value`, where the Mongo TypeScript builder reads them). `BsonValue` covers every value the driver returns with its default settings, `Code`, `MinKey`, `MaxKey`, `BSONSymbol` and a native `RegExp` (what a stored regex reads back as) included; `BSONRegExp` appears only with a driver configured with `bsonRegExp: true`. A `DBRef` is never returned, because decode turns it back into its `{ $ref, $id[, $db], ...fields }` document. It declares an empty `targetTypes`, so the validator does not constrain its value: a single field gets `{}`, and a list field still must be an array, `{ bsonType: 'array', items: {} }`. An extension that lists every Mongo codec id, or keys a map by `CodecTypes`, adds `mongo/bson@1`. An extension that stores arbitrary BSON in a field of its own contract types it `mongo/bson@1`, because `mongo/json@1` now refuses non-JSON values on encode and decode.

The detection pattern finds a descriptor whose `targetTypes` lists two or more entries, quoted strings or named constants, on one line or several. It does not see a list built elsewhere and referenced by name (`targetTypes: TYPES`); check those descriptors by hand.

The Mongo validator derivation reads every entry of a codec descriptor's `targetTypes`. For a list field the list applies to `items`, and a nullable field prepends `'null'` unless the list already has it. An empty list leaves the value's type unconstrained but not a list field's cardinality: a single field gets `{}`, and a list field gets `{ bsonType: 'array', items: {} }`.

For each Mongo codec descriptor in the extension whose `targetTypes` has more than one entry, check that every entry is a BSON type the codec's `encode` can produce, because each one is now admitted by the validator. Remove any entry the codec does not write. Then re-emit the extension's contracts and any test fixtures; their validators list every entry.

An enum's `@@type` codec must declare exactly one entry: the Mongo enum factory reports `enum "<name>" @@type codec "<id>" declares <n> BSON types; an enum needs exactly one` otherwise.
