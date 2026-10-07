---
changes:
  - id: collection-state-carries-tables
    summary: |
      A SQL ORM `CollectionState` has a required `tables` property holding the table scope and the bindings of the collection's root table and variant tables, and `emptyState()` takes it as its argument. Build it with `bindCollectionTables(contract, namespaceId, modelName)`. This applies to every hand-built state, including `IncludeExpr.nested`, a `combine()` branch state and the state of an include scalar selector.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      matches:
        - '\bemptyState\('
        - '\bCollectionState\b'
  - id: create-model-accessor-takes-tables
    summary: |
      `createModelAccessor` takes the collection's tables as its fourth argument, before the optional variant name: `createModelAccessor(context, namespaceId, modelName, tables, variantName?)`.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      matches:
        - '\bcreateModelAccessor\('
  - id: include-expr-junction-binding
    summary: |
      A hand-built `IncludeExpr` for a many-to-many relation needs a `junction` table binding next to `through`. Compiling a `through` include without one throws.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      matches:
        - '\bIncludeExpr\b'
  - id: include-rejects-foreign-collection
    summary: |
      `include()` throws `ORM.INCLUDE_INVALID` with `reason: 'foreign-collection'` when its refinement callback returns a collection, include scalar selector or `combine()` branch that was not derived from the collection the callback received.
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

These changes concern code that imports from `@prisma/orm-family-sql/orm-client` and builds SQL ORM collection state or model accessors by hand, or that asserts on the SQL text the ORM generates. Code that only chains collection methods needs the `include-rejects-foreign-collection` check and nothing else.

## `collection-state-carries-tables`

`CollectionState.tables` is a `CollectionTables` value: the table scope plus the bindings of the collection's root table and of each multi-table-inheritance variant table. `emptyState` takes it as a required argument. Build it from the contract with `bindCollectionTables`:

```ts
// before
import { emptyState } from '@prisma/orm-family-sql/orm-client';

const state = { ...emptyState(), limit: 10 };

// after
import { bindCollectionTables, emptyState } from '@prisma/orm-family-sql/orm-client';

const tables = bindCollectionTables(contract, 'public', 'User');
const state = { ...emptyState(tables), limit: 10 };
```

`bindCollectionTables(contract, namespaceId, modelName)` takes the model the state is for. For a polymorphic model pass the base model name; the variant tables are bound with it.

Every object typed `CollectionState` needs the property, not only top-level states:

- `IncludeExpr.nested`;
- the `state` of a `combine()` rows branch;
- the `state` of an include scalar selector.

A state passed to `new Collection(ctx, modelName, { state })` needs it too. A `Collection` constructed without `state` builds its own tables, so that call needs no change.

Do not build a `CollectionTables` or a table scope by hand. The scope must be one the package created.

A state built by hand for an include child must not reuse the parent's table names. Prefer building includes through `collection.include(...)` and reading `collection.state`, which binds the child from the parent's scope. Where a child state is built by hand for a relation whose target table already appears in the parent chain (a self-relation, or an include that returns to an ancestor's table), build it through `include()` instead; `bindCollectionTables` starts a fresh scope and would give the child the same reference as its parent.

## `create-model-accessor-takes-tables`

Pass the tables as the fourth argument. A variant name moves to the fifth:

```ts
// before
createModelAccessor(context, 'public', 'User');
createModelAccessor(context, 'public', 'Task', 'Feature');

// after
createModelAccessor(context, 'public', 'User', bindCollectionTables(context.contract, 'public', 'User'));
createModelAccessor(
  context,
  'public',
  'Task',
  bindCollectionTables(context.contract, 'public', 'Task'),
  'Feature',
);
```

The accessor takes the names for its relation filters and relation orders from `tables.scope` and records them there. Two relation filters over the same table built from one accessor therefore get different references (`posts`, then `posts_2`). Pass each accessor its own `bindCollectionTables(...)` result unless the expressions it builds are meant for one statement.

## `include-expr-junction-binding`

This affects only an `IncludeExpr` object written out by hand with a `through` descriptor. An include built with `collection.include('<relation>')` carries the binding already.

There is no public function that binds a junction table on its own. Replace the hand-built object with the include the collection builds:

```ts
// before
const include: IncludeExpr = { relationName: 'tags', through: { table: 'user_tags', /* … */ }, /* … */ };

// after
const [include] = users.include('tags').state.includes;
```

## `include-rejects-foreign-collection`

Check each `include()` refinement callback. It must return a value built from its own parameter:

```ts
// throws ORM.INCLUDE_INVALID (reason: 'foreign-collection')
users.include('posts', () => db.Post.where({ published: true }));
users.include('posts', (posts) => posts.combine({ recent: db.Post.limit(3) }));

// build from the parameter instead
users.include('posts', (posts) => posts.where({ published: true }));
users.include('posts', (posts) => posts.combine({ recent: posts.limit(3) }));
```

A refinement that returned an unrelated collection used to be accepted and its state was used as the include's. To reuse a refinement across includes, share a function that takes the refinement's parameter, or a scope made with `db.orm.scope(...)` / `Model.scope(...)` and passed to `.with(...)`.

## `sql-orm-table-references-renamed`

No code that only runs queries needs to change. Update assertions, snapshots and log matchers that contain generated SQL or inspect the query AST:

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
