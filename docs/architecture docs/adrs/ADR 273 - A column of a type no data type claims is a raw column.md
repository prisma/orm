# ADR 273 — A column of a type no data type claims is a raw column

## Decision

A column whose database type no data type in the stack claims is a raw column. Its data type is `sql/raw`, with one parameter, `sql`: the column's type exactly as the database catalog prints it. Its codec, `sql/raw@1`, passes values through unchanged, and the ORM types them `unknown`. Migrations create the column from the `sql` text, and `db verify` compares that text with the catalog's.

In a Prisma 8 schema, a field declares one with `Raw(...)`, whose argument is a `sql` literal (ADR 268), because the text is SQL the database reads:

```prisma
model Category {
  id        Int           @id @default(autoincrement())
  name      String
  path      Raw(sql`ltree`)
  search    Raw(sql`tsvector`)?
  area      Raw(sql`circle`) @default(sql`'<(0,0),1>'::circle`)
  tags      Raw(sql`"MyTag"[]`)
  embedding Vector(1536)?

  @@map("categories")
}
```

The contract stores each raw column like any other:

```json
"path": {
  "dataType": "sql/raw",
  "typeParams": { "sql": "ltree" },
  "codecId": "sql/raw@1",
  "nullable": false
}
```

A Prisma 7 schema's `Unsupported("ltree")` field is read as a raw column with no field (ADR 267), because Prisma 7's client never shows such a field.

## Why

A Prisma 7 project may have columns of types Prisma does not model: `ltree`, `hstore`, `tsvector`, the geometric and range types, a domain or composite type of its own. Prisma 7 declares them with `Unsupported("<type>")`. Prisma 8 must be able to describe them, or such a project cannot adopt it; and a Prisma 8 project may need such a column too.

Every Prisma 8 contract must be verifiable: `db verify` must be able to tell whether the database matches it. A raw column meets that rule. The contract records the column's type as text, and verify compares it with the text the catalog prints. What Prisma 8 gives up is interpreting the values, not knowing the column.

Every part of the system already works through a column's data type and codec. The planner renders a column's type in DDL from the data type it is stored as (`renderSqlTypeName`). Verify and the planners compare two columns by the data type each is stored as and its parameters (`sqlColumnTypesEqual`, ADR 254). The runtime writes and reads values through the codec, and the emitted types come from it. A raw column supplies a data type and a codec like any other column, so none of these needs a special case.

## The data type and the codec

`sql/raw` is a SQL data type (ADR 254) whose name in SQL is its `sql` parameter, written as given. Every other data type writes its name from a fixed pattern such as `vector({length})`; `sql/raw` declares `nameIsCatalogText`, has no texts, and renders the parameter itself. Its catalog text is the parameter too, so verify's expected text is exactly what the author wrote. The data type claims no reported type: introspection never reads a column as `sql/raw` on its own, and `contract infer` refuses a type no data type claims. The SQL family contributes the `Raw` type constructor for PSL and the TypeScript builder (``type.Raw(sql`tsvector`)``), not marked as inferred; the Postgres and SQLite adapters also export ``rawColumn(sql`tsvector`)``. Its argument is a value of `sql/expression` (ADR 268), read by the cast rule like any type-constructor argument that is a value (ADR 254), so only a `sql` literal is admitted: `Raw("tsvector")` is refused with ``Expected sql`...`; write sql`tsvector` ``.

None of this is keyed on `sql/raw`. A data type declares `nameIsCatalogText`, and every consumer reads that declaration: such a type's catalog text is what it renders; it has no base name, since its parameters cannot be separated from its name; verify compares its name with the reported text; SQLite writes it as given instead of in upper case; and Postgres sends its parameters without a cast. Another data type that declares it is treated the same way.

The `sql` text must be one type name, and the data type's parameters accept only texts of that form, so every source refuses any other: PSL, the TypeScript builder, a hand-written `contract.json` and an `alterColumnType` call marked `raw: true`. That call is more lenient in one way: it trims spaces around the text and accepts spaces inside a trailing `[ ]` (TML-3677). The text is words of letters, digits and underscores, or double-quoted names with each double quote inside doubled, as Postgres prints them (`"a""b"`), separated by single spaces; the first may follow one schema name and a dot; each may be followed by parentheses holding only letters, digits, underscores, commas, spaces and a minus sign before a digit; and one `[]` may end it. `double precision`, `timestamp(3) with time zone`, `geometry(Point,4326)`, `numeric(10,-2)`, `app.email` and `"my,type"[]` are accepted. Outside a double-quoted name, single quotes, dollar quoting, operators and every other character are refused. The check is an allowlist of type-name forms, not a SQL parser: words such as `integer UNIQUE` pass it and add a clause to the DDL. Verify after the migration then finds the column's type is not the text, and the migration's transaction rolls back.

