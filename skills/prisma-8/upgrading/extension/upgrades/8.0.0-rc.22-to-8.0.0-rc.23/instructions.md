---
from: "8.0.0-rc.22"
to: "8.0.0-rc.23"
changes:
  - id: temporal-polyfill-is-a-peer-dependency-of-mysql
    summary: |
      `temporal-polyfill` is now a required peer dependency of `@prisma/orm-target-mysql` and `@prisma/orm-mysql`. The target's control entry imports it. An extension pack that peers the target does not declare it; the application supplies it. npm, pnpm and bun install it automatically. An extension package that installs with Yarn and loads the target's control entry in its tests or tooling must add `temporal-polyfill` (`^1.0.4`) to its `devDependencies`.
    detection:
      glob: "**/yarn.lock"
      contains:
        - "@prisma/orm-mysql@"
        - "@prisma/orm-target-mysql@"
      anyMatch: true
  - id: mysql-create-namespace-moved-to-target-types
    summary: |
      `mysqlCreateNamespace` and `MysqlDatabase` moved from the MySQL target's `/target/control` entry to its `/target/types` entry, as PostgreSQL's and SQLite's are in theirs. The control entry loads `temporal-polyfill`, so code that is not control-plane code no longer has to load it to name a namespace. An import of either from `/target/control` fails to compile.
    detection:
      glob: "**/*.ts"
      contains:
        - "mysqlCreateNamespace"
        - "MysqlDatabase"
      anyMatch: true
  - id: temporal-polyfill-is-a-peer-dependency-of-sqlite
    summary: |
      `temporal-polyfill` is now a required peer dependency of `@prisma/orm-target-sqlite` and `@prisma/orm-sqlite`. The target's control entry imports it. An extension pack that peers the target does not declare it; the application supplies it. npm, pnpm and bun install it automatically. An extension package that installs with Yarn and loads the target's control entry in its tests or tooling must add `temporal-polyfill` (`^1.0.4`) to its `devDependencies`.
    detection:
      glob: "**/yarn.lock"
      contains:
        - "@prisma/orm-sqlite@"
        - "@prisma/orm-target-sqlite@"
      anyMatch: true
  - id: sqlite-create-namespace-moved-to-target-types
    summary: |
      `sqliteCreateNamespace` and `SqliteUnboundDatabase` moved from the SQLite target's `/target/control` entry to its `/target/types` entry, as PostgreSQL's `postgresCreateNamespace` is in its `/target/types`. The control entry loads `temporal-polyfill`, so code that is not control-plane code no longer has to load it to name a namespace. An import of either from `/target/control` fails to compile.
    detection:
      glob: "**/*.ts"
      contains:
        - "sqliteCreateNamespace"
        - "SqliteUnboundDatabase"
      anyMatch: true
  - id: psl-renamed-postgres-scalar-types
    summary: |
      In a Prisma 8 schema on PostgreSQL, `SmallInt`, `BigIntNumber`, `Numeric`, `UnboundedInt`, `Real`, `VarChar` and `VarBit` are deprecated and report `PSL_DEPRECATED_SCALAR_NAME` as a warning. Write the convenience call that gives the same type instead: `Int(storage: int2)`, `BigInt(as: number)`, `Decimal(precision: p, scale: s)`, `BigInt(storage: numeric)`, `Float(storage: float4)` and `String(storage: varchar, length: n)`; `VarBit` has no convenience type and becomes `Varbit`. The contract does not change. A Prisma 7 schema, which has a `datasource` block, is not affected.
    detection:
      glob: "**/*.prisma"
      matches:
        - '(?<![\s\S])(?![\s\S]*(?<![\w$])datasource[ \t]+\w+[ \t]*\{)[\s\S]*\n[ \t]+[A-Za-z_]\w*[ \t]+(?:=[ \t]*)?(?:SmallInt|BigIntNumber|Numeric|UnboundedInt|Real|VarChar|VarBit)(?![\w$])'
  - id: ts-renamed-postgres-scalar-helpers
    summary: |
      In a TypeScript contract on PostgreSQL, `type.SmallInt()`, `type.BigIntNumber()`, `type.Numeric(...)`, `type.UnboundedInt()`, `type.Real()`, `type.VarChar(...)` and `type.VarBit(...)` are deprecated. They still compile and give no warning, and they are removed together with the deprecated schema names. Call the convenience helper that gives the same type instead, such as `type.String({ storage: 'varchar', length: 64 })` for `type.VarChar(64)`, or `type.Varbit(n)` for `type.VarBit(n)`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\w$])type\.(?:SmallInt|BigIntNumber|Numeric|UnboundedInt|Real|VarChar|VarBit)\('
  - id: ts-renamed-postgres-column-helpers
    summary: |
      The PostgreSQL column helpers `int8Column` and `numericColumn` are renamed to `int8BigIntColumn` and `numericStringColumn`, after the explicit types they give (`Int8BigInt` and `NumericString`). The old names are removed. The contract does not change.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - 'import[ \t]+(?:type[ \t]+)?\{[^}]*(?<![\w$])(?:int8Column|numericColumn)(?![\w$])[^}]*\}[ \t]*from[ \t]*[''"](?:@prisma/orm-postgres/adapter/column-types|@internal/adapter-postgres/column-types)[''"]'
  - id: ts-renamed-postgres-type-groupings
    summary: |
      `@internal/target-postgres/control` exports `postgresExplicitTypes`, every explicit PostgreSQL type, and `postgresScalarTypes`, which holds the explicit types, the convenience types such as `Int` and `String`, and the deprecated aliases. They replace `postgresScalarAuthoringTypes`, `postgresNativeAuthoringTypes` and `postgresScalarAndNativeTypeConstructors`, which are removed.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\w$])(?:postgresScalarAuthoringTypes|postgresNativeAuthoringTypes|postgresScalarAndNativeTypeConstructors)(?![\w$])'
  - id: pack-declares-extension-unbound
    summary: |
      A pack that declares a Postgres extension must declare it in the unbound namespace, and no two packs may declare the same extension. A composed pack that declares an extension in a named namespace, such as `public`, is refused when a command loads the configuration, with `CONTRACT.PACK_CONTRIBUTION_INVALID`. Declare it with `extension('<name>', { namespace: unbound })` from the Postgres contract builder, or `namespace unbound { extension <name> {} }` in PSL, re-emit the pack's contract, and plan two migrations: one from the old head to the new one, which has no operations, and one from the empty contract to the new head, which creates the extension with no schema named.
    detection:
      glob: "**/*.{ts,mts,cts,prisma}"
      matches:
        - '\bextension\((?![^)]*namespace:\s*unbound\b)[^)]*\)'
        - '^(?:(?:"(?:[^"\\\n]|\\.)*"|//[^\n]*(?:\n|$)|[^{}"/]|/(?!/))|\{(?:(?:"(?:[^"\\\n]|\\.)*"|//[^\n]*(?:\n|$)|[^{}"/]|/(?!/))|\{(?:"(?:[^"\\\n]|\\.)*"|//[^\n]*(?:\n|$)|[^{}"/]|/(?!/))*\})*\})*?\bextension\s+[A-Za-z_][\w-]*\s*\{'
        - '\bnamespace\s+(?!unbound\b)[A-Za-z_][\w-]*\s*\{(?:(?:"(?:[^"\\\n]|\\.)*"|//[^\n]*(?:\n|$)|[^{}"/]|/(?!/))|\{(?:"(?:[^"\\\n]|\\.)*"|//[^\n]*(?:\n|$)|[^{}"/]|/(?!/))*\})*?\bextension\s+[A-Za-z_][\w-]*\s*\{'
  - id: mongo-index-name-required
    summary: |
      `MongoIndex` and `MongoIndexInput` (from `@prisma/orm-family-mongo/contract`) and `MongoSchemaIndex` and `MongoSchemaIndexOptions` (from `@prisma/orm-family-mongo/schema-ir`) have a required `name`, the name MongoDB stores the index under. `MongoSchemaIndex.id` is the name, where it was the keys. `MONGO_INDEX_OPTION_KEYS` and `indexLookupKey` leave the name out. `defaultMongoIndexName` moved from `@prisma/orm-family-mongo/query-ast/control` to `@prisma/orm-family-mongo/contract`, and `buildIndexOpId(verb, collection, name)` takes the index name in place of the keys.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\bnew\s+(?:MongoIndex|MongoSchemaIndex)\s*\('
        - '\b(?:MongoIndexInput|MongoSchemaIndexOptions)\b'
        - '\b(?:defaultMongoIndexName|buildIndexOpId)\b'
  - id: mongo-index-calls-take-name
    summary: |
      `CreateIndexCall` and `DropIndexCall` (from `@prisma/orm-mongo/target/control`) take a third argument, `IndexCallOptions`: the index's `name` and its `createIndex` options. `schemaIndexToCreateIndexOptions` returns them with the name. `createIndex` and `dropIndex` (from `@prisma/orm-mongo/target/migration`) create and drop the index named `options.name`, or the name after the keys when it is missing. `createIndex` has two prechecks: no index with that name, and none with the same keys and options. `dropIndex` checks the name, keys and options before, and the name after. Labels name the index: `Create index email_1 on users (email:1)`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\bnew\s+(?:CreateIndexCall|DropIndexCall)\s*\('
        - '\bschemaIndexToCreateIndexOptions\b'
  - id: mongo-build-refusal-index-name-duplicate
    summary: |
      The MongoDB contract builder's `BuildRefusal` type, from `@prisma/orm-family-mongo/contract-ts/contract-builder`, has the kind `indexNameDuplicate`, for two indexes of one collection with one name. The builder takes every index's name from its `options.name` and throws for an index without one. Call `nameIndexes(definition)`, from the same entry point, before `mergeRedundantIndexes` and the builder, to name each unnamed index after its stored keys, as Prisma 8 PSL and TypeScript do. `mergeRedundantIndexes` now merges only indexes with the same name.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\bBuildRefusal\b'
        - '\bbuildMongoContractFromDefinition\b'
        - '\bmergeRedundantIndexes\b'
  - id: mongo-build-refusal-index-duplicate-restored
    summary: |
      The MongoDB contract builder's `BuildRefusal` type, exported from `@prisma/orm-family-mongo/contract-ts/contract-builder`, has the kind `indexDuplicate` again. The builder no longer merges indexes; it refuses two identical indexes in one collection. To merge identical and redundant indexes before building, as Prisma 8 PSL and TypeScript do, call `mergeRedundantIndexes` from the same entry point.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\bBuildRefusal\b'
        - '\bbuildMongoContractFromDefinition\b'
  - id: mongo-execution-context-checks-contract-requirements
    summary: |
      `createMongoExecutionContext` from `@prisma/orm-mongo/family-runtime` refuses a contract its stack cannot serve: `RUNTIME.CONTRACT_FAMILY_MISMATCH` for a contract of another family, `RUNTIME.CONTRACT_TARGET_MISMATCH` for another target, and `RUNTIME.MISSING_EXTENSION_PACK` for a contract that requires an extension pack the stack does not hold. The MongoDB adapter's runtime descriptor now encodes with the codecs of every extension in the stack, so an extension's codec `toWire` runs on writes.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs,jsx}"
      matches:
        - '\bcreateMongoExecutionContext\b'
        - '\bMongoRuntimeExtensionDescriptor\b'
  - id: mongo-codecs-declared-once
    summary: |
      A MongoDB target, adapter or extension descriptor declares each codec once, as a codec descriptor in `types.codecTypes.codecDescriptors`, as a Postgres extension does. The `codecs()` slot that returned a `MongoCodecRegistry` is gone from `MongoStaticContributions`, `MongoRuntimeTargetDescriptor`, `MongoRuntimeAdapterDescriptor` and `MongoRuntimeExtensionDescriptor`. The runtime, the adapter and the migration runner take each codec from its descriptor with `assembleMongoCodecRegistry`. Build a descriptor from a codec with `mongoCodecDescriptor` from `@prisma/orm-family-mongo/codec`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs,jsx}"
      matches:
        - '\bMongoRuntime(?:Extension|Target|Adapter)Descriptor\b(?:<[^<>]{0,200}>)?\s{0,20}(?:=>?|\{\s{0,20}return)\s{0,20}\(?\s{0,20}\{(?:[^{}]|\{(?:[^{}]|\{(?:[^{}]|\{[^{}]{0,500}\}){0,500}\}){0,500}\}){0,500}?\bcodecs\s{0,20}[:(]'
        - '\bfamilyId\s{0,20}:\s{0,20}[''"]mongo[''"](?:[^{}]|\{(?:[^{}]|\{(?:[^{}]|\{[^{}]{0,500}\}){0,500}\}){0,500}\}){0,500}?\bcodecs\s{0,20}[:(]'
        - '\bcodecs\s{0,20}[:(](?:[^{}]|\{(?:[^{}]|\{(?:[^{}]|\{[^{}]{0,500}\}){0,500}\}){0,500}\}){0,500}?\bfamilyId\s{0,20}:\s{0,20}[''"]mongo[''"]'
        - '(?<![\s\S])(?=[\s\S]*?\b(?:newMongoCodecRegistry|MongoCodecRegistry)\b)[\s\S]*?\{(?:(?!\bfamilyId\s{0,20}:\s{0,20}[''"](?!mongo[''"]))(?:[^{}]|\{(?:[^{}]|\{(?:[^{}]|\{[^{}]{0,500}\}){0,500}\}){0,500}\})){0,500}?(?:\.\.\.(?:(?!\bfamilyId\s{0,20}:\s{0,20}[''"](?!mongo[''"]))(?:[^{}]|\{(?:[^{}]|\{(?:[^{}]|\{[^{}]{0,500}\}){0,500}\}){0,500}\})){0,500}?\bcodecs\s{0,20}(?::\s{0,20}(?:(?:async\s{1,20})?(?:\([^()]{0,200}\)|[\w$]{1,100})\s{0,20}=>|function\b|newMongoCodecRegistry\b(?!\s{0,20}\())|\([^()]{0,200}\)\s{0,20}(?::[^{};]{0,200})?\{(?:[^{}]|\{(?:[^{}]|\{[^{}]{0,500}\}){0,500}\}){0,500}\})|\bcodecs\s{0,20}(?::\s{0,20}(?:(?:async\s{1,20})?(?:\([^()]{0,200}\)|[\w$]{1,100})\s{0,20}=>|function\b|newMongoCodecRegistry\b(?!\s{0,20}\())|\([^()]{0,200}\)\s{0,20}(?::[^{};]{0,200})?\{(?:[^{}]|\{(?:[^{}]|\{[^{}]{0,500}\}){0,500}\}){0,500}\})(?:(?!\bfamilyId\s{0,20}:\s{0,20}[''"](?!mongo[''"]))(?:[^{}]|\{(?:[^{}]|\{(?:[^{}]|\{[^{}]{0,500}\}){0,500}\}){0,500}\})){0,500}?\.\.\.)(?:(?!\bfamilyId\s{0,20}:\s{0,20}[''"](?!mongo[''"]))(?:[^{}]|\{(?:[^{}]|\{(?:[^{}]|\{[^{}]{0,500}\}){0,500}\}){0,500}\})){0,500}?\}'
  - id: mongo-standard-codecs-removed
    summary: |
      `mongoStandardCodecs` and `buildStandardCodecRegistry` are gone from `@prisma/orm-mongo/target/codecs`. The target declares its codecs once, in `mongoCodecDescriptors`. A registry of them is `assembleMongoCodecRegistry([mongoRuntimeTarget])`, with `assembleMongoCodecRegistry` from `@prisma/orm-family-mongo/codec` and the target from `@prisma/orm-mongo/target/runtime`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs,jsx}"
      matches:
        - '\b(?:mongoStandardCodecs|buildStandardCodecRegistry)\b'
