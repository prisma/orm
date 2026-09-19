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

Run the colocated codemod once, from the project root, over every schema file, including the `contract.prisma` copy inside each migration directory:

```bash
node scripts/add-model-map.mjs '**/*.prisma'
```

It adds `@@map("<model name with its first letter lowered>")` as the last line of every `model` block that has no `@@map`, keeps the file's indentation and line endings, leaves models that already have `@@map` alone, and leaves a variant with `@@base(...)` and no `@@map` alone because it shares its base's table. It never descends into `node_modules` or `dist`, prints every model it mapped as `<file>: model <Name> -> @@map("<name>")`, and is idempotent. If a `model` block is written in a shape it cannot read it prints `<file>:<line>: model block not understood` and exits 1; add the `@@map` to that block by hand.

The codemod cannot see storage. It is for schemas written against the previous release only, where every unmapped model's table was created with its first letter lowered. Run it once, before you re-run `contract infer`, and never on a schema that was inferred or written after upgrading: such a schema already names its tables verbatim, and the codemod would point each unmapped model at a lowercase table that does not exist. Read the printed list and remove the `@@map` from any model whose table already has the verbatim name.

Then run the project's emit command (`prisma contract emit`, or its `contract:emit` script) and check that `contract.json` did not change; `prisma db verify --schema-only` against the database must also be clean. An unchanged `contract.json` proves the codemod was run on the right schema: if it changed, or verify reports the lowercase tables as missing, the schema was already verbatim, so revert the codemod's edits. Storage hashes, migration history, and refs are unchanged after a correct run, so no `db sign`, migration, or data move is needed.

If you plan a migration (`prisma migration plan`, `prisma db update`, `prisma migrate`) without running the codemod, planning fails instead of dropping the table:

```text
✘ [MIGRATION.PLANNING_FAILED] Migration planning failed
  why: MIGRATION.TABLE_NAME_CASE_CHANGED: table "UserProfile" would be created and table "userProfile" dropped. Prisma 8 changed the default table name: a model with no @@map now names its table verbatim, so model UserProfile points at "UserProfile" instead of "userProfile".
→ To keep table "userProfile" and its rows, add @@map("userProfile") to model UserProfile (or run the add-model-map codemod over the schema) and plan again. To rename the table and keep its rows instead: in a project with migration history, make the rename its own schema change, create its migration with prisma migration new, and add ...this.renameTable({ table: "userProfile", to: "UserProfile" }) to the migration's operations, which renames the table and the objects named after it; in a project that uses db update, rename it by hand with ALTER TABLE "public"."userProfile" RENAME TO "UserProfile", then run db update again.
```

That is the Postgres output for a model in the default `public` schema. On SQLite the last clause gives the two statements SQLite needs for a rename that only changes case: `in a project that uses db update, rename it by hand with ALTER TABLE "userProfile" RENAME TO "_prisma_rename_UserProfile"; ALTER TABLE "_prisma_rename_UserProfile" RENAME TO "UserProfile", then run db update again.`

The conflict fires for each pair where the table to drop equals the table to create with its first letter lowered, in the same namespace, whatever the columns. It does not fire on an empty database or on tables the contract's control policy marks `external` or `observed`. Mongo has no such check. A migration planned without the codemod drops the `userProfile` collection, and an application running the unmapped model reads and writes an empty `UserProfile` collection while the documents stay in `userProfile`, so run the codemod before planning or deploying.

To adopt the verbatim names on purpose instead of mapping, skip the codemod for those models and rename the storage.

**Postgres or SQLite, with migration history.** Make the rename its own schema change: remove the `@@map` from the models you rename, change nothing else, and emit the contract. Create a migration for the change:

```bash
prisma migration new --name rename-user-profile
```

In the new `migration.ts`, spread one `renameTable` call per renamed table into the operations:

```ts
override get operations() {
  return [...this.renameTable({ table: 'userProfile', to: 'UserProfile' })];
}
```

On Postgres, add `schema: 'auth'` when the table is not in the default schema or another schema has a table with the same name. The call reads the migration's start and end contracts. It renames the table, then each primary key, unique constraint, foreign key, index and check constraint named after the old table; on SQLite it drops each such index and creates it under the new name. Run `node migrations/app/<dir>/migration.ts` to write the operations, then `prisma db migrate`. The rows stay.

Make your other schema edits afterwards and plan them as usual. `db migrate` checks the database against the migration's end contract, so a rename migration that leaves out other edits from the same schema change fails there.

**Postgres, managed with `db update`.** Rename the table by hand, then run `prisma db update`:

```sql
ALTER TABLE "public"."userProfile" RENAME TO "UserProfile";
```

For a table in another schema, write that schema: `ALTER TABLE "auth"."userProfile" RENAME TO "UserProfile"`. The rows stay. Until `db update` runs, `db verify --schema-only` reports the indexes named after the old table as missing; `db update` renames them, and after that `db verify --schema-only` is clean. Primary keys, unique constraints and foreign keys that you did not name with `map:` keep the names derived from the old table, and neither `db verify` nor `db update` reports it. Rename them as well, because a migration you plan later derives these names from the new table name:

```sql
ALTER TABLE "public"."UserProfile" RENAME CONSTRAINT "userProfile_pkey" TO "UserProfile_pkey";
ALTER TABLE "public"."UserProfile" RENAME CONSTRAINT "userProfile_<columns>_key" TO "UserProfile_<columns>_key";
ALTER TABLE "public"."UserProfile" RENAME CONSTRAINT "userProfile_<columns>_fkey" TO "UserProfile_<columns>_fkey";
```

`<columns>` is the constraint's column names joined with `_`, such as `email` or `tenantId_email`. Add one statement per unique constraint and per foreign key.

**SQLite, managed with `db update`.** SQLite refuses in one statement a rename that only changes case, so rename the table through a temporary name, then run `prisma db update`:

```sql
ALTER TABLE "userProfile" RENAME TO "_prisma_rename_UserProfile";
ALTER TABLE "_prisma_rename_UserProfile" RENAME TO "UserProfile";
```

The rows stay, and SQLite renames its automatic indexes itself. `db update` drops each index named after the old table and creates it under the new name. Dropping an index needs your consent: `db update` asks for it, or, without a terminal, takes the database name it prints with `--confirm`. After that `db verify --schema-only` is clean.

**MongoDB.** Rename the collection by hand before you plan:

```js
db.userProfile.renameCollection("UserProfile")
```

`contract infer` follows the same rule: a table whose name already equals the model name (`"UserProfile"`, `"User"`) infers to a model with no `@@map` and verifies clean, where the previous output pointed the model at a lowercase table that did not exist. A snake_case table still infers with `@@map("user_profile")`. There is nothing to detect for this: the inferred text for such a table is the same as before, it is now correct.
