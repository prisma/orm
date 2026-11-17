---
changes:
  - id: fragment-types-are-renamed
    summary: |
      The SQL ORM client's types `Fragment` and `FieldFragment`, which 8.0.0-rc.17 exports, are renamed to `QueryFragment` and `DeclaredFieldsFragment`. Code still on the 8.0.0-rc.16 names renames `Scope` to `QueryFragment`, `FieldScope` to `DeclaredFieldsFragment` and `ScopeFacts` to `FragmentFacts` directly. `FragmentFacts`, `DeclaredField`, `db.orm.fragment` and `collection.fragment` keep their names. The detection matches `Fragment` and `Scope` only in an import or re-export from the ORM client (an `orm-client` entry or `@internal/sql-orm-client`), after a namespace import of it, or in an inline `import(...)` type of it, so React's `Fragment` and the SQL builder's `Scope` do not match.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\b(?:FieldFragment|FieldScope|ScopeFacts)\b'
        - '(?:import|export)\s+(?:type\s+)?\{[^}]*\b(?:Fragment|Scope)\b[^}]*\}\s*from\s*[''"]@(?:prisma/[\w-]+/orm-client|internal/sql-orm-client)[''"]'
        - 'import\s+(?:type\s+)?\*\s+as\s+([\w$]+)\s+from\s*[''"]@(?:prisma/[\w-]+/orm-client|internal/sql-orm-client)[''"][\s\S]*\b\1\.(?:Fragment|Scope)\b'
        - 'import\(\s*[''"]@(?:prisma/[\w-]+/orm-client|internal/sql-orm-client)[''"]\s*\)\.(?:Fragment|FieldFragment|Scope|FieldScope)\b'
---

# `Fragment` is now `QueryFragment`, and `FieldFragment` is now `DeclaredFieldsFragment`

A function from a collection to a collection, run with `collection.with(fn)`, is a query fragment, and its type is now named `QueryFragment<In, Out>`. "Fragment" alone also covers a row fragment, a function of the model accessor that `where` and `orderBy` take, and it is the name of React's `Fragment`. What `db.orm.fragment(fields, body)` returns, a fragment declared over the fields it needs, is now typed `DeclaredFieldsFragment`. The types work as before.

These changes apply to the SQL ORM client only. The MongoDB ORM client did not change; skip matches in code that uses it.

Rename `Fragment` to `QueryFragment` and `FieldFragment` to `DeclaredFieldsFragment`. These are the names 8.0.0-rc.17 exports.

```diff
- import type { FieldFragment, Fragment } from '@prisma/orm-postgres/orm-client';
+ import type { DeclaredFieldsFragment, QueryFragment } from '@prisma/orm-postgres/orm-client';

- const newest: Fragment<PostCollection, Ordered<PostCollection>> = (posts) => posts.newestFirst();
+ const newest: QueryFragment<PostCollection, Ordered<PostCollection>> = (posts) => posts.newestFirst();
```

Code that still uses the 8.0.0-rc.16 names renames them to the new names directly: `Scope` to `QueryFragment`, `FieldScope` to `DeclaredFieldsFragment` and `ScopeFacts` to `FragmentFacts`.

Rename every use of these types in the extension's code and in the declarations it exports, including a re-export such as `export type { Fragment } from '@prisma/orm-postgres/orm-client'`, a qualified name such as `Orm.Fragment` after `import * as Orm from '@prisma/orm-postgres/orm-client'`, and an inline type such as `import('@prisma/orm-postgres/orm-client').Fragment`. After renaming, sort the named imports again, since `QueryFragment` sorts in a different place than `Fragment` or `Scope`, and wrap any line the longer names make too long for the formatter.

Do not rename React's `Fragment`, the SQL builder's `Scope` and `ScopeField` (imported from a `builder` entry or `@internal/sql-builder`), or any `Fragment` or `Scope` that is not imported from the ORM client. Do not rename `FragmentFacts` or `DeclaredField`, which keep their names.