---

# 8.0.0-rc.22 → 8.0.0-rc.23 — Extension author upgrade instructions

## Order of the steps

No change in this guide comes with a script. Make the changes below in any order, with two exceptions:

1. A pack that declares a Postgres extension declares it in the unbound namespace first, then re-emits its contract, then plans its two new migrations (`pack-declares-extension-unbound`).
2. Code that builds a MongoDB contract from a definition names its indexes, then merges them, then builds (`mongo-build-refusal-index-name-duplicate`, `mongo-build-refusal-index-duplicate-restored`).


## MySQL: `temporal-polyfill` is a peer dependency, and `mysqlCreateNamespace` moved

### `temporal-polyfill-is-a-peer-dependency-of-mysql`

For each Yarn project that `detection` matches, add `"temporal-polyfill": "^1.0.4"` to `devDependencies` in the `package.json` that installs `@prisma/orm-target-mysql` or `@prisma/orm-mysql`, then reinstall. Without it, a test or script that loads the target's control entry fails because Node.js cannot find the package `temporal-polyfill`.

### `mysql-create-namespace-moved-to-target-types`

In each file that `detection` matches, change the module of an import of `mysqlCreateNamespace` or `MysqlDatabase` from the target's control entry to its types entry, keeping the rest of the import:

| Before | After |
| --- | --- |
| `@prisma/orm-target-mysql/target/control` | `@prisma/orm-target-mysql/target/types` |
| `@prisma/orm-mysql/target/control` | `@prisma/orm-mysql/target/types` |

