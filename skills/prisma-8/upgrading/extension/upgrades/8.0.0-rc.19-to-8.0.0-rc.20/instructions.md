---
from: "8.0.0-rc.19"
to: "8.0.0-rc.20"
changes:
  - id: engine-pin-moves-to-0-9-0
    summary: |
      The toolchain now peers `@prisma/cli-engine@0.9.0` (up from 0.7.0). An extension package whose tests or tooling load `@prisma/cli-engine` alongside the Prisma toolchain must move it to `0.9.0`, in `package.json` or in a `pnpm-workspace.yaml` catalog. A separate CLI that the package builds on the engine is not affected. The detection matches an engine version below 0.9 in either file.
    detection:
      glob: "**/{package.json,pnpm-workspace.yaml}"
      matches:
        - '[\x27"]@prisma/cli-engine[\x27"]\s*:\s*[\x27"]?[^\x27"\n#]*(?<![\d.])0\.[0-8](?!\d)'
  - id: piped-output-needs-json
    summary: |
      A piped Prisma ORM command no longer prints JSON. A test that runs the CLI with a non-terminal stdout and parses JSON frames from it must pass `--json`.
  - id: stored-contracts-expand-type-aliases
    summary: |
      A stored SQL contract whose columns name a type alias in `typeRef` no longer loads. Run `scripts/expand-type-aliases/expand-type-aliases.ts` from the extension's package root, then re-emit the bundled contract. If the re-emit drops a type alias that no field uses, add a migration with no operations to the re-emitted hash, move the head ref to it, and add it to the migrations the descriptor ships. The script writes each alias's parameters into the columns typed by it, in every stored contract the extension ships, its migration snapshots included, and rewrites the hashes and references that change.
    detection:
      glob: "**/contract.json"
      matches:
        - '"typeRef"\s*:'
    script: ./scripts/expand-type-aliases/expand-type-aliases.ts
  - id: types-key-is-database-types
    summary: |
      A TypeScript contract space that registers a database type now writes it under `databaseTypes` instead of `types`. Rename the key and keep its entries. `defineContract` refuses a `types` key with `CONTRACT.TYPES_KEY_REMOVED`. The contract and its storage hash do not change. The detection matches a `types` key whose entries are `kind: 'codec-instance'` literals.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\w$.\x27"])types\s*:\s*\{\s*(?:\[[^\]]*\]|[\w$]+|[\x27"][^\x27"]*[\x27"])\s*:\s*\{\s*kind\s*:\s*[\x27"]codec-instance[\x27"]'
  - id: column-type-ref-removed
    summary: |
      `ColumnTypeDescriptor.typeRef`, `StorageColumn.typeRef` and `ExecutionContext.types` are removed. Read a column's codec and parameters from its own `codecId` and `typeParams`. The codec instance of a parameterized column is now named `<col:Table.column>`, never after a type alias. The detection matches TypeScript that reads `typeRef` or the execution context's `types`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\w$])typeRef(?![\w$])'
        - '[cC]ontext\.types(?![\w$])'
  - id: type-alias-descriptor
    summary: |
      No action is needed. A pack may now contribute a type alias in its `type` namespace, a descriptor of `kind: 'typeAlias'` whose output names a column type and optional `onCreate` and `onUpdate` generator calls. Assembly refuses, with `CONTRACT.PACK_CONTRIBUTION_INVALID`, fixed type parameters the codec's parameter schema refuses and a generator call that does not resolve for the codec.
  - id: entity-context-data-types
    summary: |
      `AuthoringEntityContext` has a required `dataTypes: DataTypeSupport`, the stack's data types with their authoring entries, in place of `dataTypeLookup`; its `readWrittenValueForCodec` hook and the `WrittenValueReading` type are removed. Where an extension builds an `AuthoringEntityContext`, replace `dataTypeLookup` with `dataTypes` from the contract source context or the assembled stack (`assembleDataTypeSupport`), and read the data type lookup as `ctx.dataTypes.lookup`. To read a written value into a codec, call `readWrittenValueIntoCodec({ support, codecLookup, ref, written, subject })` from `@internal/framework-components/authoring`, which returns the stored value or a refusal with its code and message. The detection matches code that uses the removed hook or type, builds the context by hand, or reads `dataTypeLookup` from a context.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\w$])readWrittenValueForCodec(?![\w$])'
        - '(?<![\w$])WrittenValueReading(?![\w$])'
        - ':\s*AuthoringEntityContext\s*=\s*\{'
        - '(?<![\w$])ctx\.dataTypeLookup(?![\w$])'
  - id: enum-block-members-written-values
    summary: |
      `readEnumBlockMembers` reads every member through `readWrittenValueIntoCodec` and no longer reads a member's value as JSON. A block member with a value must have an entry in the block's `writtenValues`, which the PSL block interpreter records for every literal and for a list of literals; a member without one throws an `InternalError`, and a bare member is read from its name. `writtenValues` now holds a `WrittenValue`, which may be a list. An extension that builds an enum block itself sets `writtenValues` for each member with a value, as `{ kind: 'string', text }` for text. The detection matches code that calls `readEnumBlockMembers` or reads `writtenValues`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\w$])readEnumBlockMembers\('
        - '\.writtenValues(?![\w$])'
  - id: access-changes-rename
    summary: |
      `accessWidening` is renamed `accessChanges` on `MigrationPlanSubjects` (from `@prisma/orm-framework/components/control`) and on every type that extends it: `MigrationPlannerSuccessResult`, `PerSpacePlan` and `DbUpdateSuccess`. The subjects argument of `plannerSuccess` from `@prisma/orm-family-sql/family/control` takes `accessChanges`, and the control API option `acceptAccessWidening` becomes `acceptAccessChanges`. There is no alias for the old names.
    detection:
      glob: "**/*.{ts,tsx,mts,cts,js,mjs,cjs}"
      matches:
        - '(?<![\w$])(?:acceptAccessWidening|accessWidening)(?![\w$])'
  - id: statement-planning-target-namespaces
    summary: |
      In `@prisma/orm-family-sql/family/control`, `SchemaTables` gains `hasNamespace(namespaceId)`, and `StatementPlanningTarget` gains an optional `namespaces` member. A `SchemaTables` or a test double of it adds `hasNamespace`; a target with several namespaces may add `namespaces`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '(?<![\w$])(?:StatementPlanningTarget|SchemaTables)(?![\w$])'
  - id: schema-ownership-namespace-spaces
    summary: |
      `SchemaOwnership` from `@prisma/orm-framework/components/control` gains `namespaceDeclaringSpaces(namespaceId)`: the ids of the contract spaces that declare the namespace. A test double of it adds the method.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '(?<![\w$])SchemaOwnership(?![\w$])'
  - id: namespace-rename-statement
    summary: |
      `ResolvedRenameStatement` from `@prisma/orm-framework/components/control` gains `ResolvedNamespaceRenameStatement`, `{ kind: 'rename', entity: 'namespace', from, to }`, whose `from` and `to` are namespace ids. Code that switches over a rename's `entity` handles `'namespace'`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '(?<![\w$])ResolvedRenameStatement(?![\w$])'
  - id: check-expectation
    summary: |
      A migration check that expects one object to be absent or present can now say so in an optional `expectation` field, and a failed precheck's message then names the object: `That check failed: the database already has index "Item_state_idx".` instead of `That check failed on this database.` Checks written without it keep working and keep the generic sentence.
    detection:
      glob: "**/ops.json"
      matches:
        - '(?:\{\s*"description": "(?:[^"\\]|\\.)*",\s*"sql": "(?:SELECT (?:NOT )?EXISTS \(SELECT 1 AS \\"one\\" FROM \\"(?:information_schema\\"\.\\"columns|pg_extension|pg_constraint|pg_class|pg_policies|pg_type|pg_enum|pg_indexes|pg_namespace)\\"(?: AS \\"\w+\\")?(?: INNER JOIN \\"pg_(?:namespace|type|class)\\" AS \\"\w+\\" ON \\"\w+\\"\.\\"\w+\\" = \\"\w+\\"\.\\"\w+\\")* WHERE (?:[^"\\]|\\"(?:table_schema|table_name|column_name|extname|conname|connamespace|conrelid|nspname|schemaname|tablename|policyname|indexname|typname|typnamespace|enumlabel|enumtypid|relname|relkind|oid|type|name|c|n|t|e|i|p)\\")*?\) AS \\"result\\"|SELECT \(to_regclass\(\$\d+\)\) IS (?:NOT )?NULL AS \\"result\\"|SELECT COUNT\(\*\) (?:= 0|> 0) AS \\"result\\" FROM (?:\\"sqlite_master\\"|pragma_table_info\([^)"]*\)|pragma_index_list\([^)"]*\)) WHERE (?:[^"\\]|\\"(?:table_schema|table_name|column_name|extname|conname|connamespace|conrelid|nspname|schemaname|tablename|policyname|indexname|typname|typnamespace|enumlabel|enumtypid|relname|relkind|oid|type|name|c|n|t|e|i|p)\\")*?)"(?:,\s*"params": \[[^\]]*\])?\s*\}|"source": \{\s*"kind": "list(?:Indexes|Collections)"(?:,\s*"collection": "(?:[^"\\]|\\.)*")?\s*\},\s*"filter": \{\s*"kind": "field",(?:[^{}]|\{[^{}]*\})*\},\s*"expect": "(?:exists|notExists)"\s*\})'
  - id: check-expectation-raw-sql
    summary: |
      A precheck or postcheck you write by hand in a `rawSql` operation of a `migration.ts` can carry `expectation`, `{ expects: 'absent' | 'present', object }`, so a failure of it names the object. Add it where the check asks whether one object exists, then run `node migration.ts` for a migration no database has applied yet.
    detection:
      glob: "**/migration.ts"
      matches:
        - '\brawSql\(\{[\s\S]*?\b(?:precheck|postcheck):\s*\[(?:\s*\{(?:[^{}]|\{[^{}]*\})*\},)*?\s*\{[^{}]*\}'
  - id: sql-builder-insert-required-columns
    summary: |
      A SQL builder insert, `db.sql.<namespace>.<table>.insert(rows)`, must now include every column that is not nullable and has no default. Leaving one out is a type error that names the column, and so is a value typed `T | undefined` for such a column. Add a real value, narrowed to `T`.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      matches:
        - '\.insert\('
  - id: supabase-for-role-replaces-with-role-methods
    summary: |
      `SupabaseRuntime` no longer has `queryWithRole`, `executeWithRole`, `preparedQueryWithRole` or `preparedExecuteWithRole`, and `SupabaseRuntimeImpl` no longer has `roleActivitySource`. Call `runtime.forRole(binding)` once and use its members: `runtime.queryWithRole(plan, binding, options)` becomes `runtime.forRole(binding).query(plan, options)`, `executeWithRole` becomes `forRole(binding).execute`, a prepared statement runs on the role with `statement.query(runtime.forRole(binding), params)` or `statement.execute(runtime.forRole(binding), params)`, and the role's activity source is the `activitySource` member of `forRole(binding)`. The detection matches files that call one of the removed methods.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs}"
      matches:
        - '\.(?:queryWithRole|executeWithRole|preparedQueryWithRole|preparedExecuteWithRole|roleActivitySource)\('
  - id: supabase-role-types-gain-members
    summary: |
      Three public Supabase types require new members, so a test double or hand-built object typed with them stops compiling. `RoleBoundDb` and `ServiceRoleDb` gain `enums` and `nativeEnums`. `SupabaseTransactionContext` is now `PostgresTransactionContext`, so it gains `enums` and `nativeEnums` too. `SupabaseRuntime` requires `forRole(binding)`, which returns a `SupabaseRoleScope` (`query`, `execute`, the prepared-statement operations and `connection`), in place of the four removed `*WithRole` methods. Add the members to each double: take `enums` and `nativeEnums` from `postgresStatic({ contract })` of `@prisma/orm-postgres/static`, or from a role-bound client. The detection matches files that name one of these types.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\w$])(?:RoleBoundDb|ServiceRoleDb|SupabaseTransactionContext|SupabaseRuntime)(?![\w$])'
  - id: raw-connection-obeys-close
    summary: |
      `SqlRuntimeBase.acquireRawConnection()` now follows the close rule of `connection()`: once the runtime starts refusing new work it rejects with `DRIVER.NOT_CONNECTED` "Runtime is closed" (at once with `closeRefusal: 'at-once'`, after the runtime has been idle for a turn of the event loop with `'when-idle'`), unless you pass `{ activityParent }` of an activity that is still open; the statements and transactions run on the connection are work `close()` waits for, and a connection held between statements is not. A transaction now counts as work from its start until its commit or rollback settles, its commit fails, or its connection is released or destroyed, so `close()` waits for an open transaction on any connection and, while it waits only for transactions still open, logs `runtime.close.waiting-for-activities` with `openTransactions`, their count; it waits for each until it commits or rolls back. A subclass that shares its driver with another runtime builds each runtime with the new `ownsDriver: false` option, closes them all, then closes the driver once. The detection matches files that call `acquireRawConnection`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\w$])acquireRawConnection\('
  - id: supabase-pg-takes-a-pool
    summary: |
      The `pg` option of `supabase()` takes a `pg.Pool` only. A `pg.Client` is a type error and fails at `supabase()` with `SUPABASE.CONFIG_INVALID`. Replace `pg: new Client(...)` with `pg: new Pool(...)` built from the same settings, or pass `url`. The detection matches every `supabase()` call that passes `pg`; leave a call that already passes a `pg.Pool` as it is.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs}"
      matches:
        - '(?<![\w$.])supabase(?:<[^>]*>)?\(\s*\{(?:[^{}]|\{[^{}]*\})*?(?<![\w$.])pg\s*[:,}]'
