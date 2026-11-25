# ADR 324 — The same coordinate is the same object

**Status:** Accepted. Built on PostgreSQL, SQLite and MongoDB.
**Builds on:** [ADR 264 — A model names its storage verbatim, and a rename is an operation](ADR%20264%20-%20A%20model%20names%20its%20storage%20verbatim%2C%20and%20a%20rename%20is%20an%20operation.md), [ADR 224 — Control policy](ADR%20224%20-%20Control%20Policy%20%E2%80%94%20framework-locked%20vocabulary%20and%20family-owned%20dispatch.md), [ADR 188 — MongoDB migration operation model](ADR%20188%20-%20MongoDB%20migration%20operation%20model.md)

## At a glance

A user keeps `model User` and changes only the table it is stored in:

```prisma
// origin                          // destination
model User {                       model User {
  id    Int     @id                  id    Int     @id
  email String  @unique              email String  @unique

  @@map("users")                     @@map("people")
}                                  }
```

On PostgreSQL, `prisma migration plan` and `prisma db update` both plan these operations, with no question and no statement (as `--json` reports them):

```json
[
  { "label": "Rename table \"users\" to \"people\"", "operationClass": "widening" },
  { "label": "Rename primary key \"users_pkey\" to \"people_pkey\" on \"people\"", "operationClass": "widening" },
  { "label": "Rename unique constraint \"users_email_key\" to \"people_email_key\" on \"people\"", "operationClass": "widening" }
]
```

The `migration.ts` that `migration plan` writes contains the call a user would have written by hand:

```ts
...this.renameTable({ schema: 'public', table: 'users', to: 'people' }),
```

The rows are still there after the migration is applied. A field whose `@map` changes is planned the same way, as a column rename, and an enum member whose stored value changes (`ARCHIVED = "archived"` to `ARCHIVED = "old"`) has the value replaced in every column the enum types.

## Decision

An origin object and a destination object with the same coordinate are the same object. When its stored name or stored value differs between the two contracts, the planner renames the storage or replaces the stored value. It asks nothing.

A coordinate is the name the user wrote in the contract source, as the code calls it:

- `ModelCoordinate`: a model's namespace and name.
- `FieldCoordinate`: a field's name within its model.
- `EnumValueCoordinate`: an enum member's name within its enum.

The stored name is the name in the database: a table or collection (`@@map`), a column or document key (`@map`). The stored value is what an enum member is stored as, written `ACTIVE = "active"`.

A `--rename` statement pairs two objects whose coordinates differ. The same coordinate pairs two objects with no statement. After that, both kinds of pair are planned the same way, by comparing their stored names in the two contracts. No new operation is added.

## Which objects are paired

| Object | Paired by, in this order |
| --- | --- |
| Model | a model rename statement; else a namespace rename statement and the same model name; else the same coordinate; else, on MongoDB, the same storage |
| Field of a paired model | a field rename statement; else the same field name |
| Field of an embedded model (MongoDB) | the same field name in the same embedded model |
| Enum member | an enum value rename statement; else the same member name |

On MongoDB a root model paired only by the same storage gives questions and refusals as before this rule, never a rename with no question: no field is renamed with no statement, so a field whose stored name changes is removed and asked about, while fills and type changes still match its fields by name, as before. A variant paired by storage is renamed as any other pair. Pairing by storage does not guess identity in the sense the principles forbid: it pairs only a model that no statement and no same name pairs, and the plan still asks about what it removes. A variant's documents carry its discriminator value, so they are known to be that variant's, while a root model's documents hold nothing that names it, which is why only a variant's pair gives renames. Fields pair through their model's pair, whichever other rule made it. When `--rename User:Account` renames a model and one of its fields changes only its `@map`, that field is paired by its name and its column is renamed.

A namespace has no stored name apart from its id, so it has no change of stored name alone. The SQL family has no pairing by storage.

## Storage is renamed only when all of it moves

A table, collection or column can be shared. SQL variants stored in their base's table share it, and may share a column. MongoDB variants share their base's collection, and several MongoDB root models may share one collection. A rename moves everything stored there. So a table, collection, column, document field or key is renamed only when both of these hold:

1. Every origin object stored in the old name that the destination keeps is stored in the new name in the destination. An object the destination removes does not block the rename. Its rows move with the table, and the plan asks about them as usual.
2. Every destination object stored in the new name is new, or comes from the old name.

