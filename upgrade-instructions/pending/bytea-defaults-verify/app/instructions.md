---
changes:
  - id: contract-infer-writes-bytea-default-literals
    summary: |
      `prisma contract infer` now writes a `bytea` column default as a base64 literal, `@default("aGVsbG8=")`, where it wrote ``@default(sql`'\\x68656c6c6f'::bytea`)``. A contract emitted from the new output stores a value instead of an expression, so it gets a new storage hash while the database does not change. Re-emit, then `prisma db sign`, or record an empty migration with `prisma migration new`.
    detection:
      glob: "**/*.prisma"
      matches:
        - '\bBytes(?:\[\])?\??[ \t]+[^\n]*@default\(sql[^\n]*::bytea'
---

# `contract infer` writes `bytea` defaults as base64

## `contract-infer-writes-bytea-default-literals`

Nothing changes until `prisma contract infer` runs again. A schema that keeps the `sql` default keeps working: schema verification reads it as the same bytes as the default in the database.

When infer runs again, it writes each `bytea` default as the base64 the `Bytes` codec stores:

| Before | Now |
| --- | --- |
| ``@default(sql`'\\x68656c6c6f'::bytea`)`` | `@default("aGVsbG8=")` |
| ``@default(sql`ARRAY['\\x68656c6c6f'::bytea]`)`` | `@default(["aGVsbG8="])` |

1. Run `prisma contract emit`. The default is now stored as a value, so the storage hash changes. The default in the database does not change.
2. If you create the database with `prisma db init` or `prisma db update`, run `prisma db verify --schema-only` to confirm the schema matches, then `prisma db sign` to sign the database with the re-emitted contract.
3. If you use migrations, `prisma migration plan` refuses with "Contract changed but planner produced no operations", because nothing in the database changes. Run `prisma migration new --name bytea-default-literals` to write an empty migration from the earlier contract to the re-emitted one, then `prisma db migrate`. When `migration new` cannot tell where to start, pass `--from` with the `to` hash of your latest migration, which `prisma migration list` shows.

Sign the database or apply the migration before you deploy the re-emitted contract. Until then the application logs `CONTRACT.MARKER_MISMATCH`, because the database marker holds the earlier storage hash.
