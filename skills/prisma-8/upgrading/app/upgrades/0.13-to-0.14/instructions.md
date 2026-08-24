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
      The builder-layer flat accessors are removed: the query builder and ORM client now
      expose per-namespace facets only, and the Postgres facade exposes the qualified
      surface. Code that builds queries against a Postgres (multi-namespace) contract must
      name the namespace the table/model is declared in: `db.sql.<table>` becomes
      `db.sql.<namespace>.<table>` and `db.orm.<Model>` becomes
      `db.orm.<namespace>.<Model>` (for a standard single-schema Postgres project the
      namespace is `public`). Code that calls the builder outputs directly migrates the
      same way: `sql.<table>` → `sql.<namespace>.<table>`, `orm.<Model>` →
      `orm.<namespace>.<Model>`. SQLite and Mongo projects are unaffected — their
      single-namespace facade keeps flat `db.sql.<table>` / `db.orm.<Model>` working. There
      is no codemod: the correct namespace is the one each table/model is declared in, which
      is call-site-specific.
    detection:
      glob: "**/*.{ts,tsx}"
      contains:
        - "db.sql."
        - "db.orm."
      anyMatch: true
  - id: sql-runtime-base-class-naming
    summary: |
      `@internal/sql-runtime` now exports `abstract class SqlRuntimeBase` (previously
      `SqlRuntime`) — the family-layer subclass seam. Target classes are now named with
      `Impl` suffix: `PostgresRuntimeImpl` and `SqliteRuntimeImpl`. The bare names
      `PostgresRuntime` and `SqliteRuntime` are now interfaces — the correct types to
      depend on in extension and app code. App code using the facade factories
      (`postgres(...)`, `sqlite(...)`) is unaffected.
    detection:
      glob: "**/*.{ts,tsx}"
      contains:
        - "SqlRuntime"
        - "PostgresRuntime"
        - "SqliteRuntime"
      anyMatch: true
  - id: create-runtime-removed
    summary: |
      `createRuntime` is removed from `@internal/sql-runtime`. Use the target
      factory (`postgres(...)` / `sqlite(...)`) or construct the target class
      directly: `new PostgresRuntimeImpl({...})` from `@internal/postgres/runtime`,
      `new SqliteRuntimeImpl({...})` from `@internal/sqlite/runtime`. App code
      using the facade factories (`postgres(...)`, `sqlite(...)`) is unaffected.
    detection:
      glob: "**/*.{ts,tsx}"
      contains:
        - "createRuntime"
  - id: migration-op-factories-to-methods
    summary: |
      The bare migration op factory functions are removed from
      `@internal/postgres/migration`. Replace each import and call-site with
      the corresponding method on `this` inside your `Migration` subclass. The
      option shapes changed from positional arguments to a single options object.
    detection:
      glob: "**/migration.ts"
      contains:
        - "from '@internal/postgres/migration'"
        - "from '@internal/target-postgres/migration'"
      anyMatch: true
    script: migration-op-factories-to-methods.ts
  - id: postgres-contract-serializer
    summary: |
      `SqlContractSerializer` (from `@internal/family-sql/ir`) can no longer
      deserialize Postgres contracts. The family serializer has an empty entries
      registry and now rejects the `type` key that every Postgres namespace carries.
      Any migration file or app code that calls
      `new SqlContractSerializer().deserializeContract(postgresContractJson)` must
      switch to `new PostgresContractSerializer()` imported from
      `@internal/target-postgres/runtime`.
    detection:
      glob: "**/*.{ts,tsx}"
      contains:
        - "SqlContractSerializer"
  - id: enum-becomes-domain-concept
    summary: |
      The PSL `enum` keyword now authors the domain enum (a text-class column whose
      value set is enforced by a CHECK constraint) — the native Postgres
      `CREATE TYPE … AS ENUM` semantics are gone. An `enum` block must carry
      `@@type("<codec-id>")` (e.g. `@@type("pg/text@1")`), members map to database
      values with `Name = "value"` (a bare member name defaults to itself where the
      codec accepts it), and `@map` on members is removed — the member value IS the
      mapping. The transitional `enum2` keyword is retired; rename those blocks to
      `enum` (emitted contract is identical). The TS authoring equivalent is
      `enumType(name, codecRef, ...member(name, value))` from
      `@internal/postgres/contract-builder` returned under the contract's `enums`
      key; the old native `enumType(name, values[])` / `enumColumn` from
      `@internal/adapter-postgres/column-types` are deleted. Databases that
      already carry a native enum type need a one-time converting migration (alter
      column to text USING ::text, add the value-set CHECK, DROP TYPE) — `contract
      infer` refuses native enum types by design and names them in its diagnostic.
    detection:
      glob: "**/*.prisma"
      contains:
        - "enum "
        - "enum2 "
      anyMatch: true
  - id: generated-models-export-removed
    summary: |
      The generated `contract.d.ts` no longer emits the flat top-level
      `export type Models`. Models resolve per-namespace from the domain plane:
      replace a reference to the generated `Models` with
      `Contract['domain']['namespaces']['<namespace>']['models']` (use `public`
      for a standard single-schema Postgres project, `__unbound__` for SQLite or
      Mongo). Re-emit the contract to drop the export.
    detection:
      glob: "**/*.{ts,tsx}"
      contains:
        - "Models"
