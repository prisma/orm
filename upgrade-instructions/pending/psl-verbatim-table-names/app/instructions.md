---
changes:
  - id: psl-model-names-table-verbatim
    summary: |
      A PSL `model` with no `@@map` now names its table (or Mongo collection) after the model
      verbatim: `model UserProfile` maps to `"UserProfile"`, where it used to map to `"userProfile"`.
      Run the colocated codemod over every `.prisma` file so each unmapped model gets
      `@@map("<current table name>")` and keeps the table it already has. Emitted contracts,
      storage hashes, and migration history are unchanged after the codemod. Without it, planning
      fails with `MIGRATION.TABLE_NAME_CASE_CHANGED` instead of dropping and recreating the table.
    detection:
      glob: "**/*.prisma"
      contains:
        - "model "
    script: ./scripts/add-model-map.mjs
---

Run the codemod over every schema file in the project, then re-run `prisma contract emit` and confirm `contract.json` is unchanged:

```bash
node scripts/add-model-map.mjs 'src/**/*.prisma' 'migrations/**/contract.prisma'
```

The script is idempotent. It leaves models that already have `@@map` alone, and leaves a variant with `@@base(...)` and no `@@map` alone because it shares its base's table. To adopt the verbatim table names instead, skip the codemod and rename the tables yourself before planning.
