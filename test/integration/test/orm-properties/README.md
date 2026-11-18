# Generated tests of the SQL ORM client

These tests generate schemas, rows and ORM calls with [fast-check](https://fast-check.dev) and check properties that need no hand-written expected result. Each runs on SQLite and on Postgres.

| Test files | Property |
| --- | --- |
| `capabilities.*.test.ts` | A sequence of calls gives the same results and the same rows on the client's own ORM and on an ORM whose contract lacks some capabilities. After every call that returns rows, each row equals the row read by its key straight after. |
| `reads.*.test.ts` | A read agrees with the same rows read another way. |
| `nested.*.test.ts` | A write with relation callbacks stores the same rows as the same writes made one call at a time. |
| `values.*.test.ts` | A value of every scalar type is returned as stored, is stored again unchanged, reads the same through an include, and is found by an equality filter. |
| `known-failures/*.test.ts` | Typed examples of what the tests above found, marked `it.fails`. |

## Capabilities

The ORM client builds a call differently depending on what the contract's capabilities report. A sequence of calls runs once on the client's own ORM and once on a varied ORM, against the same database, and the two runs must agree after every call on:

- what the call returned, or the error code it was rejected with;
- the rows of every table.

Each sequence is compared under one of three variations (`variations` in `capabilities.ts`):

| Variation | Capabilities removed | What changes in the ORM |
| --- | --- | --- |
| without returning | `returning` | a write reads its rows back with a `SELECT` |
| with one query per included relation | `outerReferencesInDerivedTables`, `jsonAggWithoutTruncation` | includes load with one statement per relation and are attached in the client |
| both | all three | what MariaDB's adapter reports |

A call the varied ORM refuses with `ORM.CAPABILITY_MISSING` is skipped on the client's own ORM, and must leave every table unchanged.

## Reads

After a generated sequence of writes, `reads.ts` checks, on the client's own ORM:

- an include, with its order and limit, equals reading the related rows of each parent separately;
- pages read with `limit` and `offset`, or with `cursor`, put together equal the unpaged rows;
- the rows matching a filter, its negation and, for a nullable field, the null check are all the rows, each once;
- `every(p)` matches the rows `none(not p)` matches, and `some(p)` and `none(p)` together match every row;
- `count`, `sum`, `min` and `max` equal the same figures computed over `all()`;
- `groupBy(field)` with a count equals grouping `all()`.

## Nested writes

`nested.ts` takes one generated `create` or `update` with relation callbacks and runs it twice from the same rows: once as written, and once as separate calls (`SeparateWrites`). The separate calls create or look up a row the record holds the key for first, then write the record, then apply each operation on the other relations in order: a `create` or `update` of the related rows' foreign key, a write of a junction row for a many-to-many relation, or `updateAll` and `deleteAll` with a filter on the relation. When both succeed, every table must hold the same rows; when one is rejected, the other must be rejected too.

## Values

`values.ts` puts one nullable field of every scalar type on a model, with generated type parameters, and for each generated value requires:

- `create` returns what a read by key returns;
- storing that read value in a second row reads back the same;
- both rows read through an include of their parent hold the same value, which checks that the codec decodes a value from the include's JSON as it decodes it from a column;
- for a type with equality, a filter on the read value finds both rows, in the object form and in the callback form.

A value the codec or the database refuses is skipped; a type none of whose values was stored fails the test.

## What is generated

- **Schemas** (`schemas.ts`, `scalar-types.ts`):
  - two to four models, plus one junction model per many-to-many relation;
  - a key per model: one field of a generated type, a database-generated integer, or two fields;
  - an optional unique field, and two to four more fields whose types cycle through every scalar type of the target, with generated type parameters and nullability;
  - polymorphic models: about one model in four gets a discriminator and one to three variants, each with fields of its own, stored in the base table or in a table of its own;
  - one to five relations: one-to-many, one-to-one or many-to-many, between two models or from a model to itself, optional or required, with generated referential actions. A relation to a model with a two-field key has a two-field foreign key.

  Each schema is written as PSL, emitted with `prisma contract emit`, and pushed to an empty database through the planner.
- **Calls** (`programs.ts`, `arbitraries.ts`): creates, updates, deletes, upserts and reads as data, derived from the schema, on a model or on one of its variants. Filters compare fields or go across relations with `some`, `none` and `every`, to any depth, and a nested create or an include has no fixed depth limit either. Most keys in a call name an existing row.
- **Existing rows:** each sequence comes with a valid set of rows. Before either run they are created through the client's own ORM, so that rows the varied ORM cannot create, such as a variant stored in its own table, exist in both runs.
- **Execution** (`run-on-orm.ts`): turns a call into `db.orm` method calls.
- **Comparison** (`capabilities.ts`): runs a sequence on both ORMs and compares.

The varied ORM is `orm()` over the client's runtime and a context whose contract has the capabilities removed, because a client always adds its adapter's capabilities to the contract.

## What a run must reach

With the default seed, each test fails when the run did not reach a listed case (`each-schema.ts` and the test files). On SQLite the list has a stored value of every scalar type, each kind of key and relation, each nested operation through each kind of relation, writes on variants in both kinds of table, and filters across relations. Postgres runs fewer sequences and has a shorter list. The failure prints the counts of everything that happened and one example message per rejection code.

## Seeds and reproducing a failure

The seed is `1` unless `ORM_PROPERTIES_SEED` is set, so a run is the same every time. Set another seed to try other schemas and sequences. A failure prints the schema, its index, the seed and a path:

```bash
ORM_PROPERTIES_SEED=<seed> ORM_PROPERTIES_SCHEMA=<index> ORM_PROPERTIES_PATH=<path> pnpm test test/orm-properties/sqlite.test.ts
```

`ORM_PROPERTIES_RUNS` sets the number of sequences per schema, and `ORM_PROPERTIES_UNSHRUNK=1` stops at the first failing sequence without minimizing it. A sequence is minimized; a schema is not.

## What the generators avoid

**Known failures.** Each has a test marked `it.fails` in `known-failures/`, which starts failing when the ORM changes, and the generators leave the input out so that one known failure does not stop a run:

| Failure | Left out of generation |
| --- | --- |
| SQLite: a `BigInt` outside ±(2^53 − 1) is stored, then `create` and every read of the table throw `RangeError` | `BigInt` values outside that range |
| Postgres: a `TimeTemporal(p)` value from `23:59:59.5` up is rounded to `24:00:00`, which the codec refuses to read | times from `23:59:59` up |
| `deleteAll` returns a row another deleted row's `onDelete: SetNull` changed with its foreign key `null` with `RETURNING`, and as it was before the delete without | cascading actions on a relation from a model to itself |
| `update` of a key that `onUpdate: Cascade` propagates to the same row returns the foreign key as written with `RETURNING`, and as stored without | the same |
| `create` and `createAll` on a variant stored in its own table ignore `select` and return every field | `select` on those creates |
| SQLite: a `sql.Char(n)` value is read without its trailing spaces, and a filter on the value read does not find the row | trailing spaces in `sql.Char` values |
| `create` on a variant stored in its own table with a relation callback is refused with `ORM.FIELD_UNKNOWN` | relation callbacks on those creates |

**Calls the types reject.** The calls are made through loosely typed interfaces, so a generated call can be one TypeScript refuses. The generators avoid the ones found so far, all about a field a variant declares: it is not accepted in `update`, `updateAll` or `upsert` data, in the object form of `where`, or in `select` on a variant. The types also reject `include` on a variant collection, so calls on a variant are generated without one; before `create` or `createAll` of a variant stored in its own table it is ignored. The first two are refused with `ORM.FIELD_UNKNOWN`; a `select` of such a field on `update`, `updateAll`, `delete` or `deleteAll` of a variant stored in its own table reaches the database and fails with `no such column` when the statement has `RETURNING`.

**Refused by a codec.** Postgres `IntervalString` refuses a negative duration such as `-PT5S`.

## Limits

- Postgres runs fewer schemas and sequences than SQLite. All schemas share one PGlite dev server, whose shutdown takes most of the test's time: it sends every row change to a local stream before it closes, and `@prisma/dev` has no option to turn that off.
- A row of a variant stored in its own table cannot be created without `returning`, so those creates are skipped in both runs; such rows come only from the existing rows.
- On Postgres every key is given by the caller. A generated key cannot be read back there without `returning`, and a sequence value used by a failed statement would differ between the two runs.
- Not generated: relations declared on a variant, junction models with fields of their own, `onConflict: 'skip'`, native enums, extension types, and ordering comparisons in filters.
- MySQL has no path with `returning`, so it is not covered.
