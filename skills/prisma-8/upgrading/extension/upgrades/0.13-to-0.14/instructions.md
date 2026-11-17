---
from: "0.13"
to: "0.14"
changes:
  - id: uuid-preset-rename
    summary: |
      The uuid field presets are renamed: `field.uuid()` → `field.uuidString()`,
      `field.id.uuidv4()` → `field.id.uuidv4String()`, `field.id.uuidv7()` →
      `field.id.uuidv7String()`. These names now describe the storage encoding
      (char(36) string). Postgres-native uuid storage uses the new
      `field.uuidNative()` / `field.id.uuidv4Native()` / `field.id.uuidv7Native()`
      presets from `@internal/postgres/contract-builder`.
    detection:
      glob: "**/*.ts"
      contains:
        - "field.uuid()"
        - "field.id.uuidv4()"
        - "field.id.uuidv7()"
      anyMatch: true
    script: uuid-preset-rename.ts
  - id: qualify-flat-builder-accessors
    summary: |
      The builder-layer flat accessors are removed: `@internal/sql-builder`'s `sql()` and
      `@internal/sql-orm-client`'s `orm()` now expose per-namespace facets only. Extension
      code that builds queries by accessing a bare table/model on the builder output
      (`sql.<table>` / `orm.<Model>`) must name the namespace the table/model is declared in:
      `sql.<namespace>.<table>`, `orm.<namespace>.<Model>` (`public` for a standard
      single-schema SQL contract; the late-bound `__unbound__` namespace for an unbound/SQLite
      contract). There is no codemod — the correct namespace is the one each table/model is
      declared in, which is call-site-specific. Extensions that only contribute codecs, types,
      or migrations (and never build queries through `sql`/`orm`) are unaffected.
    detection:
      glob: "**/*.{ts,tsx}"
      contains:
        - "@internal/sql-builder"
        - "@internal/sql-orm-client"
      anyMatch: true
  - id: create-runtime-removed
    summary: |
      `createRuntime` is removed from `@internal/sql-runtime`. Extension code that
      constructed a runtime via `createRuntime(...)` must switch to the target class
      constructor directly: `new PostgresRuntimeImpl({...})` from
      `@internal/postgres/runtime`, or `new SqliteRuntimeImpl({...})` from
      `@internal/sqlite/runtime`. Pass the same options minus the `stackInstance`
      unpacking — supply `adapter` directly instead of `stackInstance.adapter`.
    detection:
      glob: "**/*.{ts,tsx}"
      contains:
        - "createRuntime"
  - id: migration-op-factories-to-methods
    summary: |
      The bare migration op factory functions are removed from
      `@internal/postgres/migration` (and the deprecated
      `@internal/target-postgres/migration` alias). Replace each import and
      call-site with the corresponding method on `this` inside your `Migration`
      subclass. The option shapes changed from positional arguments to a single
      options object.
    detection:
      glob: "**/migration.ts"
      contains:
        - "from '@internal/postgres/migration'"
        - "from '@internal/target-postgres/migration'"
      anyMatch: true
    script: migration-op-factories-to-methods.ts
  - id: namespace-entries-open-dict
    summary: |
      `SqlNamespace.entries` is now an open dictionary typed
      `Readonly<Record<string, Readonly<Record<string, unknown>>>>`. The previously
      closed shape (`{ table?: ..., valueSet?: ... }`) is gone — dot-access
      like `.entries.table` or `.entries.collection` no longer compiles. Read tables via
      the `namespaceTables(ns)` helper from `@internal/sql-contract/types`, or via
      bracket notation `entries['table']`. For typed getter access on the concrete
      class instances use the non-enumerable getters (`ns.table`, `db.collection`).
      Annotations and type constraints that hard-code the closed shape
      must be widened to the open dict.
    detection:
      glob: "**/*.{ts,tsx}"
      contains:
        - ".entries.table"
        - ".entries.collection"
        - ".entries.valueSet"
      anyMatch: true
  - id: enum-becomes-domain-concept
    summary: |
      The native Postgres enum surface is deleted from the SPI. `PostgresEnumStorageEntry`
      no longer exists in `@internal/sql-contract/types` — the `SqlStorage.types` slot
      now holds codec-instance entries only (`StorageTypeInstance`). The `pg/enum@1`
      codec surface is deleted from `@internal/target-postgres` (`PgEnumDescriptor`,
      `pgEnumColumn`, `PG_ENUM_CODEC_ID`, the `enum` codec-type-map entry), as are the
      native `enumType` / `enumColumn` helpers from
      `@internal/adapter-postgres/column-types`. Enums are domain entities plus a
      storage `valueSet` enforced by a CHECK constraint; columns reference them as
      `pg/text@1` (or another codec) with a `valueSet` ref. Extensions that referenced
      `PostgresEnumStorageEntry` in type constraints drop it (use `StorageTypeInstance`
      alone); fixtures that used `pg/enum@1` as a codec id must switch to a live codec
      or an inert fixture id.
    detection:
      glob: "**/*.{ts,tsx}"
      contains:
        - "PostgresEnumStorageEntry"
        - "pg/enum@1"
        - "pgEnumColumn"
        - "PgEnumDescriptor"
        - "PG_ENUM_CODEC_ID"
      anyMatch: true
  - id: namespaced-type-resolution
    summary: |
      Per-namespace type resolution. The emitted TypeMaps `ExtractFieldOutputTypes` /
      `ExtractFieldInputTypes` (from `@internal/sql-contract`) now nest by namespace —
      `{ [namespace]: { [model]: { [field] } } }` — and `TableProxy` (from
      `@internal/sql-builder`) takes a required namespace coordinate: `TableProxy<C, Name>`
      becomes `TableProxy<C, NsId, Name>`. Extension code that indexes those TypeMaps or
      constructs `TableProxy` types directly must thread the namespace coordinate
      (`ExtractFieldOutputTypes<C>[namespace][Model][Field]`, `TableProxy<C, namespace, Name>`):
      `public` for a standard single-schema contract, the late-bound `__unbound__` namespace
      for an unbound/SQLite contract. Extensions that only contribute codecs, native types, or
      migrations and never reference these types are unaffected.
    detection:
      glob: "**/*.{ts,tsx}"
      contains:
        - "ExtractFieldOutputTypes"
        - "ExtractFieldInputTypes"
        - "TableProxy<"
      anyMatch: true
  - id: contract-model-definitions-removed
    summary: |
      `ContractModelDefinitions` is removed from `@internal/contract` (and its
      `/types` export), along with the second `TModels` type parameter on
      `Contract` (now `Contract<TStorage>`). The flat cross-namespace model union
      it produced is gone; resolve models per-namespace instead. Replace
      `ContractModelDefinitions<C>` with
      `C['domain']['namespaces'][<ns>]['models']` (use `[keyof C['domain']['namespaces']]`
      for the sole-namespace case). Family wrappers like `MongoContract<S, M>`
      become single-arg `MongoContract<S>`; carry precise per-model types via an
      explicit per-namespace `domain` override.
    detection:
      glob: "**/*.{ts,tsx}"
      contains:
        - "ContractModelDefinitions"
        - "Contract<"
        - "MongoContract<"
      anyMatch: true