---

# 8.0.0-rc.19 → 8.0.0-rc.20 — Extension author upgrade instructions

One change comes with a script. Run `stored-contracts-expand-type-aliases` before you re-emit the extension's bundled contract. Make the other changes, then re-emit the bundled contract once.

## CLI engine 0.9.0

### `engine-pin-moves-to-0-9-0`

This applies to tests and tooling that load `@prisma/cli-engine` alongside the Prisma toolchain. A separate CLI that the package builds on the engine runs its own engine, so it does not have to move with this upgrade.

For every `package.json` or `pnpm-workspace.yaml` catalog matched by `detection`, change the `@prisma/cli-engine` version (`0.7.0`, `^0.7.0` or any other 0.x below 0.9) to `0.9.0` and reinstall.

### `piped-output-needs-json`

Engine 0.9.0 chooses the output format from flags only. Before, a run whose stdout was not a terminal printed JSON frames; now it prints the human card on stderr and the command's data lines on stdout. The engine's test harness from `@prisma/cli-engine/testing` treats stdout as a pipe unless `isTty.stdout` is set, so it is affected the same way.

Find the tests and tooling that run a Prisma ORM command, through a spawned `prisma` process or `createTestCli`, and read JSON from its output: they parse the `result` frame of its stdout, read `json` from the harness run, or read `presented.presentation.json`. Add `--json` to the argv of each such run. A run in human format still returns the command's document as `presented.data`, so a test that reads only that needs no change.