If the import also names other symbols from the control entry, split it into two imports. Nothing else changes: the function and the class are the same.


## SQLite: `temporal-polyfill` is a peer dependency, and `sqliteCreateNamespace` moved

### `temporal-polyfill-is-a-peer-dependency-of-sqlite`

For each Yarn project that `detection` matches, add `"temporal-polyfill": "^1.0.4"` to `devDependencies` in the `package.json` that installs `@prisma/orm-target-sqlite` or `@prisma/orm-sqlite`, then reinstall. Without it, a test or script that loads the target's control entry fails because Node.js cannot find the package `temporal-polyfill`.

### `sqlite-create-namespace-moved-to-target-types`

In each file that `detection` matches, change the module of an import of `sqliteCreateNamespace` or `SqliteUnboundDatabase` from the target's control entry to its types entry, keeping the rest of the import:

| Before | After |
| --- | --- |
| `@prisma/orm-target-sqlite/target/control` | `@prisma/orm-target-sqlite/target/types` |
| `@prisma/orm-sqlite/target/control` | `@prisma/orm-sqlite/target/types` |

If the import also names other symbols from the control entry, split it into two imports. Nothing else changes: the function and the type are the same.


## PostgreSQL's integer, decimal, float and text types are convenience types

On PostgreSQL, `Int`, `BigInt`, `Float`, `Decimal`, `String`, `Boolean` and `Bytes` are now convenience types, as `DateTime` already is. Each is named for what a field means, and its optional `storage` argument (and `as`, for `BigInt`) chooses an explicit type named after the database type. Written bare, each gives the same type as before, so schemas that use these names need no change.

