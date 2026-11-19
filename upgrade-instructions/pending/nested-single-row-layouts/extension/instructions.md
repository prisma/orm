---
changes:
  - id: relation-mutator-writes-many-rows-removed-delete-disabled
    summary: |
      `RelationWrites`, the type of the `Writes` parameter of `RelationMutator` and `VariantRelationMutator` (exported from `@prisma/orm-family-sql`), no longer has `'manyRows'`: a many-to-many relation now takes `'many'`, and a relation the record holds the key for takes `'one'`. Both types also take a new last type parameter, `DeleteDisabled extends boolean = false` (the tenth of `RelationMutator`, the eleventh of `VariantRelationMutator`, after `NsId` and `ConflictActions`), which makes `delete` unavailable. Code that passes `'manyRows'` passes `'many'`; code that passes fewer type arguments is unaffected.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '''manyRows'''
  - id: foreign-key-with-relation-callback-refused
    summary: |
      `update()` data that sets a field of the foreign key the record holds for a relation (many-to-one, such as `Post.authorId` for `Post.author`) and also has a callback on that relation is refused with `ORM.ARGUMENT_INVALID` (`meta.problem: 'foreign-key-with-relation-mutation'`, with `meta.relation` and `meta.fields`) before any statement runs. It used to run, and a `create`, `connect` or `disconnect` callback overwrote the foreign key the data set. Keep either the foreign key or the callback.
---

# `Writes` loses `'manyRows'`, and the relation mutator types take `DeleteDisabled`

Nested `update(data)` and `delete()` are now available on every relation layout, so `RelationWrites` no longer needs a value for a relation that offers `updateAll` and `deleteAll` but not `update` and `delete`:

| `Writes` | Relation | `where()` returns | `updateAll`, `deleteAll` | `update`, `delete` |
| --- | --- | --- | --- | --- |
| `'many'` (default) | to-many, including many-to-many | a mutator with `update`, `delete`, `updateAll`, `deleteAll` | available | only after `where()` |
| `'one'` | to-one, including a relation the record holds the key for | a mutator with `update`, `delete` | not available | available |
| `'none'` | in `create()` | not available | not available | not available |

`RelationMutator<TContract, ModelName, LinkWritesDisabled, BareDisconnectDisabled, DisconnectDisabled, Writes, ParentLinkFields, NsId, ConflictActions, DeleteDisabled>` and `VariantRelationMutator<TContract, ModelName, VariantValue, LinkWritesDisabled, BareDisconnectDisabled, DisconnectDisabled, Writes, ParentLinkFields, NsId, ConflictActions, DeleteDisabled>` take `DeleteDisabled` last, `false` by default. It applies with `Writes = 'one'`: when it is `true`, `delete`, bare and after `where()`, takes a `never` parameter, so a call is a type error. With `Writes = 'many'` it has no effect. The ORM sets it on a relation whose foreign key, held by the record, is required.

In every file the detection matches, replace `'manyRows'` passed as `Writes` with `'many'`. Where code passes `'none'` for a relation the record holds the key for in `update()` data, it may pass `'one'` to offer `update` and `delete`; when that foreign key is required, also pass `DeleteDisabled = true`, because the ORM refuses `delete` there. Uses that stop before the `DeleteDisabled` position need no change.

# `update()` data refuses a foreign key together with a callback on its relation

`update()` data that sets the foreign key the record holds for a relation and also has a callback on that relation is now refused, whatever the callback returns (`create`, `connect`, `disconnect`, `update` or `delete`). The ORM refuses it while it plans the write, before any statement runs, with:

```text
ORM.ARGUMENT_INVALID: update() data sets "authorId", the foreign key of relation "author", and also has a callback on "author"; set the foreign key or use the callback
```

`meta.relation` names the relation and `meta.fields` the foreign-key fields the data sets. A foreign-key field whose value is `undefined` does not count. It is not a type error.

Such data used to run, and a `create`, `connect` or `disconnect` callback silently overwrote the foreign key the data set.

For each such call, keep one of the two. To point the record at another row, set the foreign key, or use `connect` on the relation:

```ts
// before
await db.Post.where({ id: 10 }).update({
  authorId: 2,
  author: (author) => author.connect({ id: 2 }),
});

// after
await db.Post.where({ id: 10 }).update({
  author: (author) => author.connect({ id: 2 }),
});
```

To change or delete the row the record points at and also point the record at another row, make two calls: first the callback, then the foreign key.

```ts
// before
await db.Post.where({ id: 10 }).update({
  authorId: 2,
  author: (author) => author.update({ name: 'Ada' }),
});

// after
await db.Post.where({ id: 10 }).update({
  author: (author) => author.update({ name: 'Ada' }),
});
await db.Post.where({ id: 10 }).update({ authorId: 2 });
```
