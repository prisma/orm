---
from: "8.0.0-rc.11"
to: "8.0.0-rc.12"
# The Prisma 7 contract source adds `prisma7Schema` and `contract: ContractConfig` to
# `@prisma/orm-postgres/config`, and `diagnostics` to CliStructuredError. Both additive. It also
# moves the Postgres raw default parser out of the family `psl-infer` subpath (entry below). The
# Postgres default reader and the pinned introspection session change what users see, not any
# extension API; the app skill covers them.
# contract.d.ts now orders every collection the way contract.json does; a re-emit reorders, nothing else.
# Prepared include decoder specialization adds no consumer migration; retain existing entries below.
# The postgres/sqlite/mongo defineConfig wrappers accept a glob-shaped
# `contract:` string (e.g. `./prisma/**/*.prisma`) and derive the default
# output from its static prefix directory. Purely additive: every existing
# single-path `contract:` value keeps deriving its output exactly as before.
# Nothing for an extension author to translate.
changes:
  - id: define-config-becomes-define-prisma-config
    summary: |
      Rename the engine config marker import in `prisma.config.ts` from `defineConfig` to
      `definePrismaConfig`. Required: `@prisma/cli-engine@0.6.1` no longer exports the deprecated
      `defineConfig` alias.
    detection:
      glob: "**/prisma.config.ts"
      contains:
        - "import { defineConfig } from '@prisma/cli-engine'"
  - id: engine-pin-moves-to-0-6-1
    summary: |
      The toolchain now peers `@prisma/cli-engine@0.6.1` (up from 0.4.0). An extension package that pins `@prisma/cli-engine` for its tests or tooling must move the pin to `0.6.1`. A config section's `validate` now receives a second `provenance` argument naming the files that declared the section.
    detection:
      glob: "**/package.json"
      contains:
        - '"@prisma/cli-engine": "0.4.0"'
  - id: psl-model-names-table-verbatim
    summary: |
      A PSL `model` with no `@@map` now names its table (or Mongo collection) after the model
      verbatim: `model UserProfile` maps to `"UserProfile"`, where it used to map to `"userProfile"`.
      Run the colocated codemod over every `.prisma` file, including the `contract.prisma` copies
      under `migrations/`, so each unmapped model gets `@@map("<current table name>")` and keeps the
      table it already has. Emitted contracts, storage hashes, and migration history are unchanged
      after the codemod. Planning without it fails with `MIGRATION.TABLE_NAME_CASE_CHANGED`
      instead of dropping and recreating the table.
    detection:
      glob: "**/*.prisma"
      regex:
        - '\bmodel\s+[A-Za-z_][A-Za-z0-9_]*\s*\{'
    script: ./scripts/psl-verbatim-table-names/add-model-map.mjs
  - id: dbgenerated-removed-from-psl
    summary: |
      `@default(dbgenerated("..."))` is removed from PSL. `contract emit` refuses it with
      `PSL_UNKNOWN_DEFAULT_FUNCTION`. Write a raw SQL default as the `sql` tagged literal, and a
      value the column's data type writes as that literal.
    detection:
      glob: "**/*.prisma"
      contains:
        - "dbgenerated("
  - id: default-sql-method-deprecated
    summary: |
      `.defaultSql('...')` on the TypeScript contract builder is deprecated and is removed at
      8.0.0. Rewrite each call to `.default(...)` with `now()`, `autoincrement()`, or the `sql`
      template tag.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\.defaultSql\('
  - id: every-codec-descriptor-names-a-data-type
    summary: |
      `CodecDescriptor` gained a required `dataType`: the id of the data type the codec represents.
      A descriptor without one does not compile, and a data type no component registers is an
      assembly error.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\b(CodecDescriptorImpl|PostgresCodecDescriptor|SqliteCodecDescriptor)\b'
  - id: a-pack-registers-its-data-types
    summary: |
      A pack registers its data types through `dataTypes` on its component metadata — a sibling of
      `types`, not a member of it — as an array of `dataType(...)` declarations.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\bcodecDescriptors:'
  - id: casts-replace-accepted-shape-handling
    summary: |
      A data type declares, in `casts`, which other types' values it takes and how. Casts replace
      every per-codec list of accepted shapes and the conversions that went with them.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\bliteralTypes\b'
        - '\bLiteralTypeDeclaration\b'
        - '\bintegerLiteralTypesUpTo\b'
  - id: decode-json-takes-only-the-canonical-form
    summary: |
      `decodeJson` takes its data type's canonical form and nothing else. Remove every coercion a
      codec did to accept another shape; the cast runs before the codec sees the value.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\bdecodeJson\('
  - id: the-authoring-entry-replaces-the-tag-registry-entry
    summary: |
      PSL support for a data type is an authoring entry under `authoring.dataTypes`, keyed by the
      type's id. It replaces the entry a pack used to put in the default-literal tag registry.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\bdefaultLiteralTagRegistry\b'
        - '\bControlDefaultLiteralTagEntry\b'
        - '\bjsonDefaultLiteralTagEntry\b'
        - '\bisDefaultLiteralTagLoweringEntry\b'
  - id: map-default-takes-data-types
    summary: |
      `DefaultMappingOptions` carries `dataTypeEntries`, `dataTypes` and `columnDataType` in place
      of `literalTypes`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\bmapDefault\('
        - '\bDefaultMappingOptions\b'
  - id: psl-and-numeral-helpers-live-in-relational-core
    summary: |
      `escapePslString`, `isNumeralText`, `isNonFiniteText` and `numeralText` moved from
      `@internal/framework-components/codec` to `@internal/sql-relational-core/ast`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\b(escapePslString|isNumeralText|isNonFiniteText|numeralText)\b'
  - id: the-postgres-target-exposes-its-data-types
    summary: |
      The Postgres target gained a `./data-types` subpath, forwarded by the `@prisma/orm-postgres`
      facade as `./target/data-types`. Import the Postgres types from there to declare a cast from
      one.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\bdataType\('
  - id: a-target-adapted-codec-extends-the-template
    summary: |
      A codec whose data type depends on the target adapting it extends `CodecDescriptorTemplateImpl`
      and leaves `dataType` off; the target names the type when it adapts the template.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\bCodecDescriptorTemplateImpl\b'
  - id: codec-without-params-has-no-params-schema
    summary: A codec that takes no params sets `paramsSchema` to `undefined`; `voidParamsSchema` is removed.
    detection:
      glob: "**/*.ts"
      contains:
        - "voidParamsSchema"
  - id: psl-infer-raw-default-parser-is-target-owned
    summary: |
      `parseRawDefault` is no longer exported from the `family/psl-infer` subpath; import `parsePostgresDefault` from `@prisma/orm-postgres/target/default-normalizer` instead.
  - id: psl-attribute-specs-are-documented
    summary: |
      `fieldAttribute`, `modelAttribute` and `blockAttribute` require a `documentation` string, and so does every positional and named parameter. A named parameter is now `{ type, documentation }` instead of a bare argument type.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\b(?:fieldAttribute|modelAttribute|blockAttribute)\('
  - id: psl-entity-ref-takes-a-selector
    summary: |
      `entityRef()` takes a selector such as `entityRef({ kind: 'model' })` and returns the resolved declaration instead of a name. Use `identifier()` for a name that is not checked. The attribute context carries the collected `symbols` table.
    detection:
      glob: "**/*.{ts,mts,cts}"
      contains:
        - "entityRef()"
  - id: psl-parse-takes-a-file-name
    summary: |
      `parse(source, filename, options?)` requires the file name, and its result carries `sources` in place of `sourceFile`. The interpreter input takes `documents: [document]` in place of `document`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\bparse\([^,()]*\)'
        - '\bdocument:\s'
  - id: emit-requires-deserialize-contract
    summary: Pass the contract family's deserializer to emit(); contract.d.ts is now always generated from the canonical contract.json.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - 'import\s*\{[^}]*\bemit\b[^}]*\}\s*from\s*[^/\w\s]@(?:prisma/orm-toolchain|internal)/emitter[^/\w-]'
  - id: expression-codec-on-return-type
    summary: Move custom expression wrapper codec metadata to returnType.codec and remove the separate ExpressionImpl codec argument.
  - id: shared-preparable-envelope
    summary: Type ORM preparation descriptions with the shared compositional Preparable protocol and pass their contained plan to SQL runtime.
  - id: params-only-sql-facade-prepare
    summary: Replace injected SQL-builder preparation callbacks with params-only callbacks and lexical facade SQL access.
  - id: preserve-prepared-reference-nullability
    summary: Preserve declaration nullability when constructing or cloning PreparedParamRef AST nodes.
  - id: preserve-orm-pagination-expressions
    summary: Preserve expression-valued limit and offset when consuming ORM CollectionState.
  - id: preserve-grouped-orm-pagination-expressions
    summary: Preserve expression-valued limit and offset when consuming ORM GroupPagingState.
  - id: postgres-list-element-codecs-receive-raw-strings
    summary: |
      PostgreSQL list decoding now parses array frames in the target and passes raw string elements to the scalar element codec; custom PostgreSQL codecs used in lists must accept those raw element spellings.
  - id: query-operation-types-move-to-the-postgres-target
    summary: |
      `QueryOperationTypes` moves from `@internal/adapter-postgres/operation-types` to
      `@internal/target-postgres/operation-types`. The adapter subpath is gone, with no
      compatibility re-export.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - "adapter-postgres/operation-types"
        - "orm-postgres/adapter/operation-types"
  - id: native-enum-codec-is-not-textual
    summary: |
      The native enum codec `pg/enum@1` no longer declares the `textual` trait. `pgEnumDescriptor`
      and `PgEnumCodec` declare `['equality', 'order']`, and `CodecTypes['pg/enum@1']['traits']` is
      `'equality' | 'order'`.
  - id: sql-lowering-spec-drops-strategy
    summary: |
      `SqlLoweringSpec` from `@internal/sql-operations` no longer has a `strategy` field.
      Remove `strategy: 'infix'` and `strategy: 'function'` from every operation descriptor's
      `lowering` object; `template` alone describes the lowering.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - "strategy: 'infix'"
        - "strategy: 'function'"
        - "strategy: \"infix\""
        - "strategy: \"function\""
  - id: share-create-default-cache-across-inserts
    summary: Share query-stable mutation defaults across every insert in one logical create operation.
  - id: supabase-contract-declares-nullable-list-columns
    summary: The Supabase extension contract now declares storage.buckets.allowed_mime_types and storage.objects.path_tokens as nullable lists, so its storage hash changes; re-sign databases that were signed against the previous Supabase contract.
    detection:
      glob: "**/package.json"
      contains:
        - '"@prisma/orm-extension-supabase"'
  - id: supabase-contract-regenerated-from-the-reference-fixture
    summary: The Supabase extension contract is regenerated and now declares the reference build's 43 check constraints, six native-enum defaults as member literals, four jsonb defaults as JSON literals, and an element-not-null waiver on two more list columns, so its storage hash changes; re-sign databases that were signed against the previous Supabase contract, and check your own Supabase build declares the same constraints.
    detection:
      glob: "**/package.json"
      contains:
        - '"@prisma/orm-extension-supabase"'
  - id: contract-space-restamp
    summary: |
      The emitted `contract.json` / `contract.d.ts` embed the toolchain version, which moves
      to 8.0.0-rc.12. Rebuild the extension's contract space (the package's `build:contract-space`
      script) once after upgrading so the emitted artifacts match the installed toolchain.
    detection:
      glob: "**/contract.json"
      contains:
        - '"version": "8.0.0-rc.11"'
---

# 8.0.0-rc.11 → 8.0.0-rc.12 — Extension author upgrade instructions

## `define-config-becomes-define-prisma-config`

For every `prisma.config.ts` matched by `detection`, rename the engine import and its call site from `defineConfig` to `definePrismaConfig`:

```ts
// before
import { defineConfig } from '@prisma/cli-engine';
export default defineConfig({ ... });

// after
import { definePrismaConfig } from '@prisma/cli-engine';
export default definePrismaConfig({ ... });
```

`definePrismaConfig` has been the engine's name for the marker since `@prisma/cli-engine@0.2.0`. `defineConfig` was a deprecated alias, and `@prisma/cli-engine@0.6.1` removes it, so this rename is required before the engine pin moves (`engine-pin-moves-to-0-6-1`, next). Leave any `defineConfig` imported from a product package (for example `@prisma/orm-postgres/config`) untouched — those helpers keep their name. The engine function's behaviour is identical; only the name changes.

## `engine-pin-moves-to-0-6-1`

For every `package.json` matched by `detection`, change the `@prisma/cli-engine` version from `0.4.0` to `0.6.1` and reinstall. The engine no longer exports the deprecated `defineConfig` alias; `define-config-becomes-define-prisma-config` (the previous entry) covers the rename.

Code that calls a config section's `validate` directly, for example in a test, must pass the provenance the engine supplies as the second argument:

```ts
// before
section.validate(raw);

// after
section.validate(raw, { files: [configPath], keys: { contract: configPath } });
```

`files` lists the config files that declared the section, nearest first. `keys` maps each top-level key of the section to the file that wrote it.

## `psl-model-names-table-verbatim`

A PSL `model` with no `@@map` used to name its table, or its Mongo collection, after the model with the first letter lowered: `model UserProfile` read and wrote `"userProfile"`. It now uses the model name verbatim, `"UserProfile"`, the same rule every other Prisma 8 authoring surface already followed. Every model without `@@map` therefore points at a table that does not exist yet, so the schema must say which table it means.

From the extension package root, run the codemod that sits next to this guide once over every schema file, including the contract-space `contract.prisma` and the copy inside each migration directory. `<skill>` is the directory of the synced `prisma-8` skill. The script exits with an error if no file matches:

```bash
node <skill>/upgrading/extension/upgrades/8.0.0-rc.11-to-8.0.0-rc.12/scripts/psl-verbatim-table-names/add-model-map.mjs '**/*.prisma'
```

It adds `@@map("<model name with its first letter lowered>")` as the last line of every `model` block that has no `@@map`, keeps the file's indentation and line endings, leaves models that already have `@@map` alone, and leaves a variant with `@@base(...)` and no `@@map` alone because it shares its base's table. It never descends into `node_modules` or `dist`, prints every model it mapped as `<file>: model <Name> -> @@map("<name>")`, and is idempotent. If a `model` block is written in a shape it cannot read it prints `<file>:<line>: model block not understood` and exits 1; add the `@@map` to that block by hand.

The codemod cannot see storage. It is for schemas written against the previous release only, where every unmapped model's table was created with its first letter lowered. Run it once, before you re-run `contract infer`, and never on a schema that was inferred or written after upgrading: such a schema already names its tables verbatim, and the codemod would point each unmapped model at a lowercase table that does not exist. Read the printed list and remove the `@@map` from any model whose table already has the verbatim name.

Then run the package's contract-space build (`build:contract-space`, or `prisma contract emit` for the package) and check that the emitted `contract.json` did not change. An unchanged `contract.json` proves the codemod was run on the right schema: if it changed, the schema was already verbatim, so revert the codemod's edits. Storage hashes, migration history, and refs are unchanged after a correct run, so applications composing the extension see no change.

In this upgrade, other entries in this guide also change the emitted `contract.json` (the `version` stamp, and the defaults some later entries name). Emit also fails while the schema still holds a form this release refuses, such as `dbgenerated(...)`, until a later entry rewrites it. In either case, run this check after those entries, and compare the table names in `contract.json` rather than the whole file.

If you plan a migration (`prisma migration plan`, `prisma db update`, `prisma migrate`) without running the codemod, planning fails instead of dropping the table:

```text
✘ [MIGRATION.PLANNING_FAILED] Migration planning failed
  why: MIGRATION.TABLE_NAME_CASE_CHANGED: table "UserProfile" would be created and table "userProfile" dropped. Prisma 8 changed the default table name: a model with no @@map now names its table verbatim, so model UserProfile points at "UserProfile" instead of "userProfile".
→ To keep table "userProfile" and its rows, add @@map("userProfile") to model UserProfile (or run the add-model-map codemod over the schema) and plan again. Prisma 8 has no rename-table operation, so a deliberate rename is done by hand: run ALTER TABLE "userProfile" RENAME TO "UserProfile" (schema-qualified where applicable), after which the plan is empty.
```

The conflict fires for each pair where the table to drop equals the table to create with its first letter lowered, in the same namespace, whatever the columns. It does not fire on an empty database or on tables the contract's control policy marks `external` or `observed`. Mongo has no planner and gives no error: an unmapped model silently reads and writes an empty `UserProfile` collection while the documents stay in `userProfile`, so run the codemod before deploying.

To adopt the verbatim names on purpose instead of mapping, rename the storage by hand and skip the codemod for those models. Postgres and SQLite: `ALTER TABLE "userProfile" RENAME TO "UserProfile"` (`ALTER TABLE "auth"."userProfile" RENAME TO "UserProfile"` inside a schema). Mongo: `db.userProfile.renameCollection("UserProfile")`. After the rename the migration plan is empty and `db verify` is clean.

`contract infer` follows the same rule: a table whose name already equals the model name (`"UserProfile"`, `"User"`) infers to a model with no `@@map` and verifies clean, where the previous output pointed the model at a lowercase table that did not exist. A snake_case table still infers with `@@map("user_profile")`. There is nothing to detect for this: the inferred text for such a table is the same as before, it is now correct.

## `dbgenerated-removed-from-psl`

`@default(dbgenerated("<expression>"))` no longer parses. Every use is reported at its span as `PSL_UNKNOWN_DEFAULT_FUNCTION` with the message `` Default function "dbgenerated" was removed. Write the SQL as a tagged literal: @default(sql`<expression>`). Supported functions: ... ``. `prisma contract infer` no longer prints it either: a raw expression prints as a `sql` tagged literal, and a value the column's data type writes prints as that literal.

In PSL, a raw SQL column default is written as a tagged literal, ``@default(sql`...`)`` or `@default(sql"...")`. Rewrite each use by what the expression is:

| You wrote | Write instead |
| --- | --- |
| `@default(dbgenerated("gen_random_uuid()"))` | `` @default(sql`gen_random_uuid()`) `` |
| `@default(dbgenerated("now()"))`, `@default(dbgenerated("CURRENT_TIMESTAMP"))` on Postgres | `@default(now())` |
| `@default(dbgenerated("autoincrement()"))`, `@default(dbgenerated("nextval('<seq>'::regclass)"))` on a serial column | `@default(autoincrement())` |
| `@default(dbgenerated("'<json>'::jsonb"))` on a `Json` or `Jsonb` column | `` @default(json`<json>`) `` |
| `@default(dbgenerated("'<member>'::<enum type>"))` on a column typed by that enum | `@default("<member>")` |
| `@default(dbgenerated("'<text>'::text"))` on a text column | `@default("<text>")` |
| `@default(dbgenerated("<anything else>"))` | `` @default(sql`<anything else>`) `` |

The `now()` and `autoincrement()` rows are required, not a matter of style: `` sql`now()` `` and `` sql`autoincrement()` `` are refused with `PSL_INVALID_DEFAULT_SQL`, because Prisma reads those two expressions as its own default functions. Every other expression, including `NOW()` written in capitals, is used exactly as written.

The mechanical rewrite for the last row is `@default(sql"<expression>")` with the argument text copied unchanged: the double-quote fence uses the same escapes as the `dbgenerated("...")` argument, so the contract cannot change. The backtick fence reads better for SQL; to use it, undo the quoted string's escaping (`\"` becomes `"`, `\n` becomes a line break), then write each backtick in the body as `` \` ``. Inside backticks every other backslash is kept as written, `\$` included, because PSL has no escape for `$`, and `${` is ordinary text. A body that contains a backtick is easiest to keep in the double-quote fence.

The JSON and enum rows change the emitted contract: the default becomes `{ kind: 'literal', value }` instead of `{ kind: 'function', expression }`, so the storage hash moves. Run `prisma contract emit`, then `prisma db verify`: the literal compares equal to the live default, so verify passes and no migration is needed. Every other row emits the same contract as before; the storage hash does not move.

Find the uses with `grep -rn "dbgenerated(" prisma/` (or wherever the schema lives).

### For a pack that ships a contract

A pack's committed `contract.prisma` (for example a reference contract regenerated from a live database with `prisma contract infer`) carries the same rewrites. Regenerate it with the pack's own generation script, or apply the table above by hand, then re-emit `contract.json` and `contract.d.ts` with `prisma contract emit`. Only the JSON and enum rows change the emitted contract and move the storage hash; the pack's verify test against its reference database still passes, because the literal compares equal to the live default.

## `default-sql-method-deprecated`

Rewrite every `.defaultSql('<expression>')` call by its expression:

| Call | Replacement | Import |
| --- | --- | --- |
| `.defaultSql('now()')` | `.default(now())` | `now` from `@internal/sql-contract-ts/contract-builder` |
| `.defaultSql('autoincrement()')` | `.default(autoincrement())` | `autoincrement` from `@internal/sql-contract-ts/contract-builder` |
| `.defaultSql('gen_random_uuid()')` | `` .default(sql`gen_random_uuid()`) `` | `sql` from `@internal/sql-contract-ts/contract-builder` |
| `.defaultSql('<anything else>')` | `` .default(sql`<anything else>`) `` | `sql` from `@internal/sql-contract-ts/contract-builder` |

There is no named helper for other database functions, so they use the `sql` tag, as `gen_random_uuid()` does above. `` sql`now()` `` and `` sql`autoincrement()` `` are refused in the TypeScript `sql` tag as they are in PSL, so those two must use the named form.

Copy the expression's value, not its source string: first undo the TypeScript string's own escaping, so `.defaultSql('it\'s')` contributes `it's`. Then write each backtick as `` \` ``. Write a backslash that precedes a dollar sign as `\\$`, because the tag reads `\$` as the escape for `$`. Every other backslash can be written as it is, or doubled; both give one backslash. An expression that contains `${` is written `\${` inside the `sql` tag, which resolves it back to the two characters; in PSL it is written as it is.

Every form lowers to the same `{ kind: 'function', expression }` default, so emitted contracts do not change.

Find the uses with `grep -rn "defaultSql(" src/` (or wherever the contract is defined).

## `every-codec-descriptor-names-a-data-type`

A **data type** is a stored type made first-class: `pg/int8`, `pg/jsonb`, `postgis/geometry`. Its id is `owner/name` and carries no version, because a type's identity does not change. A **codec** is one representation of a data type, and a codec id carries a version (`pg/int8@1`), so one string never names both.

Every descriptor names the type it represents:

```ts
import { pgvectorVector } from './data-types';

export class PgVectorDescriptor extends PostgresCodecDescriptor<VectorParams> {
  override readonly dataType = pgvectorVector.id;
  override readonly codecId = VECTOR_CODEC_ID;
  override readonly traits = ['equality'] as const;
  override readonly targetTypes = ['vector'] as const;
  override readonly paramsSchema: StandardSchemaV1<VectorParams> = vectorParamsSchema;
  override factory(params: VectorParams): (ctx: CodecInstanceContext) => PgVectorCodec {
    return () => new PgVectorCodec(this, params.length);
  }
}
```

`dataType` is `abstract readonly dataType: DataTypeId` on `CodecDescriptorImpl`, so a descriptor that leaves it off does not compile. `DataTypeId` is a branded string: the only way to make one is `dataTypeId('owner/name')`, which `dataType()` calls for you, so reference the declaration's `.id` rather than writing the string again.

Several codecs may represent one type. `pg/int8@1` and `pg/int8number@1` both name `pg/int8`; they differ in the in-memory value they produce, and both store the type's one canonical form.

Name the target's type whenever your codec stores what one of the target's columns stores. A codec that keeps a JSON document in a `jsonb` column and validates it against a schema names `pg/jsonb` and registers nothing: `pg/jsonb` already says what the column holds and what it takes, and the schema check is the codec's, at the point the value is read. Register a type of your own only for a database type no pack describes yet, as pgvector does for `vector`.

Assembly checks the ids across packs. A codec naming a type nobody registers fails with `CONTRACT.DATA_TYPE_UNREGISTERED`, naming your component and the id.

## `a-pack-registers-its-data-types`

A pack that introduces a database type of its own declares each type with `dataType(id, spec)` and lists them on the component metadata. A pack whose codecs all represent types the target registers declares none, and has no `dataTypes` at all.

```ts
// data-types.ts
import { type DataType, dataType } from '@internal/framework-components/codec';
import { pgText } from '@internal/target-postgres/data-types';

export const postgisGeometry: DataType = dataType('postgis/geometry', {
  casts: { [pgText.id]: (value) => value },
});

export const postgisDataTypes: readonly DataType[] = [postgisGeometry];
```

```ts
// descriptor-meta.ts
const postgisPackMetaBase = {
  kind: 'extension',
  id: 'postgis',
  // …
  dataTypes: postgisDataTypes,
  types: {
    codecTypes: { codecDescriptors: Array.from(postgisCodecRegistry.values()), /* … */ },
  },
};
```

`dataTypes` sits beside `types`, not inside it: `types` is copied into an extension's contract space, and a cast is a function, which no contract holds.

Two components registering one id fail assembly with `CONTRACT.DATA_TYPE_DUPLICATE`, naming both.

## `casts-replace-accepted-shape-handling`

A **cast** is a pure function from another type's canonical form into this type's. Casts are declared by the type that receives, never by the source, so there is at most one for any pair and a type's owner is the only one who decides what it takes. A written value is admitted when its type is the column's type or the column's type casts from it; the cast runs before the codec sees anything.

This replaces the per-codec list of accepted shapes. Delete `literalTypes` from every descriptor, delete any import of `LiteralTypeDeclaration` or `integerLiteralTypesUpTo`, and move each conversion into the receiving type's cast:

```ts
const asNumeralText: Cast = (value) =>
  typeof value === 'number' ? numeralText(value) : wrongShape(value, 'a number');

export const pgInt8: DataType = dataType('pg/int8', {
  casts: { [pgInt2.id]: asNumeralText, [pgInt4.id]: asNumeralText },
});
```

Declaring no cast is a decision, not an omission. `pg/int4` declares none from `pg/int8`, so a number too wide for the column is refused before anything is decoded:

```text
Field "N.count": pg/int4 has no cast from pg/int8; it casts from pg/int2
```

A cast may refuse the value it is handed, with a structured error carrying `why` and `fix`; the refusal surfaces as `PSL_INVALID_DEFAULT_LITERAL` at the written value.

There is no list data type. A type whose single value holds several elements declares a `listCast` instead: `of` is the set of types an element may be, and `cast` receives the elements' canonical forms in written order. This is how a vector column takes `` @default([0.1, 0.2, 0.3]) ``:

```ts
export const pgvectorVector: DataType = dataType('pgvector/vector', {
  listCast: {
    of: [pgInt2.id, pgInt4.id, pgInt8.id, pgNumeric.id],
    cast: (elements) => elements.map(elementNumber),
  },
});
```

Assembly refuses a cast whose source type no contract source can write, with `CONTRACT.DATA_TYPE_NOT_WRITABLE`: such a cast could never be exercised.

## `decode-json-takes-only-the-canonical-form`

A data type names one **canonical form**: the single JSON shape `contract.json` stores for its values. `pg/int8` stores digit text, `pg/int4` a JSON number, `pg/jsonb` the document. Every codec of a type stores and reads exactly that form.

So `decodeJson` takes that form and nothing else, and `encodeJson` produces it. Remove every branch a codec had for a shape it does not itself write — the cast has already produced the canonical form by the time the codec is called:

```diff
 decodeJson(json: JsonValue): number {
-  if (typeof json === 'number') return decodeInt8(json);
   if (typeof json !== 'string') {
-    throw myError('RUNTIME.DECODE_FAILED', 'value must be decimal text or a whole number');
+    throw myError('RUNTIME.DECODE_FAILED', 'database JSON value must be decimal text');
   }
   return decodeInt8(json);
 }
```

Where two codecs of one type previously stored different shapes, they now share the type's form. `pg/int8number@1` and `sqlite/bigintnumber@1` store digit text like their `bigint`-valued siblings, and refuse text past 2^53 as a limit of their own representation.

A codec still validates what the column's parameters constrain, on the canonical form: `vector(3)` refuses four elements, `numeric(10,2)` refuses a third decimal place. A refusal is reported as `PSL_INVALID_DEFAULT_LITERAL` carrying the codec's own message, and `contract infer` calls the codec on what it is about to print, falling back to the raw expression when it throws.

## `the-authoring-entry-replaces-the-tag-registry-entry`

PSL support for a data type is an **authoring entry**, contributed by the pack that owns the type under `authoring.dataTypes` and keyed by the type's id. It replaces the entry a pack used to register in the default-literal tag registry.

An entry has a **written form**, a `print` that is the reverse of reading it, and `documentation` the language server shows:

```ts
export function postgresDataTypeEntries(): Readonly<Record<string, AuthoringDataTypeEntry>> {
  return {
    [pgText.id]: {
      written: { kind: 'plain', syntax: 'string', parse: (text) => text },
      print: (value) => String(value),
      documentation: 'Text.',
    },
    [pgJson.id]: {
      written: { kind: 'tag', tag: 'json', parse: parseJsonBody },
      print: printJsonBody,
      documentation: 'Reads the body as a JSON document and stores it as the default value.',
    },
  };
}
```

There are four written forms:

- `{ kind: 'tag', tag, parse }` — a qualified name followed by a body in any of PSL's quote styles. A target may register an unprefixed tag; every other pack prefixes, as `postgis.geometry` does.
- `{ kind: 'plain', syntax: 'string', parse }` and `{ kind: 'plain', syntax: 'boolean', parse }` — a quoted string, and `true`/`false`.
- `{ kind: 'plain', syntax: 'number', types, classify }` — a written number. This is the one form that yields several types, so instead of `parse` it carries a classifier that picks the type from the digits and returns the canonical form with it, plus `types`, every type the classifier can return. Naming `types` is how assembly knows those types can be written.

```ts
const classifyPostgresNumber = createNumberClassifier({
  integers: [
    { type: pgInt2.id, form: 'number', ...signedRange(16) },
    { type: pgInt4.id, form: 'number', ...signedRange(32) },
    { type: pgInt8.id, form: 'text', ...signedRange(64) },
  ],
  largerWhole: { type: pgNumeric.id, form: 'text' },
  fraction: { type: pgNumeric.id, form: 'text' },
  words: { type: pgNumeric.id, form: 'text' },
});
```

`createNumberClassifier`, `signedRange`, `parseJsonBody` and `printJsonBody` come from `@internal/sql-relational-core/ast`, so targets share one digit classifier and one JSON reader.

One tag names no data type: `sql` takes an expression in the database's language and lowers its own body. A **lowering entry** sits in the same map under a reserved key, because it has no type id to be keyed by:

```ts
export function createPostgresDataTypeEntries(): Readonly<Record<string, AuthoringDataTypeEntry>> {
  return {
    ...postgresDataTypeEntries(),
    [loweringEntryKey('sql')]: sqlDefaultLiteralTagEntry('sql'),
    [loweringEntryKey('pg.sql')]: sqlDefaultLiteralTagEntry('pg.sql'),
  };
}
```

`loweringEntryKey`, `isLoweringEntryKey` and `isDataTypeLoweringEntry` are exported from `@internal/framework-components/authoring`; `isDataTypeLoweringEntry` is the only place the discriminating key is named, so narrow with it before reaching for `lower`.

These surfaces are gone, with no replacement beyond the above: `ControlMutationDefaults.defaultLiteralTagRegistry`, the `ControlDefaultLiteralTagEntry` and `ControlDefaultLiteralTagRegistry` types, `literalTypes` on codec descriptors, and the framework's literal-types exports (`LiteralTypeName`, `LiteralTypeDeclaration`, `integerLiteralTypesUpTo`, `jsonDefaultLiteralTagEntry`, `isDefaultLiteralTagLoweringEntry`).

Assembly refuses two entries claiming one tag or one plain form with `CONTRACT.DATA_TYPE_WRITTEN_FORM_DUPLICATE`, and an entry keyed by an unregistered id with `CONTRACT.DATA_TYPE_UNREGISTERED`.

## `map-default-takes-data-types`

`mapDefault` (`@internal/family-sql/psl-infer`) classifies the stored value with the same rules a written value uses, confirms the column's type takes it, prints it with the classified type's authoring entry, and reads the text straight back. `DefaultMappingOptions` lost `literalTypes` and gained:

- `dataTypeEntries` — the stack's authoring entries, keyed by data type id;
- `dataTypes` — a `DataTypeLookup` over the stack's types, whose casts say what each one takes;
- `columnDataType` — the data type of this column's codec;
- `list` — whether the column is a list, whose elements each carry the column's own type. A written list on a column that is not a list goes through that type's `listCast` instead.

A target builds the first two once:

```ts
export function createPostgresDefaultMapping(): DefaultMappingOptions {
  return {
    dataTypeEntries: postgresDataTypeEntries(),
    dataTypes: createDataTypeLookup(postgresDataTypes),
  };
}
```

and adds the per-column half at each call:

```ts
const result = mapDefault(columnDefault, {
  ...defaultMapping,
  ...ifDefined('columnDataType', dataTypeForPrintedType(resolution.pslType.name, isEnumColumn)),
  list: column.many === true,
});
```

A value no entry writes, or one that does not read back as the stored value, makes `mapDefault` return `undefined`, which is the signal to fall back to the raw database default: map it again as a function default, which prints as a named function or as `` @default(sql`<expression>`) ``. `DefaultMappingResult` is now `{ attribute }` only; the `{ comment }` result and the `fallbackFunctionAttribute` option are removed along with `dbgenerated`. `formatLiteralValue` and the per-PSL-type formatter table a target printer used to supply (`PslDefaultValueFormat`, `formatPslValue`, `formatPslListLiteralValue`) are gone; delete them.

## `psl-and-numeral-helpers-live-in-relational-core`

Four helpers moved out of `@internal/framework-components/codec`, because they are SQL-family text handling rather than framework surface:

| Helper | What it does | Now imported from |
| --- | --- | --- |
| `escapePslString` | Escapes a string for a PSL double-quoted literal | `@internal/sql-relational-core/ast` |
| `isNumeralText` | Whether text is a number written out | `@internal/sql-relational-core/ast` |
| `isNonFiniteText` | Whether text is `NaN`, `Infinity` or `-Infinity` | `@internal/sql-relational-core/ast` |
| `numeralText` | A JS number as digit text, with no exponent | `@internal/sql-relational-core/ast` |

```diff
-import { escapePslString, numeralText } from '@internal/framework-components/codec';
+import { escapePslString, numeralText } from '@internal/sql-relational-core/ast';
```

Use them rather than a local regex, so a printed value and the reader that parses it back cannot drift.

## `the-postgres-target-exposes-its-data-types`

Declaring a cast means naming the source type by its declaration, so the Postgres target now exports its types and its authoring entries from a `./data-types` subpath:

```ts
import { pgInt2, pgInt4, pgInt8, pgNumeric, pgText } from '@internal/target-postgres/data-types';
```

The `@prisma/orm-postgres` facade forwards it as `@prisma/orm-postgres/target/data-types`, which is the import an out-of-repo extension uses.

The subpath carries every `pg/*` type (`pgText`, `pgBool`, `pgInt2`, `pgInt4`, `pgInt8`, `pgNumeric`, `pgFloat4`, `pgFloat8`, `pgJson`, `pgJsonb`, the text-backed types, and the temporal ones), the `postgresDataTypes` array, and `postgresDataTypeEntries()`.

A cast whose source belongs to another pack only makes sense when that pack is in the stack, which is why assembly, not the extension, checks it: `pgvector/vector` casting from `pg/numeric` is valid only when the Postgres target is composed in.

## `a-target-adapted-codec-extends-the-template`

A codec shared by several targets cannot name its data type itself, because the type differs per target. Such a descriptor extends `CodecDescriptorTemplateImpl`, which has every descriptor field except `dataType`:

```ts
export class SqlTextDescriptor extends CodecDescriptorTemplateImpl<void> {
  override readonly codecId = SQL_TEXT_CODEC_ID;
  override readonly traits = ['equality', 'order', 'textual'] as const;
  override readonly targetTypes = ['text'] as const;
  override readonly paramsSchema = undefined;
  override factory(): (ctx: CodecInstanceContext) => SqlTextCodec {
    return () => new SqlTextCodec(this);
  }
}
```

The target names the type when it adapts the template:

```ts
export const postgresSqlTextDescriptor = postgresCodec(sqlTextDescriptor, {
  dataType: pgText.id,
  nativeType: () => 'text',
  jsonProjection: identityJsonProjection,
});
```

`dataType` is required in the adapter's options, so a target cannot adapt a template without deciding which of its types the codec represents. Every other descriptor — one written for a single target — extends `CodecDescriptorImpl` (or a target's subclass of it, such as `PostgresCodecDescriptor`) and declares `dataType` directly.

## `codec-without-params-has-no-params-schema`

`voidParamsSchema` is no longer exported from `@internal/framework-components/codec`. A codec descriptor that takes no params (`P = void`) sets `paramsSchema` to `undefined`, and `isParameterized` is `true` exactly when a descriptor has a `paramsSchema`. A codec without params still rejects any `typeParams` with `RUNTIME.TYPE_PARAMS_INVALID`.

In every file matched by `detection`:

```ts
// before
import { CodecDescriptorImpl, voidParamsSchema } from '@internal/framework-components/codec';
import type { StandardSchemaV1 } from '@standard-schema/spec';

class MyTextDescriptor extends CodecDescriptorImpl<void> {
  override readonly paramsSchema: StandardSchemaV1<void> = voidParamsSchema;
}

// after
import { CodecDescriptorImpl } from '@internal/framework-components/codec';

class MyTextDescriptor extends CodecDescriptorImpl<void> {
  override readonly paramsSchema = undefined;
}
```

- Remove `voidParamsSchema` from the import. Remove the `StandardSchemaV1` import too if nothing else in the file uses it.
- In a descriptor written as a plain object, replace `paramsSchema: voidParamsSchema` with `paramsSchema: undefined`.
- Code that reads `descriptor.paramsSchema` now sees `StandardSchemaV1<P> | undefined`. Check `descriptor.paramsSchema !== undefined` before calling its `validate`.

Parameterized codecs are unchanged.

## `psl-infer-raw-default-parser-is-target-owned`

Find imports of `parseRawDefault` from `@prisma/orm-family-sql/family/psl-infer`, `@prisma/orm-postgres/family/psl-infer`, or `@prisma/orm-sqlite/family/psl-infer`. The function read Postgres default spellings, so it now lives in the Postgres target. Replace each import with `parsePostgresDefault` from `@prisma/orm-postgres/target/default-normalizer`. The signature is unchanged: `(rawDefault: string, nativeType?: string) => ColumnDefault | undefined`. It reads every spelling the old function read, plus the negative and cast numerals, cross-schema enum literals, zoneless `timestamp` literals, and `ARRAY[...]` lists added in this release, so a value that was `undefined` before may now be a literal.

The `parseRawDefault` option on `PslPrinterOptions` is unchanged; pass `parsePostgresDefault` there where you passed the old function.

## `psl-attribute-specs-are-documented`

The language server now shows signature help for every PSL attribute, built from the attribute's own declaration. For every file matched by `detection`, give each attribute spec a `documentation` string, give each positional parameter one, and wrap each named parameter's type in `{ type, documentation }`:

```ts
// before
const mapAttribute = blockAttribute('map', {
  positional: [{ key: 'name', type: str() }],
  named: { schema: optional(str()) },
});

// after
const mapAttribute = blockAttribute('map', {
  documentation: 'Maps this block to its database name.',
  positional: [{ key: 'name', type: str(), documentation: 'The database name.' }],
  named: { schema: { type: optional(str()), documentation: 'The schema that holds it.' } },
});
```

An attribute with no parameters still needs its own `documentation`, for example `modelAttribute('rls', { documentation: '...' })`. The documentation is editor help only; parsing, validation and the emitted contract do not change.

## `psl-entity-ref-takes-a-selector`

`entityRef()` now checks the reference against the schema's declarations. For every file matched by `detection`, pass the kind of declaration the argument must name, and read the resolved declaration from the result instead of a string:

```ts
// before
{ key: 'base', type: entityRef(), documentation: 'The base model to inherit from.' }
// parsed.base is the name as written

// after
{ key: 'base', type: entityRef({ kind: 'model' }), documentation: 'The base model to inherit from.' }
// parsed.base is { declaration, namespace }; the name is parsed.base.declaration.name
```

A reference to another block kind uses `entityRef({ kind: 'block', keyword: '<keyword>' })`. An argument that names something the schema does not declare, and that must not be checked, uses `identifier()` instead. A pinned literal name stays `identifier('<name>', { documentation })`. Code that builds an attribute context itself must now pass the collected symbol table as `symbols`, next to `sources`.

## `psl-parse-takes-a-file-name`

A schema can now span several files, so every parse result records which file it came from. For every file matched by `detection`:

```ts
// before
const { document, sourceFile, diagnostics } = parse(source);
interpret({ document, ... });

// after
const { document, sources, diagnostics } = parse(source, 'schema.prisma');
interpret({ documents: [document], ... });
```

Pass the real path when there is one; a synthetic name such as `'<inline>.prisma'` is fine for source that has no file. `sources` maps each syntax root to its file and converts offsets to line and column, which `sourceFile` used to do for the single file.

## `emit-requires-deserialize-contract`

Find calls to `emit(contract, stack, emission, options)` imported from `@prisma/orm-toolchain/emitter`. Add a `deserializeContract` option that reads the canonical JSON object back into a contract through the family instance of the contract being emitted:

```ts
const familyInstance = family.create(stack);
const result = await emit(contract, stack, family.emission, {
  serializeContract: (c) => target.contractSerializer.serializeContract(c),
  deserializeContract: (json) => familyInstance.deserializeContract(json),
});
```

`emit()` generates `contract.d.ts` from that re-read contract, so models, fields and relations appear in the order `contract.json` lists them. Use the family's own deserializer rather than an identity function: the family builds the objects the declaration generator reads. Direct calls to `generateContractDts` are unchanged.

## `expression-codec-on-return-type`

For custom SQL `Expression` wrappers, move an existing top-level `codec` reference into `returnType.codec`, preserving the complete reference including `typeParams`. Read metadata through `codecOf(expression)` or `expression.returnType.codec`, not `expression.codec`. Keep the existing `returnType.codecId` and nullability; wrappers without an explicit reference continue to use the declared codec id fallback. Do not remove or relocate unrelated codec fields on AST nodes, storage declarations, runtime bindings or scope descriptors.

For direct `ExpressionImpl` construction, change `new ExpressionImpl(ast, returnType, codec, projectionAst)` to `new ExpressionImpl(ast, { ...returnType, codec }, projectionAst)`. When the removed codec argument was `undefined`, keep `returnType` unchanged and move any fourth projection argument to the third position. Preserve projection-only lowering separately from predicate and ordering ASTs.

## `shared-preparable-envelope`

Replace imports of SQL ORM client's `RowQuery` with `Preparable` from `@internal/sql-relational-core/plan`. Supply both type arguments as `Preparable<DbRow, Result>` and return `{ plan, consume }`, where `plan` is a `SqlQueryPlan<DbRow>` and `consume` returns the complete ORM result. Read AST, parameters and metadata through `description.plan`; pass `description.plan` rather than the description to SQL runtime preparation. Keep the consumer's mapping setup outside invocation-time code.

For integrations accepting both SQL and ORM callbacks, constrain the callback result with `Q extends SqlQueryPlan | Preparable<unknown, unknown>` and use SQL ORM client's `prepareQuery` and `PreparedFrom<Params, Q>`. Preserve the concrete `Q` so SQL row/statistics types and ORM all/first result types remain distinct. Do not add identity consumers to plain SQL plans.

## `params-only-sql-facade-prepare`

Find calls to `prepare(declaration, callback)` on clients created by the Postgres or SQLite facade (`@prisma/orm-postgres/runtime`, `@prisma/orm-sqlite/runtime`, or their `@internal/postgres/runtime` and `@internal/sqlite/runtime` counterparts). Resolve the receiver and callback rather than rewriting every method named `prepare`: native SQLite `database.prepare(sql)` and SQL runtime's existing params-only preparation are different APIs and must remain unchanged.

Change callbacks from `(sql, params) => ...` to `(params) => ...`. Replace references bound to the removed `sql` callback argument with the same facade receiver's lexical `.sql` property. Preserve the params argument's name, declaration, SQL chain, row selection, filters and invocation target/options. For extracted callbacks, capture the same client in the enclosing scope; do not capture an invocation target or evaluate the callback twice. Update explicit callback type annotations to accept only the placeholder-params argument.

```ts
// Before
const query = await db.prepare({ id: 'pg/int4@1' }, (sql, params) =>
  sql.public.users.select('id').where((f, fns) => fns.eq(f.id, params.id)).build(),
);

// After
const query = await db.prepare({ id: 'pg/int4@1' }, (params) =>
  db.sql.public.users.select('id').where((f, fns) => fns.eq(f.id, params.id)).build(),
);
```

Apply the same translation to SQLite's flat SQL facade (`sql.users` becomes `db.sql.users`), retaining its existing codec ids. Keep `.query(target, params, options?)` and SQL statistics `.execute(target, params, options?)` calls unchanged. Do not rewrite historical release notes, applied upgrade recipes, generated contracts or tests as part of this source translation.

## `preserve-prepared-reference-nullability`

Find code that constructs or clones `PreparedParamRef` from SQL relational-core's AST exports. When constructing a reference from a nullable declaration, pass its declared boolean nullability as the third argument to `PreparedParamRef.of(name, codec, nullable)` or `new PreparedParamRef(name, codec, nullable)`. When cloning an existing reference, preserve `ref.nullable`: `PreparedParamRef.of(ref.name, ref.codec, ref.nullable)`. Keep the name and complete codec reference unchanged, and keep constructing frozen class instances rather than spreading nodes into plain objects. Do not derive this flag from a column's nullability or an invocation's bound value.

## `preserve-orm-pagination-expressions`

Update extension code that reads or mirrors ORM `CollectionState.limit` and `offset`: these fields now contain relational-core `LimitOffsetValue | undefined` (`number | AnyExpression | undefined`), not just numbers. Forward them unchanged to the existing `SelectAst.withLimit` and `withOffset` methods. If processing numeric literals separately, narrow with `typeof value === 'number'`; preserve expression nodes rather than coercing, serializing or boxing them as literal parameters. Test presence against `undefined`, not truthiness, so zero limits and offsets survive. Keep grouped post-aggregation paging's separate numeric state unchanged.

## `preserve-grouped-orm-pagination-expressions`

Update extension code that reads or mirrors ORM `GroupPagingState.limit` and `offset`: these fields now contain relational-core `LimitOffsetValue | undefined` (`number | AnyExpression | undefined`), not just numbers. Forward them unchanged to the existing `SelectAst.withLimit` and `withOffset` methods. If processing numeric literals separately, narrow with `typeof value === 'number'`; preserve expression nodes rather than coercing, serializing or boxing them as literal parameters. Test presence against `undefined`, not truthiness, so zero limits and offsets survive. Keep grouped post-aggregation paging separate from pre-group collection paging, preserving expression operands at both stages. This extends the collection-pagination migration in `preserve-orm-pagination-expressions` (the previous entry) to grouped pagination; do not keep grouped paging numeric-only.

## `postgres-list-element-codecs-receive-raw-strings`

Review PostgreSQL extension codecs whose descriptors can be used by `CodecRef.many` list columns. Inbound list framing is now target-owned: the target parses the Postgres array literal and invokes the scalar element codec for each non-null raw string element. Keep scalar direct-query compatibility as needed, but make the element `decode(wire, ctx)` accept the raw text spelling Postgres emits for that scalar value; the built-in numeric, boolean, integer, and float codecs accept both raw strings and native scalar wire values for this reason. Do not add a native-array fallback at the list-frame boundary, and do not add compatibility exports or codec-id aliases. `codecId`, `typeParams`, and emitted `CodecRef.many` shapes are unchanged.

## `query-operation-types-move-to-the-postgres-target`

The Postgres adapter no longer contributes query operations; the target does. Change the import:

```ts
// before
import type { QueryOperationTypes } from '@internal/adapter-postgres/operation-types';
// after
import type { QueryOperationTypes } from '@internal/target-postgres/operation-types';
```

Under the published facade, `@prisma/orm-postgres/adapter/operation-types` becomes `@prisma/orm-postgres/target/operation-types`. Emitted contracts name the target import under the alias `PgTargetQueryOps` instead of `PgAdapterQueryOps`, so a snapshot or fixture that pins emitted contract text needs regenerating.

The type's shape is otherwise unchanged. It gains `fullTextMatches`, `fullTextRank` and `fullTextHeadline` on `textual` columns, whose query argument is a `pg/tsquery@1` value (built with a parser or the `tsquery` tag). It also gains the four parser operations `websearchToTsquery`, `toTsquery`, `plaintoTsquery` and `phrasetoTsquery`, which have no `self`, so they attach to no column. None of the names collide with an existing operation, so an extension that intersects its own `QueryOperationTypes` with the Postgres one needs no other edit.

## `native-enum-codec-is-not-textual`

Postgres has no `LIKE`, `ILIKE` or `to_tsvector` for an enum type, so the native enum codec (`pgEnumDescriptor`, `PgEnumCodec` in `@internal/target-postgres/codecs`) no longer declares `textual`. Its traits are `['equality', 'order']`.

An extension operation whose `self` targets `{ traits: ['textual'] }` no longer attaches to native enum columns. That is intended when the operation passes the column where Postgres expects `text`. If an operation of yours does work on an enum, declare its `self` by codec id (`{ codecId: 'pg/enum@1' }`).

A hand-written type fixture that spells out `pg/enum@1` with `traits: 'equality' | 'order' | 'textual'` should drop `'textual'` to match the real codec.

`min` and `max` over a native enum still resolve to `pg/enum@1`: the Postgres target now lists the enum codec explicitly instead of reaching it through the `textual` fallback. Emitted `AggregateTypes` do not change.

## `sql-lowering-spec-drops-strategy`

Nothing ever read `strategy`; the template already says whether an operation lowers as an infix operator or a function call. The field is gone from `SqlLoweringSpec`, so a descriptor that still sets it fails to typecheck as an excess property. Delete the line:

```ts
// before
lowering: { targetFamily: 'sql', strategy: 'function', template: 'lower({{self}})' },
// after
lowering: { targetFamily: 'sql', template: 'lower({{self}})' },
```

The rendered SQL is unchanged.

## `share-create-default-cache-across-inserts`

If an extension orchestrates multiple `applyMutationDefaults` calls for one logical create, allocate one `Map<string, unknown>` before iterating its rows and pass it as `defaultValueCache` to every call. For multi-table inheritance, pass the same cache to both the base-table and variant-table inserts, including all rows of a bulk create.

Let helpers that apply create defaults accept that cache from their caller, with a fresh map as the default for standalone operations. Do not keep it on a reusable collection, runtime, or transaction: a subsequent create operation needs a fresh cache.

Continue letting the mutation-default registry honor generator stability. Do not cache field-stable generators yourself; generated IDs must remain independent.

## `supabase-contract-declares-nullable-list-columns`

The `@prisma/orm-extension-supabase` contract gains two fields that were previously omitted because the PSL printer could not write a nullable list: `StorageBucket.allowedMimeTypes` (`storage.buckets.allowed_mime_types`) and `StorageObject.pathTokens` (`storage.objects.path_tokens`), both `String[]?`. This is one of several changes to the Supabase contract in this release; `supabase-contract-regenerated-from-the-reference-fixture` (next) gives the storage hash they produce together.

A contract that composes the Supabase space references it by id, so your own `contract.json` and `contract.d.ts` do not change. What changes is the signature: a database that was signed against the previous Supabase contract no longer matches the new hash, so run `prisma db sign` against it once after upgrading; one sign covers this entry and the next. Both columns already exist on every Supabase database, so `prisma db verify` passes without a schema change. `path_tokens` is `GENERATED ALWAYS`: read it, do not write it.

## `supabase-contract-regenerated-from-the-reference-fixture`

The `@prisma/orm-extension-supabase` contract is now exactly what `contract:generate` produces from the reference fixture, which it had drifted away from. The Supabase space's storage hash changes from `409d9a5191d9d7d8e45a795cb55695a79edce9d8f42ff1e456bce6e79f98dff1` (the hash in 8.0.0-rc.11) to `734893bc990ae5ec14dc7ad50a7d8b5873a864f056085a7ffd2f69c866989067`. That new hash also covers the two fields added by `supabase-contract-declares-nullable-list-columns` (the previous entry).

Five things changed in the contract.

**43 check constraints are now declared.** Every `CHECK` that the pack's reference Supabase build declares on an `auth` or `storage` table — for example `users_email_change_confirm_status_check` and `one_time_tokens_token_hash_check` — is now part of the contract. The reference build is supabase/postgres 17.6.1.106 with gotrue 2.188.1 and storage-api 1.54.1. On a database at or near that version the constraints are already present, so `prisma db verify` passes without a schema change. This is the one item that can newly fail for you: the checks used to be a tolerated live extra and are now a declared shape, so if your Supabase build's constraint set differs, verify reports the missing ones. You cannot repair that with a migration, because Prisma emits no DDL against an externally controlled table; report the difference so the pack's reference fixture can be refreshed.

**Six native-enum column defaults are declared as member literals.** `auth.oauth_clients.client_type`, `auth.oauth_authorizations.response_type`, `auth.oauth_authorizations.status`, and the `type` column of `storage.buckets`, `storage.buckets_analytics` and `storage.buckets_vectors` previously carried the raw cast expression as their default, for example `{ "kind": "function", "expression": "'STANDARD'::storage.buckettype" }`. They now carry the enum member itself: `{ "kind": "literal", "value": "STANDARD" }`. This is the same live default read a more precise way, so the live databases need no change; if you read a column's declared default out of the contract, expect a literal rather than an expression.

**Four `jsonb` column defaults are declared as JSON literals.** `auth.custom_oauth_providers.attribute_mapping`, `auth.custom_oauth_providers.authorization_params` and `storage.iceberg_namespaces.metadata` (`'{}'::jsonb`), and `auth.webauthn_credentials.transports` (`'[]'::jsonb`), previously carried the raw cast expression as their default. They now carry the JSON value itself, for example `{ "kind": "literal", "value": {} }`, as the JSON row of `dbgenerated-removed-from-psl` describes. The live defaults need no change.

**Two list columns carry an element-not-null waiver.** `auth.custom_oauth_providers.acceptable_client_ids` and `auth.custom_oauth_providers.scopes` now carry `"noCheck": ["elementNotNull"]`, matching the two `storage` list columns that already did. `contract infer` writes this for any list column with no live check at the derived name, and the committed contract is the generator's output, so it carries it too. This item moves the storage hash and changes nothing else you can observe: the pack is under `external` control, so a derived check is stripped before emit whether the waiver is written or not, and `db verify` demanded no such constraint before and demands none now.

**78 timestamp columns are written as `Timestamptz` instead of `DateTime` in the PSL.** Same codec (`pg/timestamptz-temporal@1`) and same emitted column, so this is a text change only.

A contract that composes the Supabase space references it by id, so your own `contract.json` and `contract.d.ts` do not change. What changes is the signature: a database that was signed against the previous Supabase contract no longer matches the new hash, so run `prisma db sign` against it after upgrading. If you re-emit your own contract, do that first so the composed space is the new one.

## `contract-space-restamp`

For every `contract.json` matched by `detection`, run the extension package's `build:contract-space` script (or its emit command) once after upgrading. This entry accounts for the embedded `version` moving to `8.0.0-rc.12`; any other difference in the emitted files comes from an earlier entry in this guide.
