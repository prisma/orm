---
changes:
  - id: postgres-postcheck-create-table
    summary: |
      On PostgreSQL, the check that runs after `createTable` checks that the relation is a table, not a view, sequence or index of the same name. An `ops.json` written before this change keeps its old check, which the runner can find already true for an object of the same name with another definition, and then skip the operation. Run `migration.ts` again for each migration that is not applied yet.
    detection:
      glob: "**/ops.json"
      matches:
        - '"description": "create table \\"(?:[^"\\]|\\.)*?\\""(?:(?!"postcheck")[\s\S])*?"postcheck": \[\s*\{\s*"description": "verify table \\"(?:[^"\\]|\\.)*?\\" exists",\s*"sql": "SELECT \(?to_regclass\('
  - id: postgres-postcheck-add-column
    summary: |
      On PostgreSQL, the check that runs after `addColumn` checks the column's type, and that it is NOT NULL when the column is declared NOT NULL. An `ops.json` written before this change keeps its old check, which the runner can find already true for an object of the same name with another definition, and then skip the operation. Run `migration.ts` again for each migration that is not applied yet.
    detection:
      glob: "**/ops.json"
      matches:
        - '"description": "verify column \\"(?:[^"\\]|\\.)*?\\" exists",[^{}]*\}\s*\]'
  - id: postgres-postcheck-add-column-with-temporary-default
    summary: |
      On PostgreSQL, the check that runs after `addColumnWithTemporaryDefault` checks the column's type. An `ops.json` written before this change keeps its old check, which the runner can find already true for an object of the same name with another definition, and then skip the operation. Run `migration.ts` again for each migration that is not applied yet.
    detection:
      glob: "**/ops.json"
      matches:
        - 'has no default after temporary default removal",[^{}]*\}\s*\]'
  - id: postgres-postcheck-add-required-column-to-empty-table
    summary: |
      On PostgreSQL, the check that runs after `addRequiredColumnToEmptyTable` checks the column's type. An `ops.json` written before this change keeps its old check, which the runner can find already true for an object of the same name with another definition, and then skip the operation. Run `migration.ts` again for each migration that is not applied yet.
    detection:
      glob: "**/ops.json"
      matches:
        - '"description": "verify column \\"(?:[^"\\]|\\.)*?\\" exists",[^{}]*\},\s*\{\s*"description": "verify column \\"(?:[^"\\]|\\.)*?\\" is NOT NULL",[^{}]*\}\s*\]'
  - id: postgres-postcheck-create-index
    summary: |
      On PostgreSQL, the check that runs after `createIndex` checks that the relation is an index on the planned table, with the planned uniqueness, access method and columns in order, and with an expression and a predicate only where the call has them. An `ops.json` written before this change keeps its old check, which the runner can find already true for an object of the same name with another definition, and then skip the operation. Run `migration.ts` again for each migration that is not applied yet.
    detection:
      glob: "**/ops.json"
      matches:
        - '"description": "create index \\"(?:[^"\\]|\\.)*?\\"",(?:(?!"postcheck")[\s\S])*?"postcheck": \[\s*\{\s*"description": "verify index \\"(?:[^"\\]|\\.)*?\\" exists",'
  - id: postgres-postcheck-rename-index
    summary: |
      On PostgreSQL, the check that runs after `renameIndex` also checks that no index has the old name any more. An `ops.json` written before this change keeps its old check, which the runner can find already true for an object of the same name with another definition, and then skip the operation. Run `migration.ts` again for each migration that is not applied yet.
    detection:
      glob: "**/ops.json"
      matches:
        - '"description": "rename index \\"(?:[^"\\]|\\.)*?\\" to \\"(?:[^"\\]|\\.)*?\\"",(?:(?!"postcheck")[\s\S])*?"postcheck": \[\s*\{\s*"description": "verify index \\"(?:[^"\\]|\\.)*?\\" exists",[^{}]*\}\s*\]'
  - id: postgres-postcheck-add-primary-key
    summary: |
      On PostgreSQL, the check that runs after `addPrimaryKey` checks that the constraint is a primary key on the planned columns in order. An `ops.json` written before this change keeps its old check, which the runner can find already true for an object of the same name with another definition, and then skip the operation. Run `migration.ts` again for each migration that is not applied yet.
    detection:
      glob: "**/ops.json"
      matches:
        - '"description": "verify primary key \\"(?:[^"\\]|\\.)*?\\" exists"'
  - id: postgres-postcheck-add-unique
    summary: |
      On PostgreSQL, the check that runs after `addUnique` checks that the constraint is a unique constraint on the planned columns in order. An `ops.json` written before this change keeps its old check, which the runner can find already true for an object of the same name with another definition, and then skip the operation. Run `migration.ts` again for each migration that is not applied yet.
    detection:
      glob: "**/ops.json"
      matches:
        - '"description": "add unique constraint \\"(?:[^"\\]|\\.)*?\\"",(?:(?!"postcheck")[\s\S])*?"postcheck": \[\s*\{\s*"description": "verify constraint \\"(?:[^"\\]|\\.)*?\\" exists",'
  - id: postgres-postcheck-add-foreign-key
    summary: |
      On PostgreSQL, the check that runs after `addForeignKey` checks the constraint's columns, referenced table and columns in order, and its delete and update actions. An `ops.json` written before this change keeps its old check, which the runner can find already true for an object of the same name with another definition, and then skip the operation. Run `migration.ts` again for each migration that is not applied yet.
    detection:
      glob: "**/ops.json"
      matches:
        - '"description": "verify FK \\"(?:[^"\\]|\\.)*?\\" exists"'
  - id: postgres-postcheck-add-check-constraint
    summary: |
      On PostgreSQL, the check that runs after `addCheckConstraint` checks that the constraint is a check constraint. An `ops.json` written before this change keeps its old check, which the runner can find already true for an object of the same name with another definition, and then skip the operation. Run `migration.ts` again for each migration that is not applied yet.
    detection:
      glob: "**/ops.json"
      matches:
        - '"description": "add check constraint \\"(?:[^"\\]|\\.)*?\\"",(?:(?!"postcheck")[\s\S])*?"postcheck": \[\s*\{\s*"description": "verify constraint \\"(?:[^"\\]|\\.)*?\\" exists",'
  - id: postgres-postcheck-rename-constraint
    summary: |
      On PostgreSQL, the check that runs after `renameConstraint` also checks that no constraint has the old name any more. An `ops.json` written before this change keeps its old check, which the runner can find already true for an object of the same name with another definition, and then skip the operation. Run `migration.ts` again for each migration that is not applied yet.
    detection:
      glob: "**/ops.json"
      matches:
        - '"description": "rename (?:primary key|unique constraint|foreign key|check constraint) \\"(?:[^"\\]|\\.)*?\\" to \\"(?:[^"\\]|\\.)*?\\"",(?:(?!"postcheck")[\s\S])*?"postcheck": \[\s*\{\s*"description": "verify constraint \\"(?:[^"\\]|\\.)*?\\" exists",[^{}]*\}\s*\]'
  - id: postgres-postcheck-create-rls-policy
    summary: |
      On PostgreSQL, the check that runs after `createRlsPolicy` checks the policy's command, roles and whether it is permissive. An `ops.json` written before this change keeps its old check, which the runner can find already true for an object of the same name with another definition, and then skip the operation. Run `migration.ts` again for each migration that is not applied yet.
    detection:
      glob: "**/ops.json"
      matches:
        - '"description": "create RLS policy \\"(?:[^"\\]|\\.)*?\\"",(?:(?!"postcheck")[\s\S])*?"postcheck": \[\s*\{\s*"description": "verify RLS policy \\"(?:[^"\\]|\\.)*?\\" exists",'
  - id: postgres-postcheck-rename-rls-policy
    summary: |
      On PostgreSQL, the check that runs after `renameRlsPolicy` also checks that no policy has the old name any more; its precheck now also refuses a policy that already has the new name. An `ops.json` written before this change keeps its old check, which the runner can find already true for an object of the same name with another definition, and then skip the operation. Run `migration.ts` again for each migration that is not applied yet.
    detection:
      glob: "**/ops.json"
      matches:
        - '"description": "rename RLS policy \\"(?:[^"\\]|\\.)*?\\" to \\"(?:[^"\\]|\\.)*?\\"",(?:(?!"postcheck")[\s\S])*?"postcheck": \[\s*\{\s*"description": "verify RLS policy \\"(?:[^"\\]|\\.)*?\\" exists",[^{}]*\}\s*\]'
  - id: postgres-postcheck-autoincrement-default
    summary: |
      On PostgreSQL, the check that runs after `setDefault` with `autoincrement()` also checks that the column owns the sequence of the planned name and that the sequence has the column's integer width. An `ops.json` written before this change keeps its old check, which the runner can find already true for an object of the same name with another definition, and then skip the operation. Run `migration.ts` again for each migration that is not applied yet.
    detection:
      glob: "**/ops.json"
      matches:
        - 'takes its default from an attached sequence",[^{}]*\}\s*\]'
  - id: postgres-alter-column-type-unchanged-refused
    summary: |
      On PostgreSQL, `this.alterColumnType` with `using` now refuses, with `MIGRATION.ALTER_COLUMN_TYPE_USING_WITHOUT_TYPE_CHANGE`, a column the start contract, after the earlier renames in the migration, already gives the new type. Its check compares only the type, so the runner skipped the conversion. Write the conversion as a `dataTransform`.
    detection:
      glob: "**/migration.ts"
      matches:
        - '\balterColumnType\(\{(?:(?!\bthis\.)[\s\S])*?\busing\s*:'
