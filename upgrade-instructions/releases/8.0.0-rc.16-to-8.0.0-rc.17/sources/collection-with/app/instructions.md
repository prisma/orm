---
changes:
  - id: collection-apply-is-now-with
    summary: |
      The collection method `apply(fn)` is renamed to `with(fn)`. Rename every call on a collection of the SQL ORM client, such as `db.orm.public.Post.apply(notDeleted)` or `posts.apply((p) => p.limit(10))`, to `.with(...)`. The detection matches `.apply(` only when its first argument is a name followed by `)`, `(` or `=>`, or an arrow function, because `Function.prototype.apply` (`fn.apply(this, args)`) and `Reflect.apply` share the name; it can still match a `Function.prototype.apply` call with one argument. Rename only where the receiver is a collection.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\.apply\s*\(\s*(?:\(|[A-Za-z_$][\w$.]*\s*(?:\)|\(|=>))'
  - id: with-is-a-collection-member
    summary: |
      Every collection now has a `with` method instead of `apply`. A custom collection class that declares its own `with` member with another signature no longer compiles; rename it. An aggregate operation named `with` is refused with `ORM.AGGREGATE_OPERATION_RESERVED`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?:^|\n)[ \t]*(?:(?:public|protected|private|readonly|static|async|override)\s+)*with\s*[(<:=?]'
---

# `apply` is now `with`

The collection method that runs a function on a collection is now `with`. A pure filter is still written `where(rowFragment)`; `with` runs a scope, a function from a collection to a collection, for what `where` cannot express, such as a shared `select` and `include`, an order, a limit or offset, or a variant.

These changes apply to the SQL ORM client only. The MongoDB ORM client did not change; skip matches in code that uses it.

## Rename `apply` to `with`

Rename each call on a collection:

```diff
- const posts = await db.orm.public.Post.apply(notDeleted).apply(postSummary).all();
+ const posts = await db.orm.public.Post.with(notDeleted).with(postSummary).all();
```

The same holds inside an include refinement and inside a scope's body:

```diff
- db.orm.public.User.include('posts', (posts) => posts.apply(postSummary));
+ db.orm.public.User.include('posts', (posts) => posts.with(postSummary));
```

Do not rename `Function.prototype.apply` or `Reflect.apply`. A call such as `fn.apply(this, args)`, `scope.apply(undefined, [collection])` or `Reflect.apply(fn, target, args)` calls a function, not a collection; leave it as it is. When a match is unclear, rename it only if its receiver's type is a collection: `db.orm.<namespace>.<Model>`, a chain on one, a custom class that extends `Collection`, or the collection an include refinement or a scope's body receives.

Also rename `apply` to `with` in comments and documentation that name it as the collection method, such as "run with `apply` on any collection of posts".

`with` is a reserved word in JavaScript, but a valid method name. `collection.with(scope)` works; destructuring it as `const { with } = collection` does not.

The error a scope raises when it is given something that is not a collection now says `Pass the scope to with on a collection: collection.with(scope).`, and the refused bulk writes say `A scope passed to with can add one without showing it at the call site.` Update tests that assert on the old text.

## `with` is a member of every collection

A custom collection class that declares its own `with` with another signature no longer compiles. Rename that member and its call sites:

```diff
  class PostCollection extends Collection<Contract, 'Post'> {
-   with(term: string) { return this.where((post) => post.title.ilike(`%${term}%`)); }
+   withTitle(term: string) { return this.where((post) => post.title.ilike(`%${term}%`)); }
  }
```

A class that declared its own `apply` because the name was reserved may keep it under that name or rename it back.

An aggregate operation named `with` is now refused with `ORM.AGGREGATE_OPERATION_RESERVED` when the client is built; rename the operation. An aggregate operation may now be named `apply`.