The explicit types took the database's names. Seven old names stay for one release line as deprecated aliases: they give the same codec and the same contract, and `prisma contract emit` and the editor report a warning where one is written.

### `psl-renamed-postgres-scalar-types`

Rewrite each field or `types {}` alias written with an old name, keeping its other arguments and attributes:

| Before | After | Explicit type it gives |
| --- | --- | --- |
| `SmallInt` | `Int(storage: int2)` | `Int2` |
| `BigIntNumber` | `BigInt(as: number)` | `Int8Number` |
| `Numeric` | `Decimal` | `NumericString` |
| `Numeric(p)` | `Decimal(precision: p)` | `NumericString(p)` |
| `Numeric(p, s)` | `Decimal(precision: p, scale: s)` | `NumericString(p, s)` |
| `UnboundedInt` | `BigInt(storage: numeric)` | `NumericBigInt` |
| `Real` | `Float(storage: float4)` | `Float4` |
| `VarChar` | `String(storage: varchar)` | `Varchar` |
| `VarChar(n)` | `String(storage: varchar, length: n)` | `Varchar(n)` |
| `VarBit` | `Varbit` | `Varbit` |
| `VarBit(n)` | `Varbit(n)` | `Varbit(n)` |

`VarBit` has no convenience type, so its replacement is the explicit type. For the others, writing the explicit type in the last column instead is equally correct; it is the same type, and both emit the same contract. The warning names the explicit type because it is the exact replacement for the old name.

