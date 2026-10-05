---
changes:
  - id: scope-is-a-collection-member
    summary: |
      Every collection now has a `scope` method. A custom collection class that declares its own `scope` member with another signature no longer compiles; rename it.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?:^|\n)[ \t]*(?:(?:public|protected|private|readonly|static|async|override)\s+)*scope\s*[(<:=?]'
  - id: imported-postgres-field-checks-defaults
    summary: |
      The `field` exported by the Postgres facade's `contract-builder` entry now has the Postgres presets and checks a `.default(...)` value against the column type, as the `defineContract` callback's `field` does. A default of the wrong type, which compiled before and failed when the contract was built, is now a compile error; give the value the column's type.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - 'import\s*\{[^}]*\bfield\b[^}]*\}\s*from\s*[''"]@(?:prisma/orm-|internal/)postgres/contract-builder[''"]'
---

The `scope` change applies to the SQL ORM client only. The MongoDB ORM client did not change; skip matches in code that uses it.

## `scope` is a member of every collection

Collections have a new method, `scope(body)`, which defines a scope for the collection's model: `db.Post.scope((posts) => posts.select('id', 'title'))`. A custom collection class that declares its own `scope` with another signature no longer compiles. Rename that member and its call sites:

```diff
  class PostCollection extends Collection<Contract, 'Post'> {
-   scope(userId: string) { return this.where({ userId }); }
+   ownedBy(userId: string) { return this.where({ userId }); }
  }
```

An aggregate operation named `scope` is now refused with `ORM.AGGREGATE_OPERATION_RESERVED` when the client is built; rename the operation.

## The `field` of the Postgres `contract-builder` entry checks defaults

`import { field } from '@prisma/orm-postgres/contract-builder'` now gives the same field builders the `defineContract` callback receives, without the ones an extension adds: `field.text()`, `field.temporal.timestamptz()`, `field.uuidString()`, and `field.column(columnType)` as before. Its `.default(...)` now checks the value against the column type. A default of another type no longer compiles:

```diff
- field.column(int8Column).default(1)
+ field.column(int8Column).default(1n)
```
