---
changes:
  - id: stored-contracts-expand-type-aliases
    summary: |
      A stored SQL contract whose columns name a type alias in `typeRef` no longer loads. Run `scripts/expand-type-aliases/expand-type-aliases.ts` from the extension's package root, then re-emit the bundled contract. If the re-emit drops a type alias that no field uses, add a migration with no operations to the re-emitted hash, move the head ref to it, and add it to the migrations the descriptor ships. The script writes each alias's parameters into the columns typed by it, in every stored contract the extension ships, its migration snapshots included, and rewrites the hashes and references that change.
    detection:
      glob: "**/contract.json"
      matches:
        - '"typeRef"\s*:'
    script: scripts/expand-type-aliases/expand-type-aliases.ts
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
---

# Type aliases are written into each column

A type alias is now authoring shorthand only. The contract no longer stores an alias in `storage.types` with a `typeRef` on each column that uses it. Each column stores its own codec and parameters, and `storage.types` holds only the database types a contract space registers, such as pgvector's `vector`.

## `stored-contracts-expand-type-aliases`

Migration snapshots that an extension ships, its bundled `contract.json`, and any other stored contract written by an earlier release may have a column with a `typeRef`. This release refuses such a contract and says to re-emit it. A historical snapshot cannot be re-emitted from today's source, so run the script instead. Do this before you re-emit the bundled contract, and commit your work first so the script's changes can be reviewed and undone with git. Run it from the extension's package root:

```sh
node <guide>/scripts/expand-type-aliases/expand-type-aliases.ts
```

`<guide>` is the directory that holds this guide. Node 24 or later runs the TypeScript script directly; it needs no `tsx`. The script reads and writes files only and needs no database. It rewrites every SQL contract under the root, skipping `node_modules`, `.git`, `dist` and `build`. That includes test fixtures: if you keep an old contract on purpose, restore it with git afterwards.

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

If the storage hash of the bundled contract changed, tell the applications that use the extension, in your release notes, to run `prisma db sign` against every database after they upgrade, and name the old and new hash. The old hash is the one the bundled contract had before you ran the script, and the new hash is the one in `migrations/refs/head.json` when you publish. The Supabase extension's contract is an example: its hash changes from `292489649ae6d6928de98a32b544bd9caf6b7d49718c10fe2720b83545a4b5a2` to `110ad99e1e466691bdb0a4349a17365561e76ad017f58beb272f4496b05b8e9e`. Tell them too that `prisma migration status` no longer marks the extension's migrations applied before the upgrade as applied, because each rewritten migration has a new hash. `prisma db migrate` runs none of them again, and `prisma db verify` passes.

## `types-key-is-database-types`

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

## `column-type-ref-removed`

Code that reads storage gets the column's type from the column itself:

- `StorageColumn` and `ColumnTypeDescriptor` have no `typeRef`. Read `codecId` and `typeParams` from the column. A validated contract never has a `typeRef`, so there is no alias to look up in `storage.types`.
- `ExecutionContext.types` and the `TypeHelperRegistry` are removed. Get a column's codec from the codec registry, for example through `codecRefForColumn(table, column)`.
- A codec instance's `name` in its `CodecInstanceContext` is `<col:Table.column>` for a parameterized column, the first column with that codec and those parameters. It used to be the alias's name for columns typed by an alias. Columns with the same codec and parameters still share one instance, and its `usedAt` lists them all. A codec that keyed per-instance state by the alias name must key it by its parameters instead.
- `planTypeOperations` and `verifyType` still run for each `storage.types` entry, which is now only a registered database type.

A hit in a generated `contract.d.ts` is rewritten by `stored-contracts-expand-type-aliases`; do not edit it by hand.

## `type-alias-descriptor`

There is nothing to change. A pack's `type` namespace may now contain a type alias:

```ts
CreatedAt: {
  kind: 'typeAlias',
  documentation: 'A timestamp the client sets to now when a row is created.',
  output: { type: { codecId: 'pg/timestamptz-temporal@1' }, onCreate: { name: 'now', args: {} } },
},
```

It takes no arguments. PSL writes it bare as a field type (`temporal.CreatedAt`), and TypeScript as `field.column(type.temporal.CreatedAt())`. Each `onCreate` and `onUpdate` call is resolved by the column's codec, and assembly refuses a call that does not resolve with `CONTRACT.PACK_CONTRIBUTION_INVALID`.
