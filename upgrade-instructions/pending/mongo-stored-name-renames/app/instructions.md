---
changes:
  - id: mongo-stored-name-change-is-a-rename
    summary: |
      On MongoDB, a model, field or enum member that keeps its name while its `@@map`, `@map` or stored value changes is now renamed, or has its stored value replaced, by `migration plan` and `db update`, with no question. A field of an embedded model has its key renamed in every place the model is stored. The by-hand rename these changes needed before is no longer needed.
  - id: mongo-stored-name-delete-is-unused
    summary: |
      A `--delete` statement that a script passed to allow the drop of a collection, or the removal of a field, key or enum value, whose stored name changed now answers no question, and the run fails with `CLI.CONSENT_UNUSED`.
  - id: mongo-stored-name-empty-collection
    summary: |
      To get an empty collection, or a field with no values, under a new stored name instead of renaming the old one, remove the model or field in one change and add it back in a second.
  - id: mongo-stored-name-swaps-refused
    summary: |
      Swaps, chains and takeovers of collection names and of field stored names are refused with `MIGRATION.PLANNING_FAILED`. Enum members that swap stored values, shift them along a chain, or take the stored value of another member, which were asked about before with advice to use two migrations, are now refused with a route through two plans.
  - id: mongo-shared-collection-rename-refused
    summary: |
      On MongoDB, `--rename` of a model whose collection another root model shares is now refused, where it used to rename the whole collection and take the other models' documents with it.
---

# A changed stored name is a rename on MongoDB

A model, field or enum member with the same name in the contract source on both sides of a change is now the same object on MongoDB, as on PostgreSQL and SQLite. When only what it is stored as changes, `migration plan` and `db update` rename the storage or replace the value. This needs a snapshot of the contract the database is at.

## `mongo-stored-name-change-is-a-rename`

Before, changing `@@map("users")` to `@@map("app_users")` on `model User` planned a drop of `users` and a create of `app_users`, and asked for `--delete User`. To keep the documents you renamed the collection by hand: with `db update`, in `mongosh`; with `migration plan`, by writing `renameCollection(...)` into the `migration.ts` and deleting the drop.

Now the same change plans `Rename collection users to app_users` and asks nothing. The documents, indexes and validator stay with the collection. A changed `@map` on a field plans `Rename field email to mail in collection users`. A changed `@map` on a field of an embedded model renames the key in every place the model is stored, as in `Rename key "sku" to "code" at path "$[*]" in field lines of collection orders`. An enum member that keeps its name and changes its stored value, such as `ARCHIVED = "archived"` to `ARCHIVED = "retired"`, has the value replaced in every field and key the enum types, scalar or list. A collection is renamed only when everything stored in it moves and its control policy is `managed` in both contracts.

Stop renaming by hand. Make the contract change and plan it. Migrations you already wrote by hand stay as they are. If you already renamed a collection by hand and use `db update`, it finds the collection under its new name and plans nothing for it.

## `mongo-stored-name-delete-is-unused`

Before:

```bash
prisma db update --delete User
```

Now this fails with `CLI.CONSENT_UNUSED`, since nothing asks about `User`. Remove the `--delete` from the script:

```bash
prisma db update
```

The same holds for `--delete User.email` after a changed `@map`, and `--delete Status.ARCHIVED` after a changed stored value of a member that keeps its name.

## `mongo-stored-name-empty-collection`

Before, a changed `@@map` gave you an empty collection under the new name once you answered `--delete User`. Now it keeps the documents. To start empty, make two changes, each planned and applied before the next:

1. Remove `model User` from the schema, plan, and answer `--delete User`.
2. Add `model User` back with `@@map("app_users")`, and plan again.

## `mongo-stored-name-swaps-refused`

Two models that swap collections (`User` from `users` to `accounts` and `Account` from `accounts` to `users`), two fields that swap stored names, a chain where one moves to a name another frees, and a model that takes the collection of one the change removes are refused with `MIGRATION.PLANNING_FAILED`, as in:

```text
Cannot rename collection "accounts" to "users": collection "users" is renamed in the same plan
```

Enum members are refused when they swap stored values, shift them along a chain (`A` takes `"b"` while `B` takes `"c"`), or take the stored value of another member of the origin. Before, a swap or chain was asked about, with advice to make the change in two migrations. MongoDB applies a migration's operations one at a time with no transaction, so a rewrite that reads a value another rewrite of the same migration writes is not safe to run again after a stop.

Follow the message: make the change in two plans, each planned and applied before the next, through names or values nothing uses, such as `prisma_swap_users` or `prisma_swap`, or, for a takeover, by first removing the model or enum member that holds the name. A boolean enum has no third value, so members that swap `true` and `false` are refused with no route: keep the stored values of the enum in the contract.

A collection rename whose old name the change uses again, for a new model or another model's collection, is refused too: make the rename in one plan and add what uses the old name in the next.

When the two collections or fields have the same shape and nothing else changes, the storage does not change at all, so `migration plan` still reports no change and writes nothing; `db update` refuses the swap. Make such a swap through a name nothing uses in the same way.

## `mongo-shared-collection-rename-refused`

Before, `--rename User:Member`, where `User` shares collection `users` with another root model and `Member` has a collection of its own, renamed `users` to `members`, and the other model's documents moved too. Now it is refused:

```text
Cannot rename model "User" to "Member": collection "users" also stores model "Admin"
```

A plan cannot tell the two models' documents apart, since nothing in a document names its root model. Without the statement the plan does not move them either: `User` is removed and nothing is asked, since nothing is deleted; its documents stay in `users`, where `Admin` still reads them, and `Member` starts with none. If the new validator of `users` does not accept them, its change stops the apply in every database that holds them, until they are deleted or moved there. To keep them, move them in a hand-written migration with `migration plan`, as the message describes.