---

<!--
control-query-extension-codecs: pgvector test files
(planner.behavior.test.ts, planner.contract-to-schema-ir.test.ts,
planner.storage-types.test.ts) were updated to pass an explicit
`PostgresControlAdapter` to `createPostgresMigrationPlanner`, which now
requires an adapter argument. Internal test harness change only — no
extension-author API change. Incidental substrate diff only.
-->

<!--
TML-2867: codec-routed DDL defaults. The pgvector extension test files were updated
to await lazy plan operations (`Promise.all(result.plan.operations)`) and to use
`PostgresControlAdapter` instead of the removed `createPostgresAdapter`. The
`packages/3-extensions/postgres re-export test` deletion was already declared by
TML-2859 above. No extension-author API change. Incidental substrate diff only.
-->

<!--
TML-2859: SQLite createTable authoring method. The free `createTable` function from
`@internal/sqlite/migration` is now a protected method on the `SqliteMigration`
base class. The `createTable` re-export test in `packages/3-extensions/sqlite/` was
removed (it asserted the free function was exported, which is no longer true). The
README was updated to reflect the current authoring surface. No extension-author action
beyond what the `sqlite-create-table-method` entry in the 0.12-to-0.13 instructions
already covers. Incidental substrate diff only.
-->


<!--
TML-2785: the sql-orm-client runtime gained M:N correlated include
reads — `.include()` of an N:M relation resolves child rows through the
junction table via a correlated subquery. Internal runtime only; no
extension API or contract-shape change. No extension-author action
required.