One rename is planned for the storage, not one per model or field. A name the rename frees may be used by a new object in the same plan; on MongoDB a collection name may not, as [What MongoDB does differently](#what-mongodb-does-differently) says.

When only some of the objects move, or objects from elsewhere join them, the storage is being split or merged. That is a data migration, which a plan does not write. No rename is planned, and the plan is the storage diff, with a question for each model or field whose data it drops. When a statement asks for such a rename, as `--rename Bug:Defect` does for a variant stored in its base's table when `Defect` has a table of its own, the statement is refused: renaming the table would move every other variant's rows with it.

A dropped table or collection that several models store their data in is asked about once for every model that loses data, so `--delete` names each of them. MongoDB does this. The SQL family names only one of the models today, which is a gap, not a difference between the families; the project's deferred list records it ("SQL: a dropped table shared by several models asks about one of them").

A pair is made only when the control policy is `managed` for the old table under the origin contract and for the new table under the destination contract.

## What a pair plans

A pair with the same coordinate plans what a rename statement for the same two stored names plans. The companion renames (primary keys, unique constraints, foreign keys, indexes and checks whose names come from the table or column name), the rendering in `migration.ts` and the checks at apply time are the same code.

- **A stored name and something else change together.** The rename is applied to the planner's working copy of the start schema first, and the diff then sees the renamed object. A changed column type becomes an alteration of the renamed column, which asks a question only when the type change can lose data, as it would on its own.
- **A model's `@@map` changes and a field rename statement is given.** The table is renamed first, then the column on the renamed table.
- **A field is removed in the same change.** Its question names it by its origin model and field, `User.nick`, as after a statement rename, and `--delete User.nick` answers it.
- **Enum members.** A member that keeps its name and changes its stored value has the value replaced in every column the enum types in a table whose control policy is `managed`. A column in a table the contract does not manage keeps the old value; the plan does not write to that table, so the user rewrites its values. Values that shift along a chain (`ACTIVE` takes `archived` while `ARCHIVED` takes `old`) are rewritten last value first. A new member may take a value an existing member gives up.
- **Reporting.** No statement was given, so the rename is not listed under `Statements applied` or in `appliedStatements`. It is in the operation list.

Operations run in this order:

1. Namespace rename statements.
2. Table renames from pairs with the same coordinate.
3. Model and field statements, in the order given.
4. Column renames from pairs with the same coordinate.
5. Stored value replacements, in the order the planner computes for them.

Table renames come before the statements, so a field statement on a model whose `@@map` changed finds its table already renamed.

## One check over all renames

Before any rename is applied, one check runs over all the renames of the plan: those from statements and those from pairs with the same coordinate. It compares names the way the target compares them, so on SQLite two names that differ only in ASCII case are the same name. A rename from a pair with the same coordinate is refused when:

| Case | Example | Refusal |
| --- | --- | --- |
| Swap or chain | `User` moves to `accounts` and `Account` moves to `users`, or to `members` | `Cannot rename table "accounts" to "users": table "users" is renamed in the same plan` |
| Takeover | `Account` is removed, and `User` moves to `accounts` | `Cannot rename table "users" to "accounts": the schema being planned from already has a table "accounts"` |
| Chain with a statement | `User` moves to `people` while `--rename Account:Member` gives `Member` the table `users` | `Cannot rename table "users" to "people": another rename in the same plan takes table name "users"` |
| `db update`, both names in the database | the database has both `users` and `people`, and the origin contract has only `users` | `Cannot rename table "users" to "people": the database has both tables` |

The same cases are refused for columns, and in both directions for a chain with a statement. Rename statements among themselves are planned in the order the user gives them, as before.

A statement and a model that keeps its name can also move into one new table, as when `User` moves to `people` while `--rename Member:Person` gives `Person` the table `people`. That merges two tables' rows, so it is not in the table above: the statement is refused (`statementRefused`), as [Storage is renamed only when all of it moves](#storage-is-renamed-only-when-all-of-it-moves) says, with `Cannot rename table "members" to "people": table "people" also stores model "public.User", whose rows are not in table "members"`. Columns are the same.

Each refusal is a `MIGRATION.PLANNING_FAILED` conflict of kind `unsupportedOperation`, with no `refusedStatement`, and its text names the contract change, never a statement. It says why the plan would read the rows of one table as rows of another model, and gives a route that works on both commands: make the change in two plans through names nothing uses, such as `prisma_swap_users`, each planned and applied before the next. For a takeover, the first plan removes the model or field that holds the name, which the text names by its contract name (`first remove model "public.Account"`), or keeps it and changes its table or column to a name nothing uses.

Enum members are checked inside the enum. Members that move stored values in a cycle, such as two members that swap values, are refused, with the same two-plan route through a value no member stores (`prisma_swap`, or the next integer for a number). A member that takes a stored value another member of the origin enum holds, when no change in the plan moves that value away, is refused, since their rows would merge. That includes a member the destination removes; then the route is to remove it in one plan and change the other member in the next. The first plan asks about the removed member's rows. Answered with `--delete`, a column that takes no NULL cannot keep them, so the text says to delete them, or set them to the other member's old value to merge their data on purpose, before that plan applies.

A refusal offers only a route a user can follow to the end on every target that prints it, with only what the text gives. So neither enum refusal offers a hand-written migration that rewrites the values itself: on PostgreSQL an enum stored as text or a number has a check constraint that lists its values, a rewrite through a value no member stores breaks it, and the text cannot give the name of the constraint the destination contract expects. The planned routes drop and add those constraints themselves.

Swaps, chains and takeovers of tables and columns could be planned, with an order or a temporary name. The planner does not work that order out for tables and columns, so they are refused. It already orders chains of enum values, which is why those are planned.

## `db update` and a database that does not match the origin

For `db update`, the planner's working copy is the live database, which can differ from the origin contract, for example after a user renamed a table by hand. A rename from a pair with the same coordinate does this:

| Live database | What the plan does |
| --- | --- |
| Old name present, new name absent | Plans the rename. |
| Old name absent, new name present | Plans nothing for it. The rename is already done. The planner still records that the origin model is now in the new table, as a planned rename does, so field renames on it, questions about it and `--delete User.field` answers work. |
| Both absent | Plans nothing for it. The diff creates the table, as for any new table. |
| Both present | Refused, unless the origin contract has the new name too, when the swap and takeover refusals above apply. The text gives the two possible causes apart, each with its fix, and says which table holds the model's rows in each. If the rename was half done by hand, or something created the new table, the old table holds them: move into it the rows of the new table that it does not already hold, keep the version you want of a row both tables hold, drop the new table, and run again. If the old table was renamed by hand and its name then used for another table, the new table holds them: drop the old table, after moving the rows of that other table into a table the contract has, since `db update` drops every table the contract does not have, and run again. The text for columns is the same: it copies a value of the new column only into a row whose old column holds none, and where both hold a value, the user keeps the one they want. |

In the second row the planner takes the new table to be the old one renamed. Nothing is planned for the table itself, but the rest of the plan acts on it: field renames, stored value replacements and the answers to `--delete` questions rewrite or remove data in it. So if a table or collection with the new name exists that was never the old one renamed, the plan rewrites it as if it were. This holds on every target.

## What MongoDB does differently

MongoDB takes the same rule: a collection rename for a model, a `$rename` of the stored key for a field, a rename of the key in every place an embedded model is stored for its field, and a value replacement for an enum member. It differs where its storage differs.

- **Enum chains are refused.** MongoDB applies a migration's operations one at a time, with no transaction, and knows that an operation already ran only from the documents. A rewrite of a value that another rewrite of the same migration writes would act on what that one wrote if the migration runs again after a later operation stopped. So values that shift along a chain, which SQL rewrites last value first, are refused on MongoDB, with the two-plan route through a value no member stores ([ADR 188](ADR%20188%20-%20MongoDB%20migration%20operation%20model.md)).
- **Root models may share a collection with no discriminator.** Nothing in a document says which root model it belongs to, so every root model stored in the collection reads every document in it. A collection rename moves them all, so `--rename` of one such model while another stays is refused. A root model the destination removes does not block a rename: the models that remain read the documents they read before. Which other models count as sharing a collection's documents differs by check. The rewrites the rewrite check refuses (renames, value replacements, removals, casts and fills) count only the models the destination stores in the collection, as they did before this rule; field renames count the same models. A model new to the collection counts too, because the planner cannot tell a new model with no documents from one whose documents a hand-written move copies in; to rename such a field, rename it in an earlier migration, before the model is added. Variant deletes and discriminator replacements keep the stricter check they had before, narrowed only by the models the destination removes: they select documents by a discriminator value, and the documents a model that moves out leaves behind can match it, so every model the destination keeps counts, wherever it stores it. That the other rewrites reach the documents a moving model leaves behind is part of the known gap about a model leaving a shared collection. A takeover counts every origin model, since a removed model's documents still hold its keys: removing that model does not free the name. A root model that moves to a collection of its own is planned as the storage diff makes it, with no rename: its documents stay in the shared collection, and it starts with none in its new one. A field of it whose stored name changes is removed from the shared collection and asked about, and refused when the model that stays holds the same key. Moving them is a data migration, recorded as a gap in the project's deferred list.
- **A freed collection name is not used again in the same plan.** A collection rename runs again, after a later operation of the migration stopped, only while its old collection exists and its new one does not. Once the plan creates a collection under the old name, or renames another collection to it, a stopped migration cannot be run again to finish. SQL runs the whole migration in one transaction, so it plans this. On MongoDB it is refused, with two plans: the rename first, then what uses the old name. A field or key name freed by a rename may still be used by a new field: a rename skips the documents that no longer hold the old key, so a stopped migration runs again to the end, and a fill that writes the old name is refused by the overlap check above.
- **A boolean enum whose two values trade places is refused with no route.** There is no third value to move through, and a swap has no state a check can read, so no migration that makes it could run again after a stop. As on SQL, the refusal offers no hand-written rewrite of the values: it says to keep the stored values of the enum in the contract.

## Where the rule does not apply

- **No origin contract.** With no snapshot of the contract the database is at, there is no coordinate to compare, and nothing is paired. A dropped table is named by its storage name. `MIGRATION.TABLE_NAME_CASE_CHANGED` still refuses a plan that drops one table and creates another whose name differs only in the case of the first letter. With an origin contract, a model that keeps its name is renamed instead, so that check is in practice reached only without one.
- **Storage the contract does not manage.** When the control policy is not `managed` on both sides, no pair is made, and the plan is what the storage diff makes of the change under that policy. Where it drops the old table, the question carries `keepDataAdvice`, which says how to rename the table by hand. On MongoDB, a key of an embedded model stored in a collection the contract does not manage is not renamed, and a swap of such keys plans nothing.
- **Targets with no rename planning.** The MySQL target has no rename operation and refuses every statement. A stored-name change there is planned as a drop and a create, with the same by-hand advice. This is an exception to the rule, not a consequence of it, and it lasts until MySQL plans renames.
- **A native PostgreSQL enum type whose `@@map` changes.** No operation renames an enum type, and a native enum is not fully managed ([ADR 286](ADR%20286%20-%20Prisma%208%20does%20not%20fully%20manage%20native%20Postgres%20enums.md)).
- **A discriminator value.** It is not the stored name of a coordinate. A changed value stays a question answered by `--convert`.
- **A model that moves to another namespace, or any object whose coordinate changes.** The namespace is part of the coordinate, so this takes a rename statement, as before.
- **Indexes and constraints with an explicit `map:` name.** They were already renamed or recreated with no question.

## Why

- **The contract is where the user states intent.** The user wrote the same name on both sides. Reading that as one object is not a guess. Every other part of planning already pairs models and fields by name; a change of stored name was the one place that treated the object as new.
- **The contracts hold the whole answer.** The old and the new stored names are both in them. A statement would make the user type a fact the planner can read.
- **A rename keeps the data.** A user who wants an empty table can remove the model in one change and add it back in a second. A drop cannot be undone.
- **The check closes silent damage.** Without it, a swap of two tables' names left each table in place, holding the other model's rows, with no question asked.

## Consequences

- Changing `@@map`, `@map` or an enum member's stored value on PostgreSQL, SQLite and MongoDB no longer asks a question, and the by-hand advice for it is gone. A script that passed `--delete User` to allow the old drop and create now fails with `CLI.CONSENT_UNUSED`, since nothing asks about `User`.
- A `--rename User:User` statement is still `MIGRATION.STATEMENT_INVALID`. Its text says that a model or field that keeps its name needs no statement when only its stored name changes.
- A project with an origin snapshot that still has the table names an earlier release gave models with no `@@map` (the first letter lowered) gets its tables renamed to the model names, with no question. To keep the old names, add `@@map` before planning.
- Swaps, chains and takeovers that used to plan with no question are refused.
- No target produces a `KeepDataEdit` for an enum member that keeps its name, and the CLI no longer gives its own route for one. `KeepDataEdit.swapsValues` stays in the framework, unset.
- `migration plan` writes nothing when the origin and destination storage hashes are equal. A swap of two tables, columns, collections or fields of identical shape leaves the storage section unchanged, so `migration plan` reports no change and the rows are read as the other model's, while `db update` refuses it. This is not solved yet.
- On MongoDB, `--rename` of a model whose collection another model shares is refused, where it used to move the other models' documents with it. Enum stored values that swap or chain, which used to be asked about with advice to use two migrations, are refused with a two-plan route.

## Alternatives considered

- **A statement that names storage**, such as `--rename storage/users:app_users`. It would make the user type the old and new stored names, which the two contracts already hold. It is still the answer for a plan with no origin contract and for storage the contract does not model, so it may be built later. The `storage/` prefix would keep a table name apart from a model of the same name, and the question would print the subject with the prefix so the user copies it whole.
- **A declaration in the schema**, such as Atlas's `renamed_from` or Terraform's `moved` block. It records a fact the contracts already show when the coordinate is kept, and it has to stay in the schema until every environment has applied it.
- **Keep the question.** The plan dropped and created the table and asked the user to allow it, and the only way to keep the data was by hand. Every user who changed `@@map` either lost rows or wrote the rename themselves.