## Type aliases are written into each column

A type alias is now authoring shorthand only. The contract no longer stores an alias in `storage.types` with a `typeRef` on each column that uses it. Each column stores its own codec and parameters, and `storage.types` holds only the database types a contract space registers, such as pgvector's `vector`.

### `stored-contracts-expand-type-aliases`

Migration snapshots that an extension ships, its bundled `contract.json`, and any other stored contract written by an earlier release may have a column with a `typeRef`. This release refuses such a contract and says to re-emit it. A historical snapshot cannot be re-emitted from today's source, so run the script instead. Do this before you re-emit the bundled contract, and commit your work first so the script's changes can be reviewed and undone with git. Run it from the extension's package root:

```sh
node <guide>/scripts/expand-type-aliases/expand-type-aliases.ts
```

`<guide>` is the directory that holds this guide. Node 24 or later runs the TypeScript script directly; it needs no `tsx`. The script reads and writes files only and needs no database. It rewrites every SQL contract under the root, skipping `node_modules`, `dist`, `build` and every directory whose name starts with `.`, such as `.git` and the worktrees under `.claude/worktrees/`. That includes test fixtures: if you keep an old contract on purpose, restore it with git afterwards.

In each contract it replaces every column's `typeRef` with the parameters of the `storage.types` entry it names, and removes each entry a column named. It makes the same change in the `contract.d.ts` next to the contract. The extension's own contract space is an extension's space, because its `migrations/` directory holds `refs/` directly, so an entry that no column names is kept, as a database type the contract registers, and the script lists it. The script cannot tell such an entry from an alias your source declares but no field uses, so it keeps both. A re-emit drops an unused alias, so the bundled contract then gets another storage hash than the one the script wrote into `migrations/refs/head.json`. Do not change the script's output to match: each application runs the same script on its own copy of your migrations and gets the hash the script wrote. Add a migration to the re-emitted contract instead, as described after the re-emit below.

