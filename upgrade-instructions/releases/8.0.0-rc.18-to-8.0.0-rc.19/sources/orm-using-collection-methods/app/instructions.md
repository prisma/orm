---
changes:
  - id: orm-collection-member-using-reserved
    summary: |
      Every ORM collection has a `using` member, which holds the collection methods packages contribute for the model, such as `db.orm.public.Post.using.post_search(q)` for a Postgres full-text index. A custom collection class that declares its own member named `using` no longer compiles; rename that member. The detection matches a file that extends `Collection` and declares a class member named `using`.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      matches:
        - '(?<![\s\S])(?=[\s\S]*\bextends\s+Collection\b)[\s\S]*\n[ \t]*(?:(?:public|private|protected|override|readonly|async|declare|static|accessor)[ \t]+)*(?:(?:(?:get|set)[ \t]+)?using[ \t]*[?!]?[ \t]*[(<]|using[ \t]*[?!]?[ \t]*=(?![=>])|using[ \t]*[?!]?[ \t]*:[^\n]*[^,\s][ \t]*(?:\n|$))'
---

# `using` is a member of every collection

A collection's `using` member holds the collection methods that packages contribute for the model. The Postgres target contributes one for each full-text index, so `db.orm.public.Post.using.post_search(q)` filters to the posts that match `q` and orders them by relevance, and pgvector contributes one for each vector field, such as `db.orm.public.Post.using.embedding_nearest(v)`.

A custom collection class registered with `orm({ collections })` can no longer declare its own `using`, whether as a method, a getter or a property. TypeScript refuses it because the base class defines `using` as an accessor. Rename the member, and its callers:

```ts
// Before
class PostCollection extends Collection<Contract, 'Post'> {
  using(tag: string) {
    return this.where({ tag });
  }
}

// After
class PostCollection extends Collection<Contract, 'Post'> {
  withTag(tag: string) {
    return this.where({ tag });
  }
}
```
