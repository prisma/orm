---
changes:
  - id: scope-is-a-collection-member
    summary: |
      Every collection now has a `scope` method. A custom collection class that declares its own `scope` member with another signature no longer compiles; rename it.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?:^|\n)[ \t]*(?:(?:public|protected|private|readonly|static|async|override|get|set)\s+)*scope\s*[!(<:=?]'
  - id: imported-postgres-field-checks-defaults
    summary: |
      The `field` exported by the Postgres facade's `contract-builder` entry now has the Postgres presets and checks a `.default(...)` value against the Postgres target's column types, as the `defineContract` callback's `field` does; it does not know the column types an extension adds, such as pgvector's, so it does not check those. A default of the wrong type, which compiled before and failed when the contract was built, is now a compile error; give the value the column's type.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - 'import\s*\{[^}]*\bfield\b[^}]*\}\s*from\s*[''"]@(?:prisma/orm-|internal/)postgres/contract-builder[''"]'
  - id: writes-refuse-what-they-would-ignore
    summary: |
      `updateAll`, `updateAndCount`, `deleteAll` and `deleteAndCount` now throw `ORM.ARGUMENT_INVALID` on a collection that has a `limit`, an `offset`, a `cursor`, `distinct` or `distinctOn`. These writes change every row that matches the filter; their statement cannot apply any of these, so they were ignored and more rows changed than the chain asked for. Remove them before the write, or read the rows first and change them by their ids. `update` with a relation callback now throws on a collection with an order, a limit, an offset, a cursor, `distinct` or `distinctOn`, which it ignored; filter it to the one row instead. `update` and `delete` without a relation callback change the row `first()` returns, as before, except after `limit(0)`: they changed one row and now change none and return `null`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\.(?:limit|offset|cursor|distinct|distinctOn)\s*\([^)]*\)[\s\S]{0,300}?\.(?:update|updateAll|updateAndCount|delete|deleteAll|deleteAndCount)\s*\('
        - '\.orderBy\s*\([\s\S]{0,300}?\.update\s*\('
---

The `scope` change applies to the SQL ORM client only. The MongoDB ORM client did not change; skip matches in code that uses it.

## `scope` is a member of every collection

Collections have a new method, `scope(body)`, which defines a scope for the collection's model: `db.orm.public.Post.scope((posts) => posts.select('id', 'title'))`. A custom collection class that declares its own `scope` with another signature no longer compiles. Rename that member and its call sites:

```diff
  class PostCollection extends Collection<Contract, 'Post'> {
-   scope(userId: string) { return this.where({ userId }); }
+   ownedBy(userId: string) { return this.where({ userId }); }
  }
```

An aggregate operation named `scope` is now refused with `ORM.AGGREGATE_OPERATION_RESERVED` when the client is built; rename the operation.

## The `field` of the Postgres `contract-builder` entry checks defaults

`import { field } from '@prisma/orm-postgres/contract-builder'` now gives the same field builders the `defineContract` callback receives, without the ones an extension adds: `field.text()`, `field.temporal.timestamptz()`, `field.uuidString()`, and `field.column(columnType)` as before. Its `.default(...)` now checks the value against the Postgres target's column types; a column type an extension adds, such as pgvector's `vector`, is not checked. A default of another type no longer compiles:

```diff
- field.column(int8Column).default(1)
+ field.column(int8Column).default(1n)
```

## Writes refuse what they would ignore

`updateAll`, `updateAndCount`, `deleteAll` and `deleteAndCount` change every row that matches the filter. They ignored a `limit`, an `offset`, a `cursor`, `distinct` and `distinctOn` on the collection, so a chain such as `db.orm.public.Post.where(...).limit(10).deleteAll()` deleted every matching row, not ten, and one with `.cursor({ id })` deleted the rows before the cursor too. They now throw `ORM.ARGUMENT_INVALID` instead. An order does not change which rows they change, and they still accept it. Remove what the write would ignore, or read the rows and change them by their ids:

```diff
- await db.orm.public.Post.where({ userId }).limit(10).deleteAll();
+ const ids = (await db.orm.public.Post.where({ userId }).select('id').limit(10).all()).map((p) => p.id);
+ await db.orm.public.Post.where((p) => p.id.in(ids)).deleteAll();
```

`update` and `delete` change one row, the one `first()` returns, so the order, the offset, the cursor, `distinct` and `distinctOn` choose it; they are unchanged, except after `limit(0)`. `first()` replaces the limit with 1, so after `limit(0)` they changed one row; they now change none and return `null`. A `limit(0)` that a request can set, such as a page size of zero, no longer writes.

The exception is `update` with a relation callback, such as `posts: (posts) => posts.connect(...)`. It finds its row by the filter alone and ignored the order, the limit, the offset, the cursor, `distinct` and `distinctOn`, so it could change another row than the chain chose. It now throws `ORM.ARGUMENT_INVALID` on a collection with any of them. Find the row first and filter to it:

```diff
- await users.where({ teamId }).orderBy((u) => u.createdAt.asc()).update({ posts: (posts) => posts.connect([{ id: postId }]) });
+ const oldest = await users.where({ teamId }).orderBy((u) => u.createdAt.asc()).select('id').first();
+ if (oldest) await users.where({ id: oldest.id }).update({ posts: (posts) => posts.connect([{ id: postId }]) });
```

