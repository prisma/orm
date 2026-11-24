# Slice spec — A changed stored name is planned as a rename

**Project:** [`projects/migration-statements/`](../../spec.md) · **Decision record:** [`storage-naming.md`](../../storage-naming.md) (Will, 2026-11-18) · **Code map:** `wip/stored-name-renames/code-map.md` (not committed; claims below about today's code come from it and from the two design reviews, with file and line) · **Design reviews:** `reviews/design/architect-review.md` and `principal-engineer-review.md` (not committed); their findings are folded in, see "Review record" · **Branch:** `tml-3839-stored-name-renames`, from `main` · **Linear:** [TML-3839](https://linear.app/prisma-company/issue/TML-3839) (PostgreSQL and SQLite), [TML-3840](https://linear.app/prisma-company/issue/TML-3840) (MongoDB)

Two pull requests against `main`, one after the other: the SQL family first, then the MongoDB target.

## At a glance

```prisma
// origin                          // destination
model User {                       model User {
  id    Int    @id                   id       Int    @id
  email String @map("email")         email    String @map("email_address")
  @@map("users")                     @@map("app_users")
}                                  }
```

```text
$ prisma migration plan --name tidy
✔ Planned 4 operation(s)
  Rename table "users" to "app_users"                              widening
  Rename constraint "users_pkey" to "app_users_pkey"               widening
  Rename column "app_users"."email" to "email_address"             widening
  Rename constraint "users_email_key" to "app_users_email_address_key"   widening
```

No question is asked and no statement is passed. `prisma db update` plans the same operations against a live database. The written `migration.ts` contains `this.renameTable(...)` and `this.renameColumn(...)`, as it does for a `--rename` statement. On MongoDB the same change plans `renameCollection` and a `$rename` of the stored key. Today both families plan a drop and a create and ask the user to allow the data loss, and the only way to keep the data is by hand.

The operation names and the exact companion renames above are illustrative. They are whatever a `--rename` statement produces today for the same pair of stored names.

## Terms

- **Coordinate.** The name the user wrote in the contract source, as the code already calls it (`ModelCoordinate`, `FieldCoordinate`, `EnumValueCoordinate`): a model's namespace and name, a field's name within its model, an enum member's name within its enum.
- **Stored name.** The name in the database: a table or collection, a column or document key. `@@map` sets a model's and `@map` a field's.
- **Stored value.** What an enum member is stored as, written `ACTIVE = "active"`. Enum members take no `@map`.
- **Statement.** A `--rename`, `--delete`, `--convert` or `--backfill` flag on `migration plan` or `db update`.
- **Origin and destination.** The contract the database is at, and the contract being planned to.
- **Paired.** An origin object and a destination object the planner treats as one object.
- **Working schema.** The planner's copy of the start schema that renames are applied to before the storage diff runs. For `migration plan` it is built from the origin contract. For `db update` it is the live database.

This spec says "a pair with the same coordinate" for the new case. That phrase is for this document only. It is not a name for a type, a function or a message; the implementation uses the code's existing words (rename, origin, destination), and messages describe the change ("the table of model `User` changes from `users` to `app_users`").

## Chosen design

### The rule

**An origin object and a destination object with the same coordinate are paired. When a paired object's stored name or stored value differs between the two contracts, the planner renames the storage or replaces the stored value. It asks nothing.**

A rename statement pairs two objects with different coordinates. The same coordinate pairs two objects with no statement. After pairing, both are planned the same way: by comparing the stored names in the two contracts. So this slice adds no new operation. It adds a second source of pairs.

Pairing order, per kind:

| Object | Paired by, in this order | Compared | SQL family | MongoDB |
| --- | --- | --- | --- | --- |
| Model | a model rename statement; else a namespace rename statement and the same name; else the same coordinate; else, MongoDB variants only, the same storage (the rule of prisma/orm#31061, unchanged) | table, collection | rename table | rename collection |
| Field of a paired model | a field rename statement; else the same field name | column, document key | rename column | rename field (`$rename`) |
| Field of an embedded model (MongoDB) | the same field name in the same embedded model | key inside the subdocument | not applicable | rename stored key, in every place the type is stored |
| Enum member | an enum value rename statement; else the same member name | stored value | replace stored value | replace stored value |

- Fields pair through their model's pair, whichever rule made it. A field of `User` whose `@map` changes while `--rename User:Account` renames the model is paired by its field name, on the pair `User`/`Account`.
- MongoDB's pairing by storage compares collections after renames. Renames from same-coordinate pairs count there, as statement renames do today.
- The SQL family has no pairing by storage.
- A namespace has no stored name apart from its id, so it has no stored-name-only change.

### Storage is renamed only when all of it moves

A table, collection or column can be shared: SQL single-table variants share the base's table and may share a column, MongoDB variants share the base's collection, and MongoDB root models may share one collection. A rename moves everything stored there. So:

**A table, collection or column is renamed only when both of these hold. One rename is planned for the storage, not one per model or field.**

1. Every origin object stored in the old name that the destination keeps is paired with a destination object stored in the new name. An object the destination removes does not block the rename: its rows move with the storage and are asked about by `--delete` as usual. On MongoDB a root model the destination removes does block the rename of a collection it shares with no discriminator, since its documents would move with the collection as another model's.
2. Every destination object stored in the new name is new or is paired with an origin object stored in the old name.

A name freed by the rename may be taken by a new object, so the old name may still be used in the destination by something new; on MongoDB, not a collection name (see "Freed and reused").

When only some of the objects move, or objects from elsewhere join, the storage is splitting or merging, not being renamed. That is a change of storage mode (a variant moving between its base's table and its own, a model leaving a shared collection), which the design notes already list as a data migration that statements do not offer. No rename is planned for it, and the plan is what it is today: the storage diff, with its questions.

This also fixes a defect in statement renames today. `--rename Bug:Defect`, where `Bug` is a single-table variant and `Defect` gets its own table, renames the base's table and takes every variant's rows with it (shown by the probe in `wip/stored-name-renames/pe-probes/`). The same condition now applies to statement pairs. A statement that fails it is refused, with a message that says the model's storage is shared and the change is a data migration.

### What a pair with the same coordinate plans

**It plans what a rename statement for the same two stored names plans today.** Companions, order within the plan, rendering and the checks at apply time are the same code path.

- **Companions.** Constraint, index and check renames, foreign key retargeting, row-level security policies and validators follow as they follow a statement rename.
- **A stored name and something else change together.** The rename is applied to the working schema first, and the storage diff then sees the renamed object. A changed column type or nullability becomes an alteration of the renamed column, with its usual question (`--convert`, `--backfill`). Today both plan a drop and an add.
- **A model `@@map` change with a field rename statement.** Refused today in both families, because the field would be renamed on a table the plan then drops. It becomes plannable: the table or collection rename runs first.
- **Freed and reused.** A stored name freed by a rename may be taken by a new object in the same plan: a new model whose table is the old name of a renamed table, a new field whose column is the old name of a renamed column, a new enum member whose stored value is the old value of a member that moved. The SQL family plans these: the rename runs first and the new object is created empty. For enum values this means the check that refuses a statement when the destination still stores the old value (`stillStoredRefusal`) does not apply to a pair with the same coordinate. MongoDB plans a new field or key under a freed name, except where its overlap check refuses (see the refused table), but refuses a new collection under the name a collection rename frees, or a rename into it: a collection rename runs again after a stop only while its old collection exists and its new one does not, so once the old name exists again a stopped migration could not be run again to finish. The refusal gives two plans, the rename first and then what uses the old name.
- **Reporting.** The rename is not a statement. It does not appear under `Statements applied` or in `appliedStatements`. It appears in the operation list.
- **Rendering.** `migration.ts` contains the same facade calls a statement rename renders, and re-running the file writes the same `ops.json`.
- **Questions.** Later questions about a renamed table or column are named by the origin model and field, as they are after a statement rename.
- **Both commands.** `migration plan` and `db update` share the planner. All operations involved are `widening`, which `db update` allows.

**How it is represented.** Inside each family's planner, the input to rename planning is a list of renames. Each rename carries the statement that asked for it, or none. No statement object is made up for a pair with the same coordinate. One function per family builds a refusal: with a statement it is today's `statementRefused` conflict; without one it is a conflict with no `refusedStatement` and text that names the contract change. Every place that sets `refusedStatement` or says "this statement" today is either reached through that function or shown to be unreachable without a statement. This stays inside the families. `ResolvedMigrationStatement` and the planner interfaces in `packages/1-framework` do not change.

### Where the rule does not apply

- **No origin contract.** There is no coordinate to compare, so nothing is paired. The plan is as today: storage subjects, `--delete`, and the advice to store the snapshot and run again. The transitional `MIGRATION.TABLE_NAME_CASE_CHANGED` check still fires here.
- **A model that moves to another namespace.** The namespace is part of the coordinate. That is a model rename statement today and stays one.
- **A model or field whose coordinate changed.** A statement, as today.
- **A discriminator value.** It is not the stored name of a coordinate. It stays a `--convert` question.
- **Storage the contract does not manage.** A pair is made only when the control policy is `managed` for the old storage under the origin contract and for the new storage under the destination contract. Otherwise no pair is made and the plan is as today. `keepTableAdvice` stays for this case.
- **Targets without rename planning.** The rule applies on targets that implement their family's rename planning: PostgreSQL, SQLite and MongoDB. The MySQL target has no rename operation and refuses every statement. A stored-name change there keeps today's drop, create and by-hand advice until MySQL gets rename planning. This is an exception to "always the same object", and the decision record and the ADR say so. No code branches on the target: MySQL does not call the family's rename planning.
- **A PostgreSQL native enum type whose `@@map` changes.** No statement renames an enum type, and a member change other than an append is refused today (ADR 286). Unchanged, with an entry in `deferred.md`.
- **Indexes and constraints with an explicit `map:` name.** Already renamed or recreated with no question. Unchanged.

### Refused in this slice

One check runs over all renames of a plan together, those from statements and those from pairs with the same coordinate, before any is applied. Names are compared the way the target compares them (SQLite folds ASCII case). The scope of a name is its namespace for a table or collection, and its table, collection or embedded type for a column or key.

A rename from a pair with the same coordinate is refused when:

1. **Its new name is held in the origin** by anything other than its own source. This is a swap, a chain or a takeover.
2. **Its new name is the new name of a statement rename.** Two statements, or a statement and a contract change, would merge two objects' storage. (Two contract changes that move into one new name fail the shared-storage condition above, so no rename is planned and the plan is today's, with its questions.)
3. **Its old name is the new name of a statement rename**, or the reverse. This is a chain between a statement and the contract change, in either direction.
4. **On `db update`, the live database has both its old and its new name**, and the origin contract does not have the new name (see the `db update` table). When the origin contract has the new name, rule 1 applies as on `migration plan`.

Statement renames among themselves behave as today: the user orders them.

| Case | Example | Today | This slice |
| --- | --- | --- | --- |
| Swap | `User` moves to `accounts`, `Account` moves to `users` | No drop and no create. Each table is altered in place and silently holds the other model's rows. | Refused |
| Chain | `User` moves to `accounts`, `Account` moves to `members` | Same silent reinterpretation | Refused |
| Taking the storage of a removed model | `Account` removed, `User` moves to `accounts` | `users` is dropped and asked about. `Account`'s rows silently become `User`'s. | Refused |
| Merge | `User` and `Member` both move to `people` | Both tables dropped and asked about | As today when no statement is involved; refused when a statement is |
| Two fields of one model swap or chain `@map` | `a @map("x")`, `b @map("y")` become `a @map("y")`, `b @map("x")` | Nothing planned. The data is silently swapped. | Refused |
| A field takes the column of a removed field | | The column is kept and silently read as the other field | Refused |
| Chain with a statement | `a` moves from column `x` to `y`, and `--rename User.b:User.c` gives `c` the column `x` | Refused or planned depending on direction | Refused, both directions, for tables and columns |
| Enum members swap stored values | `A = "a"`, `B = "b"` become `A = "b"`, `B = "a"` | Two removal questions, with advice to edit `migration.ts` by hand | Refused, with the by-hand route a cycle of statements is given today |
| An enum member takes the value of a removed member | `X = "x"` removed, `A` becomes `"x"` | SQL: `X`'s rows silently become `A`'s | Refused, as a merging statement is |
| A chain of enum values | `B` moves from `"b"` to `"c"`, `A` from `"a"` to `"b"` | Removal questions | SQL: planned, in the order the planner already computes for value rewrites. MongoDB: refused by its overlap check. |
| MongoDB: an old key reused by a new required field | `email` moves from key `email` to `emailAddress`, and a new required field takes `@map("email")` | Unset and a question | Refused by the overlap check, because the fill writes a key the rename empties |
| MongoDB: an embed relation's stored name changes (TypeScript builder only) | | Possibly nothing planned | Refused, as a statement on an embed relation is refused today |

**Why SQL and MongoDB differ on enum chains, and why tables differ from enum values.** The SQL family applies a migration in one transaction and its value rewrite code already orders a chain safely. MongoDB has no transaction, and its overlap check (ADR 188) refuses any plan where one rewrite writes what another reads. Table and column chains could be ordered on SQL the same way, and swaps could go through a temporary name. That ordering code does not exist for tables and columns, so those are refused in this slice and recorded in `deferred.md` as work to do. It is a gap, not a principle.

The refusals of swaps, chains and takeovers also close a path where today's plan damages data without asking.

**How a refusal is reported.** A planner conflict under `MIGRATION.PLANNING_FAILED`, of the kind the planner already uses for a change it cannot plan (`unsupportedOperation`), with no `refusedStatement`. The message names the coordinates and the stored names, says why the plan would misread data, and gives a route that works: make the change in two steps through a stored name nothing uses, each step its own plan. Each route is tested by following it.

### Order

1. Namespace rename statements, as today.
2. Table and collection renames from pairs with the same coordinate.
3. The user's model and field statements, in the order given, as today.
4. Column, field and stored key renames from pairs with the same coordinate.
5. Stored value replacements, in the order the existing code computes.

Step 2 comes before step 3 so that a field statement on a model whose `@@map` changed finds its table already renamed. No order between steps can go wrong on a chain, because the check above refuses every chain that involves a pair with the same coordinate.

### `db update` and a database that does not match the origin

For `db update` the working schema is the live database, which may differ from the origin contract. This table is for tables, columns and collections, which the planner can see.

| Live database | Rename from a pair with the same coordinate |
| --- | --- |
| Old name present, new absent | Planned |
| Old absent, new present | No operation. The rename is already done. The planner still records that the origin object is now at the new name, exactly as a planned rename does, so field renames on it, questions about it and `--delete User.field` answers work. This is the state of every user who followed today's by-hand advice, and of a MongoDB `db update` that stopped after the collection rename. |
| Old absent, new absent | No operation and nothing recorded. The storage diff creates the object, as today. |
| Old present, new present | Refused, with its own text. It says the likely cause, which on MongoDB is that the application wrote to the new collection before `db update` ran, and the fix: move those rows or documents into the old storage, or drop the new one, then run again. |

In "Old absent, new present" the planner takes the new table to be the old one renamed. No operation is planned for the table itself, but field renames, stored value replacements and the answers to `--delete` questions then act on it. So if a table or collection with the new name exists that was never the old one renamed, the plan rewrites it as if it were. This holds on every target.

MongoDB document keys, keys inside subdocuments and stored values are not in the schema the planner reads. For them the protection is at apply time: `$rename` has the precheck "no document holds both keys" and touches only documents that hold the old key, and a replacement touches only the values that match. Running a stopped migration again finishes it.

### Text and code that goes away or changes

- **`STORED_NAME_ONLY`** and **the enum swap hint** (framework CLI, `resolve-statements.ts`) change in the first pull request, to wording that is true for every target at that point: a name that is kept needs no statement; the plan renames its storage where the target can, and otherwise asks about it. The second pull request changes nothing in them unless the wording can then be made simpler.
- **`keepCollectionByHandAdvice`** and `collectionChangeAdvice` (MongoDB target): removed where no plan reaches them. The unmanaged-storage case may still need the first; the implementer decides from the code.
- **The SQL field refusal** "the model's table changes ... and no statement renames the table" is deleted, because the case is now planned.
- **Enum keep-data edits.** The SQL family and the MongoDB target stop producing a `KeepDataEdit` for an enum member that keeps its name, because that change is now planned or refused, never asked.
- **Framework CLI code that only served those enum questions** (`twoRuns` in `keep-data-edit-advice.ts`; `keepsDataByCommand` and `sharesValueWithKeptMember` in `plan-questions.ts`). If nothing reaches it after both pull requests, it is deleted in the second one. It is family-blind CLI code. `KeepDataEdit.swapsValues` in `framework-components` is a framework type and is left as it is, with an entry in `deferred.md`.

## Contract impact

None. No contract entity, kind or hash changes.

## Adapter impact

- **PostgreSQL and SQLite targets:** planner behaviour changes as described. No new operation.
- **MongoDB target:** planner behaviour changes as described. No new operation.
- **MySQL target:** no change.

## Framework domain

The rule is built in the SQL family and the MongoDB target. No interface or type in `packages/1-framework` changes.

Changes inside `packages/1-framework` are limited to the CLI package and are family-blind: two message texts, and the deletion of CLI advice code that nothing reaches. If an implementer finds that the design needs any other framework change, the dispatch stops and reports.

## Architecture record

- **A new ADR, "The same coordinate is the same object".** It covers models, fields and enum members in both families, the shared-storage condition, the refusals, the unmanaged-storage and MySQL exceptions, and what happens without an origin contract. The first pull request writes it. Its number is chosen after checking `main` and open pull requests.
- **ADR 264** gets update notes, not a rewrite: on "The planner cannot infer one" (still true of storage alone; identity by coordinate is not inference), on "A rename needs a hand-written migration", and on the case check, which no longer runs when an origin contract exists.
- **Migration System subsystem doc:** the paragraphs on `keepDataAdvice` for a `@@map` change, enum members that keep their names, MongoDB field `@map`, and "Rename limits in this release" are rewritten to the end state, each in the pull request that changes its family.
- **`docs/reference/error-reference.md`**, **`skills/prisma-8/references/migrations.md`** and the CLI `README.md` statements paragraph follow.
- **`design-notes.md`:** the first principle is reworded, not joined by a second: the contract states identity by name; the planner never guesses identity from storage, and acts on a destructive-looking change only when the user has stated what it is.
- **`storage-naming.md`:** the sentence on prisma/orm#31061 is corrected. That change pairs models whose names differ and whose storage matches; this rule pairs models whose names match and whose storage differs. The MySQL exception is added.

## Failure states

A plan either contains the renames or is refused before any operation is planned. No new partial state is introduced.

- **PostgreSQL and SQLite** apply a migration in one transaction, so a failed rename rolls back with the rest.
- **MongoDB** applies operations one at a time with no transaction. The exposure is the same as for a statement plan: `renameCollection` checks both names before and after, `$rename` never overwrites a key that exists in the same document, and the runner skips an operation whose postcheck already holds, so running a stopped migration again finishes it.
- **A swap or chain** is the case where a part-applied plan could leave data under the wrong name. It is refused, so it cannot start.

## Upgrade notes the fragments must carry

1. A stored-name change no longer asks a question, and the by-hand route is no longer needed.
2. A `--delete` statement that a script passes to allow the old drop and create now answers no question, and the run is refused as an unused consent. Remove it.
3. A user who wants an empty table under the new name removes the model in one change and adds it back in a second.
4. Swaps, chains and takeovers of stored names that used to plan with no question are now refused.
5. A project upgrading from a release that lowered the first letter of table names, with an origin snapshot, gets its tables renamed to the model names with no question. To keep the table names, add `@@map` before planning.

## Coherence rationale

Each pull request is one family: the rule, its refusals, its tests and journeys, and the docs for that family. A reviewer holds one planner at a time. The shared CLI text changes once, in the first.

## Scope

**In:**

- The rule for models, fields, embedded model fields (MongoDB) and enum members, on PostgreSQL, SQLite and MongoDB, for `migration plan` and `db update`.
- The shared-storage condition, for pairs with the same coordinate and for statement renames.
- The refusals in "Refused in this slice", each with advice that works when followed.
- The `db update` table.
- Removal of the by-hand advice and tests that the rule makes unreachable.
- The new ADR and the other records listed above.
- One upgrade instruction fragment per pull request.

**Deliberately out, each with an entry in `deferred.md`:**

- Planning swaps, chains, takeovers and merges of tables, collections and columns.
- A statement that names storage (`--rename storage/...`), recorded in `storage-naming.md`.
- MySQL rename operations and statement planning. They belong to the MySQL proof of concept.
- Moving a variant between its base's storage and its own, and a model leaving a shared collection. These stay data migrations.
- Renaming a PostgreSQL native enum type, and a PostgreSQL sequence owned by a renamed table.
- What the storage diff plans today for a stored-name change on storage that is not `managed`.
- Removing `KeepDataEdit.swapsValues` from `framework-components`, and removing the transitional case check.

## Pre-investigated edge cases

| Case | Disposition |
| --- | --- |
| A user already renamed the table or collection by hand, then runs `db update`, alone or with a field change, a removed field or a field statement | No operation for the table; the mapping is recorded; the rest plans against the new name. Journeys cover each. |
| `--rename User:User` | Still `MIGRATION.STATEMENT_INVALID`. The text says no statement is needed. |
| Model renamed by statement, one of its fields changes `@map` only | The field pairs by its name on the statement's pair, and the column is renamed. |
| Model `@@map` changes and `--delete User.name` removes a field | Table renamed first, then the column drop is planned on the renamed table and asked about by its field name. |
| The base of single-table or MongoDB variants changes `@@map` and the variants follow | One rename for the shared storage. |
| A variant gains or loses its own `@@map`, in either family | Not a rename. Planned as today. |
| One of two MongoDB root models that share a collection moves | Not a rename. The moving model is asked about on the operation that gives it its new storage, since its documents stay behind; the plan is refused when it has none. A root model the destination removes is not asked about. |
| Two SQL single-table variant fields share a column and one changes `@map` | Not a rename. Planned as today. |
| `--rename Bug:Defect` where the variant's storage is shared | Refused, with the shared-storage text. A fix of today's behaviour. |
| MongoDB root models that share one collection, all moving together, one with a field `@map` change | The field rename is refused as a field statement on a shared collection is today, with its own text. |
| Names that differ only in ASCII case on SQLite | The check compares as SQLite does. Tests for tables and columns. |
| A value object field | Takes no `@map` in either family. No stored-name-only change. |
| An implicit many-to-many join table from a Prisma 7 source | Its model name is derived from the two model names. Unchanged. |
| A column with a check constraint that lists enum values, and an array column of an enum (PostgreSQL) | The statement path handles these today; a test shows the new path takes the same route. |
| The stale comments in the PostgreSQL planner saying `db update` passes no origin contract | Corrected in the first pull request. |

## Slice-specific done conditions

1. For each row of the rule table, on PostgreSQL, SQLite and MongoDB where the row applies: a planner test and a CLI journey show the rename planned with no question, for `migration plan` and for `db update`, and the data is still there after the migration is applied.
2. For each row of "Refused in this slice": a planner test shows the refusal, and a journey follows the printed advice to the end and finds the data under the right names.
3. Each row of the `db update` table has a test against a live database, for tables and columns on the SQL targets and for collections on MongoDB, including the hand-rename cases combined with a field `@map` change, a removed field answered with `--delete`, and a field statement. A MongoDB `db update` run again after it stopped between `renameCollection` and `$rename` finishes.
4. Shared storage: a single-table variant moves to its own table and back (PostgreSQL, SQLite); one of two MongoDB root models sharing a collection moves; a MongoDB variant gains its own `@@map`; two models merge into one new name. In each, no rename is planned and no row or document of another model moves. `--rename Bug:Defect` on shared storage is refused.
5. A journey applies the rule together with a type change and with a field rename statement.
6. Chains between a statement and a pair with the same coordinate are refused in both directions, for tables and for columns.
7. No `MIGRATION.PLANNING_FAILED` caused by a pair with the same coordinate carries `refusedStatement`, in the JSON error output, or the words "this statement".
8. No test, journey, doc or message in the repository still says that a stored-name change is a drop and a create on PostgreSQL, SQLite or MongoDB.
9. `git diff` of `packages/1-framework` shows only the CLI package, and nothing in it names a family or target.

## Open questions

None.

## Review record

Design reviewed on 2026-11-18 by an architect and a principal engineer. What changed as a result:

| Finding | Change |
| --- | --- |
| A variant that gains its own `@@map`, or a model leaving shared storage, would have had the shared table renamed away (architect A01, engineer P01, with a probe) | "Storage is renamed only when all of it moves", for both kinds of pair; merges refused |
| The claim that unmanaged storage "plans nothing" was false (A02, P07) | A pair needs `managed` on both sides; otherwise planned as today; `keepTableAdvice` stays |
| MySQL is an exception, not a consequence (A03) | Stated as one |
| The refusal boundary contradicted the enum chain row, and chains with statements behaved differently by direction (A04, P05) | One check over all renames; chains with a statement refused both ways; the SQL and MongoDB difference explained by transactions; table and column ordering recorded as a gap |
| No representation was given, and a made-up statement would leak into messages (A05, P03) | Renames carry an optional statement; one refusal function per family; done condition 7 |
| Native enum types, embed relations and namespaces were not listed (A06) | Listed with a disposition |
| MongoDB's pairing by storage was left out (A07) | Pairing order written in full |
| The `db update` table did not fit keys and values, a skipped rename lost the mapping, and its refusal used statement text (A08, P02, P10) | Table limited to what the planner sees; mapping recorded; own refusal text |
| The check missed case folding, live-only tables, merges and the MongoDB freed-and-reused fill (P04) | Check defined once, compared as the target compares; cases listed |
| A statement refusal contradicted the rule for a freed enum value (P06) | Freed and reused is planned |
| Amending ADR 264 in place (A09) | A new ADR, update notes on ADR 264, the design-notes principle reworded |
| "Contract name" duplicated "coordinate" (A10) | Terms use the code's words |
| CLI text false between the two pull requests (P08) | Text changes in the first |
| Upgrade notes missed unused `--delete`, the empty-table route and the lowering rule (A11, P09, A09) | "Upgrade notes the fragments must carry" |
| Tests would have passed with the defects present (P11) | Done conditions 3, 4, 6 and 7 |

## References

- [`storage-naming.md`](../../storage-naming.md): the decision, the prior art, and the deferred storage statement.
- [`design-notes.md`](../../design-notes.md): the project's principles.
- ADR 264, ADR 188 (MongoDB operation model, the overlap check), ADR 224 (control policy), ADR 286 (native enums).
- prisma/orm#31061: the MongoDB variant pairing by storage.
