---
changes:
  - id: relation-mutator-writes-parameter
    summary: |
      The boolean type parameter `FilteredWritesDisabled` of `RelationMutator` (its sixth) and `VariantRelationMutator` (its seventh), exported from `@prisma/orm-family-sql`, is replaced by `Writes extends 'many' | 'one' | 'none'`, which also decides whether the mutator offers the new `update(data)` and `delete()` members. Both types also take a new last parameter, `DeleteDisabled extends boolean = false`. Code that passes fewer type arguments than the `Writes` position is unaffected; code that passes it replaces `false` with `'many'` and `true` with `'one'` on a to-one relation in `update()`, or `'none'` in `create()`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\w$])(?:Variant)?RelationMutator\s*<'
---

# The relation mutator types take a `Writes` parameter

`RelationMutator<TContract, ModelName, LinkWritesDisabled, BareDisconnectDisabled, DisconnectDisabled, Writes, ParentLinkFields, DeleteDisabled>` and `VariantRelationMutator<TContract, ModelName, VariantValue, LinkWritesDisabled, BareDisconnectDisabled, DisconnectDisabled, Writes, ParentLinkFields, DeleteDisabled>` used to take a boolean, `FilteredWritesDisabled`, in the place of `Writes`. `Writes` says which row writes the mutator offers:

| `Writes` | Relation | `where()` returns | `updateAll`, `deleteAll` | `update`, `delete` |
| --- | --- | --- | --- | --- |
| `'many'` (default) | to-many | a mutator with `update`, `delete`, `updateAll`, `deleteAll` | available | only after `where()` |
| `'one'` | to-one | a mutator with `update`, `delete` | not available | available |
| `'none'` | in `create()` | not available | not available | not available |

`DeleteDisabled`, `false` by default, makes `delete` unavailable; the ORM sets it on a to-one relation whose foreign key, held by the record, is required. An unavailable member takes a `never` parameter, so a call is a type error.

In every file the detection matches, find each `RelationMutator<...>` or `VariantRelationMutator<...>` that passes the `Writes` argument (the sixth for `RelationMutator`, the seventh for `VariantRelationMutator`) and replace it:

- `false` becomes `'many'`.
- `true` becomes `'one'` for a to-one relation in `update()` data, and `'none'` in `create()` data.

Uses with fewer type arguments need no change. Code that lists the members of a mutator, for example with `keyof`, also sees `update` and `delete`.
