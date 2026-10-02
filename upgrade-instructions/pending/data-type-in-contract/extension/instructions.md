---
changes:
  - id: contract-stores-data-type
    summary: |
      A SQL contract names each column's data type in `dataType` (for example `pg/int4`) instead of
      its database type name in `nativeType`. Run the colocated script on the extension's contract
      space, release the extension against the framework version that contains this change, and
      raise its peer dependency floor to that version: the old framework refuses a rewritten
      contract space and the new framework refuses an old one, so your users upgrade the framework
      and the extension in one step. Publish a `--data-type` line for each codec the extension owns.
    detection:
      glob: "**/*.json"
      matches:
        - '"nativeType"\s*:\s*"'
    script: ./scripts/data-type-in-contract.ts
  - id: column-descriptors-drop-native-type
    summary: |
      `ColumnTypeDescriptor` and authored `storage.types` entries lose `nativeType`, the pack
      metadata loses its `types.storage` list and `StorageTypeMetadata` is deleted, `column()`
      loses its fourth argument, and a codec descriptor's
      `columnFromEntity` returns `{ typeParams }` only. The contract takes a column's data type from
      its codec. A `types` constraint over what `type.*` helpers return is
      `Record<string, AuthoredStorageType>` instead of `Record<string, StorageTypeInstance>`.
      `StorageTypeInstanceInput` is no longer exported; type a stored entry as
      `StorageTypeInstance`, or pass `toStorageTypeInstance` an object literal.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '(?<![\w$])(?<!readonly\s+)nativeType\s*:'
        - '(?<![\w$.])column\s*\((?:[^()]|\([^()]*\))*,(?:[^()]|\([^()]*\))*,(?:[^()]|\([^()]*\))*,\s*[\w''"](?:[^()]|\([^()]*\))*\)'
        - '\bRecord\s*<\s*string\s*,\s*StorageTypeInstance\s*>'
        - '\bStorageTypeInstanceInput\b'
        - '\bStorageTypeMetadata\b'
        - '\bstorage\s*:\s*\[\s*\{\s*typeId\b'
  - id: default-renderer-receives-data-type
    summary: |
      `DefaultRenderer` receives a third argument, `{ dataType, baseTypeName }`: the id of the data
      type the column's codec represents, and its base name (the written name without
      parameters). The Postgres `renderDefaultLiteral` takes `{ many?, baseTypeName, dataType }`
      instead of `{ many?, nativeType, dataTypeId? }`, and `dataType` is required.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\bDefaultRenderer\b'
        - '\brenderDefaultLiteral\b'
        - '\bDefaultColumn\b'
  - id: ddl-column-default-visitor-removed
    summary: |
      `DdlColumnDefaultVisitor`, `DdlColumnRenderContext` and the `accept` method of
      `LiteralColumnDefault` and `FunctionColumnDefault` are removed. Nothing in Prisma Next called
      them.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\bDdlColumnDefaultVisitor\b'
        - '\bDdlColumnRenderContext\b'
  - id: control-family-instance-sign-spaces
    summary: |
      `ControlFamilyInstance` has a new required method, `signSpaces({ driver, spaces })`, which
      writes the marker of every contract space it is given. `db sign` calls it once for all
      spaces, each with the marker `db sign` read before verifying it (`verifiedMarker`), and
      writes a marker only while it still holds those hashes. `SqlControlAdapter` gains
      `lockMarker`. `ControlFamilyInstance.sign`, `ControlClient.sign`, `SignOptions` and
      `SignDatabaseResult` are removed.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\bControlFamilyInstance\s*<'
        - '\bSignDatabaseResult\b'
        - '\bSignOptions\b'
  - id: sqlite-data-types-are-stored-types
    summary: |
      The SQLite target declares only the types SQLite stores, plus the two character types:
      `sqlite/text`, `sqlite/integer`, `sqlite/real`, `sqlite/blob`, `sqlite/character` and
      `sqlite/character-varying`. `sqlite/json`, `sqlite/datetime` and `sqlite/bigint` are deleted:
      a codec, cast or authoring entry that names one fails assembly. The JSON and date-time codecs
      represent `sqlite/text`, the big integer codecs `sqlite/integer`. The date-time canonical form
      moves from `sqlite/datetime` to the codec `sqlite/datetime@1`, whose descriptor declares
      `toCanonicalForm`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '[''"`]sqlite/(?:json|datetime|bigint)[''"`]'
        - '\bsqlite(?:Json|Datetime|Bigint)\.id\b'
  - id: canonical-form-of-a-column
    summary: |
      A column's canonical form comes from one function, `canonicalFormOf(codec, dataTypes)` in
      `@internal/framework-components/codec`: the codec's `toCanonicalForm` when it declares one,
      else its data type's. `CanonicalDateTimeOptions.dataTypeId` is renamed `ownerId`.
      `SqlColumnDefaultIRInput` carries `toCanonicalForm` instead of `dataType`, and
      `SqlColumnIRInput` gains `toCanonicalForm`. `DefaultMappingOptions.columnDataType` is
      replaced by `columnCodec`, the column's codec descriptor.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\bCanonicalDateTimeOptions\b'
        - '\bcanonicalDateTime\s*\('
        - '\bcolumnDataType\b'
        - '\bSqlColumnDefaultIR\b'
  - id: authoring-entry-key-checked
    summary: |
      Assembly refuses an authoring entry filed under the wrong key with
      `CONTRACT.DATA_TYPE_ENTRY_KEY_INVALID`: an entry whose tag names the type it yields (`type`)
      sits under `tagEntryKey(tag)`, and an entry under a data type's id names no `type`.
    detection:
      glob: "**/*.{ts,mts,cts}"
      matches:
        - '\bkind\s*:\s*[''"]tag[''"]'
  - id: db-sign-signs-extension-spaces
    summary: |
      `db sign` now signs every contract space, the extension's included, and only a space whose
      schema verifies. Documentation that describes `db sign` for an extension's space says so.
    detection:
      glob: "**/*.md"
      matches:
        - '\bdb sign\b'
        - '\bfails verify and cannot repair it\b'
