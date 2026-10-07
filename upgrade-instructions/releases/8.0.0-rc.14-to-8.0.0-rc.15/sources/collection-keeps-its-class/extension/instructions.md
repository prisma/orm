---
changes:
  - id: writes-on-a-conditional-collection-are-refused
    summary: |
      A write (`update`, `updateAll`, `updateAndCount`, `delete`, `deleteAll`, `deleteAndCount`) on a collection that is filtered on some code paths and not on others no longer compiles. A pattern cannot tell which collections those are: act only where the compiler reports "The 'this' context of type '...' is not assignable to method's 'this' of type 'HasWhere'". Filter on every path, or make the write only where the filter was applied.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\.(?:updateAll|updateAndCount|deleteAll|deleteAndCount)\s*\('
        - '\.update\s*\('
        - '\.delete\s*\(\s*(?:\)|\()'
  - id: cursor-and-distinct-on-check-the-receiver
    summary: |
      `cursor` and `distinctOn` now require an order on the collection they are called on, checked on the receiver. A cast on the argument, such as `cursor({ id } as never)`, no longer bypasses the check; add the `orderBy`, or cast the collection to `Ordered<C>` where the query is meant to have no order.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\.(?:cursor|distinctOn)\s*\([^)]*\bas\s+never\b'
  - id: apply-is-a-collection-member
    summary: |
      Every collection now has an `apply` method. A custom collection class that declares its own `apply` member with another signature no longer compiles; rename it.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?:^|\n)[ \t]*(?:(?:public|protected|private|readonly|static|async|override)\s+)*apply\s*[(<:=?]'
  - id: overriding-a-chaining-method
    summary: |
      In a class that extends `Collection`, an override of a chaining method (`where`, `orderBy`, `limit`, `offset`, `distinct`, `distinctOn`, `cursor`, `include`) or of a method that returns rows (`all`, `first`, `create`, `createAll`, `upsert`, `update`, `updateAll`, `updateAndCount`, `delete`, `deleteAll`, `deleteAndCount`) must use the new signature, which takes a `this` parameter.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?:^|\n)[ \t]*(?:(?:public|protected|override|async)\s+)*(?:where|orderBy|limit|offset|distinct|distinctOn|cursor|include|all|first|create|createAll|upsert|update|updateAll|updateAndCount|delete|deleteAll|deleteAndCount)\s*[(<]'
  - id: collection-state-flags-are-boolean
    summary: |
      In `DefaultCollectionTypeState`, `hasWhere`, `hasOrderBy` and `hasUniqueFilter` are `boolean` (not known) instead of `false`. Code that expects `false` on a collection with no filter or order must expect `boolean`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\bhas(?:Where|OrderBy|UniqueFilter)\b[''"]?\]?\s*,\s*false\b'
        - '\bhas(?:Where|OrderBy|UniqueFilter)\s*:\s*false\b'
  - id: read-collection-state-and-row-with-helpers
    summary: |
      A collection's type state and row are read with `CollectionTypeStateOf<C>` and `CollectionRowOf<C>`, not by inferring the type arguments of `Collection`. The type arguments keep what the collection started with.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\bCollection<[^;]*?\binfer\b'
  - id: return-type-of-a-chaining-method
    summary: |
      `ReturnType` of `where`, `orderBy`, `limit`, `offset`, `distinct`, `distinctOn`, `cursor` or `include` no longer gives a collection. Write `Filtered<C>` after `where`, `Ordered<C>` after `orderBy`, and `C` after the others, or take `typeof` of a value.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\bReturnType<[^>]*\[[''"](?:where|orderBy|limit|offset|distinct|distinctOn|cursor|include)[''"]\]'
        - '\bReturnType<\s*typeof\s+[\w$.]+\.(?:where|orderBy|limit|offset|distinct|distinctOn|cursor|include)\b'
  - id: chaining-methods-take-no-explicit-type-arguments
    summary: |
      `include`, `distinct` and `distinctOn` with explicit type arguments no longer compile: `posts.include<'user'>('user')` and `posts.distinct<['title']>('title')` fail, and `ReturnType<typeof posts.include<'user'>>` is `never`. Drop the type arguments; they are inferred from the arguments, so `posts.distinct('title')` needs none.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\.(?:include|distinct|distinctOn)<'
  - id: custom-collection-methods-chain
    summary: |
      Optional. Custom collection methods now stay available after the built-in chaining methods. Where code repeats a class method's body inline after a chaining call, it can call the method instead.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\bextends\s+Collection<'
---

# A collection keeps its class through the chain

`where`, `orderBy`, `limit`, `offset`, `distinct`, `distinctOn`, `cursor` and `include` now return the collection they were called on, with what they establish added to its type as a fact. A custom collection class keeps its methods through the chain, so `db.Post.where({ userId }).withTitle('orm')` and `db.Post.include('user').withTitle('orm')` compile.

The facts have names. Write a filtered collection's type as `Filtered<C>` and an ordered one as `Ordered<C>`. `Filtered<C>` is `C & HasWhere`, and `HasWhere` is the name error messages print. Import the names from `@internal/sql-orm-client`, or from the `orm-client` entry of the facade your extension depends on.

These changes apply to the SQL ORM client only. The MongoDB ORM client did not change; skip matches in code that uses it.

## Writes on a conditional collection are refused

A write needs a collection that is filtered on every code path. Code that filters only on some paths compiled before and no longer does:

```ts
const posts = search ? db.Post.withTitle(search) : db.Post;
await posts.deleteAll(); // error: The 'this' context of type 'PostCollection' is not assignable to method's 'this' of type 'HasWhere'
```

The same applies to an `if` with an early return, a `switch`, a loop, and a `let` reassigned in an `if`. Make the write only where the filter was applied, or filter on every path:

```diff
- const posts = search ? db.Post.withTitle(search) : db.Post;
- await posts.deleteAll();
+ if (search) {
+   await db.Post.withTitle(search).deleteAll();
+ }
```

If the code relied on deleting or updating every row when there is no filter, that was the unsafe case the check now refuses. State the intent with an explicit filter instead.

## `cursor` and `distinctOn` check the receiver

`cursor` and `distinctOn` need an order on the collection they are called on. The check is on the receiver, so a cast on the argument no longer bypasses it:

```ts
await db.Post.cursor({ id } as never).all(); // error: The 'this' context of type 'PostCollection' is not assignable to method's 'this' of type 'HasOrderBy'
```

Add the order the query needs:

```diff
- await db.Post.cursor({ id } as never).all();
+ await db.Post.orderBy((post) => post.id.asc()).cursor({ id }).all();
```

Where the query is meant to run without an order, cast the collection instead of the argument:

```ts
import type { Ordered } from '@internal/sql-orm-client';

const unordered = db.Post as Ordered<typeof db.Post>;
await unordered.cursor({ id }).all();
```

## `apply` is a member of every collection

Collections have a new method, `apply(fn)`, which calls `fn` with the collection and returns the result. A custom collection class that declares its own `apply` with another signature no longer compiles. Rename that member and its call sites:

```diff
  class PostCollection extends Collection<Contract, 'Post'> {
-   apply(limit: number) { return this.limit(limit); }
+   firstPage(limit: number) { return this.limit(limit); }
  }
```

An aggregate operation named `apply` is now refused with `ORM.AGGREGATE_OPERATION_RESERVED` when the client is built; rename the operation.

## Overriding a chaining method or a method that returns rows

A class that extends `Collection` and overrides one of the chaining methods, or one of the methods that return rows (`all`, `first`, `create`, `createAll`, `upsert` and the writes), must declare the override with the new signature: a type parameter for the receiver, a `this` parameter of that type, and the result type the base method returns. Call the base method with `call` and explicit type arguments, so that the receiver type passes through:

```diff
  class PostCollection extends Collection<Contract, 'Post'> {
-   override limit(n: number) {
-     return super.limit(Math.min(n, 100));
-   }
+   override limit<Self>(this: Self, n: number): Self {
+     return super.limit.call<Self, [number], Self>(this, Math.min(n, 100));
+   }
  }
```

Only classes that extend the SQL `Collection` are affected; skip matches in other classes.

## The flags of a new collection are `boolean`

`DefaultCollectionTypeState` declares `hasWhere`, `hasOrderBy` and `hasUniqueFilter` as `boolean`, meaning not known. A method that establishes a flag sets it to `true`. Where your code expects `false`, expect `boolean`:

```diff
- type Check = Equal<CollectionTypeStateOf<typeof users>['hasOrderBy'], false>;
+ type Check = Equal<CollectionTypeStateOf<typeof users>['hasOrderBy'], boolean>;
```

A type of your own that sets a flag to `false` should set it to `boolean`. The writes still need `hasWhere: true`, and `cursor` and `distinctOn` still need `hasOrderBy: true`.

## Read the state and the row with `CollectionTypeStateOf` and `CollectionRowOf`

`where`, `orderBy` and `include` record what they establish in two declared properties, not in the type arguments of `Collection`. Inferring the third or fourth type argument gives the row and the state the collection started with. Read them with `CollectionRowOf` and `CollectionTypeStateOf` instead:

```diff
- type RowOf<C> = C extends Collection<infer _C, infer _M, infer Row, infer _S> ? Row : never;
- type UsersRow = RowOf<typeof users>;
+ import type { CollectionRowOf } from '@internal/sql-orm-client';
+ type UsersRow = CollectionRowOf<typeof users>;
```

To keep a helper of your own, constrain its parameter, because both helpers require one:

```ts
import type { CollectionRowOf, CollectionTypeStateOf, HasRow, HasTypeState } from '@internal/sql-orm-client';

type RowOf<C extends HasRow> = CollectionRowOf<C>;
type StateOf<C extends HasTypeState> = CollectionTypeStateOf<C>;
```

## `ReturnType` of a chaining method does not give a collection

The chaining methods are generic in their receiver, and `ReturnType` of a generic method uses the constraint of its type parameter. `ReturnType<PostCollection['where']>` is now `HasWhere`, and `ReturnType<PostCollection['limit']>` is `unknown`. Write the type with `Filtered` after `where`, `Ordered` after `orderBy`, and the collection type itself after `limit`, `offset`, `distinct`, `distinctOn` and `cursor`. You can also take `typeof` of a value:

```diff
- type MatchingPosts = ReturnType<PostCollection['where']>;
+ import type { Filtered } from '@internal/sql-orm-client';
+ type MatchingPosts = Filtered<PostCollection>;
```

`ReturnType` of a method of your own class, such as `ReturnType<PostCollection['withTitle']>`, still works.

## `include`, `distinct` and `distinctOn` take no explicit type arguments

These methods infer their receiver from the call. With explicit type arguments the receiver is not inferred: `posts.include<'user'>('user')` does not compile, `posts.distinct<['title']>('title')` and `posts.distinctOn<['title']>('title')` fail with "Expected 2 type arguments, but got 1", and `ReturnType<typeof posts.include<'user'>>` is `never`. Drop the type arguments. They are inferred from the arguments, so `distinct<['title']>('title')` becomes `distinct('title')`:

```diff
- const titles = posts.distinct<['title']>('title');
+ const titles = posts.distinct('title');
```

To name the type of an include, call `include` on a value and take its type:

```diff
- type WithUser = ReturnType<typeof posts.include<'user'>>;
+ const withUser = posts.include('user');
+ type WithUser = typeof withUser;
```

## Optional: call custom collection methods after chaining

Custom collection methods are now available after `where`, `orderBy`, `limit` and the other chaining methods. Where code on a client built with `orm({ collections })` repeats a class method's body inline after a chaining call on that class, it can call the method. A client without custom classes, such as `db.orm`, has no such methods.

```diff
  return db.Post.forUser(userId)
-   .orderBy((post) => post.createdAt.desc())
+   .newestFirst()
    .limit(limit)
    .all();
```

Here `newestFirst()` is a method of the application's `PostCollection` whose body is that `orderBy`.
