---
changes:
  - id: relation-mutator-writes-parameter
    summary: |
      The boolean type parameter `FilteredWritesDisabled` of `RelationMutator` (its sixth) and `VariantRelationMutator` (its seventh), exported from `@prisma/orm-family-sql`, is replaced by `Writes extends 'many' | 'manyRows' | 'one' | 'none'`, which also decides whether the mutator offers the new `update(data)` and `delete()` members. Code that passes the argument replaces `false` with `'many'` (or `'manyRows'` through a junction) and `true` with `'one'` for a one-to-one relation the related row holds the key for in `update()`, or `'none'` for a relation the record holds the key for (many-to-one) or in `create()`. Code that leaves the argument out gets the default `'many'`; that is unchanged for a one-to-many relation, but a type written for a relation through a junction must now pass `'manyRows'`. The types may be imported under another name; follow the local name.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - '(?<![\w$])(?:Variant)?RelationMutator\s*<'
        - 'import\s+(?:type\s+)?\{[^}]*(?<![\w$])(?:Variant)?RelationMutator(?![\w$])[^}]*\}'
---

# The relation mutator types take a `Writes` parameter

`RelationMutator<TContract, ModelName, LinkWritesDisabled, BareDisconnectDisabled, DisconnectDisabled, Writes, ParentLinkFields, NsId, ConflictActions>` and `VariantRelationMutator<TContract, ModelName, VariantValue, LinkWritesDisabled, BareDisconnectDisabled, DisconnectDisabled, Writes, ParentLinkFields, NsId, ConflictActions>` used to take a boolean, `FilteredWritesDisabled`, in the place of `Writes`. `Writes` says which row writes the mutator offers:

| `Writes` | Relation | `where()` returns | `updateAll`, `deleteAll` | `update`, `delete` |
| --- | --- | --- | --- | --- |
| `'many'` (default) | to-many, the related rows hold the key | a mutator with `update`, `delete`, `updateAll`, `deleteAll` | available | only after `where()` |
| `'manyRows'` | many-to-many through a junction | a mutator with `updateAll`, `deleteAll` | available | not available |
| `'one'` | to-one, the related row holds the key | a mutator with `update`, `delete` | not available | available |
| `'none'` | in `create()`, or a relation the record holds the key for | not available | not available | not available |

An unavailable member takes a `never` parameter, so a call is a type error.

In every file the detection matches, find each use of `RelationMutator<...>` or `VariantRelationMutator<...>`. A file may import them under another name, as in `import type { RelationMutator as RM } from '@prisma/orm-family-sql'`; follow the local name. Where a use passes the `Writes` argument (the sixth for `RelationMutator`, the seventh for `VariantRelationMutator`), replace it by which row holds the foreign key:

- `false` becomes `'many'`, or `'manyRows'` when the relation goes through a junction table.
- `true` becomes `'one'` only for a one-to-one relation the related row holds the key for, in `update()` data. It becomes `'none'` for a relation the record holds the key for (many-to-one, such as `Post.author`), and in `create()` data.

Where a use leaves the `Writes` argument out, it gets `'many'`. That needs no change for a one-to-many relation. For a relation through a junction table, add the arguments up to `Writes` and pass `'manyRows'`, because the mutator a relation callback receives for such a relation no longer matches `'many'`. Code that lists the members of a mutator, for example with `keyof`, also sees `update` and `delete`.
