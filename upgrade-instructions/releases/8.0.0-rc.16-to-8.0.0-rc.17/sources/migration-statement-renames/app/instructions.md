---
changes:
  - id: non-data-drops-are-widening
    summary: |
      Dropping an index, a unique or foreign-key constraint, a check, a row-level-security policy, a default or a native enum type, and disabling row-level security, are now `widening` operations on Postgres and SQLite. `prisma db update` no longer asks for consent before them, and `prisma migration plan` no longer counts them when it asks for consent to an auto-baseline. A script or CI job that passes `--confirm <token>` only to get past those operations now runs without it.
    detection:
      glob: "**/*.{sh,bash,zsh,yml,yaml,json,toml,mjs,cjs,js,ts,mts,cts}"
      matches:
        - '(?<![\w-])--confirm(?![\w-])'
  - id: rename-statements
    summary: |
      `prisma migration plan` and `prisma db update` accept `--rename <old>:<new>`, repeatable, to rename a model or a field instead of dropping and creating its table or column. Each side is `Model`, `namespace.Model`, `Model.field` or `namespace.Model.field`, and a field's model is named as the new contract names it: `--rename Profile:User --rename User.name:User.fullName`.
---

# Non-data drops are widening, and renames are stated on the command line

## `non-data-drops-are-widening`

For each `prisma db update ... --confirm <database>` or `prisma migration plan ... --confirm <directory>` in a script or CI job, check what the consent was for. Consent is still required for dropping a table or a column, for a type change that can lose data, and for the other operations that remove data. If the `--confirm` was only there because the run dropped an index, a constraint, a check, a policy, a default or a native enum type, or disabled row-level security, remove it, or leave it in place: the command now runs without it, and an unused consent token does no harm.

## `rename-statements`

When a contract change renames a model or a field and the plan drops and creates its table or column, state the rename instead of editing the migration by hand: `prisma migration plan --rename <old>:<new>` or `prisma db update --rename <old>:<new>`. The planner then renames the table or column, and the constraints and indexes named after it, and keeps the rows. `db update` resolves the old names against the contract snapshot of the database's last update, which it stores when it advances a ref; with `--db <url>`, pass `--advance-ref <name>` on the run before the rename so the snapshot exists. Nothing in an existing project needs to change.
