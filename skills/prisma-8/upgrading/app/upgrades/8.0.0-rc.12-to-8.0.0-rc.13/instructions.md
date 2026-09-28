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
      `contract.d.ts` files, including migration snapshots, import `adapter/codec-types` and no
      longer compile until rewritten or re-emitted.
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
      release; rename them now. Codec ids, `contract.json` and every hash are unchanged.
    detection:
      glob: "**/*.prisma"
      matches:
        - '(?:^|\n)[ \t]*[A-Za-z_][A-Za-z0-9_]*[ \t]+(?:Int|Float|Boolean|DateTime)(?:\[\])?\??(?![ \t]*\{)(?=\s|$)'
  - id: mongo-json-field-semantics
    summary: |
      A Mongo `Json` field now admits only JSON values. Its collection validator lists the
      JSON-representable BSON types, which changes the validator and `storageHash` of every Mongo
      contract with a `Json` field, and a document whose `Json` field holds a `Date`, `ObjectId`,
      `Decimal128`, `Binary`, or another non-JSON BSON value at any depth fails to decode.
  - id: mongo-variant-field-codecs
    summary: |
      Through `.variant(...)`, a field declared only on the variant model is now written and read
      through its codec, as base-model fields always were. An `ObjectId` field there is stored as
      an `ObjectId` and read back as a hex string; an `Int64`, `Decimal128` or `Binary` field reads
      back as its application type; `Json` and `Bson` fields refuse values outside their type.
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
2. Contract snapshots under `migrations/snapshots/<hash>/` that carry an `execution` section have the old keys too. In each `execution.mutations.defaults[].ref`, in both `contract.json` and `contract.d.ts`, rename `table` to `entry` and `column` to `field`, and write the keys in the order `entry`, `field`, `namespace`, which is the order `prisma contract emit` writes. Leave the snapshot's existing `executionHash` as it is. It no longer matches the renamed content, but the snapshot loader re-hashes only the storage section, so nothing checks it. `storageHash` and `profileHash` do not move, so snapshot directory names stay the same.
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

Apply this only in a schema whose `prisma.config.ts` uses `@prisma/orm-mongo`. The detection pattern also matches Postgres and SQLite schemas, whose scalar names do not change in this release.

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

## `mongo-json-field-semantics`

This change has no detection pattern: which `Json` fields hold non-JSON values depends on the data, which a search of the source cannot see.

A Mongo `Json` field (`field.json()` in TypeScript) means a JSON value, no more. Its validator admits BSON `object`, `array`, `string`, `double`, `int`, `long`, `bool` and `null`. Reading a document fails with `RUNTIME.DECODE_FAILED` when the field holds a `Date`, `ObjectId`, `Decimal128`, `Binary`, regular expression, timestamp, or a 64-bit integer outside the safe-integer range, at any depth; the message names the path inside the field. Writing such a value fails with `RUNTIME.ENCODE_FAILED`.

To find the affected fields, query each collection with a `Json` field for documents whose field holds a non-JSON value at its top level or as a direct element of an array: a BSON type outside the JSON types, a `long` outside the safe-integer range, or a `NaN` or infinite `double`:

```js
db.<collection>.find({
  $or: [
    { <field>: { $exists: true, $not: { $type: ['object', 'array', 'string', 'double', 'int', 'long', 'bool', 'null'] } } },
    { <field>: { $elemMatch: { $not: { $type: ['object', 'array', 'string', 'double', 'int', 'long', 'bool', 'null'] } } } },
    { <field>: { $type: 'long', $gt: 9007199254740991 } },
    { <field>: { $type: 'long', $lt: -9007199254740991 } },
    { <field>: { $in: [NaN, Infinity, -Infinity] } },
  ],
})
```

The first clause checks the field's own value, and the second checks each direct element when the value is an array. The last three clauses match at both levels. A non-JSON value nested deeper, inside an object or an array of objects, is not visible to this query; reading every document through the ORM finds it, because the read fails with the path of the first such value.

1. For each Mongo `Json` field whose documents hold such values, change its type to `Bson` in PSL (`field.bson()` in TypeScript), which admits any BSON value. A project whose contract source is a Prisma 6 schema (`prisma6Schema`) cannot declare `Bson`: keep its `Json` fields JSON-only, or move the contract source to a Prisma 8 schema and change the type there.
2. Run `prisma contract emit`. Every Mongo contract written in Prisma 8 PSL with a `Json` field changes: its validator lists the JSON types and its `storageHash` moves, whether or not step 1 changed anything. A contract built with the TypeScript builder or read from a Prisma 6 schema has no validator, so it does not change; the codec's checks on read and write still apply to it.
3. If the contract changed in step 2, run `prisma db update` so each collection's validator matches the contract. It reports the validator change as destructive and asks for confirmation: type the database name, or pass `--confirm <database>` when nobody is there to ask. A project that deploys with migrations runs `prisma migration plan` instead and applies the new migration the way it applies any other.

## `mongo-variant-field-codecs`

This change has no detection pattern: it applies to every model with `@@base` whose own fields are written or read through `.variant(...)`, and the effect depends on the field types.

Before, a field declared only on a variant model (`model Photo { ownerId ObjectId  @@base(Asset, "photo") }`) was passed to the driver as the application wrote it and returned as the driver read it. An `ObjectId` field written as a hex string was refused by the collection validator when the contract was written in Prisma 8 PSL; a contract built with the TypeScript builder or read from a Prisma 6 schema has no validator, so there the hex string was stored as a string. A where filter on such a field passed its value unencoded, so a hex string matched nothing where an `ObjectId` was stored; it is now encoded and matches. A stored `ObjectId`, `Long`, `Decimal128` or `Binary` came back as the driver's class instead of the application type.

1. Remove any workaround that converted such values by hand, for example passing `new ObjectId(hex)` for a variant `ObjectId` field or calling `.toHexString()` on what a read returned; pass and expect the application types listed in the scalar types reference instead.
2. Documents written before this change by a TypeScript-builder or Prisma 6 contract may hold a variant `ObjectId` field as a string; a filter with a hex string now looks for an `ObjectId` and does not match them. Convert the ones that are 24-character hex strings with `db.<collection>.updateMany({ <field>: { $type: 'string', $regex: /^[0-9a-fA-F]{24}$/ } }, [{ $set: { <field>: { $toObjectId: '$<field>' } } }])`. The regex matters: without it, one string that is not an `ObjectId` in hex makes `$toObjectId` fail the whole command. Other strings, `ObjectId` values and documents without the field are left as they are.
3. A read through the base collection (without `.variant(...)`) still returns variant-only fields as the driver read them.

## `contract-artifacts-restamp`

For every `contract.json` matched by `detection`, run the project's emit command (`prisma contract emit`, or the project's `contract:emit` script) once after upgrading. This entry accounts for the embedded `version` moving to `8.0.0-rc.13`; any other difference in the emitted files comes from an earlier entry in this guide.
