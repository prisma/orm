---
changes:
  - id: fragment-is-made-from-the-root-collection
    summary: "The SQL ORM client's collection.fragment(body) refuses a collection with chained calls, such as db.Post.where(...).fragment(body), which used to ignore those calls; call fragment on the model's root collection instead. this.fragment(body) in a custom collection class is refused at compile time. The detection matches .fragment( right after a closing parenthesis, as in a chained call, and this.fragment(."
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '\)\s*\.fragment\('
        - '\bthis\s*\.fragment\('
---

# `fragment` is called on the model's root collection

A fragment for one model, made with `collection.fragment(body)`, is built from the model alone. Calls chained before `.fragment(...)`, such as `where`, `orderBy`, `include`, `limit` or `forUpdate`, were ignored without a word. Now `fragment` throws `ORM.ARGUMENT_INVALID` on such a collection, and a `where`, an `orderBy` or an `include` before it is also a compile error. `this.fragment(...)` in a custom collection class is a compile error too, because `this` may be a chained collection.

In the extension's code, call `fragment` on the model's root collection. If the chained calls were meant to be part of the fragment, move them into its body:

```diff
- const recentSummary = db.orm.public.Post.orderBy((p) => p.id.desc()).fragment((posts) =>
-   posts.select('id', 'title'),
- );
+ const recentSummary = db.orm.public.Post.fragment((posts) =>
+   posts.orderBy((p) => p.id.desc()).select('id', 'title'),
+ );
```

Move a `this.fragment(...)` call in a class method to a module-level constant made from the root collection, and apply it in the method with `this.with(fragment)`.

Skip a match whose receiver is a root collection, such as `client().Post.fragment(...)`, and a match in code that uses the MongoDB ORM client, which did not change.
