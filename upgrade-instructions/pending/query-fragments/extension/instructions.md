---
changes:
  - id: orm-scope-is-now-fragment
    summary: |
      The SQL ORM client's `scope` methods are renamed to `fragment`: `db.orm.scope(fields, body)` is now `db.orm.fragment(fields, body)`, and `collection.scope(body)`, such as `db.orm.public.Post.scope(...)`, is now `collection.fragment(body)`. Rename each use whose receiver is the ORM client or a collection, including `typeof db.orm.scope` and `const { scope } = db.orm`. The detection matches every `.scope(` call; leave calls on other objects as they are.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\.scope\s*[(<]'
        - '\btypeof\s+[\w$.]*\.scope\b'
        - '\{[^}]*\bscope\b[^}]*\}\s*=\s*[\w$.]*\borm\b'
  - id: orm-scope-types-are-now-fragment-types
    summary: |
      The types `Scope`, `FieldScope` and `ScopeFacts` exported by the SQL ORM client (`@prisma/orm-postgres/orm-client`, the other facades' `orm-client` entries and `@internal/sql-orm-client`) are renamed to `Fragment`, `FieldFragment` and `FragmentFacts`. The SQL builder's own `Scope` and `ScopeField` types are a different thing and keep their names; the detection matches `Scope` only in an import or re-export from the ORM client, or after a namespace import of it.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\b(?:FieldScope|ScopeFacts)\b'
        - '(?:import|export)\s+(?:type\s+)?\{[^}]*\bScope\b[^}]*\}\s*from\s*[''"]@(?:prisma/[\w-]+/orm-client|internal/sql-orm-client)[''"]'
        - 'import\s+(?:type\s+)?\*\s+as\s+([\w$]+)\s+from\s*[''"]@(?:prisma/[\w-]+/orm-client|internal/sql-orm-client)[''"][\s\S]*\b\1\.Scope\b'
  - id: fragment-is-a-collection-member
    summary: |
      Every collection now has a `fragment` method instead of `scope`. A custom collection class that declares its own `fragment` member with another signature no longer compiles; rename it. An aggregate operation named `fragment` is refused with `ORM.AGGREGATE_OPERATION_RESERVED`. The name `scope` is free again. The detection matches a member named `fragment` only in a file that extends `Collection`, and an aggregate operation declared as `operation: 'fragment'`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\s\S])(?=[\s\S]*\bextends\s+Collection\b)[\s\S]*\n[ \t]*(?:(?:public|protected|private|readonly|static|async|override|get|set)\s+)*fragment\s*(?:\?\s*)?[(<:=]'
        - '\boperation\s*:\s*[''"]fragment[''"]'
  - id: namespace-named-fragment-hides-the-client-method
    summary: |
      A contract namespace named `fragment` now takes the name of the client's `fragment` method, so `db.orm.fragment` is that namespace and the client has no method to make a fragment for any model; code that called `db.orm.scope(fields, body)` with such a contract must make its fragments another way. A namespace named `scope` no longer hides anything.
    detection:
      glob: "**/*.prisma"
      matches:
        - '(?:^|\n)[ \t]*namespace\s+fragment\b'
  - id: fragment-error-texts
    summary: |
      Errors and compile errors about these functions say "fragment" where they said "scope", such as `Cannot define the fragment: the body is not a function` and `Pass the fragment to with on a collection: collection.with(fragment).` Update tests that assert on the old text.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - 'Cannot (?:define|apply) (?:the|a) scope|Pass the scope to with|Run the scope with apply|A scope (?:passed to with|applied with apply)|The scope was (?:made|declared)|the scope could not read the model|declaration in the scope'
---

# The `scope` methods and types are renamed to `fragment`

The general term for a function from a collection to a collection, run with `collection.with(fn)`, is **query fragment**, or **fragment** for short. A **scope** is a fragment that only imposes conditions on the query, such as a soft-delete filter. The methods and types that make fragments were named `scope`, although they also make fragments that select, include or order, so they are renamed to `fragment`. What they do has not changed.

These changes apply to the SQL ORM client only. The MongoDB ORM client did not change; skip matches in code that uses it.

## Rename `scope` to `fragment`

Rename the client's method and the collection method:

```diff
- const notDeleted = db.orm.scope(
+ const notDeleted = db.orm.fragment(
    { deletedAt: field.temporal.timestamptz().optional() },
    (rows) => rows.where((r) => r.deletedAt.isNull()),
  );
- const postSummary = db.orm.public.Post.scope((posts) => posts.select('id', 'title').include('user'));
+ const postSummary = db.orm.public.Post.fragment((posts) => posts.select('id', 'title').include('user'));
```

The same holds on a chained collection, a custom collection class and `this` inside one, in the extension's code and in the fragments or collection classes it exports, and in a type such as `typeof db.orm.scope` or a destructuring such as `const { scope } = db.orm`. Rename a use only when its receiver is the ORM client (`db.orm`, or the client `orm()` returns) or a collection. Leave `.scope(` calls on other objects as they are.

## Rename the types

```diff
- import type { FieldScope, Scope, ScopeFacts } from '@prisma/orm-postgres/orm-client';
+ import type { FieldFragment, Fragment, FragmentFacts } from '@prisma/orm-postgres/orm-client';
```

Rename every use of these types in the file, including a re-export such as `export type { Scope } from '@prisma/orm-postgres/orm-client'` and a qualified name such as `Orm.Scope` after `import * as Orm from '@prisma/orm-postgres/orm-client'`. Do not rename the SQL builder's `Scope` or `ScopeField`, which describe the tables and columns a builder query can see; they are imported from a `builder` entry or `@internal/sql-builder`, not from the ORM client.

## Rename what you named after scopes

Code that calls a fragment a "scope" still compiles, but rename it to match the new words. Name a module, a variable or a comment for a fragment that selects, includes, orders or limits a fragment, and keep "scope" for a fragment that only imposes conditions on the query. For example, a module `scopes.ts` that holds both a filter and a shared `select` becomes `fragments.ts`, with its imports updated, while a comment that describes a filter in it as a scope stays. Update documentation the same way, such as a README that names `db.orm.scope`, `.scope(...)` or a module you renamed.

## `fragment` is a member of every collection

A custom collection class that declares its own `fragment` with another signature no longer compiles. Rename that member and its call sites:

```diff
  class PostCollection extends Collection<Contract, 'Post'> {
-   fragment(text: string) { return this.where((post) => post.body.ilike(`%${text}%`)); }
+   containing(text: string) { return this.where((post) => post.body.ilike(`%${text}%`)); }
  }
```

A class may now declare a method named `scope`.

An aggregate operation named `fragment` is now refused with `ORM.AGGREGATE_OPERATION_RESERVED` when the client is built; rename the operation. An aggregate operation may now be named `scope`.

## A namespace named `fragment`

A contract namespace takes its name on the client even when the client has a method of that name. If your contract has a namespace named `fragment`, `db.orm.fragment` is that namespace, and the client has no method to make a fragment for any model. If code calls `db.orm.scope(fields, body)` with such a contract, replace each call: a fragment for one model with `collection.fragment(body)` on each model it serves, or a filter with a function of the model accessor (a row fragment) whose parameter is typed with `CodecField`, passed to `where`. A namespace named `scope` no longer hides a method, and `db.orm.scope` still reaches it.

## Error texts

Errors and compile errors about fragments say "fragment" where they said "scope". Before this change, after `apply` was renamed to `with`, they read `Cannot define the scope: the body is not a function`, `Pass the scope to with on a collection: collection.with(scope).` and, for the refused bulk writes, `A scope passed to with can add one without showing it at the call site.` They now read `Cannot define the fragment: the body is not a function`, `Pass the fragment to with on a collection: collection.with(fragment).` and `A fragment passed to with can add one without showing it at the call site.` Every other text that said "the scope" or "a scope" says "the fragment" or "a fragment" in the same place. The compile error for a model that lacks a declared field names the property `the model has no field that matches the declaration in the fragment`. Update tests that assert on the old text.
