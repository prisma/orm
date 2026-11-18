---
changes:
  - id: disconnect-on-required-relation-refused
    summary: |
      In `update()` data, `r.disconnect()` on a relation whose foreign key is required (not nullable) no longer compiles, and at run time it is refused with `ORM.OPERATION_UNSUPPORTED` (`meta.reason: 'required-foreign-key'`) before any statement runs, instead of failing with the database's NOT NULL error. On a relation the record holds the key for (many-to-one), link the record to another row with `connect` or delete the record; on a relation the related rows hold the key for (one-to-many, one-to-one), connect those rows to another record or delete them. Many-to-many `disconnect` and `disconnect` on an optional relation are unchanged.
---

# `disconnect` on a required relation is refused

`r.disconnect()` in the data of `update()` sets the foreign key of the relation to null. On a relation the record holds the key for (many-to-one), that is the record's own key; on a relation the related rows hold the key for (one-to-many, one-to-one), it is the key of the related rows. When that key is required, the database refused the statement with a NOT NULL error, which reached the caller unwrapped.

Such a call is now a type error, on an emitted `contract.d.ts` and on a contract built with the TypeScript contract builder. Run the project's typecheck to find them. At run time, the ORM refuses it while it plans the write, before any statement runs, with:

```text
ORM.OPERATION_UNSUPPORTED: disconnect() nested mutation for relation "author" cannot set "userId" of model "Post" to null, because the foreign key is required
```

`meta.reason` is `'required-foreign-key'`, `meta.model` names the model that holds the key and `meta.fields` its fields. Because nothing has been written, the whole `update()` is refused, including its own field changes.

For each such call, decide what should become of the row that holds the key.

On a relation the record holds the key for (many-to-one), the key is on the record being updated:

- To link the record to another row, use `connect` on the same relation instead:

  ```ts
  // before
  await db.Post.where({ id: 10 }).update({
    author: (author) => author.disconnect(),
  });

  // after
  await db.Post.where({ id: 10 }).update({
    author: (author) => author.connect({ id: 2 }),
  });
  ```

- To remove the record, delete it with its own collection, for example `db.Post.where({ id: 10 }).delete()`.

On a relation the related rows hold the key for (one-to-many, one-to-one), the key is on the related rows:

- To move them to another record, use `connect` on that record instead:

  ```ts
  // before
  await db.User.where({ id: 1 }).update({
    posts: (posts) => posts.disconnect([{ id: 10 }]),
  });

  // after
  await db.User.where({ id: 2 }).update({
    posts: (posts) => posts.connect({ id: 10 }),
  });
  ```

- To remove them, delete them, for example with `r.where(filter).deleteAll()` on a one-to-many relation, or with the related model's own `delete()`.

On either layout, if the row that holds the key may exist without the row it points at, make the foreign key optional in the contract (`.optional()` on the field, or `?` in PSL), re-emit the contract and migrate the column to nullable. `disconnect` is then available.

Code that caught the database's NOT NULL error of such a call catches `ORM.OPERATION_UNSUPPORTED` with `meta.reason === 'required-foreign-key'` instead.