---

<!--
TML-2867: codec-routed DDL defaults. The migration planner now resolves each plan
operation lazily (operations are `Promise<Op>[]`), and DDL execute steps carry a
`params` array. The example migration fixtures (`prisma-8-demo`,
`prisma-8-postgis-demo`) were regenerated to reflect the added `params` field.
No user-side API change. Incidental substrate diff only.
-->

<!--
TML-2852: the enum read surface. `enumType`-authored enums become first-class in
application code — an enum-restricted field's value union flows into the static
read/write types of both query lanes, `db.enums.<namespace>.<Name>` exposes the
enum at runtime (a lane-agnostic facade map), and `ORDER BY` on an enum column
sorts by declaration order. Purely additive and opt-in: PSL `enum` stays native
until the cutover, so only `enumType`-authored contracts exercise it, and
`fixtures:check` is byte-identical for every existing contract. No user-side
action — the examples/ diff is the new feature's demonstration. Incidental
substrate diff only.

TML-2838: the PGlite-backed example apps (`prisma-8-demo`, `react-router-demo`,
`supabase`, `bundle-size`, `multi-extension-monorepo`) switched their vitest
`pool` from `threads` to `forks` and pass `--no-memory-protection-keys`. Running
PGlite (WebAssembly) across vitest worker threads intermittently aborts on Linux
with a residual V8 JIT-page race (`jit_page_->allocations_.erase`) that
`@prisma/dev` 0.24.12 reduced but did not fully eliminate; process-per-fork with
PKU JIT-hardening disabled removes it. Test-harness only — no runtime, contract,
or public-API change. Incidental substrate diff only.
-->

# 0.13 → 0.14 — User upgrade instructions

## `uuid-preset-rename`

The uuid field preset names now include the storage encoding suffix:

| Before | After |
| --- | --- |
| `field.uuid()` | `field.uuidString()` |
| `field.id.uuidv4()` | `field.id.uuidv4String()` |
| `field.id.uuidv7()` | `field.id.uuidv7String()` |

These presets store UUIDs as `char(36)` strings and work across all SQL targets. If you want the Postgres-native `uuid` column type instead, use `field.uuidNative()` / `field.id.uuidv4Native()` / `field.id.uuidv7Native()` from `@internal/postgres/contract-builder`.

The rename is mechanical. Run the colocated script or apply the following find-and-replace in your `contract.ts` (or wherever you use the field builder):

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

No change to `contract.json` — both the old and new preset names emit the same codec (`sql/char@1`), so existing emitted contracts remain valid.

## `qualify-flat-builder-accessors`

The query builder and ORM client are now **always qualified by namespace**. The flat by-bare-name accessors are gone: there is no `sql.<table>` and no `orm.<Model>` at the builder layer, and the **Postgres** facade exposes the qualified surface (`db.sql` / `db.orm` are the namespace map). You reach a table or model by naming its namespace.

Namespace selection separates *which namespace's table* from *the ergonomic shorthand for the single-namespace case*. The builder layer always names the namespace; the single-namespace shorthand is recovered by the facade on targets that have only one namespace (SQLite, Mongo).

### Who needs to change code

**Postgres projects** that build queries through the facade or the builder outputs. A standard Postgres project keeps its tables and models in the `public` schema, so the namespace to insert is `public`:

```ts
// Before
const users = await db.sql.user.select('id', 'email').build().execute();
const alice = await db.orm.User.find({ where: { id } });

// After — name the namespace the table/model is declared in (`public` for a standard schema)
const users = await db.sql.public.user.select('id', 'email').build().execute();
const alice = await db.orm.public.User.find({ where: { id } });
```

The same rule applies inside a `transaction` (`tx.sql.public.user`, `tx.orm.public.User`), inside a `prepare(...)` callback (`(sql) => sql.public.user…`), and to code that imports the builder outputs directly rather than through the facade (`sql.public.user`, `orm.public.User`). If your Postgres contract declares more than one namespace, name the namespace each table/model actually sits in — `db.sql.auth.user` for a table in the `auth` schema, `db.sql.public.profile` for one in `public`.

### Who does **not** need to change anything

**SQLite and Mongo projects.** These targets have a single namespace, so their facade still exposes the flat surface — `db.sql.<table>` and `db.orm.<Model>` keep working unchanged. No edits are required.

### How to migrate

There is no codemod, because the correct namespace is the one each table or model is declared in — a fact that lives at the call site, not in a mechanical rule. For each flagged file:

1. If the project's facade is SQLite or Mongo (`sqlite(...)` / `mongo(...)`), leave it unchanged.
2. If it is Postgres (`postgres(...)`), insert the namespace segment after `.sql` / `.orm` (and on direct `sql` / `orm` builder calls): use `public` for a standard single-schema project, or the specific schema name for each table/model in a multi-schema contract.

After migrating, run your project's `pnpm typecheck` (or equivalent) — a missed site is a compile error (`Property '<table>' does not exist on type 'Db<…>'`), so the type checker pins every remaining flat access for you.

## `sql-runtime-base-class-naming`

The SQL runtime class hierarchy now follows the repo naming convention:

- `SqlRuntime` (previously exported) → now `SqlRuntimeBase` (abstract family base)
- `PostgresRuntime` (previously a class) → now an **interface** (the type to depend on); the concrete class is `PostgresRuntimeImpl`
- `SqliteRuntime` (previously a class) → now an **interface** (the type to depend on); the concrete class is `SqliteRuntimeImpl`

App code using the facade factories (`postgres(...)`, `sqlite(...)`) is unaffected — those return `Runtime` / the interface. Only code that referenced the class names directly needs to change:

```ts
// Before — referencing the class as a type
import { PostgresRuntime } from '@internal/postgres/runtime';
function takesRuntime(r: PostgresRuntime) { ... }

// After — use the interface (same import path)
import type { PostgresRuntime } from '@internal/postgres/runtime';
function takesRuntime(r: PostgresRuntime) { ... }

// Before — subclassing
import { PostgresRuntime } from '@internal/postgres/runtime';
class MyRuntime extends PostgresRuntime { ... }

// After — subclass the Impl
import { PostgresRuntimeImpl } from '@internal/postgres/runtime';
class MyRuntime extends PostgresRuntimeImpl { ... }
```

## `create-runtime-removed`

`createRuntime` is removed from `@internal/sql-runtime`. App code using the facade factories (`postgres(...)`, `sqlite(...)`) is unaffected — those still return a `Runtime` as before. Only code that imported and called `createRuntime` directly needs to change.

Replace direct `createRuntime` calls with the appropriate target class constructor or factory:

```ts
// Before
import { createRuntime } from '@internal/sql-runtime';
const runtime = createRuntime({ stackInstance, context, driver, ...opts });

// After — use the target factory (recommended for app code)
import { postgres } from '@internal/postgres';
const db = postgres({ contract, ...opts });
// runtime is accessed via db.connect() / db.runtime() etc.

// Or construct the target class directly (for advanced/test use)
import { PostgresRuntimeImpl } from '@internal/postgres/runtime';
const runtime = new PostgresRuntimeImpl({ adapter: stackInstance.adapter, context, driver, ...opts });
```

The constructor options are identical to what `createRuntime` accepted, except `stackInstance` is not taken: pass `adapter` from `stackInstance.adapter` directly.

## `migration-op-factories-to-methods`

The bare op factory functions previously exported from `@internal/postgres/migration` (and the deprecated `@internal/target-postgres/migration` alias) are removed. Each function is now a protected method on the `PostgresMigration` base class — call it as `this.<method>(...)` inside your `Migration` subclass body.

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

Example:

