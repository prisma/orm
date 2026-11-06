---
changes:
  - id: sqlite-postchecks-check-full-definition
    summary: |
      On SQLite, the checks that let the runner skip an operation whose effect is already in place now check the whole definition. `createTable` checks every column's name, type, nullability and primary key position; `addColumn` checks the column's type and nullability; `createIndex` checks the index's table, ordered columns and uniqueness; `recreateTable` checks foreign key actions and `autoincrement()`. An `ops.json` written by an earlier release still carries the old checks; write it again before you apply it.
    detection:
      glob: "**/ops.json"
      matches:
        - '(?<![\s\S])(?![\s\S]*has exactly its columns)[\s\S]*"description":\s*"verify table \\"(?:[^"\\]|\\.)*\\" exists",\s*"sql":\s*"(?:[^"\\]|\\.)*sqlite_master'
        - '(?<![\s\S])(?![\s\S]*\\" has type )[\s\S]*"description":\s*"verify column \\"(?:[^"\\]|\\.)*\\" exists",\s*"sql":\s*"(?:[^"\\]|\\.)*pragma_table_info'
        - '(?<![\s\S])(?![\s\S]*\\" covers \()[\s\S]*"description":\s*"verify index \\"(?:[^"\\]|\\.)*\\" exists",\s*"sql":\s*"(?:[^"\\]|\\.)*sqlite_master'
        - 'pragma_foreign_key_list\(''(?:[^''\\]|\\.)*''\) f WHERE f\.\\"table\\" = ''(?:[^''\\]|\\.)*'' GROUP BY'
---

# SQLite postchecks check the whole definition

## `sqlite-postchecks-check-full-definition`

The runner checks an operation's postchecks before it runs the operation, and skips the operation when they already hold. Some SQLite postchecks held for a different state:

- `createTable` checked only that a table of that name exists, whatever its columns.
- `addColumn` checked only that a column of that name exists, whatever its type or nullability.
- `createIndex` checked only that an index of that name exists, whatever its table or columns.
- `recreateTable` did not check foreign key actions (`onDelete`, `onUpdate`) or `autoincrement()`. A migration that changed only those was skipped, and `prisma db migrate` then failed with `MIGRATION.SCHEMA_VERIFY_FAILED`.

Each of these postchecks now checks the whole definition, so the runner skips an operation only when its full effect is in place.

The checks are written into `ops.json` when the migration package is written. A matched `ops.json` needs action only when its migration is not applied yet. Write its `ops.json` again before you apply it: run its `migration.ts` (`node migration.ts`), or delete the package and run `prisma migration plan` again. An applied migration needs nothing. A `recreateTable` written for an `autoincrement()` change has no text to detect; write it again as well when its migration is not applied yet.
