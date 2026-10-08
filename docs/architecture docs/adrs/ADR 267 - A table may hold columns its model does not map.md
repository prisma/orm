# ADR 267 — A table may hold columns its model does not map

## Decision

A model maps to a table, and the table may hold columns the model does not map. A table may have no model at all. Such storage is part of the contract's storage plane like any other: migrations create and manage it, `db verify` expects it, the storage hash covers it. The ORM reads, writes and types only the columns a model's fields map.

A contract source written for Prisma 7 is the source that produces such storage. Prisma 7 marks a field `@ignore` to keep it out of the client while its column stays in the table, and marks a model `@@ignore` to do the same for a whole table:

```prisma
model User {
  id         Int     @id
  email      String  @unique
  legacy_key String? @ignore
}

model AuditRow {
  id         Int      @id
  recordedAt DateTime @map("recorded_at")

  @@map("audit_rows")
  @@ignore
}
```

A contract has a storage plane and a domain plane (ADR 221). The storage plane lists tables, columns, keys and constraints. The domain plane lists models, fields and relations, and each field names the column that holds it. The source above lowers to:

| Storage plane | Domain plane |
|---|---|
| table `User`: `id`, `email`, `legacy_key` | model `User`: fields `id`, `email` |
| table `audit_rows`: `id`, `recorded_at` | no model |

Each consumer reads one plane. Migrations, `db verify` and the storage hash read storage, so they create, verify and fingerprint `legacy_key` and `audit_rows`. The ORM and the emitted types start from the domain and reach storage only through a field's column, so to them neither exists:

```ts
const users = await db.public.User.all();                     // [{ id: 1, email: '...' }]
type UserKeys = keyof (typeof users)[number];                  // 'id' | 'email'

await db.public.User.create({ email: 'a@b', legacy_key: 'x' } as never);
// throws ORM.FIELD_UNKNOWN: Model "User" has no field "legacy_key"

db.public.AuditRow;                                            // not a property, in code or in types
```

The storage shape gains nothing. A column with no field, or a table with no model, is such storage by that fact alone, and `contract.json` already represents it. Two terms are used below: an *extra column* is a column of a modelled table that no field maps, and a *table with no model* is what it says.

Prisma 8's own contract sources, PSL and the TypeScript DSL, have no form that declares an extra column or a table with no model. Whether they should, and what it looks like, is a separate decision; the candidates are listed under alternatives. This decision covers the contract, the lowering, the Prisma 7 reader and the ORM.

## Why

Every database holds objects the application must not touch: a column kept for an audit process, a column in the middle of a rename, a table another process writes inside the schema Prisma migrates, and the record of applied migrations that Prisma 7 keeps in `_prisma_migrations`. A Prisma 7 source marks these `@ignore` and `@@ignore`, and that source is read into a Prisma 8 contract (ADR 252), so the contract has to carry them with the same meaning: in the table, migrated with it, invisible to the application. Prisma 7 itself migrates an ignored field's column, so a Prisma 8 contract that left it out would plan its drop.

The separation of the storage plane from the domain plane exists for this. Storage is what the migration system receives, and it must be complete and unambiguous on its own. Domain is what the application sees. A column the application must not see is a storage fact with no domain counterpart, and the contract says exactly that: it describes the table, not a field the model is told to hide.

## How a contract is assembled

Every source lowers to one data structure, `ContractDefinition`, and one function, `buildSqlContractFromDefinition`, turns it into a contract. ADR 181 makes the definition the shared lowering target so that parity between sources is structural: two sources that produce the same definition produce the same contract. That holds only if every input passes through the definition and the same lowering, so storage without a field goes into the definition as authored nodes, beside the definition's existing storage members, and is lowered by the same code that lowers a field's column.

The definition gains two node kinds:

- **A column node** is a `FieldNode` without the field's identity: the column name, its type descriptor, nullability, multiplicity, an authored default, and `noCheck`. It is addressed to a table in a namespace. An `@ignore` field becomes one.
- **A table node** is the table half of a `ModelNode`: namespace, table name, column nodes, primary key, uniques, indexes, checks, foreign keys and control policy. An `@@ignore` model becomes one. A foreign key, whether on a model or a table node, may target a table by name as well as a model, because an extra column or a kept field's column may reference a table with no model.

