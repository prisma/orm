---
changes:
  - id: sql-stored-name-change-is-a-rename
    summary: |
      On PostgreSQL and SQLite, a model, field or enum member that keeps its name while its `@@map`, `@map` or stored value changes is now renamed, or has its stored value replaced, by `migration plan` and `db update`, with no question. The by-hand rename these changes needed before is no longer needed.
  - id: sql-stored-name-delete-is-unused
    summary: |
      A `--delete` statement that a script passed to allow the drop and create of a table or column whose stored name changed now answers no question, and the run fails with `CLI.CONSENT_UNUSED`.
  - id: sql-stored-name-empty-table
    summary: |
      To get an empty table or column under a new stored name instead of renaming the old one, remove the model or field in one change and add it back in a second.
  - id: sql-stored-name-swaps-refused
    summary: |
      Swaps, chains and takeovers of table and column names, which planned with no question before and left rows under the wrong model, are now refused with `MIGRATION.PLANNING_FAILED`. So are enum members that swap stored values or take the stored value of a removed member, which were asked about before. Chains of enum stored values are planned.
  - id: sql-lowered-table-names-renamed
    summary: |
      A project with an origin snapshot whose tables still have the names an earlier release gave models with no `@@map` (the first letter lowered) now gets those tables renamed to the model names, with no question. Add `@@map` to keep the old names.
---

# A changed stored name is a rename on PostgreSQL and SQLite

A model, field or enum member with the same name in the contract source on both sides of a change is now the same object. When only what it is stored as changes, `migration plan` and `db update` rename the storage or replace the value. This applies on PostgreSQL and SQLite, with a snapshot of the contract the database is at. MySQL and MongoDB plan these changes as before.

## `sql-stored-name-change-is-a-rename`

Before, changing `@@map("users")` to `@@map("people")` on `model User` planned a drop of `users` and a create of `people`, and asked for `--delete User`. To keep the rows you renamed the table by hand: with `db update`, in the database; with `migration plan`, by writing `...this.renameTable({ table: 'users', to: 'people' })` into a `migration.ts` of its own.

Now the same change plans a rename of table `users` to `people` and the renames of its constraints (on PostgreSQL the plan prints `Rename table "users" to "people"`, on SQLite `Rename table users to people`), and asks nothing. A changed `@map` plans a column rename. An enum member that keeps its name and changes its stored value, such as `ARCHIVED = "archived"` to `ARCHIVED = "old"`, has the value replaced in every column the enum types. A table or column is renamed only when everything stored in it moves and its control policy is `managed` in both contracts; a variant that gains or loses a table of its own is still asked about.

Stop renaming by hand. Make the contract change and plan it. Migrations you already wrote by hand stay as they are.

## `sql-stored-name-delete-is-unused`

Before:

```bash
prisma migration plan --name move-users --delete User
```

Now this fails with `CLI.CONSENT_UNUSED`, since nothing asks about `User`. Remove the `--delete` from the script:

```bash
prisma migration plan --name move-users
```

A `--rename User:User` statement still fails with `MIGRATION.STATEMENT_INVALID`. Remove it too.

## `sql-stored-name-empty-table`

Before, a changed `@@map` gave you an empty table under the new name once you answered `--delete User`. Now it keeps the rows. To start empty, make two changes, each planned and applied before the next:

1. Remove `model User` from the schema, plan, and answer `--delete User`.
2. Add `model User` back with `@@map("people")`, and plan again.

## `sql-stored-name-swaps-refused`

Before, two models that swapped tables (`User` from `users` to `accounts` and `Account` from `accounts` to `users`) planned no drop and no create: each table was altered in place and then held the other model's rows. Now the plan fails with `MIGRATION.PLANNING_FAILED`, as in:

```text
Cannot rename table "accounts" to "users": table "users" is renamed in the same plan
```

The same holds for two fields that swap columns, a chain where one model or field moves to a name another frees, a model or field that takes the storage of one the change removes, and enum members that swap stored values or take the stored value of a removed member. Follow the message: make the change in two plans through names nothing uses, such as `prisma_swap_users`, each planned and applied before the next.

When the two tables or columns have the same shape and nothing else changes, the storage does not change at all, so `migration plan` still reports no change and writes nothing; `db update` refuses the swap. Make such a swap through a name nothing uses in the same way.

## `sql-lowered-table-names-renamed`

Before, a model with no `@@map` whose table still had the name an earlier release gave it, with the first letter lowered (`userProfile` for `model UserProfile`), was refused with `MIGRATION.TABLE_NAME_CASE_CHANGED` when planned from a snapshot that named the lowered table. Now, from such a snapshot, the plan renames `userProfile` to `UserProfile` with no question.

To keep the lowered name, add it with `@@map` before you plan:

```prisma
model UserProfile {
  id Int @id

  @@map("userProfile")
}
```