The storage hash changes, so the script also renames each changed snapshot directory to its new hash. It rewrites every `migration.json`, ref, `migration.ts` and `contract.d.ts` that names an old hash, and gives each changed migration a new `migrationHash`. When it finishes, it prints how many files it rewrote, how many snapshot directories it renamed, each storage hash it replaced (`<old> -> <new>`), each `storage.types` entry it removed, per contract, and each entry it kept. A package with no `typeRef` is left unchanged, and the script says so.

It changes no file and exits 1, naming the file, when a `contract.json`, `migration.json`, `ops.json` or ref is not valid JSON; when a contract's stored storage hash or snapshot directory name does not match its content; when a column names an alias `storage.types` does not declare, stores both `typeRef` and `typeParams`, or has a codec or data type other than its alias's; when a migration with no data operation goes between two snapshots that become the same snapshot once their aliases are written into their columns, because it only introduced or renamed an alias; or when a renamed snapshot directory already exists with different content. In the first three cases, restore that file from version control, or re-emit it, and run the script again. When two snapshots become one, the script names each migration between them that has no data operation, because after the upgrade it would go from a snapshot to itself, which only a migration with a data operation may do. Delete its directory and run the script again. When that migration is your latest, nothing else names its target snapshot, so the script names that snapshot directory too; delete it as well. The script then writes the merged snapshot's hash into every `migration.json`, ref and `migration.ts` that names either old hash, and gives each changed migration a new `migrationHash`. If it stops partway, for example on a full disk, it says so; run it again to finish.