---

## `contract-stores-data-type`

Commit your work first, so the script's changes can be reviewed and undone with git. Then run the script from the extension package's root:

```sh
node <path-to-this-guide>/scripts/data-type-in-contract.ts
```

Node 24 or later runs the TypeScript script directly; it needs no `tsx`. It reads and writes files only and needs no database. It rewrites every `*.json` file under the root that parses as a SQL contract in the old format (a column or `storage.types` entry that stores `nativeType`), skipping `node_modules`, `.git`, `dist` and `build`. That includes a test fixture of an old-format contract: if you keep such a fixture on purpose, restore it with git afterwards (`git restore <file>`), or keep it outside the project root.

If the script stops on an error, for example on a full disk, it prints the error and `the upgrade stopped partway, run the script again to finish it`, and exits 1. After an error, Ctrl-C or a crash, run it again: it finishes the upgrade. A file the script was writing at that moment is either unchanged or complete, and it removes its own temporary files (ending in `.data-type-in-contract-tmp`) on the next run.

Run your formatter afterwards. The script replaces text in `migration.ts` and `contract.d.ts`, so the import order in `migration.ts` and the line wrapping in `contract.d.ts` can differ from what a fresh emit and your formatter produce.

When it finishes, it prints how many files it rewrote and how many snapshot directories it renamed, and each storage hash it replaced (`<old> -> <new>`). A contract already in the new format is never changed, even when its stored hash does not match its content, so a project already in the new format is left unchanged, and the script says that nothing changed. If it finds no SQL contract under the root, it says so; run it again from the project root. It prints `<file>: stored hash did not recompute; rehashed from content` for an old-format contract whose stored storage hash does not match its content, and rewrites it anyway. It changes no file and exits 1 when a column uses a codec it does not know (`<file>: unknown codec <id>; name its data type with --data-type <id>=<data type id>`) or when a renamed snapshot directory already exists with different content.

The script knows every codec that Prisma and its own extensions ship. For each codec your extension owns, run the script with `--data-type <codec id>=<data type id>`, naming the data type that codec represents, for example `--data-type acme/shape@1=acme/shape`. Publish those lines in your release notes: your users pass the same options when they run the script on their projects. The option cannot change the data type of a codec the script already knows for a contract's target, but it can name the data type of a shared `sql/*` codec on a target the script does not know.

Release the extension with the rewritten contract space against the framework version that contains this change, and raise the extension's peer dependency floor on the framework to that version. The two versions cannot be mixed: the old framework refuses a contract space that stores `dataType`, and the new framework refuses one that still stores `nativeType`. So a release published early cannot be installed before the framework upgrade. Tell your users to upgrade the framework and your extension in the same step.

## `column-descriptors-drop-native-type`

Delete `nativeType` from every column type descriptor: column type helpers, hand-written descriptors, and enum descriptors.

```ts
// before
export function vector<N extends number>(length: N) {
  return { codecId: VECTOR_CODEC_ID, nativeType: 'vector', typeParams: { length } } as const;
}
const pgText = { codecId: 'pg/text@1', nativeType: 'text' } as const;

// after
export function vector<N extends number>(length: N) {
  return { codecId: VECTOR_CODEC_ID, typeParams: { length } } as const;
}
const pgText = { codecId: 'pg/text@1' } as const;
```