TML-2786: the sql-orm-client runtime gained M:N relation filters — a
`where` predicate on an N:M relation lowers to an EXISTS subquery joined
through the junction table. Internal runtime only; no extension API or
contract-shape change. No extension-author action required.

TML-2787: the sql-orm-client runtime gained M:N nested writes — connect /
disconnect / nested create on an N:M relation insert and delete
junction-table rows. Internal runtime only; no extension API or
contract-shape change. No extension-author action required.

TML-2838: the temporary `--no-memory-protection-keys` test-harness workaround
has been removed from every PGlite-backed vitest config (including
`packages/3-extensions/{postgres,supabase}`) now that the WAL-teardown crash is
fixed upstream in `@prisma/dev` 0.24.12 (which pulls in the
`@prisma/streams-local` worker-termination fix). Test-harness only — no
runtime, contract, or public-API change. Incidental substrate diff only.
-->

<!--
#823: `jose` bumped from ^5 to ^6 in `packages/3-extensions/supabase`. The Supabase
extension's transitive auth dependency only — no extension-author API, runtime, or
contract-shape change. Incidental substrate diff only.
-->

<!--
TML-2852: the enum read surface. Additive surface for `enumType`-authored enums.
`@internal/postgres/contract-builder` gains `enumType` / `member` exports (the
Postgres-bound `enumType` constrains member values to the column codec) and the
factory `defineContract` overload threads a top-level `enums` key;
`@internal/sql-orm-client` gains the lane-agnostic `db.enums.<namespace>.<Name>`
runtime accessor map (built from `domain.namespaces[ns].enum`) and value-union
narrowing of enum-restricted fields, plus emit-time narrowing in the emitter from a
field's `valueSet` ref. All additive — existing exports and the framework SPI are
unchanged, PSL `enum` stays native until the cutover, and `fixtures:check` is
byte-identical. No extension-author action. Incidental substrate diff only.
-->

# 0.13 → 0.14 — Extension-author upgrade instructions

## `uuid-preset-rename`

The uuid field preset names now include the storage encoding suffix:

| Before | After |
| --- | --- |
| `field.uuid()` | `field.uuidString()` |
| `field.id.uuidv4()` | `field.id.uuidv4String()` |
| `field.id.uuidv7()` | `field.id.uuidv7String()` |

Apply the rename in any extension test files, contract fixture files, or documentation that uses these presets. The rename is mechanical — run the colocated script or apply the substitutions directly:

```ts
// Before
id: field.id.uuidv7(),
userId: field.id.uuidv4(),
externalId: field.uuid(),

// After
id: field.id.uuidv7String(),
userId: field.id.uuidv4String(),
externalId: field.uuidString(),
```

No change to emitted `contract.json` — both old and new preset names emit the same codec (`sql/char@1`).

## `qualify-flat-builder-accessors`

The query builder (`@internal/sql-builder`) and ORM client (`@internal/sql-orm-client`) are now **always qualified by namespace**. The flat by-bare-name accessors are gone: the value returned by `sql({ … })` / `orm({ … })` is a map of per-namespace facets, so there is no `sql.<table>` and no `orm.<Model>` at the top level. You reach a table or model by naming its namespace.

This affects extension code that *builds queries* through these packages. Extensions that only contribute codecs, native types, or migration operations — and never construct a `sql`/`orm` query — need no change.

### Migrate query-building call sites

Insert the namespace segment after the builder output, naming the namespace each table/model is declared in:

```ts
// Before
const plan = sql.user.select('id', 'email').build();
const row  = await orm.User.find({ where: { id } });

// After — name the namespace (`public` for a standard single-schema SQL contract)
const plan = sql.public.user.select('id', 'email').build();
const row  = await orm.public.User.find({ where: { id } });
```

For an unbound contract (e.g. SQLite, or any target whose entities live in the late-bound namespace) the namespace segment is `__unbound__` — import `UNBOUND_NAMESPACE_ID` from `@internal/framework-components/ir` and index with it (`sql[UNBOUND_NAMESPACE_ID].user`) rather than hard-coding the string. For a multi-namespace contract, name the specific namespace each table/model sits in.

### Validation