Then re-emit the bundled contract with the extension's own emit script, and ship the new `contract.json` and `contract.d.ts` together. A bundled contract written in PSL may keep its `types {}` aliases.

If the re-emitted `storage.storageHash` differs from the hash in `migrations/refs/head.json`, the re-emit dropped an alias that no field uses. An application would then refuse to load the extension with `MIGRATION.DESCRIPTOR_HEAD_HASH_MISMATCH`, because the head ref must name the bundled contract's hash. Write a migration with no operations from the head ref's hash to the re-emitted hash, in a new directory under `migrations/`. Import `Migration` and `MigrationCLI` from your target's migration module, as your existing `migration.ts` files do. The example uses Postgres's, `@internal/postgres/migration`:

```ts
#!/usr/bin/env -S node
import { Migration, MigrationCLI } from '@internal/postgres/migration';

export default class M extends Migration {
  override describe() {
    return { from: '<the hash in migrations/refs/head.json>', to: '<the re-emitted storageHash>' };
  }

  override get operations() {
    return [];
  }
}

MigrationCLI.run(import.meta.url, M);
```

Run `node migration.ts` in that directory to write its `ops.json` and `migration.json`. Copy the re-emitted `contract.json` and `contract.d.ts` into `migrations/snapshots/<the re-emitted storageHash>/`. Then set `hash` in `migrations/refs/head.json` to the re-emitted hash, and keep its `invariants`. The new migration changes nothing in the database.

