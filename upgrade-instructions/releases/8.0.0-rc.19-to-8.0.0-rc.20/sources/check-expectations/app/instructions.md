---
changes:
  - id: check-expectation
    summary: |
      A migration check that expects one object to be absent or present can now say so in an optional `expectation` field, and a failed precheck's message then names the object: `That check failed: the database already has index "Item_state_idx".` instead of `That check failed on this database.` Checks written without it keep working and keep the generic sentence.
    detection:
      glob: "**/ops.json"
      matches:
        - '(?:\{\s*"description": "(?:[^"\\]|\\.)*",\s*"sql": "(?:SELECT (?:NOT )?EXISTS \(SELECT 1 AS \\"one\\" FROM \\"(?:information_schema\\"\.\\"columns|pg_extension|pg_constraint|pg_class|pg_policies|pg_type|pg_enum|pg_indexes|pg_namespace)\\"(?: AS \\"\w+\\")?(?: INNER JOIN \\"pg_(?:namespace|type|class)\\" AS \\"\w+\\" ON \\"\w+\\"\.\\"\w+\\" = \\"\w+\\"\.\\"\w+\\")* WHERE (?:[^"\\]|\\"(?:table_schema|table_name|column_name|extname|conname|connamespace|conrelid|nspname|schemaname|tablename|policyname|indexname|typname|typnamespace|enumlabel|enumtypid|relname|relkind|oid|type|name|c|n|t|e|i|p)\\")*?\) AS \\"result\\"|SELECT \(to_regclass\(\$\d+\)\) IS (?:NOT )?NULL AS \\"result\\"|SELECT COUNT\(\*\) (?:= 0|> 0) AS \\"result\\" FROM (?:\\"sqlite_master\\"|pragma_table_info\([^)"]*\)|pragma_index_list\([^)"]*\)) WHERE (?:[^"\\]|\\"(?:table_schema|table_name|column_name|extname|conname|connamespace|conrelid|nspname|schemaname|tablename|policyname|indexname|typname|typnamespace|enumlabel|enumtypid|relname|relkind|oid|type|name|c|n|t|e|i|p)\\")*?)"(?:,\s*"params": \[[^\]]*\])?\s*\}|"source": \{\s*"kind": "list(?:Indexes|Collections)"(?:,\s*"collection": "(?:[^"\\]|\\.)*")?\s*\},\s*"filter": \{\s*"kind": "field",(?:[^{}]|\{[^{}]*\})*\},\s*"expect": "(?:exists|notExists)"\s*\})'
  - id: check-expectation-raw-sql
    summary: |
      A precheck or postcheck you write by hand in a `rawSql` operation of a `migration.ts` can carry `expectation`, `{ expects: 'absent' | 'present', object }`, so a failure of it names the object. Add it where the check asks whether one object exists, then run `node migration.ts` for a migration no database has applied yet.
    detection:
      glob: "**/migration.ts"
      matches:
        - '\brawSql\(\{[\s\S]*?\b(?:precheck|postcheck):\s*\[(?:\s*\{(?:[^{}]|\{[^{}]*\})*\},)*?\s*\{[^{}]*\}'
---

# Checks say which object they expect absent or present

Before an operation runs, the migration runner runs its prechecks. When one fails, the error's `why` named the check and said only that it failed on this database. A check that expects one object to be absent or present can now carry that as data, in `expectation`, and the `why` then says what the database already has or lacks. On MongoDB, a check carries the object's name in `object`, and its `expect` says whether it should exist.

Nothing breaks without it. An `ops.json` that has no `expectation` reads, verifies its hash and runs as before.

## Migrations Prisma writes

The PostgreSQL, SQLite and MongoDB operations now write it on every check that asks only whether one object exists. A matched `ops.json`, or a MongoDB `ops.json` written before this change, gains it when you write it again: run its `migration.ts` (`node migration.ts`). Writing it again changes its hash, so do this only for a migration that no database has applied yet. Leave an applied migration as it is.

## Checks you write yourself

In your app's migrations, a check you write in a `rawSql` operation can carry it too. Add `expectation` to the precheck or postcheck step, with `expects: 'absent'` or `'present'` and the object as a reader would name it, then run `node migration.ts`:

```typescript
rawSql({
  // ...
  precheck: [
    {
      description: 'verify extension "vector" is not already enabled',
      sql: "SELECT NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector')",
      expectation: { expects: 'absent', object: 'extension "vector"' },
    },
  ],
})
```

Leave it out of a check about data or about several objects at once, such as a check that a column holds no NULL values.
