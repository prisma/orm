---
from: "8.0.0-rc.12"
to: "8.0.0-rc.13"
changes:
  - id: execution-ref-entry-field
    summary: |
      Each entry in `contract.execution.mutations.defaults` now names its target as
      `ref: { namespace, entry, field }` instead of `ref: { namespace, table, column }`. The values
      are the same table and column names. Re-emit the contract; code that reads `.ref.table` or
      `.ref.column` reads `.ref.entry` and `.ref.field`.
    detection:
      glob: "**/*.{json,ts,mts,cts}"
      matches:
        - '"ref"\s*:\s*\{(?![^{}]*"kind")[^{}]*"(?:table|column)"\s*:'
        - '\.ref\??\.(?:table|column)\b'
        - '\bref\s*:\s*\{(?![^{}]*\bkind\b)[^{}]*\b(?:table|column)\s*:[^{}]*\b(?:table|column)\s*:'
    script: ./scripts/execution-ref-entry-field/rename-execution-ref-keys.ts
  - id: ts-defaults-encoded-by-codec
    summary: |
      `defineContract` from the Postgres and SQLite packages now encodes every literal `.default(value)` through the column's codec. The literal is the codec's input type. TypeScript checks it for fields built inside the `defineContract` factory, and the build fails with `CONTRACT.DEFAULT_INVALID` for a value the codec refuses. Pass a value of the codec's input type, or choose the field preset whose codec takes the value you have.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\.default\(\s*(?!now\(\)|autoincrement\(\)|sql`)'
  - id: contract-format-formats-prisma7-schema
    summary: prisma contract format now formats a Prisma 7 schema configured through prisma7Schema().
  - id: config-contract-source-requires-format
    summary: A contract source object written in prisma.config.ts must declare format 'psl' or 'typescript'.
  - id: policy-expression-json-escapes
    summary: A policy expression in a PSL contract decodes every JSON escape, so \t, \b, \f, \/ and \uXXXX no longer read as written.
  - id: cursor-rejects-expression-orders
    summary: "cursor() now throws ORM.ARGUMENT_INVALID when an active orderBy item is not a plain column (extension-operation orders such as vector distance were previously dropped from the keyset silently)"
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\.cursor\('
  - id: mongo-codec-subpaths-move-to-target
    summary: |
      The Mongo codec subpaths moved from the adapter to the target:
      `adapter/codec-types`, `adapter/codecs`, `adapter/codec-ids` and `adapter/data-types` under
      `@prisma/orm-mongo` and `@prisma/orm-target-mongo` are now `target/...`. Emitted
      `contract.d.ts` files, including migration snapshots, import `adapter/codec-types` until
      rewritten or re-emitted. Under `skipLibCheck: true` that import fails silently and the
      contract's field types turn wrong where they are used, instead of failing to compile.
    detection:
      glob: "**/*.{ts,mts,cts,md}"
      matches:
        - '@prisma/orm-(?:target-)?mongo/adapter/(?:codec-types|codecs|codec-ids|data-types)(?![\w-])'
  - id: create-mongo-runner-deps-removed
    summary: |
      `createMongoRunnerDeps(...)` is removed from `@prisma/orm-mongo/adapter/control`. Build the
      runner dependencies with `new MongoControlAdapterImpl().createRunnerDependencies(controlDriver)`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\bcreateMongoRunnerDeps\b'
  - id: mongo-runner-dependency-types-move-to-family
    summary: |
      `MongoRunnerDependencies` and `MarkerOperations` are no longer exported from
      `adapter/control` or `target/control`; import them from `@prisma/orm-mongo/family/control-adapter`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\b(?:MongoRunnerDependencies|MarkerOperations)\b[^;]*?from\s*[''"]@prisma/orm-(?:target-)?mongo/(?:adapter|target)/control[''"]'
  - id: mongo-create-runner-needs-adapter-on-stack
    summary: |
      `mongoTargetDescriptor.migrations.createRunner(family)` now reaches the database through the
      control adapter on the family's control stack. A family instance created from an empty
      stack (`createMongoFamilyInstance({} as ...)`), or from a `createControlStack(...)` with no
      `adapter`, fails with "Mongo family requires an adapter descriptor in ControlStack" when the
      runner executes.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - 'createMongoFamilyInstance\(\s*\{\s*\}'
        - 'createControlStack\(\s*\{(?:(?!adapter)[^}])*mongoTargetDescriptor(?:(?!adapter)[^}])*\}\s*\)'
  - id: mongo-psl-scalar-names
    summary: |
      Four Mongo PSL scalar names are deprecated in favour of the name of the BSON type they store:
      `Int` → `Int32`, `Float` → `Double`, `Boolean` → `Bool`, `DateTime` → `Date`. The old names
      are still accepted, with a `PSL_DEPRECATED_SCALAR_NAME` warning, and will be removed in a later
      release; rename them now. Codec ids, `contract.json` and every hash are unchanged. Rename only
      in the Prisma 8 contract source and its `migrations/app/*/contract.prisma` copies, never in a
      Prisma 6 `schema.prisma`.
    detection:
      glob: "**/*.prisma"
      matches:
        - '(?<![\s\S])(?![\s\S]*\bprovider\s*=\s*"mongodb")[\s\S]*?(?:^|\n)[ \t]*[A-Za-z_][A-Za-z0-9_]*[ \t]+(?:Int|Float|Boolean|DateTime)(?:\[\])?\??(?![ \t]*\{)(?=\s|$)'
  - id: mongo-variant-field-codecs
    summary: |
      Through `.variant(...)`, a field declared only on the variant model is now written and read
      through its codec, as base-model fields always were. An `ObjectId` field there is stored as
      an `ObjectId` and read back as a hex string, and a where filter on it encodes a hex string.
  - id: contract-artifacts-restamp
    summary: |
      The emitted `contract.json` / `contract.d.ts` embed the toolchain version, which moves
      to 8.0.0-rc.13. Run `contract emit` once after upgrading so the emitted artifacts match
      the installed toolchain.
    detection:
      glob: "**/contract.json"
      contains:
        - '"version": "8.0.0-rc.12"'
---

# 8.0.0-rc.12 → 8.0.0-rc.13 — User upgrade instructions

## `execution-ref-entry-field`

A contract with generated defaults (`temporal.createdAt()`, `temporal.updatedAt()`, `@default(uuid())` and the like) carries them under `execution.mutations.defaults`. Each entry's `ref` changes keys; the values do not:

```json
// before
{ "ref": { "namespace": "public", "table": "user", "column": "updated_at" }, "onUpdate": { "kind": "generator", "id": "timestampNow" } }

// after
{ "ref": { "entry": "user", "field": "updated_at", "namespace": "public" }, "onUpdate": { "kind": "generator", "id": "timestampNow" } }
```

1. Run `prisma contract emit` so `contract.json` and `contract.d.ts` use the new keys. The runtime rejects a contract whose refs still say `table` and `column` with `Contract structural validation failed: execution.mutations.defaults[0].ref.entry must be a string`.
2. Contracts stored under `migrations/` carry the old keys too: the snapshots in `migrations/snapshots/<hash>/contract.json` and `contract.d.ts`, and any intermediate contract a migration imports from its own directory, such as `migrations/app/<dir>/intermediate.json` and `intermediate.d.ts`. From the project root, run the script that sits next to this guide. `<skill>` is the directory of the synced `prisma-8` skill:

   ```bash
   pnpm exec tsx <skill>/upgrading/app/upgrades/8.0.0-rc.12-to-8.0.0-rc.13/scripts/execution-ref-entry-field/rename-execution-ref-keys.ts
   ```

   The script reads every `.json` and `.d.ts` file under a `migrations/` directory, skipping `node_modules`, `.git` and `dist`, and changes only `execution.mutations.defaults[].ref` entries. In each one it renames `table` to `entry` and `column` to `field`, and writes the keys in the order `entry`, `field`, `namespace`, which is the order `prisma contract emit` writes. The old key order varies between files: older `contract.d.ts` files list `namespace`, `table`, `column`, newer ones `column`, `namespace`, `table`. The script handles any order; a hand edit or a search-and-replace that assumes one order misses some refs. A `contract.json` in canonical form stays canonical, so a snapshot matches a fresh emit apart from `executionHash`; an indented JSON file keeps its indentation. The script leaves every `executionHash` as it is. That hash no longer matches the renamed content, but the snapshot loader re-hashes only the storage section, so nothing checks it. `storageHash` and `profileHash` do not move, so snapshot directory names stay the same. A second run changes nothing. Pass `--check` to list the files it would change without writing them; it exits 1 if any would change. A `.json` file it cannot parse is listed as `NOT JSON` and also makes it exit 1.

   To confirm the rewrite, name one migration directory under `migrations/app/` as both ends of a plan: `prisma migration plan --from <dir> --to <dir>`. It loads that migration's snapshot without touching the database. Before the rewrite it fails with `CONTRACT.VALIDATION_FAILED` and `execution.mutations.defaults[0].ref.entry must be a string`; after the rewrite it prints `No changes detected` and writes no migration. In a project with extensions it also re-pins their files under `migrations/<space-id>/`, as every `migration plan` does. `prisma db migrate --to <hash>` does not confirm it: it applies migrations, and on a database already past that snapshot it has no route back, so it fails either way. `prisma migration check` and `prisma db verify` never validate an app snapshot's `execution` section, so they pass before and after the rewrite.
3. Code that reads the section directly changes `.ref.table` to `.ref.entry` and `.ref.column` to `.ref.field`.

`executionHash` changes for every contract with generated defaults, because the canonical JSON changes. Nothing compares it against the database, so no migration or re-sign is needed.

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

## `contract-format-formats-prisma7-schema`

A project whose `contract` is `prisma7Schema('./prisma/schema.prisma')` used to be skipped by `prisma contract format`. The Prisma 7 source is now a PSL source, so the command formats that file with the Prisma 8 formatter when it parses, and refuses with `PSL.PARSE_FAILED`, without writing, when it does not (for example, a schema with a model whose closing brace is missing). A schema with a `view` block parses, so the command formats it.

If the Prisma 7 schema must keep Prisma 7's own formatting, do not run `prisma contract format` on it; format it with Prisma 7's `prisma format` instead.

## `config-contract-source-requires-format`

A config that builds `contract.source` itself, as an object with a `load` function, must now give it a `format`: `'psl'` when its inputs are PSL text, and `'typescript'` when it builds the contract in TypeScript, for example `source: { format: 'typescript', load: async () => ok(contract) }`. Without it, or with any other value, every command that reads the config fails with `CONFIG.VALIDATION_FAILED` on the field `contract.source.format`. Sources made by `defineConfig`, `prisma7Schema()`, `prismaContract()` and the TypeScript contract helpers already declare one.

## `policy-expression-json-escapes`

A `using` or `withCheck` expression in a `policy_*` block of a PSL contract is a JSON string, the form `prisma contract print` and `prisma contract infer` write. The reader used to decode only `\n`, `\r`, `\"` and `\\`, and kept every other backslash sequence as written. It now also decodes `\t`, `\b`, `\f`, `\/` and `\uXXXX`, so `"a\tb"` reads as `a`, a tab and `b`. A backslash sequence that is not a JSON escape, such as `\d`, is still kept as written.

If a PSL contract writes one of those five sequences in a policy expression and means the backslash and the letter, write the backslash twice (`\\t`), then run `prisma contract emit`. Otherwise the emitted policy, and the contract's storage hash, change.

## `cursor-rejects-expression-orders`

`db.orm.<ns>.<Model>....cursor(...)` builds its keyset from plain model columns. It throws `ORM.ARGUMENT_INVALID`, naming the 1-based `orderBy` position, when an active order is any of these:

- an extension-operation result, such as `(p) => p.embedding.cosineDistance(v).asc()` or `(m) => m.text.fullTextRank(q).desc()`;
- a relation field, such as `(p) => p.author.name.asc()`;
- a relation count, such as `(u) => u.posts.count().desc()`;
- an order with null placement, such as `(p) => p.title.asc({ nulls: 'last' })`.

The check runs when `cursor()` is called and again when the query is planned, so an order added after `cursor()` is refused too. Before this change an extension-operation order was left out of the keyset without an error, which returned wrong pages.

For each `.cursor(` call on a `db.orm` chain that also calls `.orderBy(`, look at every `orderBy` lambda in the chain. If any of them is one of the orders above, do one of these:

- Paginate with `.limit(n).offset(n)` and remove `.cursor(...)`:

  ```ts
  const page = await db.orm.public.Post
    .orderBy((p) => p.embedding.cosineDistance(v).asc())
    .limit(20)
    .offset(pageIndex * 20)
    .all();
  ```

- Keep the cursor and order by plain columns only, for example `(p) => p.createdAt.desc()` and `(p) => p.id.desc()`.

`distinctOn()` throws the same error when one of the first N orders, where N is the number of `distinctOn` columns, is not a plain column: Postgres needs those leading orders to match the `DISTINCT ON` columns, so such a query already failed in the database; it now fails earlier, with `ORM.ARGUMENT_INVALID`. Put the `distinctOn` columns first; a relation order, a count or an operation result may follow them. For example, `.orderBy([(post) => post.title.asc(), (post) => post.author.name.asc()]).distinctOn('title')` is accepted.

## `mongo-codec-subpaths-move-to-target`

The Mongo target package owns the codecs now. Rewrite each specifier, in every file that names it (source, emitted `contract.d.ts`, the `contract.d.ts` in each `migrations/snapshots/<hash>/` directory, and docs):

| Before | After |
| --- | --- |
| `@prisma/orm-mongo/adapter/codec-types` | `@prisma/orm-mongo/target/codec-types` |
| `@prisma/orm-mongo/adapter/codecs` | `@prisma/orm-mongo/target/codecs` |
| `@prisma/orm-mongo/adapter/codec-ids` | `@prisma/orm-mongo/target/codec-ids` |
| `@prisma/orm-mongo/adapter/data-types` | `@prisma/orm-mongo/target/data-types` |
| `@prisma/orm-target-mongo/adapter/<same four>` | `@prisma/orm-target-mongo/target/<same four>` |

The exported names are unchanged. For the application's own `contract.d.ts`, running `prisma contract emit` produces the same result as the rewrite. Snapshot `contract.d.ts` files under `migrations/snapshots/` are not re-emitted, so rewrite them. The contract JSON and every hash stay the same.

Do not rely on `tsc` to find the `contract.d.ts` files. They are declaration files, and a project with `skipLibCheck: true` (the `tsconfig.json` that `prisma orm init` writes sets it) gets no error for their stale import. Instead the contract's field types stop resolving to the codec types, so type errors appear where the contract is used, such as a seed script or a query, rather than at the import, and some fields are no longer type-checked. Rewrite or re-emit every file the detection finds, whether or not `tsc` complains.

## `create-mongo-runner-deps-removed`

```ts
// before
import { createMongoRunnerDeps, extractDb } from '@prisma/orm-mongo/adapter/control';
import { MongoDriverImpl } from '@prisma/orm-mongo/driver';
const runner = new MongoMigrationRunner(
  createMongoRunnerDeps(controlDriver, MongoDriverImpl.fromDb(extractDb(controlDriver)), family),
);

// after
import { MongoControlAdapterImpl } from '@prisma/orm-mongo/adapter/control';
const runner = new MongoMigrationRunner(
  new MongoControlAdapterImpl().createRunnerDependencies(controlDriver),
);
```

Drop imports that are now unused (`extractDb`, `MongoDriverImpl`, `createMongoFamilyInstance`) and any family instance built only to pass as the third argument.

## `mongo-runner-dependency-types-move-to-family`

Change the import of `MongoRunnerDependencies` or `MarkerOperations` to `@prisma/orm-mongo/family/control-adapter`. The shapes are unchanged.

## `mongo-create-runner-needs-adapter-on-stack`

Build the family instance from a control stack that includes the Mongo adapter:

```ts
import mongoAdapter from '@prisma/orm-mongo/adapter/control';
import { createMongoFamilyInstance, mongoFamilyDescriptor } from '@prisma/orm-mongo/family/control';
import { createControlStack } from '@prisma/orm-mongo/components/control';
import { mongoTargetDescriptor } from '@prisma/orm-mongo/target/control';

const family = createMongoFamilyInstance(
  createControlStack({ family: mongoFamilyDescriptor, target: mongoTargetDescriptor, adapter: mongoAdapter }),
);
```

Code that goes through the CLI or `defineConfig` already has the adapter on the stack and needs no change.

## `mongo-psl-scalar-names`

`Int`, `Float`, `Boolean` and `DateTime` are deprecated in Mongo schemas. They are still accepted, and they produce the same contract as the new names, but `prisma contract emit` and the language server report a `PSL_DEPRECATED_SCALAR_NAME` warning for each use, and a later release removes them. Rename them now.

Apply this only to the Prisma 8 Mongo contract source, the `.prisma` file that `prisma.config.ts` passes to `defineConfig` from `@prisma/orm-mongo/config`, and to its copies under `migrations/app/<migration>/contract.prisma`. The detection pattern also matches Postgres and SQLite schemas, whose scalar names do not change in this release; leave them alone.

Never rename in a Prisma 6 `schema.prisma`, such as one kept beside the Prisma 8 contract in a project that still runs Prisma 6: Prisma 6 has no `Int32`, `Double`, `Bool` or `Date`, and would reject the schema. The detection skips a file that declares `provider = "mongodb"`, which every Prisma 6 MongoDB schema does, but a multi-file Prisma 6 schema declares it in one file only, so also skip the other `.prisma` files of a Prisma 6 schema directory.

In each field whose type is one of the deprecated names, replace the type name, keeping any `[]` and `?`:

| Deprecated | Use | Stored as |
| --- | --- | --- |
| `Int` | `Int32` | BSON int |
| `Float` | `Double` | BSON double |
| `Boolean` | `Bool` | BSON bool |
| `DateTime` | `Date` | BSON date |

```prisma
// before
model Post {
  id        ObjectId  @id @map("_id")
  views     Int
  rating    Float?
  published Boolean
  createdAt DateTime
  tags      Int[]
}

// after
model Post {
  id        ObjectId  @id @map("_id")
  views     Int32
  rating    Double?
  published Bool
  createdAt Date
  tags      Int32[]
}
```

This includes the `contract.prisma` copies under `migrations/app/<migration>/`. Then run `prisma contract emit`: `contract.json` and `contract.d.ts` come out the same as before, so no migration or `db sign` is needed. Until the rename, each use reports `warning <file>:<line>:<column> PSL_DEPRECATED_SCALAR_NAME Scalar type "Int" is deprecated and will be removed; use "Int32" (stored as BSON int).`

Docs: list only `Int32`, `Double`, `Bool`, `Date`; the old names must not appear in the scalar tables.

## `mongo-variant-field-codecs`

This change has no detection pattern: it applies to every model with `@@base` whose own `ObjectId` fields are written or read through `.variant(...)`.

Before, a field declared only on a variant model (`model Photo { ownerId ObjectId  @@base(Asset, "photo") }`) was passed to the driver as the application wrote it and returned as the driver read it. An `ObjectId` field written as a hex string was refused by the collection validator when the contract was written in Prisma 8 PSL; a contract built with the TypeScript builder has no validator, so there the hex string was stored as a string. A stored `ObjectId` came back as the driver's `ObjectId` class instead of a hex string. A where filter on such a field passed its value unencoded, so a hex string matched nothing where an `ObjectId` was stored; it is now encoded and matches.

1. Remove any workaround that converted such values by hand, for example passing `new ObjectId(hex)` for a variant `ObjectId` field or calling `.toHexString()` on what a read returned; pass and expect hex strings, as for any other `ObjectId` field.
2. Documents written before this change through a TypeScript-builder contract may hold a variant `ObjectId` field as a string; a filter with a hex string now looks for an `ObjectId` and does not match them. Convert the ones that are 24-character hex strings with `db.<collection>.updateMany({ <field>: { $type: 'string', $regex: /^[0-9a-fA-F]{24}$/ } }, [{ $set: { <field>: { $toObjectId: '$<field>' } } }])`. The regex matters: without it, one string that is not an `ObjectId` in hex makes `$toObjectId` fail the whole command. Other strings, `ObjectId` values and documents without the field are left as they are.
3. A read through the base collection (without `.variant(...)`) still returns variant-only fields as the driver read them.

## `contract-artifacts-restamp`

For every `contract.json` matched by `detection`, run the project's emit command (`prisma contract emit`, or the project's `contract:emit` script) once after upgrading. This entry accounts for the embedded `version` moving to `8.0.0-rc.13`; any other difference in the emitted files comes from an earlier entry in this guide.