```prisma
model Account {
  id     Int                                  @id
  visits Int(storage: int2)                   // was SmallInt
  rank   BigInt(as: number)                   // was BigIntNumber
  price  Decimal(precision: 10, scale: 2)     // was Numeric(10, 2)
  code   String(storage: varchar, length: 12) // was VarChar(12)
}
```

Rewrite only Prisma 8 schemas whose config uses the PostgreSQL target, including the `contract.prisma` copies in migration folders. The detection cannot tell which target a schema is for, so it also matches SQLite's `BigIntNumber` and MySQL's `VarChar`; a match in a project whose `prisma.config.ts` uses the SQLite or MySQL target needs no change. Update comments and documentation that name the old types the same way. Re-emit the contract with `prisma contract emit`: it is byte for byte the same as before.

### `ts-renamed-postgres-scalar-helpers`

Rewrite only in contracts on PostgreSQL:

```ts
field.column(type.Int({ storage: 'int2' })); // was type.SmallInt()
field.column(type.BigInt({ as: 'number' })); // was type.BigIntNumber()
field.column(type.Decimal({ precision: 10, scale: 2 })); // was type.Numeric(10, 2)
field.column(type.BigInt({ storage: 'numeric' })); // was type.UnboundedInt()
field.column(type.Float({ storage: 'float4' })); // was type.Real()
field.column(type.String({ storage: 'varchar', length: 64 })); // was type.VarChar(64)
field.column(type.Varbit(16)); // was type.VarBit(16)
```

