# ADR 264 — A model names its storage verbatim, and a rename is an operation

## Decision

A model names its table, or its MongoDB collection, exactly as the model is written. A different storage name is always stated with `@@map`.

```prisma
model UserProfile {
  id    Int    @id
  email String
}
```

That model reads and writes the table `"UserProfile"`. To point it at another table, the schema says so:

```prisma
model UserProfile {
  id    Int    @id
  email String

  @@map("user_profiles")
}
```

Changing a model's storage name is a rename of existing storage, not a new table. The user states the rename in a migration:

```ts
override get operations() {
  return [
    ...this.renameTable({ table: 'userProfile', to: 'UserProfile' }),
  ];
}
```

## Why

Prisma 8 does not transform identifier case implicitly. Fields take the field name, native enums take the block name, TypeScript authoring takes the model name, and a Prisma 7 schema read as a contract source takes the names Prisma 7 used. A storage name that differs from the name in the schema is information only the author has, so the schema carries it.

A rule that lowered the first letter of a model name produced storage names that match no convention: neither the snake_case a SQL schema usually uses, nor the PascalCase an earlier Prisma version created. It also made `contract infer` emit a contract that could not verify. Infer writes `@@map` when the model name it derives differs from the table name it read; for a table already named `"UserProfile"` the two are identical, so it wrote no `@@map`, and the contract then named a table that did not exist.

## How a rename works

`this.renameTable({ table, to })` reads the migration's start and end contracts and returns several operations: the table rename, then a rename for every object whose name the planner derives from the table name and that the migration leaves otherwise unchanged. `ALTER TABLE ... RENAME TO` renames none of them, and a later plan looks for names derived from the new table name, so without these the next migration that touched one would fail.

| Object | Postgres | SQLite |
|---|---|---|
| Table | `ALTER TABLE ... RENAME TO`, schema-qualified | `ALTER TABLE ... RENAME TO`; a change of ASCII case only goes through a temporary name, because SQLite compares identifiers folding ASCII case |
| Unnamed primary key, unique constraint, foreign key | `ALTER TABLE ... RENAME CONSTRAINT` | Renamed by the database with the table |
| Index with a derived name | `ALTER INDEX ... RENAME TO` | Dropped and recreated, because SQLite cannot rename an index |
| Check constraint with a derived name | `ALTER TABLE ... RENAME CONSTRAINT` | Carried by the table rebuild |
| Row-level security settings and policies | Carried to the new table name | Not applicable |

An object the migration also changes keeps the name the database has, so an author writing that change by hand refers to the name they can see. Explicitly named objects, and foreign keys on other tables that point at the renamed table, keep their names.

The migration must reach its end contract. The runner applies a migration's operations together and then verifies the database against that contract, so a migration whose operations leave any part of the change unapplied is rolled back, the rename included. A rename can therefore sit beside other operations in one migration, as long as the migration carries every operation its end contract needs. The simplest way to satisfy that is to make the rename its own schema change, which is what the planner's refusal message recommends.

## Why the user states the rename

The planner cannot infer one. Indexes and check constraints carry a hash of their content in their names, so a renamed index can be paired with the name it had. Tables carry no such identity: a dropped table and a created table with the same columns may be one table renamed or two unrelated tables. Guessing would carry rows into the wrong table.

The planner instead refuses the dangerous plan. When a plan would drop table `X` and create table `Y` in the same namespace, where `X` is `Y` with its first letter lowered, planning fails with `MIGRATION.TABLE_NAME_CASE_CHANGED`. That shape is the signature of a schema written against a lowering rule, and the message gives the three ways forward: add `@@map` to keep the table, state the rename in a migration, or rename the storage by hand and run `db update` again. This check is transitional and goes away once no supported upgrade path reaches the old rule.

A schema that declares no `@@map` and whose storage was created under the lowering rule is brought up to date by adding `@@map("<current storage name>")` to each such model, which changes no emitted artifact, no storage hash and no migration history.

## Consequences

- A model with no `@@map` names storage that can be quoted exactly as written, which is what a database created by an earlier Prisma version holds.
- `contract infer` round-trips: a table whose name already equals the model name infers with no `@@map` and verifies clean, and a snake_case table still infers with `@@map`.
- A rename needs a hand-written migration. The user states one line per renamed table and the operations follow from the contracts.
- MongoDB has no rename operation. A collection is renamed outside Prisma, with `renameCollection`.

## Alternatives considered

- **Keep the lowering rule and write `@@map` from `contract infer` whenever the model name does not round-trip.** This repairs infer but leaves a default that matches no convention, contradicts every other authoring surface, and surprises anyone reading a schema without one.
- **Infer a rename from a drop and a create whose columns match.** Two unrelated tables can have the same columns, and a wrong guess moves rows into the wrong table. A guess that cannot be verified is worse than a refusal that names the fix.
- **State the rename on the command line, for example `migration plan --rename old=new`.** The command line belongs to the framework CLI, which serves every family, so a flag naming tables puts one family's vocabulary in a shared surface; MongoDB accepted such a flag and planned a collection drop. It also duplicates the planner hint below.

  > **Update — 2026-10:** renames are now stated on the command line after all, as `--rename <old>:<new>` on `migration plan` and `db update`. A statement names models and fields, not tables, so no family vocabulary enters the shared CLI, and a statement that resolves to nothing is an error. It drives the rename operation this ADR introduces. See [Migration System § Statements](../subsystems/7.%20Migration%20System.md#statements).

- **A planner hint in the contract source.** An annotation such as `@hint(was: "userProfile")` would let `migration plan` and `db update` rename without a hand-written migration. It is the intended direction and is recorded in the Data Contract and Migration System subsystem documents and in [ADR 001](ADR%20001%20-%20Migrations%20as%20Edges.md). It needs its own decisions first: the syntax in PSL and in TypeScript authoring, whether the hint names the old model or the old storage, how a hint reaches an offline planner without entering `contract.json` or its hashes, and what a hint that matches nothing means. The rename operation is the part a hint would drive, so it is built first.

  > **Update — 2026-10:** a contract-source hint is no longer the direction. Renames are stated on the command line as statements (see the note under the previous alternative), and nothing in the contract source records them. See [Migration System § Statements](../subsystems/7.%20Migration%20System.md#statements).
