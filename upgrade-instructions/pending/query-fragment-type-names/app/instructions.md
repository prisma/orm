---
changes:
  - id: fragment-types-are-renamed
    summary: |
      The SQL ORM client's types `Scope` and `FieldScope`, which 8.0.0-rc.16 exports, are renamed to `QueryFragment` and `DeclaredFieldsFragment`; rename them directly, without the intermediate names `Fragment` and `FieldFragment`, which no release exported. Code that already uses `Fragment` or `FieldFragment` renames those the same way. `ScopeFacts` becomes `FragmentFacts`; `DeclaredField`, `db.orm.fragment` and `collection.fragment` keep their names. The detection matches `Fragment` and `Scope` only in an import or re-export from an `orm-client` entry, after a namespace import of one, or in an inline `import(...)` type of one, so React's `Fragment` and the SQL builder's `Scope` do not match.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\b(?:FieldFragment|FieldScope)\b'
        - '(?:import|export)\s+(?:type\s+)?\{[^}]*\b(?:Fragment|Scope)\b[^}]*\}\s*from\s*[''"]@prisma/[\w-]+/orm-client[''"]'
        - 'import\s+(?:type\s+)?\*\s+as\s+([\w$]+)\s+from\s*[''"]@prisma/[\w-]+/orm-client[''"][\s\S]*\b\1\.(?:Fragment|Scope)\b'
        - 'import\(\s*[''"]@prisma/[\w-]+/orm-client[''"]\s*\)\.(?:Fragment|FieldFragment|Scope|FieldScope)\b'
---

# `Scope` is now `QueryFragment`, and `FieldScope` is now `DeclaredFieldsFragment`

A function from a collection to a collection, run with `collection.with(fn)`, is a query fragment, and its type is now named `QueryFragment<In, Out>`. "Fragment" alone also covers a row fragment, a function of the model accessor that `where` and `orderBy` take, and it is the name of React's `Fragment`. What `db.orm.fragment(fields, body)` returns, a fragment declared over the fields it needs, is now typed `DeclaredFieldsFragment`. The types work as before.

These changes apply to the SQL ORM client only. The MongoDB ORM client did not change; skip matches in code that uses it.

Rename `Scope` to `QueryFragment` and `FieldScope` to `DeclaredFieldsFragment` directly. Do not stop at `Fragment` and `FieldFragment`: those names were planned for this release and never released. Code that already uses `Fragment` or `FieldFragment` renames them the same way. `ScopeFacts` is now `FragmentFacts`.

```diff
- import type { FieldScope, Scope, ScopeFacts } from '@prisma/orm-postgres/orm-client';
+ import type { DeclaredFieldsFragment, FragmentFacts, QueryFragment } from '@prisma/orm-postgres/orm-client';

- const newest: Scope<PostCollection, Ordered<PostCollection>> = (posts) => posts.newestFirst();
+ const newest: QueryFragment<PostCollection, Ordered<PostCollection>> = (posts) => posts.newestFirst();
```

Rename every use of these types in the file, including a re-export such as `export type { Scope } from '@prisma/orm-postgres/orm-client'`, a qualified name such as `Orm.Scope` after `import * as Orm from '@prisma/orm-postgres/orm-client'`, and an inline type such as `import('@prisma/orm-postgres/orm-client').Scope`. After renaming, sort the named imports again, since `QueryFragment` sorts in a different place than `Scope` or `Fragment`, and wrap any line the longer names make too long for the formatter.

Do not rename React's `Fragment`, the SQL builder's `Scope` and `ScopeField` (imported from a `builder` entry), or any `Fragment` or `Scope` that is not imported from the ORM client. Do not rename `FragmentFacts` or `DeclaredField`, which keep their names.