This is a type-level change — `pnpm typecheck` (or `pnpm build`) pinpoints every remaining flat access as a compile error (`Property '<table>' does not exist on type 'Db<…>'`). Fix each by inserting the namespace segment, then run your extension's standard `pnpm test`.

## `migration-op-factories-to-methods`

The bare op factory functions previously exported from `@internal/postgres/migration` (and the deprecated `@internal/target-postgres/migration` alias) are removed. Each function is now a protected method on the `PostgresMigration` base class — call it as `this.<method>(...)` inside your extension's `Migration` subclass.

The option shapes also changed: positional arguments are replaced by a single options object.

Remove the bare names from your import and replace each call-site:

| Before (bare function) | After (method) |
| --- | --- |
| `dropColumn(schema, table, column)` | `this.dropColumn({ schema, table, column })` |
| `setNotNull(schema, table, column)` | `this.setNotNull({ schema, table, column })` |
| `setDefault(schema, table, column, defaultSql)` | `this.setDefault({ schema, table, column, defaultSql })` |
| `addPrimaryKey(schema, table, name, columns)` | `this.addPrimaryKey({ schema, table, constraint: name, columns })` |
| `addForeignKey(schema, table, { name, columns, references, onDelete })` | `this.addForeignKey({ schema, table, foreignKey: { name, columns, references, onDelete } })` |
| `addCheckConstraint(schema, table, name, column, values)` | `this.addCheckConstraint({ schema, table, constraint: name, column, values })` |
| `createIndex(schema, table, indexName, columns)` | `this.createIndex({ schema, table, index: indexName, columns })` |
| `installExtension({ id, extensionName, invariantId })` | `this.installExtension({ id, extensionName, invariantId })` |

Example (extension migration):

```ts
// Before
import { installExtension, Migration, MigrationCLI } from '@internal/target-postgres/migration';

override get operations() {
  return [
    installExtension({
      id: 'my-ext.install',
      extensionName: 'my_extension',
      invariantId: MY_INVARIANTS.install,
    }),
  ];
}

// After
import { Migration, MigrationCLI } from '@internal/target-postgres/migration';

override get operations() {
  return [
    this.installExtension({
      id: 'my-ext.install',
      extensionName: 'my_extension',
      invariantId: MY_INVARIANTS.install,
    }),
  ];
}
```

The colocated script applies this transformation automatically. Run it from your extension root:

```bash
pnpm exec tsx .claude/skills/prisma-8/upgrading/extension/upgrades/0.13-to-0.14/migration-op-factories-to-methods.ts
```

## `create-runtime-removed`

`createRuntime` is removed from `@internal/sql-runtime`. Construct the target runtime class directly instead.

```ts
// Before
import { createRuntime } from '@internal/sql-runtime';
const runtime = createRuntime({ stackInstance, context, driver, ...opts });

// After — Postgres
import { PostgresRuntimeImpl } from '@internal/postgres/runtime';
const runtime = new PostgresRuntimeImpl({ adapter: stackInstance.adapter, context, driver, ...opts });

// After — SQLite
import { SqliteRuntimeImpl } from '@internal/sqlite/runtime';
const runtime = new SqliteRuntimeImpl({ adapter: stackInstance.adapter, context, driver, ...opts });
```

The options are identical except `stackInstance` is no longer passed: supply `adapter` from `stackInstance.adapter` directly. Depend on the bare-name interfaces (`PostgresRuntime`, `SqliteRuntime`) for type annotations, not the `Impl` classes.

## `namespace-entries-open-dict`

The `entries` property on every namespace class is now an open dictionary:

```ts
// The type is now:
entries: Readonly<Record<string, Readonly<Record<string, unknown>>>>

// Previously it was a closed shape:
entries: {
  table?: Readonly<Record<string, StorageTable>>;
  valueSet?: Readonly<Record<string, StorageValueSet>>;
}
```

Dot-access like `.entries.table` or `.entries.collection` no longer compiles. Migrate to one of the two canonical read styles:

**Generic/walker code** — bracket notation:

```ts
// Before
const tables = ns.entries.table;

// After — bracket notation
const tables = ns.entries['table'] as Record<string, StorageTable> | undefined;
```

**Typed family/target code** — use the exported family helpers or the class getters:

```ts
// Using the namespaceTables() helper (for SqlNamespace values)
import { namespaceTables, namespaceValueSets } from '@internal/sql-contract/types';
const tables = namespaceTables(ns);    // Record<string, StorageTable>
const vsets  = namespaceValueSets(ns); // Record<string, StorageValueSet> | undefined

// Using the namespaceCollections() helper (for MongoNamespace values)
import { namespaceCollections } from '@internal/mongo-contract';
const collections = namespaceCollections(ns); // Record<string, MongoCollection>
```

**Type annotations** — widen any closed-shape annotation to the open dict:

```ts
// Before
const ns = namespaces[id] as { entries: { table: Record<string, StorageTable> } };

// After — open dict annotation
const ns = namespaces[id] as { entries: Record<string, Record<string, unknown>> };
// then narrow via the helper:
const tables = namespaceTables(ns);
```

This is a compile-time-only change when using the helpers — no runtime behavior differs. Run `pnpm typecheck` to find all remaining dot-access sites.

## `enum-becomes-domain-concept`

Native Postgres enums are removed from the framework. Enums are now a **domain concept**: a domain enum entity plus a storage `valueSet` entity, with member values stored through an ordinary codec (typically `pg/text@1` → a `text` column) and the value set enforced by a planner-generated CHECK constraint. The whole native surface is deleted:

- `PostgresEnumStorageEntry` is gone from `@internal/sql-contract/types`. The polymorphic `SqlStorage.types` slot now carries codec-instance entries only. Type constraints that accepted both narrow to `StorageTypeInstance`:

  ```ts
  // Before
  import type { PostgresEnumStorageEntry, StorageTypeInstance } from '@internal/sql-contract/types';
  type TypesConstraint = Record<string, StorageTypeInstance | PostgresEnumStorageEntry>;

  // After
  import type { StorageTypeInstance } from '@internal/sql-contract/types';
  type TypesConstraint = Record<string, StorageTypeInstance>;
  ```

- The `pg/enum@1` codec and its registry surface are deleted from `@internal/target-postgres`: `PgEnumDescriptor`, `pgEnumColumn`, `PG_ENUM_CODEC_ID`, and the `enum` entry in the codec type map. Test fixtures that used `'pg/enum@1'` as an opaque codec id must switch to a live codec id or an inert fixture id (e.g. `app/test-enum@1`) — the id no longer resolves to a registered codec.
- The native `enumType(name, values[])` / `enumColumn(...)` authoring helpers are deleted from `@internal/adapter-postgres/column-types`. The domain authoring surface is `enumType(name, codecRef, ...member(name, value))` + `member` from the target contract-builder, returned under the contract's `enums` key.
- Introspection no longer adopts native enum types: the adapter records detected native enum type names under `annotations.pg.nativeEnumTypeNames` (names only), and `contract infer` refuses with a diagnostic naming them. The old `annotations.pg.enumTypes` structure is gone.

Columns restricted to an enum now carry `codecId: 'pg/text@1'` (or another codec), `nativeType: 'text'`, and a `valueSet` reference; the owning table carries a check entry. If your extension reads `storage.types` looking for enum shapes, read the namespace's `valueSet` entries instead.

### Validation

`pnpm typecheck` flags every deleted-symbol reference. After fixing, run your extension's standard `pnpm test`.

## `namespaced-type-resolution`

The SQL/ORM type machinery now resolves columns, fields, and models **by namespace coordinate** rather than by bare name across all namespaces. Two type-shape changes affect extension code that depends on these types directly:

1. **Emitted TypeMaps nest by namespace.** `ExtractFieldOutputTypes<C>` / `ExtractFieldInputTypes<C>` (from `@internal/sql-contract`) now return `{ [namespace]: { [model]: { [field]: <type> } } }` instead of the flat `{ [model]: { [field] } }`. Index the namespace first:

```ts
// Before
type Row = ExtractFieldOutputTypes<C>['User'];
// After — name the namespace the model is declared in
type Row = ExtractFieldOutputTypes<C>['public']['User'];
```

2. **`TableProxy` takes a required namespace coordinate.** `TableProxy<C, Name>` (from `@internal/sql-builder`) becomes `TableProxy<C, NsId, Name>`:

```ts
// Before
let p: TableProxy<C, 'users'>;
// After
let p: TableProxy<C, 'public', 'users'>;
```

