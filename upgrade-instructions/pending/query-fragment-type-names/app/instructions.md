---
changes:
  - id: fragment-types-are-renamed
    summary: |
      The SQL ORM client's types `Fragment` and `FieldFragment` are renamed to `QueryFragment` and `DeclaredFieldsFragment`. Code written against the earlier names `Scope` and `FieldScope` goes straight to the new names. `FragmentFacts`, `DeclaredField`, `db.orm.fragment` and `collection.fragment` keep their names. The detection matches `Fragment` only in an import or re-export from an `orm-client` entry, or after a namespace import of one, so React's `Fragment` does not match.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\bFieldFragment\b'
        - '(?:import|export)\s+(?:type\s+)?\{[^}]*\bFragment\b[^}]*\}\s*from\s*[''"]@prisma/[\w-]+/orm-client[''"]'
        - 'import\s+(?:type\s+)?\*\s+as\s+([\w$]+)\s+from\s*[''"]@prisma/[\w-]+/orm-client[''"][\s\S]*\b\1\.Fragment\b'
---

# `Fragment` is now `QueryFragment`, and `FieldFragment` is now `DeclaredFieldsFragment`

A function from a collection to a collection, run with `collection.with(fn)`, is a query fragment, and its type is now named `QueryFragment<In, Out>`. "Fragment" alone also covers a row fragment, a function of the model accessor that `where` and `orderBy` take, and it is the name of React's `Fragment`. What `db.orm.fragment(fields, body)` returns, a fragment declared over the fields it needs, is now typed `DeclaredFieldsFragment`. The types work as before.

These changes apply to the SQL ORM client only. The MongoDB ORM client did not change; skip matches in code that uses it.

```diff
- import type { FieldFragment, Fragment, FragmentFacts } from '@prisma/orm-postgres/orm-client';
+ import type { DeclaredFieldsFragment, FragmentFacts, QueryFragment } from '@prisma/orm-postgres/orm-client';

- const newest: Fragment<PostCollection, Ordered<PostCollection>> = (posts) => posts.newestFirst();
+ const newest: QueryFragment<PostCollection, Ordered<PostCollection>> = (posts) => posts.newestFirst();
```

Rename every use of these types in the file, including a re-export such as `export type { Fragment } from '@prisma/orm-postgres/orm-client'` and a qualified name such as `Orm.Fragment` after `import * as Orm from '@prisma/orm-postgres/orm-client'`. Code that still uses the earlier names `Scope` and `FieldScope` from the ORM client renames them directly: `Scope` to `QueryFragment` and `FieldScope` to `DeclaredFieldsFragment`.

Do not rename React's `Fragment`, or any `Fragment` that is not imported from the ORM client. Do not rename `FragmentFacts` or `DeclaredField`, which keep their names.
