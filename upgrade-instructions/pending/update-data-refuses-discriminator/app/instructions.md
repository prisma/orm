---
changes:
  - id: update-data-refuses-discriminator
    summary: |
      Update data on a polymorphic model no longer takes the discriminator field. Setting it in `update`, `updateAll`, `updateAndCount`, the `update` of `upsert`, or a nested `updateAll`, with or without `variant()`, is a type error and is refused with `ORM.FIELD_IMMUTABLE` before any statement runs. Remove the discriminator from the data.
---

# Update data on a polymorphic model does not set the discriminator

The ORM sets a polymorphic model's discriminator when it creates a row, and create data already refused it. Update data took it, but changing it relabelled the row in the base table and left the variant tables as they were: a row moved to a variant stored in its own table had no row there, and a row moved out of one kept its old row. Update data now refuses the discriminator too. Run the project's typecheck to find each call that sets it.

Remove the discriminator field from the data:

```ts
// before
await db.Task.variant('feature').where({ id }).updateAll({ type: 'feature', title: 'Dark mode' });

// after
await db.Task.variant('feature').where({ id }).updateAll({ title: 'Dark mode' });
```

When the call set the discriminator to another value to move a row to another variant, the ORM has no replacement: delete the row and create it again as the other variant, in one transaction.

Data the type check does not see, such as data built as `Record<string, unknown>`, is refused at run time with `ORM.FIELD_IMMUTABLE`, whose `meta` holds `model` and `field`.
