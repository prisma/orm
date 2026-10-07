---
changes:
  - id: include-rejects-foreign-collection
    summary: |
      `include()` on a SQL ORM collection throws `ORM.INCLUDE_INVALID` with `reason: 'foreign-collection'` when its refinement callback returns a collection, include scalar selector or `combine()` branch that was not derived from the collection the callback received.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      matches:
        - '\.include\s*[(<]'
  - id: sql-orm-table-references-renamed
    summary: |
      The SQL ORM names tables in generated SQL as `<table>` for the first use and `<table>_<n>` for later uses. The aliases `__orm_rel_<n>`, `__orm_junction_<n>`, `<relation>__child` and `<table>__write_filter` are gone, and a table used twice in one collection chain is now aliased where it was not before. Query results are unchanged; code and tests that match on SQL text need updating.
    detection:
      glob: "**/*.{ts,tsx,mts,cts,snap}"
      matches:
        - '__orm_rel_\d'
        - '__orm_junction_\d'
        - '__child\b'
        - '__write_filter\b'
---

## `include-rejects-foreign-collection`

Check each `include()` refinement callback. It must return a value built from its own parameter:

```ts
// throws ORM.INCLUDE_INVALID (reason: 'foreign-collection')
db.orm.public.User.include('posts', () => db.orm.public.Post.where({ published: true }));
db.orm.public.User.include('posts', (posts) =>
  posts.combine({ recent: db.orm.public.Post.limit(3) }),
);

// build from the parameter instead
db.orm.public.User.include('posts', (posts) => posts.where({ published: true }));
db.orm.public.User.include('posts', (posts) => posts.combine({ recent: posts.limit(3) }));
```

A refinement that returned an unrelated collection used to be accepted, and that collection's filters, order and selection were used for the include. Rewrite such a callback to apply the same calls to its parameter. This also covers a refinement that ignores its parameter and returns a collection kept in a variable, a scalar reducer called on another collection (`db.orm.public.Post.count()`), and a helper function that returns a collection it did not receive as an argument.

To reuse a refinement across includes, share a function that takes the refinement's parameter and returns what it builds from it. A scope made with `db.orm.scope(...)` or `Model.scope(...)` can be passed to `.with(...)` on the parameter in the same way.

```ts
const publishedOnly = <C extends { where(filter: { published: boolean }): C }>(posts: C): C =>
  posts.where({ published: true });

db.orm.public.User.include('posts', (posts) => publishedOnly(posts));
```

## `sql-orm-table-references-renamed`

Code that only runs queries needs no change. Update assertions, snapshots and log matchers that contain SQL the ORM generated:

| Before | After |
| --- | --- |
| `"__orm_rel_1"` for a relation filter or relation order over the collection's own table | `"<table>_2"`, counting up for each further use of that table in the chain |
| `"__orm_junction_<n>"` for a repeated junction table | `"<junction table>_<n>"` |
| `"<relation>__child"` for a self-relation include | `"<table>_<n>"` |
| `"<table>__write_filter"` in `updateAndCount` / `deleteAndCount` on a multi-table-inheritance variant | `"<table>_<n>"`; the filters inside that subquery now reference the statement's target table directly |

Text also changes in cases that had no alias before:

- a table used by two relation filters in one chain, or by a relation filter and an include, or by two includes: every use after the first is aliased;
- an include that returns to a table an enclosing level already uses (for example users → posts → author);
- the variant table of an included polymorphic model whose table already appears in the chain: the table is aliased and its projected column labels become `<table>_<n>__<column>`;
- the derived tables of an include (`<relation>__rows` and the like) when the same relation is included at two levels of one statement, or in two `combine()` branches: the second gets a `_2` suffix.

Names follow the order of the calls in the chain, so `where(...).include(...)` and `include(...).where(...)` give the two uses of a table their names in opposite order. Regenerate snapshots rather than editing them by hand, and check that the rows the tests assert are unchanged.