```ts
// Before
import { addForeignKey, createIndex, dropColumn } from '@internal/postgres/migration';

override get operations() {
  return [
    dropColumn('public', 'user', 'legacyName'),
    addForeignKey('public', 'post', {
      name: 'post_userId_fkey',
      columns: ['userId'],
      references: { schema: 'public', table: 'user', columns: ['id'] },
    }),
    createIndex('public', 'post', 'post_userId_idx', ['userId']),
  ];
}

// After
import { Migration, MigrationCLI } from '@internal/postgres/migration';

override get operations() {
  return [
    this.dropColumn({ schema: 'public', table: 'user', column: 'legacyName' }),
    this.addForeignKey({
      schema: 'public',
      table: 'post',
      foreignKey: {
        name: 'post_userId_fkey',
        columns: ['userId'],
        references: { schema: 'public', table: 'user', columns: ['id'] },
      },
    }),
    this.createIndex({ schema: 'public', table: 'post', index: 'post_userId_idx', columns: ['userId'] }),
  ];
}
```

The colocated script applies this transformation automatically. Run it from your project root:

```bash
pnpm exec tsx .claude/skills/prisma-8/upgrading/app/upgrades/0.13-to-0.14/migration-op-factories-to-methods.ts
```

## `postgres-contract-serializer`

`SqlContractSerializer` (from `@internal/family-sql/ir`) now rejects Postgres contracts. The family serializer validates entries against a registry of known entity kinds; it only knows the SQL-family built-ins (`table`, `valueSet`) and has no knowledge of the Postgres-specific `type` key (Postgres enum types). Every Postgres namespace carries `"type": {}` in its `entries`, so the family serializer throws a `ContractValidationError` naming `type` as an unregistered kind.

Replace `SqlContractSerializer` with `PostgresContractSerializer` in any migration file or app code that deserializes a Postgres-emitted contract:

```ts
// Before
import { SqlContractSerializer } from '@internal/family-sql/ir';
const contract = new SqlContractSerializer().deserializeContract(contractJson) as Contract;

// After
import { PostgresContractSerializer } from '@internal/target-postgres/runtime';
const contract = new PostgresContractSerializer().deserializeContract(contractJson) as Contract;
```

SQLite and family-only (non-Postgres) contracts are unaffected — their namespaces carry only `table` entries, which the family serializer knows about.

## `enum-becomes-domain-concept`

The `enum` keyword changed meaning. Before 0.14 a PSL `enum` block authored a **native Postgres enum** (`CREATE TYPE <name> AS ENUM (…)`, columns typed with the named type). Starting at 0.14 the same keyword authors the **domain enum**: the column stores plain values through a declared codec (typically `pg/text@1` → a `text` column) and the value set is enforced by a CHECK constraint the migration planner generates and verifies. The native enum machinery (the `pg/enum@1` codec, native `CREATE TYPE` planning, native-enum introspection adoption) is deleted.

### Who needs to change code

Any project whose `.prisma` schema contains an `enum` block **without** an `@@type(...)` attribute (the old native form), or with `@map` on members, or whose schema uses the transitional `enum2` keyword. Projects that already author enums with `@@type` + member values (the `enum2`-era shape introduced in 0.13) only need the keyword rename described below — the emitted contract is identical.

### 1. Convert the schema syntax

```prisma
// Before — native enum (0.13)
enum user_type {
  admin
  user
}

// After — domain enum (0.14)
enum user_type {
  @@type("pg/text@1")
  admin = "admin"
  user  = "user"
}
```

Rules:

- `@@type("<codec-id>")` is **required**. For string-valued enums use `@@type("pg/text@1")`.
- Each member maps to its database value with `member = "value"`. Under the native semantics the stored label was the member name, so a faithful conversion sets each value to the member's name (`admin = "admin"`). A member that previously carried `@map("dbvalue")` becomes `member = "dbvalue"` — `@map` on enum members is removed; the member value is the mapping.
- If your schema uses the transitional `enum2` keyword (added in 0.13), rename `enum2` → `enum`. Nothing else changes — that block shape is exactly what `enum` now means.

If you author contracts in TypeScript instead of PSL: the native `enumType(name, values[])` and `enumColumn(...)` helpers from `@internal/adapter-postgres/column-types` are deleted. Author the domain enum with `enumType` + `member` from your target's contract-builder and return it under the `enums` key:

```ts
import { defineContract, enumType, member } from '@internal/postgres/contract-builder';

const pgText = { codecId: 'pg/text@1', nativeType: 'text' } as const;
const UserType = enumType('user_type', pgText, member('admin', 'admin'), member('user', 'user'));

export const contract = defineContract({ /* … */ }, ({ field, model }) => ({
  enums: { user_type: UserType },
  models: {
    User: model('User', {
      fields: { /* … */ kind: field.namedType(UserType) },
    }),
  },
}));
```

Then re-emit: `prisma-next contract emit`. The emitted contract carries the enum as a domain entity plus a storage `valueSet`; the column becomes `pg/text@1` / `text` with a `valueSet` reference and a table-level check entry.

### 2. Migrate the database off the native type

A database created under 0.13 still has the native enum type and columns typed with it. Author a one-time converting migration — for each native enum type, in order:

1. Alter each column off the native type, casting the stored labels: `ALTER TABLE … ALTER COLUMN <col> TYPE text USING <col>::text`.
2. Add the value-set CHECK constraint the contract now declares (name it as the contract does, e.g. `<table>_<col>_check`).
3. Drop the native type: `DROP TYPE "<schema>"."<type>"`.

Because the contract hash does not change (the schema conversion in step 1 and the emitted contract are the end state), scaffold the migration as a data-only edge on the current hash: `prisma-next migration new --name convert-<type>-to-value-set --from <current-storage-hash>`, give the ALTER op `operationClass: 'data'`, and self-emit by running the scaffolded `migration.ts`. The `DROP TYPE` has no op builder — express it as an inline `rawSql` op.

A complete worked example ships in the Prisma Next repo: `examples/prisma-8-demo/migrations/app/20260611T1856_convert_user_type_to_value_set/migration.ts` — three ops (data-class ALTER … USING, `addCheckConstraint`, rawSql `DROP TYPE`), each with pre/postchecks that make replay idempotent.

Note: `prisma-next contract infer` **refuses** databases containing native enum types — it names each offending type and points at this conversion. Convert the database first, then infer.

### 3. Verify