Delete the fourth argument of `column()`, the type name:

```ts
// before
column(pgVectorDescriptor.factory({ length }), pgVectorDescriptor.codecId, { length }, 'vector');

// after
column(pgVectorDescriptor.factory({ length }), pgVectorDescriptor.codecId, { length });
```

Delete the `storage` list from the pack metadata's `types`: nothing reads it, and `StorageTypeMetadata`, its type, is deleted from `@internal/sql-contract/pack-types`. Delete an import that only the list used, and the part of a doc comment that describes the list. Contracts no longer carry `extensions.<pack>.types.storage`; the script removes it from yours.

```ts
// before
types: {
  codecTypes: { import: { package: '@acme/pack/codec-types', named: 'CodecTypes', alias: 'AcmeTypes' } },
  storage: [{ typeId: pgvectorTypeId, familyId: 'sql', targetId: 'postgres', nativeType: 'vector' }],
},

// after
types: {
  codecTypes: { import: { package: '@acme/pack/codec-types', named: 'CodecTypes', alias: 'AcmeTypes' } },
},
```

Delete `nativeType` from each `storage.types` entry of the contract space's source (`src/contract.ts`):

```ts
// before
[PGVECTOR_NATIVE_TYPE]: { kind: 'codec-instance', codecId: VECTOR_CODEC_ID, nativeType: PGVECTOR_NATIVE_TYPE, typeParams: {} },

// after
[PGVECTOR_NATIVE_TYPE]: { kind: 'codec-instance', codecId: VECTOR_CODEC_ID, typeParams: {} },
```

A codec descriptor's `columnFromEntity` returns `{ typeParams }` and no `nativeType`; code that read `nativeType` from its result stops reading it.

A `defineContract` facade that constrains the contract's `types` to what `type.*` helpers return uses `AuthoredStorageType` from `@internal/sql-contract/types`, which has no `dataType`; the contract build adds it:

```ts
// before
type TypesConstraint = Record<string, StorageTypeInstance>;

// after
type TypesConstraint = Record<string, AuthoredStorageType>;
```

Code that builds a stored contract's column by hand, for example a test helper, writes the data type id instead of the type name: `{ dataType: 'pg/int4', codecId: 'pg/int4@1' }` instead of `{ nativeType: 'int4', codecId: 'pg/int4@1' }`, and a contract type written by hand declares `readonly dataType: 'pg/int4'` instead of `readonly nativeType: 'int4'`.

Update doc comments and examples that describe what a helper produces: `// Produces: codecId: 'pg/vector@1', typeParams: { length: 1536 }` instead of `// Produces: nativeType: 'vector', typeParams: { length: 1536 }`.

## `default-renderer-receives-data-type`

```ts
// before
const renderDefault: DefaultRenderer = (def, column) => render(def);
renderDefaultLiteral(value, { many: true, nativeType: 'text', dataTypeId: 'pg/text' });

// after
const renderDefault: DefaultRenderer = (def, column, type) => render(def, type.baseTypeName);
renderDefaultLiteral(value, { many: true, baseTypeName: 'text', dataType: 'pg/text' });
```

`baseTypeName` is the type's written name without parameters, for example `jsonb` or `varchar`. Compare `dataType`, for example `pg/jsonb`, when the decision depends on which type the column stores.

## `ddl-column-default-visitor-removed`

Code that dispatched a column default through `accept` reads its `kind` instead:

```ts
// before
const sql = node.accept({ literal: (n, ctx) => renderLiteral(n, ctx.nativeType), function: (n) => n.expression }, { nativeType: 'jsonb' });

// after
const sql = node.kind === 'literal' ? renderLiteral(node, 'jsonb') : node.expression;
```

## `control-family-instance-sign-spaces`

A family that implements `ControlFamilyInstance` adds `signSpaces`:

```ts
signSpaces(options: {
  readonly driver: ControlDriverInstance<TFamilyId, string>;
  readonly spaces: readonly SpaceToSign[];
}): Promise<readonly SpaceSignature[]>;
```

`SpaceToSign` is `{ space, contract, verifiedMarker }`, where `verifiedMarker` is the marker `db sign` read before it verified the space. The method writes each space's marker with its contract's hashes and returns one `SpaceSignature` per space: `{ status, space, contract: { storageHash, profileHash } }`, where `status` is `created`, `updated` (with `previous`, the hashes the marker held) or `unchanged`. It writes a space's marker only while the marker still holds `verifiedMarker`, and returns `{ status: 'conflict', space, contract, expected, found }` for a space whose marker changed, whether it finds that on reading the marker or when its compare-and-swap write fails. It does not verify the schema; `db sign` verifies every space before it calls the method. A SQL family's control adapter implements `lockMarker(driver)`, which takes the one lock the target's migration runner holds while it reads and writes markers. The SQL family writes every marker in one transaction, so a failed write leaves every marker as it was; the Mongo family writes them one by one, and running `db sign` again finishes the job.

