---
changes:
  - id: psl-model-names-table-verbatim
    summary: |
      A PSL `model` with no `@@map` now names its table (or Mongo collection) after the model
      verbatim: `model UserProfile` maps to `"UserProfile"`, where it used to map to `"userProfile"`.
      Run the colocated codemod over every `.prisma` file, including the `contract.prisma` copies
      under `migrations/`, so each unmapped model gets `@@map("<current table name>")` and keeps the
      table it already has. Emitted contracts, storage hashes, and migration history are unchanged
      after the codemod. Planning without it fails with `MIGRATION.TABLE_NAME_CASE_CHANGED`
      instead of dropping and recreating the table.
    detection:
      glob: "**/*.prisma"
      regex:
        - '\bmodel\s+[A-Za-z_][A-Za-z0-9_]*\s*\{'
    script: ./scripts/add-model-map.mjs
---

## `psl-model-names-table-verbatim`

A PSL `model` with no `@@map` used to name its table, or its Mongo collection, after the model with the first letter lowered: `model UserProfile` read and wrote `"userProfile"`. It now uses the model name verbatim, `"UserProfile"`, the same rule every other Prisma 8 authoring surface already followed. Every model without `@@map` therefore points at a table that does not exist yet, so the schema must say which table it means.

Run the colocated codemod once, from the extension package root, over every schema file, including the contract-space `contract.prisma` and the copy inside each migration directory:

```bash
node scripts/add-model-map.mjs '**/*.prisma'
```

It adds `@@map("<model name with its first letter lowered>")` as the last line of every `model` block that has no `@@map`, keeps the file's indentation and line endings, leaves models that already have `@@map` alone, and leaves a variant with `@@base(...)` and no `@@map` alone because it shares its base's table. It never descends into `node_modules` or `dist`, prints every model it mapped as `<file>: model <Name> -> @@map("<name>")`, and is idempotent. If a `model` block is written in a shape it cannot read it prints `<file>:<line>: model block not understood` and exits 1; add the `@@map` to that block by hand.

The codemod cannot see storage. It is for schemas written against the previous release only, where every unmapped model's table was created with its first letter lowered. Run it once, before you re-run `contract infer`, and never on a schema that was inferred or written after upgrading: such a schema already names its tables verbatim, and the codemod would point each unmapped model at a lowercase table that does not exist. Read the printed list and remove the `@@map` from any model whose table already has the verbatim name.

Then run the package's contract-space build (`build:contract-space`, or `prisma contract emit` for the package) and check that the emitted `contract.json` did not change. An unchanged `contract.json` proves the codemod was run on the right schema: if it changed, the schema was already verbatim, so revert the codemod's edits. Storage hashes, migration history, and refs are unchanged after a correct run, so applications composing the extension see no change.

If you plan a migration (`prisma migration plan`, `prisma db update`, `prisma migrate`) without running the codemod, planning fails instead of dropping the table:

```text
✘ [MIGRATION.PLANNING_FAILED] Migration planning failed
  why: MIGRATION.TABLE_NAME_CASE_CHANGED: table "UserProfile" would be created and table "userProfile" dropped. Prisma 8 changed the default table name: a model with no @@map now names its table verbatim, so model UserProfile points at "UserProfile" instead of "userProfile".
→ To keep table "userProfile" and its rows, add @@map("userProfile") to model UserProfile (or run the add-model-map codemod over the schema) and plan again. To rename the table and keep its rows instead: in a project with migration history, make the rename its own schema change, create its migration with prisma migration new, and add ...this.renameTable({ table: "userProfile", to: "UserProfile" }) to the migration's operations, which renames the table and the objects named after it; in a project that uses db update, rename it by hand with ALTER TABLE "public"."userProfile" RENAME TO "UserProfile", then run db update again.
```

That is the Postgres output for a model in the default `public` schema. On SQLite the last clause gives the two statements SQLite needs for a rename that only changes case: `in a project that uses db update, rename it by hand with ALTER TABLE "userProfile" RENAME TO "_prisma_rename_UserProfile"; ALTER TABLE "_prisma_rename_UserProfile" RENAME TO "UserProfile", then run db update again.`

The conflict fires for each pair where the table to drop equals the table to create with its first letter lowered, in the same namespace, whatever the columns. It does not fire on an empty database or on tables the contract's control policy marks `external` or `observed`. Mongo has no such check. A migration planned without the codemod drops the `userProfile` collection, and an application running the unmapped model reads and writes an empty `UserProfile` collection while the documents stay in `userProfile`, so run the codemod before planning or deploying.

To adopt the verbatim names on purpose instead of mapping, skip the codemod for those models and ship the rename as a migration of your contract space. Applications change your tables only by running the migrations your descriptor lists in `contractSpace.migrations`: their `prisma migration plan` copies each one into `migrations/<space-id>/`, and `prisma db migrate` applies it. If you rename the table by hand in your own database and run `db update`, only that database changes. Every application keeps the old table.

**Postgres or SQLite.** Make the rename its own schema change: remove the `@@map` from the models you rename, change nothing else, and run the package's contract-space build. From the extension package root, create a migration for the change:

```bash
prisma migration new --name rename-user-profile
```

In the new `migration.ts`, spread one `renameTable` call per renamed table into the operations:

```ts
override get operations() {
  return [...this.renameTable({ table: 'userProfile', to: 'UserProfile' })];
}
```

On Postgres, add `schema: 'auth'` when the table is not in the default schema or another schema has a table with the same name. The call renames the table and the constraints and indexes named after it, and the rows stay. Run `node migrations/app/<dir>/migration.ts` to write the operations. Add the new migration's `migration.json` and `ops.json` to `contractSpace.migrations` in the descriptor. In the head ref the descriptor passes as `headRef`, set `hash` to the new migration's `to` hash and keep `invariants` as they are. Applications get the rename when they upgrade the extension and run `prisma migration plan` and `prisma db migrate`, and their rows stay.

This works only if the package's migration history is in `migrations/app/`, where `migration new` reads and writes it. If the package keeps its migration directories directly under `migrations/`, as Prisma's own extension packages do, `migration new` does not see that history, the new migration has no start contract, and `renameTable` refuses with `MIGRATION.TABLE_RENAME_UNMATCHED`. A deliberate rename is not supported for that layout yet, so keep the `@@map`.

**MongoDB.** A Mongo contract space has no rename operation, so a deliberate rename is not supported there yet. Keep the `@@map`.

`contract infer` follows the same rule: a table whose name already equals the model name (`"UserProfile"`, `"User"`) infers to a model with no `@@map` and verifies clean, where the previous output pointed the model at a lowercase table that did not exist. A snake_case table still infers with `@@map("user_profile")`. There is nothing to detect for this: the inferred text for such a table is the same as before, it is now correct.