Run `prisma-next db verify` (or your project's test suite) after applying the converting migration: the live schema must now match the contract — `text` column, CHECK constraint present, native type gone.

## `generated-models-export-removed`

The generated `contract.d.ts` no longer emits the flat top-level `export type Models` (the first-name-wins map of every model across namespaces). Models now resolve per-namespace from the domain plane, matching how the runtime and DSL read them.

If your code imported `Models` from the generated contract, read a namespace's models instead:

```ts
// Before
import type { Contract, Models } from './prisma/contract';
type UserModel = Models['User'];

// After — name the namespace the model is declared in
import type { Contract } from './prisma/contract';
type Models = Contract['domain']['namespaces']['public']['models'];
type UserModel = Models['User'];
```

Use `public` for a standard single-schema Postgres project, or `__unbound__` for SQLite and Mongo. In a multi-schema Postgres contract, name the schema each model is declared in. Re-emit your contract (`prisma-next contract emit`) so the generated `.d.ts` drops the `Models` export; the emitted `contract.json` is unchanged.

<!--
TML-2882: transitional PSL `enum2` block (PR #805). The demo authors `enum2 Priority`
and a `priority` field; emitted artifacts and migrations regenerate accordingly, and
the `ValueSetRef` carrier / `StorageValueSet` node tag land in their first persisted
form. Additive and opt-in: no existing consumer contract changes shape, native `enum`
is untouched, and re-emit round-trips. No consumer action required; the keyword is
transitional and is renamed to `enum` at the cutover (TML-2853), which will carry the
user-facing upgrade entry.
-->

<!--
TML-2855: member defaults via `@default(member)` (PR #808). The PSL interpreter and
contract-ts authoring surface now resolve `@default(EnumType.Member)` to a
`{ kind: 'literal', value: '<dbValue>' }` default. The demo `priority` field gains
`@default(Priority.Low)` and a new migration (`20260610T2216_set_priority_default`)
is emitted. Additive and opt-in: only fields that declare `@default(<EnumType>.<Member>)`
are affected; no existing contract changes shape. No consumer action required; the
cutover (TML-2853) will carry the user-facing docs.
-->

<!--
TML-2885: typed domain enum block in emitted contract.d.ts (PR #809). The emitter
now generates a `domain` block in `contract.d.ts` that exposes each PSL-authored enum
as a `ContractEnumAccessor<Entry>` with literal `values`, `names`, and `members` types.
`contract.json` is unchanged — the enum data was already there; this is a types-only
addition. Consumers that re-emit gain a literal-typed `db.enums.<namespace>.<Name>`
surface at compile time (e.g. `db.enums.public.Priority.members.Low` resolves to
`'low'` rather than `string`). Additive — no existing contract shape changes.
No consumer action required.
-->

<!--
TML-2886: typed ALTER TABLE … ADD COLUMN via AlterTable DDL IR (PR #813). The
example migrations that used the bare `addColumn()` helper are updated to
`this.addColumn(...)` (the method on the `Migration` base class, which now carries
full column typing via the `col()` builder). The column-attribute order in emitted
CREATE TABLE SQL changed from `… NOT NULL DEFAULT …` to `… DEFAULT … NOT NULL` as a
by-product of the AlterTable IR alignment. The example fixture snapshots are
regenerated accordingly. No user-facing contract or migration format change.
Incidental substrate diff only.
-->

<!--
TML-2886 (redo, PR #841): type SQL enum columns via a baked storage column lookup.
The SQL emitter now generates a top-level `StorageColumnTypes` map keyed
`[namespace][table][column]`; `FieldOutputTypes`/`FieldInputTypes` are derived from
it at emit time. The query builder (sql-builder) reads `StorageColumnTypes` directly;
the ORM still reads `FieldOutputTypes`. `contract.json` and both hashes are
byte-identical; `FieldOutputTypes` is byte-identical to main. The examples/ diff is
purely `.d.ts` regeneration (the new `StorageColumnTypes` block added; observable
types unchanged). No consumer action required. Incidental substrate diff only.
-->

<!--
#788: enum input types widened to their member union in emitted contract.d.ts (PR
#797). The emitter now renders an enum-restricted field's input type as the literal
member union on the write side, matching the existing output side: a `pg/enum@1`
field's `FieldInputTypes` entry flips from `CodecTypes['pg/enum@1']['input']` (≈
`string`) to e.g. `'admin' | 'user'`. The example `contract.d.ts` goldens are
regenerated accordingly. `contract.json` is unchanged — this is a types-only
addition that makes create/update exhaustiveness-checked. Additive; no existing
contract shape changes. No consumer action required. Incidental substrate diff only.
-->

<!--
TML-2853 (PR #829): regenerate the `prisma-8-demo` example migration chain into
the new value-set representation, recovering work that #817 (the user-facing
`enum-becomes-domain-concept` cutover, already in main) left undone in the example.
The committed chain previously created `user_type` as a native `CREATE TYPE … AS ENUM`
and converted it in a later self-edge migration — a start state the post-cutover
system can no longer produce. The chain is re-authored as a multi-step incremental
history in which the initial migration creates `user.kind` as a `text` column with a
`user_kind_check` CHECK constraint from the start; the native-enum arc and the
`convert_user_type_to_value_set` self-edge are removed. The remaining incremental
milestones (displayName, MTI variant link columns, `post.priority` value-set + default)
are preserved so the chain still demonstrates the incremental migration CLI. Diff is
`examples/prisma-8-demo/migrations/**` only. No NEW consumer action beyond the
existing `enum-becomes-domain-concept` entry above. Incidental substrate diff only.
-->

<!--
TML-2550: per-namespace typed resolution. The emitted contract.d.ts TypeMaps
(`FieldOutputTypes` / `FieldInputTypes`) now nest by namespace
(`{ [namespace]: { [model]: { [field] } } }`), so the query builder and ORM client
resolve each namespace's own columns/fields — fixing same-bare-name models declared
in more than one namespace. The example contract.d.ts fixtures regenerate to the
nested shape; a consumer re-emit round-trips. The user-facing always-qualified query
surface is already covered by `qualify-flat-builder-accessors` above — this slice is
the type-resolution fix beneath it. No user action: re-emit picks up the new shape.
Incidental substrate diff only.
-->

<!--
TML-2916: un-namespaced Postgres models now correctly default to the `public`
namespace per ADR 223, dropping the spurious empty `__unbound__` storage slot the
authoring + serializer pipeline was injecting. Example contract.json / contract.d.ts /
end-contract.* / migration.json files regenerate to drop the `__unbound__` slot;
migration content hashes update. No user action: re-emit picks up the new shape.
Incidental substrate diff only.
-->