Then add the new migration to the migrations your descriptor ships, after the existing ones. An application gets the extension's migrations only from that list. Without it, an application's database that is empty or at the head ref's old hash cannot reach the new head. In pgvector, PostGIS and ParadeDB the list is the `migrations` argument of `contractSpaceFromJson`:

```ts
import removeUnusedAliasMetadata from '../../migrations/<the new directory>/migration.json' with { type: 'json' };
import removeUnusedAliasOps from '../../migrations/<the new directory>/ops.json' with { type: 'json' };

const contractSpace = contractSpaceFromJson<Contract<SqlStorage>>({
  contractJson,
  migrations: [
    { dirName: BASELINE_DIR_NAME, metadata: baselineMetadata, ops: baselineOps },
    { dirName: '<the new directory>', metadata: removeUnusedAliasMetadata, ops: removeUnusedAliasOps },
  ],
  headRef,
});
```

If the storage hash of the bundled contract changed, tell the applications that use the extension, in your release notes, to run `prisma db sign` against every database after they upgrade, and name the old and new hash. The old hash is the one the bundled contract had before you ran the script, and the new hash is the one in `migrations/refs/head.json` when you publish. The Supabase extension's contract is an example: its hash changes from `292489649ae6d6928de98a32b544bd9caf6b7d49718c10fe2720b83545a4b5a2` to `110ad99e1e466691bdb0a4349a17365561e76ad017f58beb272f4496b05b8e9e`. Tell them too that `prisma migration status` no longer marks the extension's migrations applied before the upgrade as applied, because each rewritten migration has a new hash. `prisma db migrate` runs none of them again, and `prisma db verify` passes. A database that has not applied every migration yet is refused by a plain `prisma db sign`, and `prisma db migrate` stops on it with `MIGRATION.MARKER_MISMATCH`: tell them to sign it with `prisma db sign --contract <the last migration it applied>` and then run `prisma db migrate`, as the app guide's `stored-contracts-expand-type-aliases` says.

### `types-key-is-database-types`

A contract space that registers a database type, because PSL has no syntax for an extension to register one, writes it under `databaseTypes`:

```ts
// Before
export const contract = defineContract({ codecLookup, dataTypeLookup }, () => ({
  types: {
    [PGVECTOR_NATIVE_TYPE]: { kind: 'codec-instance', codecId: VECTOR_CODEC_ID, typeParams: {} },
  },
  models: {},
}));

// After
export const contract = defineContract({ codecLookup, dataTypeLookup }, () => ({
  databaseTypes: {
    [PGVECTOR_NATIVE_TYPE]: { kind: 'codec-instance', codecId: VECTOR_CODEC_ID, typeParams: {} },
  },
  models: {},
}));
```

The emitted contract is the same, so its storage hash does not change. No column can reference a `databaseTypes` entry: `field.namedType(...)` now takes only an enum handle. If the `types` key held aliases that fields used through `field.namedType(types.X)`, write each as a constant instead, `const X = field.column(type.Y(...))`, and use the constant as the field. Then re-emit the bundled contract.

### `column-type-ref-removed`

Code that reads storage gets the column's type from the column itself:

- `StorageColumn` and `ColumnTypeDescriptor` have no `typeRef`. Read `codecId` and `typeParams` from the column. A validated contract never has a `typeRef`, so there is no alias to look up in `storage.types`.
- `ExecutionContext.types` and the `TypeHelperRegistry` are removed. Get a column's codec from the codec registry, for example through `codecRefForColumn(table, column)`.
- A codec instance's `name` in its `CodecInstanceContext` is `<col:Table.column>` for a parameterized column, the first column with that codec and those parameters. It used to be the alias's name for columns typed by an alias. Columns with the same codec and parameters still share one instance, and its `usedAt` lists them all. A codec that keyed per-instance state by the alias name must key it by its parameters instead.
- `planTypeOperations` and `verifyType` still run for each `storage.types` entry, which is now only a registered database type.

A hit in a generated `contract.d.ts` is rewritten by `stored-contracts-expand-type-aliases`; do not edit it by hand.

### `type-alias-descriptor`

There is nothing to change. A pack's `type` namespace may now contain a type alias:

```ts
CreatedAt: {
  kind: 'typeAlias',
  documentation: 'A timestamp the client sets to now when a row is created.',
  output: { type: { codecId: 'pg/timestamptz-temporal@1' }, onCreate: { name: 'now', args: {} } },
},
```

It takes no arguments. PSL writes it bare as a field type (`temporal.CreatedAt`), and TypeScript as `field.column(type.temporal.CreatedAt())`. Each `onCreate` and `onUpdate` call is resolved by the column's codec, and assembly refuses a call that does not resolve with `CONTRACT.PACK_CONTRIBUTION_INVALID`.

## Written values are read into a codec by one framework function

Enum members and `@@base` values are read by `readWrittenValueIntoCodec` in `@internal/framework-components/authoring`, in every family. It replaces the `readWrittenValueForCodec` hook on `AuthoringEntityContext`, which now carries the stack's `dataTypes` in place of the hook and of `dataTypeLookup`:

```typescript
const context: AuthoringEntityContext = {
  family,
  target,
  codecLookup,
  dataTypes,
};
```

A discriminator and its variants' values are decided by `applyDiscriminatorRule`, and its refusals worded for PSL by `describeDiscriminatorRefusal`, both in the same entry point; a target names its text data types in `authoring.textDataTypes`.

## `accessWidening` is renamed `accessChanges`

A migration planner lists each operation that changes who can read or write data. Such an operation does not always widen access, so the list is now `accessChanges`. Each entry is still a `MigrationAccessChange`, with `widens` saying whether it widens access. Rename the property wherever a planner, a test double or a hand-built plan sets or reads it:

```ts
// Before
return { kind: 'success', plan, appliedStatements, dataLoss: [], accessWidening: [], temporaryValues: [] };
plannerSuccess(plan, appliedStatements, { dataLoss: [], accessWidening: [], temporaryValues: [] });

// After
return { kind: 'success', plan, appliedStatements, dataLoss: [], accessChanges: [], temporaryValues: [] };
plannerSuccess(plan, appliedStatements, { dataLoss: [], accessChanges: [], temporaryValues: [] });
```

A caller of the control API's `executeDbUpdate` or `dbUpdate` renames the option `acceptAccessWidening` to `acceptAccessChanges`, and reads `accessChanges` from a `DbUpdateSuccess`.

## Statements can move tables and rename namespaces

### `statement-planning-target-namespaces`

A SQL target's statement planner now moves a table to another namespace and renames a namespace. Add `hasNamespace` to each `SchemaTables` you implement:

```ts
hasNamespace: (namespaceId) => namespaceId === UNBOUND_NAMESPACE_ID,
```

A target with one namespace, as SQLite has, leaves out `namespaces` on its `StatementPlanningTarget`; the planner then refuses a namespace rename or a model move with a `statementRefused` conflict. A target with several namespaces adds `namespaces: { createNamespaceCalls, moveTableCall, namespaceRenameRefusal, renameNamespaceCall }`, returning the calls that create a namespace, move a table and rename a namespace, which it applies to its working schema. `namespaceRenameRefusal` returns `{ reason, fix }` for a namespace it cannot rename for a reason of its own, such as Postgres's `public`; the planner itself refuses a namespace another contract space declares.

