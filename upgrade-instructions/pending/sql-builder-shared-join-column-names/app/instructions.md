---
changes:
  - id: sql-builder-shared-join-column-name-needs-table
    summary: |
      In the SQL builder, a column name that two or more joined tables have is now reached only through its table, such as `f.profiles.id`, however many tables the query joins. Before, with three or more joined tables, a name that the first two shared but a later one also had, such as `id`, became a top-level field again: `f.id` and `select('id')` type-checked and the query failed in the database as ambiguous. They are now a type error, and `select('id')` is refused at run time with `ORM.COLUMN_UNKNOWN`. Name the table the column belongs to.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      matches:
        - '\.(?:innerJoin|outerLeftJoin|outerRightJoin|outerFullJoin)\('
---

# A column name that several joined tables share needs its table

## `sql-builder-shared-join-column-name-needs-table`

In a query that joins three or more tables, a column name that more than one of them has, such as `id`, is no longer a top-level field. This code now fails to type-check:

```ts
db.public.users
  .innerJoin(db.public.posts, (f, fns) => fns.eq(f.users.id, f.posts.user_id))
  .innerJoin(db.public.profiles, (f, fns) => fns.eq(f.users.id, f.profiles.user_id))
  .select((f) => ({ id: f.id }));
```

Before, it type-checked, and the database refused the query because `id` was ambiguous. Name the table whose column you mean:

```ts
  .select((f) => ({ id: f.profiles.id }));
```

The same applies to `select('id')`, `where`, `orderBy` and the other callbacks. Names that only one joined table has stay available at top level.
