# Project spec: data types own column types

**Linear:** project [Data types own column types](https://linear.app/prisma-company/project/data-types-own-column-types-2e1b16116e13); planning ticket TML-3385; slices in order TML-3386, TML-3388, TML-3387, TML-3389. **Design:** [`design.md`](design.md). **Plan:** [`plan.md`](plan.md). **Evidence:** [`research.md`](research.md) and [`inventory/`](inventory/). **Decision record:** [`design-notes.md`](design-notes.md).

## Purpose

Every fact about a database type is declared once, by the pack that owns the type, and every tool reads that declaration. Today the name of a column's database type is written or computed in eight places that disagree, so adding a type means editing several tables, extension types are invisible to `contract infer`, and `db verify` compares strings.

## At a glance

A data type declares its name, the texts a database reports for it, its parameters and how its name is written:

```ts
export const pgTimestamptz = sqlDataType('pg/timestamptz', {
  params: temporalPrecision,                       // precision 0 to 6
  texts: [
    { text: 'timestamptz', written: true },
    { text: 'timestamptz({precision})', written: true },
    { text: 'timestamp with time zone', catalog: true },
    { text: 'timestamp({precision}) with time zone', catalog: true },
  ],
  casts: { [pgText.id]: unchanged },
});
```

A contract column names the data type, not a string:

```json
{ "codecId": "pg/timestamptz-temporal@1", "dataType": "pg/timestamptz", "typeParams": { "precision": 3 }, "nullable": false }
```

With pgvector in the stack, a `vector(1536)` column verifies by exact equality and infers as:

```prisma
embedding pgvector.Vector(1536)
```

## Non-goals

- Retiring `types {}` aliases or field presets, or adding mixins (TML-3055). Both keep working.
- Changing how values are stored or compared: canonical forms of date and time types (TML-3302), codec strictness (TML-3300), and reading or rendering default values (TML-3253). The data type owns its canonical form and its casts (ADR 254); the codec reads, writes and checks values; a data type never parses or prints SQL value literals.
- Mongo casts, written values, or any change to the collection validator's format.
- New data types for Postgres types nobody claims today (`money`, ranges, `tsvector`, domains, composite types, interval with fields, `geography`, `halfvec`).
- Rewriting database ledger rows. Databases are re-signed.
- Policy `permissive` and other block settings.

## Place in the larger world

- **Builds on** ADR 254 as shipped in #30350, ADR 129 (tagged literals), ADR 231 (attribute specifications), ADR 208 (codec instances from parameters).
- **Replaces** ADR 171's `expandNativeType` hooks.
- **Depends on** TML-3253 being merged before slice 3 (TML-3387) starts, and TML-3367 (the `dataTypeValue` argument building block, from the SQL expression literals project) before slice 4 starts.
- **Is depended on by** TML-3055, whose type constructors need data types to own names and parameters.
- **Closes** TML-3283 with the answer "no: a data type never parses or prints SQL value literals; the codec reads and writes values".

## Cross-cutting requirements

1. **One source per fact.** After the project no production code holds a table of database type names, and no type name is written in two places. The grep checks in each slice enforce this.
2. **Migration SQL does not change** for any existing column. A data type's written name is the name contracts store today. Two exceptions, both fixes: a `typeRef` column whose type has no parameters is no longer written as a quoted name (design 3.6); and on SQLite a `BigInt` column's literal default is written as bare digits (`DEFAULT 42`), like an `Int` column's, because both codecs store digit text after slice 2 (design 9.3).
3. **Exact comparison.** `db verify` compares a data type id and normalised parameters by equality. Other names are used only while reading a database.
4. **Extensible by declaration.** An extension's data type is recognised by introspection, verify and infer with no change outside the extension. No production code names a type it does not own.
5. **No SQL words in the framework layer.** Names, texts and rendering live in the SQL family's data type; the framework `DataType` gains only the parameter schema. `pnpm lint:framework-vocabulary` must not rise.
6. **Targets declare column types; the family declares none** and exports shared helpers. The SQL family's `sql/expression` (TML-3296) is the type of a written SQL expression value, never a column's type: it has no texts and is neither written nor reported, and assembly refuses a SQL stack in which a codec represents it.
7. **A column's data type is what the database stores.** On SQLite that is `text`, `integer`, `real`, `blob`, and the two character types.
8. **No backward-compatibility shims.** An old-format contract is refused. The refusal does not mention the upgrade script.
9. **Tests against a real database** for everything that reads or writes database text.
10. **Tests before implementation**, each red before the change that makes it green.

## Transitional-shape constraints

- After slice 1, `contract.json` is unchanged: the column still stores `nativeType`, written from the data type. `pnpm fixtures:check` shows no contract change.
- The contract format, the SQLite data type correction, `db sign` over every space and every hash change land together in slice 2, so users upgrade once.
- In slice 2 `db verify` still compares type text; exact comparison of data type ids arrives in slice 3, after SQLite's data types are the ones the database stores.
- Slices 3 and 4 change no contract.

## Contract impact

`StorageColumn` and `StorageTypeInstance`: `nativeType` removed, `dataType` added (slice 2). `extensions.<pack>.types.storage` removed. SQLite literal defaults of JSON and integer columns change stored form. Every SQL storage hash, migration hash, snapshot directory name and ref changes. Mongo contracts do not change.

## Adapter impact

Postgres and SQLite targets gain the data type declarations and type constructors; their adapters lose them, the rendering hooks and the introspection normalisers. pgvector, postgis and arktype-json lose their rendering hooks; pgvector and postgis declare names and parameters. Mongo data types declare BSON type names.

## ADR pointers

ADR 171 is marked superseded by ADR 254 in slice 1. ADR 254 is amended in slice 2 (status Accepted; the declaration; the SQLite paragraph; the stored column; assembly) and slice 3 (claiming by kind; parameter normal forms; printing and the failure on unclaimed types).

## Project definition of done

- TML-3386, TML-3388, TML-3387 and TML-3389 merged.
- The four grep checks in `plan.md` return only their allowed lines on `main`.
- Manual QA, recorded: a project created with the last release before slice 2, with pgvector and an applied migration, upgrades by running the script and `db sign`, after which `db verify`, `migrate` and `migration status` succeed; the same on a database with PostGIS; the Prisma 7 side-by-side flow (`prisma7 migrate dev`, then `db sign`) after slice 3.
- ADR 254 status is Accepted and its text matches the code.
- Final retro recorded; every decision in `design-notes.md` mapped to a durable home in the close-out pull request.