### `schema-ownership-namespace-spaces`

Add `namespaceDeclaringSpaces: () => []` to a `SchemaOwnership` test double that declares no namespace, or return the ids of the spaces whose contracts have the namespace in `storage.namespaces`.

### `namespace-rename-statement`

A `switch` or `if` over `statement.entity` of a `ResolvedRenameStatement` gains a `'namespace'` branch. A planner that cannot rename a namespace refuses the statement with a `statementRefused` conflict.

## Checks say which object they expect absent or present

Before an operation runs, the migration runner runs its prechecks. When one fails, the error's `why` named the check and said only that it failed on this database. A check that expects one object to be absent or present can now carry that as data, in `expectation`, and the `why` then says what the database already has or lacks. On MongoDB, a check carries the object's name in `object`, and its `expect` says whether it should exist.

Nothing breaks without it. An `ops.json` that has no `expectation` reads, verifies its hash and runs as before.

### Migrations Prisma writes

The PostgreSQL, SQLite and MongoDB operations now write it on every check that asks only whether one object exists. A matched `ops.json`, or a MongoDB `ops.json` written before this change, gains it when you write it again: run its `migration.ts` (`node migration.ts`). Writing it again changes its hash, so do this only for a migration that no database has applied yet. Leave an applied migration as it is.

Do not write a migration your extension has already published again: the apps that applied it recorded its hash. The rewrite that `stored-contracts-expand-type-aliases` makes is different: every application runs the same script on its own copy of your migrations.

### Checks you write yourself

In your extension's migrations, a check you write in a `rawSql` operation can carry it too. Add `expectation` to the precheck or postcheck step, with `expects: 'absent'` or `'present'` and the object as a reader would name it, then run `node migration.ts`:

```typescript
rawSql({
  // ...
  precheck: [
    {
      description: 'verify extension "vector" is not already enabled',
      sql: "SELECT NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector')",
      expectation: { expects: 'absent', object: 'extension "vector"' },
    },
  ],
})
```

Leave it out of a check about data or about several objects at once, such as a check that a column holds no NULL values.

## Inserts must include the columns the database requires

The SQL builder's `insert` now requires every column that is not nullable and has no default. A column is still optional when it is nullable, has a default (`@default(...)`, including `now()` and `autoincrement()`), or is generated on create (`@onCreate(...)` or a preset that generates on create).

For each insert in your extension's code that stops compiling, add a real value for each column the error names. Do not cast the row. A required property does not accept `undefined`, so a value typed `T | undefined` for one of these columns must be checked before the insert.

## Supabase runs every role operation through one object

`SupabaseRuntime.forRole(binding)` returns a `SupabaseRoleScope`, the runtime operations under one role: `query`, `execute`, the prepared-statement operations and `connection`. Run a transaction under the role with `withTransaction(runtime.forRole(binding), fn)`.

| Type | New required members |
| --- | --- |
| `RoleBoundDb`, `ServiceRoleDb` | `enums`, `nativeEnums` |
| `SupabaseTransactionContext` | `enums`, `nativeEnums` (it is now `PostgresTransactionContext`) |
| `SupabaseRuntime` | `forRole(binding)`, in place of the four `*WithRole` methods |

```ts
// Before
const rows = await runtime.queryWithRole(plan, { role: 'anon' }).toArray();

// After
const rows = await runtime.forRole({ role: 'anon' }).query(plan).toArray();
```

The statements and the open transactions on a raw connection keep `close()` waiting; a connection held between statements does not, so release it when you are done:

```ts
const connection = await this.acquireRawConnection({ activityParent });
try {
  await connection.execute({ sql: 'SELECT 1' });
} finally {
  await connection.release();
}
```