Use `public` for a standard single-schema SQL contract; for an unbound/SQLite contract use the late-bound namespace (`UNBOUND_NAMESPACE_ID` from `@internal/framework-components/ir`); for a multi-namespace contract, name the namespace each model/table actually sits in. There is no codemod — the correct namespace is call-site-specific. `pnpm typecheck` pins every remaining flat access (`Property '<model>' does not exist on type '{ public: ... }'`). Extensions that only contribute codecs, native types, or migrations — and never reference `ExtractFieldOutputTypes` / `ExtractFieldInputTypes` / `TableProxy` directly — need no change.

## `contract-model-definitions-removed`

`ContractModelDefinitions` is removed from `@internal/contract` (and the `@internal/contract/types` re-export), and the `Contract` interface loses its second `TModels` type parameter — `Contract<TStorage, TModels>` becomes `Contract<TStorage>`. The flat, first-name-wins cross-namespace model union is gone; models resolve per-namespace from the domain plane.

Replace any `ContractModelDefinitions<C>` use with a read of a namespace's models:

```ts
// Before
import type { Contract, ContractModelDefinitions } from '@internal/contract/types';
type Models = ContractModelDefinitions<C>;
type UserModel = Models['User'];

// After — read the sole namespace's models (or name a specific namespace)
type Models = C['domain']['namespaces'][keyof C['domain']['namespaces']]['models'];
type UserModel = Models['User'];
```

If you need a bare model shape rather than the contract's own models, use `ContractModelBase` from `@internal/contract/types`. Family contract aliases drop their model parameter too — `MongoContract<S, M>` becomes `MongoContract<S>`. When you build a contract *type* that must carry precise per-model shapes (e.g. a test fixture or a `defineContract` result type), override the `domain` explicitly:

```ts
type MyContract = Omit<Contract<MyStorage>, 'domain'> & {
  readonly domain: {
    readonly namespaces: {
      readonly public: { readonly models: MyModels };
    };
  };
};
```

<!--
TML-2550: per-namespace typed resolution. The extension-package contract.d.ts fixtures
(supabase, paradedb, pgvector, postgis) regenerate to the namespace-nested TypeMaps shape
above; the diff round-trips on a consumer re-emit and needs no extension-author action beyond
the `namespaced-type-resolution` entry. Incidental substrate diff only.
-->

<!--
TML-2918: schema-namespaced op-ids for addColumn. The pgvector test files
(planner.behavior.test.ts, planner.contract-to-schema-ir.test.ts) were updated to
assert the new `column.${schema}.${table}.${column}` op-id format for add-column
operations. Test-only assertion updates — no extension-author API change. Incidental
substrate diff only.
-->

<!--
TML-2919: typed-DDL conversion of the not-null-with-temporary-default recipe. The
recipe's ADD COLUMN execute step now lowers a typed `PostgresAlterTable` DDL node
through the adapter, with the temporary backfill value carried as a
`FunctionColumnDefault` — so the emitted DEFAULT clause parenthesizes its expression
(e.g. `DEFAULT ('')` instead of the previous `DEFAULT ''`). Semantically identical
in PostgreSQL (parenthesizing an atomic primary expression in a `DEFAULT` clause is
a no-op). The pgvector `planner.behavior.test.ts` assertion that pins the recipe's
emitted ADD COLUMN SQL was updated to the parenthesized form. Test-only assertion
update — no extension-author API change. Incidental substrate diff only.
-->

<!--
TML-2916: un-namespaced Postgres extension contracts (pgvector, paradedb, postgis,
supabase) regenerate to drop the spurious empty `__unbound__` storage namespace slot
the authoring + serializer pipeline was injecting, restoring ADR 223 compliance.
Migration `head.json` and `migration.ts` hashes update. No extension-author action:
re-emit picks up the new shape. Incidental substrate diff only.
-->

<!--
TML-2886 (redo, PR #841): type SQL enum columns via a baked storage column lookup.
The SQL emitter generates a new `StorageColumnTypes` map in `contract.d.ts`, keyed
`[namespace][table][column]`; `FieldOutputTypes`/`FieldInputTypes` are derived from it
at emit time. The extension-package `contract.d.ts` fixtures (paradedb, pgvector,
postgis, supabase, sql-orm-client test fixture) regenerate to add the `StorageColumnTypes`
block. `contract.json` and hashes are byte-identical; `FieldOutputTypes` is unchanged.
No extension-author API or surface change. Incidental substrate diff only.
-->
