---
changes:
  - id: relation-mutator-writes-many-rows-removed-delete-disabled
    summary: |
      `RelationWrites`, the type of the `Writes` parameter of `RelationMutator` and `VariantRelationMutator` (exported from `@prisma/orm-family-sql`), no longer has `'manyRows'`: a many-to-many relation now takes `'many'`, and a relation the record holds the key for takes `'one'`. Both types also take a new last type parameter, `DeleteDisabled extends boolean = false` (the tenth of `RelationMutator`, the eleventh of `VariantRelationMutator`, after `NsId` and `ConflictActions`), which makes `delete` unavailable. Code that passes `'manyRows'` passes `'many'`; code that passes fewer type arguments is unaffected.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '''manyRows'''
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
