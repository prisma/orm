---
changes:
  - id: orm-write-inside-transaction-suspends-tx
    summary: |
      An ORM write of more than one statement on `tx.orm`, such as a create with a nested relation, runs in a savepoint. While it runs, other work sent on the same `tx` rejects with `RUNTIME.TRANSACTION_SUSPENDED`. The detection matches TypeScript sources that call `transaction` and `Promise.all` or `Promise.allSettled`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\s\S])(?=[\s\S]*\.transaction\s*\()[\s\S]*Promise\.all'
---

# Concurrent work on `tx` during an ORM write

Inside `db.transaction(async (tx) => ...)`, where an ORM write of several statements runs at the same time as other work on `tx`, for example in `Promise.all`, await the write before sending the other work:

```ts
await tx.orm.public.Post.create({ title, author: (author) => author.create(user) });
await tx.execute(plan);
```
