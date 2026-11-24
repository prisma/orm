---
changes:
  - id: sql-builder-shared-join-column-name-needs-table
    summary: |
      In the SQL builder, a column name that two or more joined tables have is now reached only through its table, such as `f.users.id`, however many tables the query joins. Before, with three or more joined tables, a name that the first two shared but a later one also had, such as `id`, became a top-level field again. In 8.0.0-rc.25, reading that field in a callback, such as `f.id`, type-checked, ran without an error and silently returned the column of the last joined table that has the name; in earlier releases the database refused it as ambiguous. Passing the name as a string, as in `select('id')`, `orderBy('id')`, `groupBy('id')` or `distinctOn('id')`, was refused by the database as ambiguous in every release. Both forms are now a type error, and the string forms throw `ORM.COLUMN_AMBIGUOUS` when `select` (or `orderBy`, `groupBy` or `distinctOn`) is called. Decide which table's column the code means, which may not be the last joined table that has the name, and name that table. Results that the callback form produced in 8.0.0-rc.25 may hold the wrong table's values; so may either form inside a lateral subquery.
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

- In 8.0.0-rc.25 it type-checked and ran without an error, and `f.id` returned the column of the last joined table that has the name: `profiles.id` here.
- In earlier releases the database refused the query because `id` was ambiguous.

Do not assume the last joined table that has the name is the right one. Read the code, decide which table's column it means, and name that table. In this example the code most likely meant the user's id:

```ts
  .select((f) => ({ id: f.users.id }));
```

If it meant another table, name that one instead, such as `f.posts.id` or `f.profiles.id`. If the code ran on 8.0.0-rc.25 and meant a table other than the last joined table that has the name, the results it produced, and any data written from them, hold the wrong table's values; check them. The same applies to such a name read in `where`, `orderBy` and the other callbacks.

Passing the name as a string is different. `select('id')`, `orderBy('id')`, `groupBy('id')` and `distinctOn('id')` sent a bare `"id"`, which the database refused as ambiguous in 8.0.0-rc.25 and every earlier release, so that code never returned wrong results. It is now a type error, and it throws `ORM.COLUMN_AMBIGUOUS` when `select` (or `orderBy`, `groupBy` or `distinctOn`) is called, instead of failing in the database. The error's `fix` lists the tables that have the name; decide which one the code means and name it, such as `select('id', (f) => f.users.id)`, or `orderBy((f) => f.users.id)` and the same for `groupBy` and `distinctOn`. Keep `orderBy`'s options; for `select`, `groupBy` and `distinctOn`, put any other names in a separate call, which adds to the earlier one.

In a join of two tables, a name both share was already not a top-level field, so passing it as a string was a type error before too. Code that reached it anyway, through a cast or a name built at run time, used to get `ORM.COLUMN_UNKNOWN` and now gets `ORM.COLUMN_AMBIGUOUS`.

Inside the subquery of `lateralJoin` or `outerLateralJoin`, both forms could run without an error: a name that the subquery's table shared with the parent tables read the subquery's own table. If the code meant a parent table's column, its results hold the wrong values; check them. Write the table's name, such as `f.profiles.id`.

Names that only one joined table has stay available at top level.
