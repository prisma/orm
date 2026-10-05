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
  - id: writes-refuse-limit-or-offset
    summary: |
      `update`, `updateAll`, `updateAndCount`, `deleteAll` and `deleteAndCount` now throw `ORM.ARGUMENT_INVALID` on a collection that has a `limit` or an `offset`. These writes change every row that matches the filter; the limit and the offset were ignored, so more rows changed than the chain asked for. Remove the limit and offset before the write, or read the rows first and change them by their ids.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\.(?:limit|offset)\s*\([^)]*\)[\s\S]{0,300}?\.(?:update|updateAll|updateAndCount|deleteAll|deleteAndCount)\s*\('
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

## Writes refuse a limit or an offset

`update`, `updateAll`, `updateAndCount`, `deleteAll` and `deleteAndCount` change every row that matches the filter. They ignored a `limit` or an `offset` on the collection, so a chain such as `db.orm.public.Post.where(...).limit(10).deleteAll()` deleted every matching row, not ten. They now throw `ORM.ARGUMENT_INVALID` instead. An order is still ignored without an error. Remove the limit and offset, or read the rows and change them by their ids:

```diff
- await db.orm.public.Post.where({ userId }).limit(10).deleteAll();
+ const ids = (await db.orm.public.Post.where({ userId }).select('id').limit(10).all()).map((p) => p.id);
+ await db.orm.public.Post.where((p) => p.id.in(ids)).deleteAll();
```

