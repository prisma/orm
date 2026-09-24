---
changes:
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
---

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
    fallbackFunctionAttribute: formatDbGeneratedAttribute,
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

A value no entry writes, or one that does not read back as the stored value, comes back as `{ comment }` rather than `{ attribute }`, which is the signal to fall back to the raw database default. `formatLiteralValue` and the per-PSL-type formatter table a target printer used to supply (`PslDefaultValueFormat`, `formatPslValue`, `formatPslListLiteralValue`) are gone; delete them.

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
  override readonly paramsSchema: StandardSchemaV1<void> = voidParamsSchema;
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
