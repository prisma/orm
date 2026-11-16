---
changes:
  - id: nested-create-on-polymorphic-target-needs-variant
    summary: |
      In a relation callback whose target is a polymorphic base model, `r.create(data)` no longer compiles. Create the rows with `r.variant(value).create(data)` and drop the discriminator field from the data.
---

# A nested create on a polymorphic model names its variant

## `nested-create-on-polymorphic-target-needs-variant`

The mutator a relation callback receives for a polymorphic base model has `variant(value)`, which takes a discriminator value the model declares, as a collection's `variant()` does. Its `create(data)` writes a complete row of that variant, including the row of a variant stored in its own table. `r.create(data)` on such a mutator now takes no data, as a collection's `create()` on a polymorphic base model without `variant()` does, so each such call is a type error. Run the project's typecheck to find them.

For each call, take the value of the discriminator field from the data, pass it to `variant(...)` and remove the field from the data:

```ts
// before
await db.Project.where({ id: 1 }).update({
  tasks: (tasks) => tasks.create({ title: 'Crash on login', type: 'bug' }),
});

// after
await db.Project.where({ id: 1 }).update({
  tasks: (tasks) => tasks.variant('bug').create({ title: 'Crash on login' }),
});
```

The data of `r.variant(value).create(...)` takes the variant's own fields too, such as `severity` for the `bug` variant, and requires those the variant requires; add them where the type check asks for them. When the rows of one call have different discriminator values, split it into one `variant(value).create(...)` per value and return them as an array from the callback.

A variant stored in its own table needs the contract capability `returning`; without it the call is refused with `ORM.CAPABILITY_MISSING`, as `createAll()` on that variant is.