The explicit helpers `type.Int2()`, `type.Int8Number()`, `type.NumericString(10, 2)`, `type.NumericBigInt()`, `type.Float4()` and `type.Varchar(64)` give the same types.

The old helpers still compile, and nothing warns where they are called. They are removed in the same release as the deprecated schema names, so rewrite them now.

### `ts-renamed-postgres-column-helpers`

The detection matches a file that imports `int8Column` or `numericColumn` from `@prisma/orm-postgres/adapter/column-types` or `@internal/adapter-postgres/column-types`. In that file, rename the import and every use of the imported name. Each column helper is named after the explicit type it gives:

```ts
import { int8BigIntColumn, numericStringColumn } from '@prisma/orm-postgres/adapter/column-types';

field.column(int8BigIntColumn); // was int8Column
field.column(numericStringColumn(10, 2)); // was numericColumn(10, 2)
```

### `ts-renamed-postgres-type-groupings`

Replace the removed exports of `@internal/target-postgres/control`:

| Before | After |
| --- | --- |
| `postgresScalarAndNativeTypeConstructors` | `postgresScalarTypes` |
| `postgresScalarAuthoringTypes` | `postgresScalarTypes` |
| `postgresNativeAuthoringTypes` | `postgresExplicitTypes` |

`postgresScalarTypes` holds every name `postgresScalarAuthoringTypes` held, including `Int`, `String`, `Decimal` and the other convenience types. It is not the target's whole `type` namespace: the namespaced `sql.*`, `temporal.*` and `pg.enum`, and the generated-ID aliases such as `UuidString`, are not in it. A test that needs them uses `assembleAuthoringContributions([...]).type`, which already holds every PostgreSQL type; a test that spread a removed export under that namespace can drop the spread.

