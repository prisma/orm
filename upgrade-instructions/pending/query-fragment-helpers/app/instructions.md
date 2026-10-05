---
changes:
  - id: scope-is-a-collection-member
    summary: |
      Every collection now has a `scope` method. A custom collection class that declares its own `scope` member with another signature no longer compiles; rename it.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?:^|\n)[ \t]*(?:(?:public|protected|private|readonly|static|async|override)\s+)*scope\s*[(<:=?]'
---

These changes apply to the SQL ORM client only. The MongoDB ORM client did not change; skip matches in code that uses it.

## `scope` is a member of every collection

Collections have a new method, `scope(body)`, which defines a scope for the collection's model: `db.Post.scope((posts) => posts.select('id', 'title'))`. A custom collection class that declares its own `scope` with another signature no longer compiles. Rename that member and its call sites:

```diff
  class PostCollection extends Collection<Contract, 'Post'> {
-   scope(userId: string) { return this.where({ userId }); }
+   ownedBy(userId: string) { return this.where({ userId }); }
  }
```

An aggregate operation named `scope` is now refused with `ORM.AGGREGATE_OPERATION_RESERVED` when the client is built; rename the operation.