The text must also be the type as the catalog prints it: `integer`, not `int4`; `character varying(10)`, not `varchar(10)`. Other columns compare by data type: the database side gets the data type that claims the type it reports, so `int4` and `integer` are both `pg/int4`. A raw column cannot compare that way, because `sql/raw` claims no reported type, and a raw text may name a type another data type claims, such as ``Raw(sql`integer`)``. So the contract-derived column of a type that declares `nameIsCatalogText` carries the text it expects as its `catalogText`, and `sqlColumnTypesEqual` compares it, exactly and with `[]` for a list, with the other column's catalog text or the text the database reports. A text in any other form reports a mismatch, and the finding names both texts. On SQLite the reported type is the declared type, which migrations write as given, so the comparison is exact there too, case included: a column declared `CIRCLE` does not match ``Raw(sql`circle`)``.

A `sql` literal holds double quotes as written, so a type whose name needs quoting, such as one with capital letters, is written ``Raw(sql`"MyType"`)``, and `contract print` writes it the same way.

For a base type the text names no schema. Introspection reports a base type from outside `pg_catalog` without its schema, as it does for the types extensions provide, so `ltree` matches whether the type lives in `public` or in `extensions`. Migrations write the text as given, so the type is found through the database's `search_path`, as it is for every extension type and as it was under Prisma 7. A type that is not a base type, such as a domain, an enum or a composite type, is printed with its schema when that schema is not on the `search_path`, so its text names the schema: `app.email`.

`sql/raw@1` writes and reads wire values unchanged (`toWire`, `fromWire`), except a SQLite BLOB in an include, described below, and its values are typed `unknown`. A raw value has one shape per target, the same flat and through an include, so a value read can be written back. On Postgres it is the text the type's output function prints. The runtime driver returns every column as that text on a flat read, and the codec projects a raw value in an include through the same output function (`format('%s', …)`), where Postgres' own JSON form would give `integer` as a number and `boolean` as `true`. On SQLite a value keeps the shape the driver returns for its storage class: a number for INTEGER and REAL, a string for TEXT, a `Uint8Array` for BLOB, and null for NULL. SQLite's JSON functions reject a BLOB, so an include projects a BLOB as a one-element array of its uppercase hex text, as a `blob` column's include does, and the codec's `fromWire` turns it back into a `Uint8Array`. A column value never reaches the JSON constructor as an array, so the array cannot be mistaken for another value. A raw parameter is sent without a cast in every position, a list included, so Postgres parses it with the column's own input function; a cast such as `$1::character varying(3)[]` would truncate. The codec declares no traits, so the ORM offers no filters or ordering on a raw column; a query that needs them uses SQL.

A raw column's default is a `sql` expression (ADR 268), written as given. A literal default is refused, because the data type has no literal values. The data type owns the rule: its reader refuses every value with `CONTRACT.LITERAL_VALUES_ABSENT`, so the codec's `toDataTypeValue` refuses every literal. The TypeScript builder reaches the refusal through the codec, and loading a hand-written `contract.json` reaches it when the contract's defaults are read through their data types; PSL's cast rule refuses a written literal earlier, since the data type declares no casts (``Expected sql`...` ``). Each refusal says to write the default as `sql`.

A change from one raw text to another plans `ALTER COLUMN ... TYPE`. When Postgres has no cast between the two types it refuses the alter, and the author writes the conversion with `--convert`, as for any type change that needs one. The `alterColumnType` call the planner writes marks the type with `raw: true`, and a raw type is checked afterwards as written. Every other type is checked through the data types that read it, so a misspelt type in a hand-written call, such as `varchr(10)`, is still refused when `migration.ts` runs.

## The Prisma 7 reader

The reader (ADR 252) turns `Unsupported("X")` into a raw column with `sql: "X"`, and gives the model no field for it. Prisma 7's generated client leaves such a field out of the model's rows and inputs, and leaves out `create`, `createMany` and `upsert` when the field is required and has no default. So the Prisma 8 ORM shows the model with the shape the Prisma 7 client had.

The reader reads `Unsupported` as written. It does not substitute a data type an extension pack provides, even where one claims the text, as pgvector claims `vector(1536)`. Moving such a column to its real type is a choice the author makes when converting to a Prisma 8 schema.