`postgresExplicitTypes` holds only explicit types. Code that looked up `VarChar`, `Numeric`, `SmallInt` or `Real` in `postgresNativeAuthoringTypes` uses `Varchar`, `NumericString`, `Int2` or `Float4` in it.

After the rewrite, check that a schema that uses `Int` and `String` still reads with the namespace the code builds.


## A pack declares its extension in the unbound namespace

```typescript
import { defineContract, extension, unbound } from '@prisma/orm-postgres/contract-builder';

export const contract = defineContract({
  entities: [extension('vector', { namespace: unbound })],
});
```

### `pack-declares-extension-unbound`

1. In the pack's contract source, pass `{ namespace: unbound }` to `extension(...)`, importing `unbound` from `@prisma/orm-postgres/contract-builder`. In a PSL contract, move the `extension` block into `namespace unbound { ... }`.
2. Run `prisma contract emit` in the pack.
3. Plan two migrations. The first goes from the old head to the new one and has no operations, because the extension a database already has is found through the search path. The second goes from the empty contract to the new head and creates the extension without `WITH SCHEMA`, so a new database takes it in one step. Today `prisma migration plan` reads and writes the migrations of a project's own space under `migrations/app/`, while a pack keeps its migrations directly under `migrations/`, so plan through a temporary copy. Issue TML-3473 tracks removing these steps:
   1. Copy the pack's migration directories and `migrations/refs/` into a new `migrations/app/` directory.
   2. Run `prisma migration plan --from <old head hash> --name <name>`, where the old head hash is the `hash` in `migrations/refs/head.json`. It writes the new migration to `migrations/app/<timestamp>_<name>/` and the new contract snapshot to `migrations/snapshots/<new hash>/`.
   3. Run `prisma migration plan --from @empty --name <other name>`. It writes the migration from the empty contract to `migrations/app/<timestamp>_<other name>/`.
   4. Move both new directories from `migrations/app/` to `migrations/`, then delete `migrations/app/`.
   5. In each moved `migration.ts`, change each import of `../../snapshots/` to `../snapshots/`.
   6. Set `hash` in `migrations/refs/head.json` to the new contract hash, the `to` of the new migrations' `migration.json`, and keep its `invariants`.
4. Add both new migrations' `migration.json` and `ops.json` to the migrations the pack's control descriptor lists.


## MongoDB indexes carry their names

Every MongoDB index has a required name, migrations create and drop each index by that name, and the contract builder no longer merges indexes on its own.

### `mongo-index-name-required`

Give every index you construct a name:

```ts
// before
new MongoIndex({ keys: [{ field: 'email', direction: 1 }], unique: true });
new MongoSchemaIndex({ keys: [{ field: 'email', direction: 1 }], unique: true });
// after
new MongoIndex({ name: 'email_1', keys: [{ field: 'email', direction: 1 }], unique: true });
new MongoSchemaIndex({ name: 'email_1', keys: [{ field: 'email', direction: 1 }], unique: true });
```

`defaultMongoIndexName(keys)` gives the name MongoDB gives an index created without one. Import it from `@prisma/orm-family-mongo/contract`:

```ts
// before
import { defaultMongoIndexName } from '@prisma/orm-family-mongo/query-ast/control';
// after
import { defaultMongoIndexName } from '@prisma/orm-family-mongo/contract';
```

Code that looked up an index of the schema IR by `id` with its keys, such as `'email:1'`, looks it up by name. Code that builds an operation id calls `buildIndexOpId('create', 'users', 'email_1')`.

### `mongo-index-calls-take-name`

```ts
// before
new CreateIndexCall('users', keys, { unique: true });
new DropIndexCall('users', keys);
// after
new CreateIndexCall('users', keys, { name: 'email_1', unique: true });
new DropIndexCall('users', keys, { name: 'email_1', unique: true });
```

