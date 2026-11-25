---
changes:
  - id: relation-mutation-error-codes-merged
    summary: |
      A nested relation mutation now refuses malformed input with `ORM.ARGUMENT_INVALID` instead of `ORM.RELATION_MUTATION_INVALID`, and an operation it does not support in that position with `ORM.OPERATION_UNSUPPORTED` instead of `ORM.RELATION_MUTATION_UNSUPPORTED`. The error's `meta` is unchanged.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs,jsx}"
      matches:
        - 'ORM\.RELATION_MUTATION_(?:INVALID|UNSUPPORTED)(?![\w$])'
---

# Nested relation mutation errors use the general ORM codes

## `relation-mutation-error-codes-merged`

Replace every comparison with the old codes:

- `ORM.RELATION_MUTATION_INVALID` becomes `ORM.ARGUMENT_INVALID`.
- `ORM.RELATION_MUTATION_UNSUPPORTED` becomes `ORM.OPERATION_UNSUPPORTED`.

The `meta` of these errors keeps its fields (`kind`, `relation`, `problem`, `reason` and the others). Code that needs to tell a nested relation mutation error from another error with the same code can check `meta.relation`, which the nested relation mutation errors with these two codes carry.

A nested `create` whose `conflictOn` names a field the related model does not have throws `ORM.FIELD_UNKNOWN`, as top-level `createAll` does, with `meta.model` and `meta.field` and no `meta.relation`.