The lowering merges a table's declared columns with the columns its model's fields imply before any column is lowered, and lowers a table node through the same steps as a model's table. So one pass produces every column's data type, encoded default, derived checks and value set, and every table's index and check names and backing indexes, whichever node kind the input came from. A column present as both a field and a column node is refused. A table node naming a table a model maps is refused, so one declaration owns each table's table-level properties. A single-table variant does not own its table, so a column node is addressed to the base, and a collision between a column node and a variant's field names the variant. Table names are unique per namespace, and a table node carries its namespace as a `ModelNode` does.

Because the lowering is the same, one equation holds: lowering a model with a field equals lowering the model without the field plus the same column as a column node. The storage plane is equal, not only its hash. This is what makes exposure free to change: adding or removing `@ignore` moves one column between a field and a column node, plans no migration and leaves the marker valid. The equation is tested as a matrix that compares the storage plane with deep equality for every column kind the lowering treats specially: a scalar, a list, an enum, a named storage type, a value object, a literal and a function default, a column inside a foreign key with a backing index, a column inside an authored index, a column on an inheritance base table and on a multi-table variant's table, and a column on a table that is not `managed`.

`contract print` lowers the contract's models and prints as storage whatever the contract's storage plane holds beyond what they imply. `contract infer` does the same from a database: tables it can model become models, and the rest stays storage.

## The Prisma 7 reader

The reader lowers an `@ignore` field to a column node on the model's table with the field's type, nullability and default, and an `@@ignore` model to a table node with its columns, keys, indexes and foreign keys. A relation field pointing at an ignored model is still left out of the domain, but the foreign key under it is kept, targeting the table by name, because Prisma 7 created that constraint. An index or unique over an ignored field is valid storage and is kept. A primary key over an ignored field is refused, because the model would then have no identity among its fields and could not be updated, deleted or related.

A column whose Prisma 7 type has no Prisma 8 codec cannot become a column node, since every storage column carries a codec. The reader reports it as today and leaves it out, whether or not it is ignored; this is the one fidelity gap `@ignore` cannot close, and a column without a codec is its own decision.

`_prisma_migrations` is Prisma 7's record of applied migrations. The reader declares it from the target binding with the `observed` policy: present on a database Prisma 7 built and absent on a fresh one, never created, altered or dropped by Prisma 8, never reported by `db verify`.

A contract read before this decision carries a storage hash computed without the ignored objects. The first plan after the reader starts declaring them contains no DDL and records the new hash.

## Keeping the ORM to the domain

A model's columns are the columns of its own fields and of the fields it inherits, on each table it reads. Models inherit: a single-table variant shares its base's table and adds fields to it, and a multi-table variant has a table of its own holding its fields and the key it inherits. So the set a query reads from a table is worked out per model: the model's fields on that table, its variants' fields on that table, and, on a multi-table variant's table, the inherited key. The default projection, `RETURNING` lists and `include` joins use that set and nothing else.

Every name a caller supplies as a field resolves through one resolver that throws `ORM.FIELD_UNKNOWN` for a name that is not a field of the model. Nothing falls back to treating the name as a column, and row mapping never passes through a column that maps to no field. That covers `create`, `update` and `upsert` data, `where` and `orderBy` in both shorthand and callback form, `select`, `distinct`, `groupBy`, `cursor`, aggregates, `conflictOn`, nested `select` under `include`, and relation filters. The types already reject such names; the runtime check is what stops a request body passed straight to `create`, or any untyped caller, from reaching an extra column by its column name. The relation lowering refuses a join column that is not a field for the same reason.

Two validators let the ORM's write path rest on the contract. Every field has a storage entry, so a field is never assumed to be a column of the same name. And an execution default, a value the ORM fills in on create or update, targets a column some field maps, because the ORM writes no other column. A required extra column with no database default on a table some model maps makes every ORM insert fail, so the lowering warns about it; it is not refused, because Prisma 7 allows it.

The ORM may touch an extra column inside a query it builds, for example the row-number subquery behind `distinct` reads every column of the table, but it never returns one in a row, assigns one in a write, or accepts one's name from a caller.

## Types

The emitted `contract.d.ts` and the no-emit `SqlContractResult` both omit extra columns from the ORM's model, row and input types and omit tables with no model from the model map. Their storage types keep them: the SQL query builder addresses storage, and a migration author or raw-SQL caller needs the names. A model with no fields, or no relations, is typed as `{}`, never `Record<string, never>`, whose `keyof` is all of `string` and would let a row or create type accept any key.