`ControlFamilyInstance.sign`, `ControlClient.sign`, `SignOptions` and `SignDatabaseResult` are removed: a family that implemented `sign` deletes it and keeps `signSpaces`, and code that called `client.sign({ contract })` calls `client.dbSign({ contract, migrationsDir })`, which verifies every contract space and signs each one that verified, as `db sign` does.

## `sqlite-data-types-are-stored-types`

A codec, cast or authoring entry that named one of the deleted types names the type SQLite stores instead: `sqlite/text` for JSON and date-time values, `sqlite/integer` for big integers. The data types are exported from `@internal/target-sqlite/data-types`.

```ts
// before
override readonly dataType = sqliteJson.id;        // 'sqlite/json'
override readonly dataType = sqliteBigint.id;      // 'sqlite/bigint'

// after
override readonly dataType = sqliteText.id;        // 'sqlite/text'
override readonly dataType = sqliteInteger.id;     // 'sqlite/integer'
```

The canonical forms follow the stored type: `sqlite/integer` stores digit text and `sqlite/text` a string. A JSON codec on SQLite stores the JSON text of the document, and a date-time codec its text. `sqlite/text` declares no canonical form, so a codec whose values have several written forms declares one on its descriptor: `sqlite/datetime@1` does, with `toCanonicalForm` (the function that was `sqliteDatetime.toCanonicalForm`). A contract source, `db verify` and DDL use a codec's canonical form before its data type's.

```ts
import type { ToCanonicalForm } from '@internal/framework-components/codec';

// your function: written text in, the one text the contract stores out; it throws
// CONTRACT.CAST_REFUSED for text the codec does not hold
declare const datetimeCanonicalForm: ToCanonicalForm;

export class MyDatetimeDescriptor extends SqliteCodecDescriptor<void> {
  override readonly dataType = sqliteText.id;
  override readonly toCanonicalForm = datetimeCanonicalForm;
  // codecId, traits, the JSON projection and the factory follow
}
```

## `canonical-form-of-a-column`

Read a column's canonical form through `canonicalFormOf`, and pass the renamed options:

```ts
// before
canonicalDateTime(text, { shape: 'instant', dataTypeId: 'acme/instant' });
mapDefault(stored, { dataTypeEntries, dataTypeLookup, columnDataType: codec.dataType });
const toCanonical = codec.toCanonicalForm ?? dataTypes.get(codec.dataType)?.toCanonicalForm;

// after
canonicalDateTime(text, { shape: 'instant', ownerId: 'acme/instant' });
mapDefault(stored, { dataTypeEntries, dataTypeLookup, columnCodec: codec });
const toCanonical = canonicalFormOf(codec, dataTypes);
```

## `authoring-entry-key-checked`

An entry whose tag yields a type that another entry already holds under that type's id, as SQLite's `json` tag yields `sqlite/text`, moves under its tag's key and names the type it yields:

```ts
import { tagEntryKey } from '@internal/framework-components/authoring';

// before
[sqliteJson.id]: {
  written: { kind: 'tag', tag: 'json', parse: parseJsonBody },
  print: printJsonBody,
  documentation: 'Reads the body as a JSON document and stores it as the default value.',
},

// after
[tagEntryKey('json')]: {
  written: {
    kind: 'tag',
    tag: 'json',
    type: sqliteText.id,
    parse: (text) => canonicalizeJson(parseJsonBody(text)),
  },
  print: (value) => String(value),
  documentation: 'Reads the body as a JSON document and stores its JSON text as the default value.',
},
```

An entry under a data type's id keeps naming no `type`. Any other combination fails assembly with `CONTRACT.DATA_TYPE_ENTRY_KEY_INVALID`.

## `db-sign-signs-extension-spaces`

`db sign` signs the contract space of every extension in the project together with the application's, and signs a space only when its schema verifies; a space that does not verify is reported with its differences and the command exits with code 4. If your extension's documentation explains what happens when a user's database does not match your contract space, add that `db sign` does not sign the space either. The Supabase extension's `src/contract/CONTRACT-FIDELITY.md` adds this sentence at the end of the paragraph that says a database with a different constraint set fails verify:

> `db sign` signs a contract space only when its schema verifies, so such a database cannot be signed for this pack's space either: `db sign` signs the application's space, reports this one with its differences and exits 4.