The reader reads `Unsupported("X")` as the SQL family's ``Raw(sql`X`)``, so the text is checked as any `Raw` text is, and the column is kept like an `@ignore` field's (ADR 267): on its model's table, with its uniques and indexes, and with no field.

Prisma 7 accepts only `@default(dbgenerated("..."))` on an `Unsupported` field. The reader lowers it to a `sql` expression default, and refuses any other default, `@db.*` and `@updatedAt` on such a field, as Prisma 7 does. It accepts `@ignore` on an `Unsupported` field, which Prisma 7 refuses, because the column already has no field and the meaning is not in doubt.

A model needs a field that identifies a row, so `@id` or `@@id` over an `Unsupported` field is refused on a model that is not `@@ignore`; the edit is `@@ignore` on the model, which keeps its table and primary key. A relation that is not `@ignore` cannot join on an `Unsupported` field, because Prisma 8 relations join on fields; the edit is `@ignore` on the relation field, which keeps its foreign key. Prisma 7 accepts both, so both are Prisma 7 edits with no migration.

Prisma 7 never compares an `Unsupported` type with the database: its migrations write the text into DDL as given, and its diff plans nothing when the text changes, even from `tsvector` to `circle`. So a Prisma 7 schema may hold an `Unsupported` text that does not match the database, and Prisma 8's `db verify` is the first to report it. Correcting the text in the Prisma 7 schema makes Prisma 7 plan nothing.

## Consequences

- A Prisma 7 project with `Unsupported` fields can adopt Prisma 8. Its raw columns are created, verified and kept, and its query code sees the models it saw before.
- A Prisma 8 schema can declare any column type the database has, without waiting for a data type.
- `contract print` writes a raw column a field maps as ``Raw(sql`...`)``. A raw column read from Prisma 7 has no field, and `contract print` refuses it until Prisma 8 PSL can declare a column with no field, so such a project keeps its Prisma 7 schema as the contract source until then.
- A required raw column with no default and no field makes every ORM insert into its table fail. The lowering warns about it (`PN_COLUMN_REQUIRED_UNMAPPED`), as it does for any such column (ADR 267). Prisma 7 left `create` out of the client instead.
- After Prisma 8 owns a project's migrations, changing a raw column's text changes the column's type, and the planner must plan it. Under Prisma 7 the same edit did nothing.
- A raw text that is not the catalog's form, such as ``Raw(sql`int4`)``, is accepted by emit and plan, because neither has a database to ask. The check after the migration finds `integer`, so the migration fails when it runs, and `db verify` names the text to write. TML-3675 tracks reporting it earlier for types the stack's data types read.
- A raw column's type must be on the `search_path` that migrations run with. A project that installs a type in a schema outside that path must add the schema to it, as it must for an extension type.
- Choosing `Raw(...)` over a data type the stack has is the author's call. Nothing refuses ``Raw(sql`vector(1536)`)`` when pgvector is installed.

## Alternatives considered

**Keep refusing such columns.** A Prisma 7 project with one `ltree` column could not adopt Prisma 8 until someone wrote a data type and codec for `ltree`, and the only way to add one is an extension pack.

**A column with no data type or codec.** Every consumer reads a column through its data type and codec: the planner, verify, the runtime and the emitter. A column without them needs a special case in each.

**Read `Unsupported` as a field.** Prisma 7's client never had the field, so reading a Prisma 7 schema would change the model's shape in the Prisma 8 ORM.

**Substitute a data type the stack provides.** `Unsupported("vector(1536)")` could become pgvector's vector type when pgvector is installed. The author wrote that Prisma should not interpret the column; the real type is theirs to choose when they convert.

**Refuse `Raw(...)` for a type a data type claims.** It would keep raw columns to types Prisma 8 cannot model, but it takes the choice away from the author for no gain in safety: the column is verified either way.

**Normalize the `sql` text through the database before comparing.** `'int4'::regtype` would let authors write any alias. It needs a database round trip wherever the text is compared, and requiring the catalog's form is simpler and explicit.

**Write the text as a quoted string, `Raw("ltree")`.** This was the first form. A PSL string does not read as SQL: it is a value of a text type, and a type name that needs double quotes would need escapes inside it. The text is SQL the database reads, so it is a `sql` literal, as every other place that takes SQL is (ADR 268).

**Call it `opaque`, `passthrough`, `untyped` or `native`.** `opaque` and `passthrough` describe the codec, not the column. `untyped` is wrong: the column has a type. `native` fits every column. A raw `hstore` column, set with raw SQL, names what it is.
