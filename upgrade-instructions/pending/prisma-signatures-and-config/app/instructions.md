---
changes:
  - id: marker-table-is-signatures
    summary: |
      On PostgreSQL, Prisma's `marker` table is replaced by `_prisma.signatures`, one row per contract space with the columns `space`, `core_hash`, `profile_hash`, `invariants` and `signed_at`, and `_prisma.config`, which holds the database's policies. Queries, scripts and project docs that name the marker table, as `_prisma.marker` or `prisma_contract.marker`, name `_prisma.signatures` instead, or `_prisma.config` for the policies.
    detection:
      glob: "**/*"
      matches:
        - '(?:_prisma|prisma_contract)"?\."?marker\b'
        - '[Mm]arker table'
---

# The marker table is split into signatures and config

## `marker-table-is-signatures`

The change `prisma-tables-move-to-prisma-schema` describes the whole upgrade, including how the first command moves the rows. This entry covers only text in the project that names the marker table.

Search the project for `_prisma.marker` and `prisma_contract.marker`, also written with quoted names (`"_prisma"."marker"`, `"prisma_contract"."marker"`), outside `node_modules`, build output and planned migrations, and for docs that describe "the marker table". Also search for SQL that names `marker` without a schema, in code that sets `search_path` to include `prisma_contract`: such a query reads the same table, and fails once it is dropped; changing `search_path` does not help, since `_prisma` has no `marker` either. Planned migrations are left out of the search and are never edited, because a migration's hash covers its SQL. A planned migration that names the marker table follows the rule `prisma-tables-move-to-prisma-schema` gives for one that names `prisma_contract`: if it has already been applied to every database it needs no change; if it will still run on a database that has not applied it, stop and tell the user that from this release it fails there, because the table it names no longer exists, and the user decides how to replace it. In each of the other matches:

- Where it reads which contract a space was signed with, its hashes or its invariants, name `_prisma.signatures`. Use `signed_at` where it used `updated_at`. The columns `contract_json`, `canonical_version`, `app_tag` and `meta` are gone.
- Where it reads the policies from `meta -> 'policies'` on the application's row, read the `policies` column of `_prisma.config`, which has at most one row.

`_prisma.signatures` also has a row for the space `_prisma`, the contract space of Prisma's own tables. A query or a doc that lists every space should leave it out or say it is there. For example:

```sql
-- Before
select space, core_hash, invariants from prisma_contract.marker order by space;

-- After
select space, core_hash, invariants from _prisma.signatures where space <> '_prisma' order by space;
```