Give `DropIndexCall` every option the index has, not only its name: its precheck requires an index with that name, those keys and exactly those options. Code that matches an operation's checks by position reads `createIndex`'s content check at `precheck[1]`; `precheck[0]` checks the name.

### `mongo-build-refusal-index-name-duplicate`

Code that switches over every `refusal.kind` handles `indexNameDuplicate`:

```typescript
switch (refusal.kind) {
  case 'indexNameDuplicate':
    return `${refusal.key.model}: another index of collection ${refusal.collection} is named ${refusal.name}`;
  // ...
}
```

Code that calls `buildMongoContractFromDefinition` names its indexes first:

```ts
const named = nameIndexes(definition);
const { definition: merged } = mergeRedundantIndexes(named, codecLookup, dataTypes);
const built = buildMongoContractFromDefinition(merged, codecLookup, dataTypes);
```

A source that reads a schema with its own naming rule, such as the Prisma 6 reader, sets `options.name` on each index itself.

### `mongo-build-refusal-index-duplicate-restored`

Code that switches over every `refusal.kind` must handle `indexDuplicate`:

```typescript
switch (refusal.kind) {
  case 'indexDuplicate':
    return `${refusal.key.model}: an identical index already exists`;
  // ...
}
```

Code that builds a definition with `buildMongoContractFromDefinition` and relied on the builder merging indexes calls `mergeRedundantIndexes(definition, codecLookup, dataTypes)` first and builds its `definition`. Call `nameIndexes` before `mergeRedundantIndexes`, as the example under `mongo-build-refusal-index-name-duplicate` shows.


## MongoDB execution contexts check the contract against the stack

### `mongo-execution-context-checks-contract-requirements`

1. Where code calls `createMongoExecutionContext({ contract, stack })` with a contract that requires extension packs, build the stack with those packs: `createMongoExecutionStack({ target, adapter, extensions: [myPack] })`.
2. A MongoDB extension's codecs now encode values on writes as well as decode them on reads. Check that each codec's `toWire` returns the form the database stores, and that `fromWire` reads that form back.

### `mongo-codecs-declared-once`

Replace the `codecs()` slot of a MongoDB descriptor with one codec descriptor per codec, shared by the pack and the runtime descriptor:

```typescript
import { mongoCodec, mongoCodecDescriptor } from '@prisma/orm-family-mongo/codec';

const shoutCodec = mongoCodec({ typeId: 'shout/text@1', dataType: shoutText, toWire, fromWire, fromDataTypeValue });

const shoutMeta = {
  kind: 'extension',
  id: 'shout',
  familyId: 'mongo',
  targetId: 'mongo',
  version: '0.0.1',
  dataTypes: [shoutText],
  types: { codecTypes: { codecDescriptors: [mongoCodecDescriptor(shoutCodec, { traits: ['equality'] })] } },
} as const;

export const shoutRuntime: MongoRuntimeExtensionDescriptor<'mongo'> = {
  ...shoutMeta,
  create: () => ({ familyId: 'mongo', targetId: 'mongo' }),
};
```

1. For each codec the `codecs()` registry held, add `mongoCodecDescriptor(codec, { traits })` to `types.codecTypes.codecDescriptors`, with the traits the pack declared for it. If the pack already lists a hand-written descriptor for the codec, replace it with this one.
2. Delete `codecs` from the descriptor.
3. Make the runtime and control descriptors spread the same metadata as the pack, so all three list the same descriptors and `dataTypes`.

### `mongo-standard-codecs-removed`

1. Replace `buildStandardCodecRegistry()` with `assembleMongoCodecRegistry([mongoRuntimeTarget])`.
2. Replace a read of `mongoStandardCodecs` with the registry: `registry.get(codecId)` for one codec, `[...registry]` for all of them, or with `mongoCodecDescriptors` where only the codec ids or metadata are needed.