## Verify and control policy

Strict verify asks whether the contract declares each database object, and declaration is a storage fact, so extra columns and tables with no model are declared and never unclaimed.

Who manages the storage is a separate question from whether the application sees it. An extra column takes its table's control policy, as every column does under ADR 224, and a table with no model carries its own, defaulting to `managed`: a Prisma 7 `@ignore` column is migrated and must survive a rebuild from `migrations/`. ADR 224's rejection of per-column policy stands; nothing here needs a `managed` table with an `external` column.

## Junction tables

A junction table for an implicit many-to-many relation is a model. The lowering requires it to be a declared model, the relation's `through` resolves by model, and the ORM joins through its fields; the Prisma 7 reader synthesises that model with its two key fields. ADR 174 left open whether a junction appears as a model, leaning towards not. It does, and a table with no model is declared as a table node, never through a relation. Whether a junction model is an aggregate root follows ADR 174's root rules, unchanged.

## Consequences

- Adding or removing `@ignore` or `@@ignore` in a Prisma 7 source changes no storage, no hash and no migration history.
- A contract read from a Prisma 7 source keeps every ignored object that has a codec and declares `_prisma_migrations`, so strict verify passes on the database Prisma 7 built.
- A column name passed where a field name belongs is an error at runtime as well as in the types.
- `ContractDefinition` carries column nodes and table nodes beside models, and one lowering produces every column and table.
- A junction table is a model, which closes the question ADR 174 left open.
- A column whose type has no codec is not covered. That is its own decision.
- Prisma 8 PSL and the TypeScript DSL cannot yet declare an extra column or a table with no model. That is its own decision.
- MongoDB's storage plane declares collections and indexes, not fields, so a field the application must not see has no storage representation to declare; this decision is SQL-only.

## Alternatives considered

- **A field the model is told to hide.** A flag on a field node, or `@ignore` as a Prisma 8 attribute, describes storage as domain with a negation. It needs a model to carry it, so a table with no model becomes a model with invented field names, and the vocabulary names the thing by what the ORM refuses to do. Storage declared in storage terms needs neither.
- **A flag on storage tables and columns.** The storage plane would record a decision the ORM makes, the two planes could disagree, and the storage hash would change when exposure changed, so every `@ignore` edit would plan a migration.
- **Control policy instead of exposure.** Marking the objects `tolerated` or `external` satisfies verify, but those policies mean migrations do not manage the object, and an ignored column is managed. The two answer different questions.
- **Leaving the objects out of the contract and verifying leniently.** The planner then treats them as foreign, dropping or re-creating them as the schema edits around them, and strict verify can never pass.
- **Declared storage in the contract's own storage input shapes.** Those shapes are the output of lowering: data types, encoded defaults, derived checks and hashed constraint names. Each source would have to compute them, parity would be fixture-tested again, and the equation above would fail for any column with a derived check or an encoded default. Column and table nodes go through the lowering instead.
- **Storage entering the lowering without passing through the definition.** The Prisma 7 reader would lower the models it maps and hand ignored storage to a later step directly. That is a second lowering path, and ADR 181's parity argument covers only what passes through the definition.
- **The Prisma 7 reader appending tables after the contract is built.** It would be a second assembler: it would re-hash, re-validate and resolve its own foreign keys, and a foreign key between an ignored table and a modelled one would need both to agree.
- **A type-level guarantee only, keeping column-name fallbacks in the ORM.** `create(req.body)` and any JavaScript caller would write and read extra columns, which is the data the concept exists to protect.
- **Exposure per table in the ORM.** A multi-table variant's table has no field describing its key, so its `RETURNING` list is empty and `create` fails, and two models over one table would see each other's columns.
- **Hiding extra storage from the SQL query builder's types.** The query builder addresses storage; hiding storage from it would split one storage description in two and remove the way to read an extra column on purpose.
- **Prisma 8 authoring forms, deferred.** Two candidates exist. One declares the storage with its type: an `sql { }` block inside a PSL model and a `table` block beside models, twinned with `columns` in the TypeScript `.sql({ ... })` stage and a `table(...)` declaration. The other names columns without a type, `@@ignore(["legacy_key"])` on a model, which cannot create the column on a rebuild and so describes a column the contract tolerates rather than one it manages; it is closer to the answer for a column without a codec than to this decision. Neither is decided.
