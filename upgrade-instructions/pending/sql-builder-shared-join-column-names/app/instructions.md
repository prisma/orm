---
changes:
  - id: sql-builder-shared-join-column-name-needs-table
    summary: |
      In the SQL builder, a column name that two or more joined tables have is now reached only through its table, such as `f.users.id`, however many tables the query joins. Before, with three or more joined tables, a name that the first two shared but a later one also had, such as `id`, became a top-level field again. In 8.0.0-rc.25, `f.id` and `select('id')` type-checked, ran, and silently returned the column of the table joined last, without an error; in earlier releases the database refused the query as ambiguous. They are now a type error, and `select('id')` is refused at run time with `ORM.COLUMN_UNKNOWN`. Decide which table's column the code means, which may not be the one joined last, and name that table. Results such code produced in 8.0.0-rc.25 may hold the wrong table's values.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      matches:
        - '\.(?:innerJoin|outerLeftJoin|outerRightJoin|outerFullJoin|lateralJoin|outerLateralJoin)\('
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

What this code did before depends on the release:

- In 8.0.0-rc.25 it type-checked and ran without an error, and `f.id` returned the column of the table joined last: `profiles.id` here.
- In earlier releases the database refused the query because `id` was ambiguous.

Do not assume the table joined last is the right one. Read the code, decide which table's column it means, and name that table. In this example the code most likely meant the user's id:

```ts
  .select((f) => ({ id: f.users.id }));
```

If it meant another table, name that one instead, such as `f.posts.id` or `f.profiles.id`. If the code ran on 8.0.0-rc.25 and meant a table other than the last one joined, the results it produced, and any data written from them, hold the wrong table's values; check them.

The same applies to `select('id')`, `where`, `orderBy` and the other callbacks, and inside the subquery of `lateralJoin` or `outerLateralJoin`: there, a name that the subquery's table shares with two or more parent tables read the subquery's own table. Write that table's name, such as `f.profiles.id`. Names that only one joined table has stay available at top level.