---

# PostgreSQL postchecks check the full definition

The runner runs an operation's postchecks before the operation. When they all hold, it records the operation as already applied and skips it. Several PostgreSQL operations checked only that an object with the planned name exists, so a database holding an index, constraint, policy, table or column of that name but another definition skipped the operation, and the run failed later or left the object as it was. Each of these operations now checks the object's definition in the catalog: kind, table, columns in order, types, referenced table and actions, access method, command and roles. It never compares text that PostgreSQL prints in its own form, such as expressions, predicates, check and policy bodies, or defaults. Renames now also check that the old name is gone.

## The `postgres-postcheck-*` entries

A matched `ops.json` needs action only when its migration is not applied yet. Write its `ops.json` again before you apply it: run its `migration.ts` (`node migration.ts`), or delete the package and run `prisma migration plan` again. An applied migration needs nothing; its operations do not run again. Each detection matches the old check of one operation.

## `postgres-alter-column-type-unchanged-refused`

`this.alterColumnType({ schema, table, column, type, using })` to the type the migration's start contract, after its earlier renames, already gives the column, used to build an operation whose check, the column's type, already held, so the runner skipped it and `using` never ran. `migration.ts` now refuses the call. Write the conversion as a `dataTransform`, which checks the rows themselves:

```typescript
// before
this.alterColumnType({ schema: 'public', table: 'user', column: 'email', type: 'text', using: 'lower(email)' })
// after
this.dataTransform(endContract, 'Lower-case user emails', {
  check: () => /* a query for the users whose email is not lower-case */,
  run: () => /* an update that lower-cases those emails */,
})
```

A matched `migration.ts` needs action only when the call converts a column to the type the start contract already gives it.
