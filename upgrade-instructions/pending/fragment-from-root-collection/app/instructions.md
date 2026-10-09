---
changes:
  - id: fragment-is-made-from-the-root-collection
    summary: "The SQL ORM client's collection.fragment(body) refuses a collection with chained calls, such as db.Post.where(...).fragment(body), which used to ignore those calls; chain on the collection directly instead, or define a shared fragment on the model's root collection. A receiver typed by a type parameter, such as this in a custom collection class method, is refused at compile time. The detection matches .fragment( right after a closing parenthesis, as in a chained call, and this.fragment(."
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\)\s*\.fragment\('
        - '\bthis\s*\.fragment\('
---

# `fragment` is called on the model's root collection

A fragment for one model, made with `collection.fragment(body)`, is built from the model alone. Calls chained before `.fragment(...)`, such as `where`, `orderBy`, `include`, `limit` or `forUpdate`, were ignored without a word. Now `fragment` throws `ORM.ARGUMENT_INVALID` on such a collection, and a `where`, an `orderBy` or an `include` before it is also a compile error. A receiver typed by a type parameter, such as `this` in a custom collection class method or `C` in a generic function, is a compile error too, because it may be a chained collection.

In your code, chain on the collection directly instead of defining a fragment from it. Inside a class method, chain on `this`:

```diff
  titles() {
-   return this.with(this.fragment((posts) => posts.select('id', 'title')));
+   return this.select('id', 'title');
  }
```

If the fragment is shared between places, define it once as a module-level constant on the model's root collection, and move the chained calls that were meant to be part of it into its body:

```diff
- const recentSummary = db.orm.public.Post.orderBy((p) => p.id.desc()).fragment((posts) =>
-   posts.select('id', 'title'),
- );
+ const recentSummary = db.orm.public.Post.fragment((posts) =>
+   posts.orderBy((p) => p.id.desc()).select('id', 'title'),
+ );
```

The detection does not find a `.fragment(` call whose receiver is a variable or a parameter holding a chained collection, such as `const published = db.orm.public.Post.where(...)` followed by `published.fragment(...)`, or a generic receiver. Check those `.fragment(` calls by hand.

Skip a match on the fragment for any model, `fragment(fields, body)`, called on a client returned by a call, such as `orm(...).fragment(fields, body)`, which did not change, and a match in code that uses the MongoDB ORM client, which did not change either.
