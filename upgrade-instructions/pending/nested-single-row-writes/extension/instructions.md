---
changes:
  - id: relation-mutator-writes-parameter
    summary: |
      The sixth type parameter of `RelationMutator` and `VariantRelationMutator` (exported from `@prisma/orm-family-sql`), the boolean `FilteredWritesDisabled`, is replaced by `Writes extends 'many' | 'manyRows' | 'one' | 'none'`, which also decides whether the mutator offers the new `update(data)` and `delete()` members. Code that names the types with two or three type arguments is unaffected; code that passes the sixth argument replaces `false` with `'many'` (or `'manyRows'` through a junction) and `true` with `'one'` on a to-one relation in `update()`, or `'none'` in `create()`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\w$])(?:Variant)?RelationMutator\s*<'
---

# The relation mutator types take a `Writes` parameter

`RelationMutator<TContract, ModelName, LinkWritesDisabled, BareDisconnectDisabled, DisconnectDisabled, Writes, ParentLinkFields>` and `VariantRelationMutator<TContract, ModelName, VariantValue, LinkWritesDisabled, BareDisconnectDisabled, DisconnectDisabled, Writes, ParentLinkFields>` used to take a boolean, `FilteredWritesDisabled`, in the place of `Writes`. `Writes` says which row writes the mutator offers:

| `Writes` | Relation | `where()` returns | `updateAll`, `deleteAll` | `update`, `delete` |
| --- | --- | --- | --- | --- |
| `'many'` (default) | to-many, the related rows hold the key | a mutator with `update`, `delete`, `updateAll`, `deleteAll` | available | only after `where()` |
| `'manyRows'` | many-to-many through a junction | a mutator with `updateAll`, `deleteAll` | available | not available |
| `'one'` | to-one, the related row holds the key | a mutator with `update`, `delete` | not available | available |
| `'none'` | in `create()`, or a relation the record holds the key for | not available | not available | not available |

An unavailable member takes a `never` parameter, so a call is a type error.

In every file the detection matches, find each `RelationMutator<...>` or `VariantRelationMutator<...>` that passes the `Writes` argument (the sixth for `RelationMutator`, the seventh for `VariantRelationMutator`) and replace it:

- `false` becomes `'many'`, or `'manyRows'` when the relation goes through a junction table.
- `true` becomes `'one'` for a to-one relation in `update()` data, and `'none'` in `create()` data or for a relation the record holds the key for.

Uses with fewer type arguments need no change. Code that lists the members of a mutator, for example with `keyof`, also sees `update` and `delete`.
