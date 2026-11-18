---
changes:
  - id: to-one-disconnect-criteria-applied
    summary: |
      In `update()` data, `r.disconnect(criteria)` on a relation the record holds the key for (many-to-one) now unlinks the record only when the row it is linked to matches one of the criteria; before, it ignored the criteria and always unlinked. Where the criteria do not match the linked row, the foreign key stays unchanged, and the other updates of the same `update()` still apply. Pass no criteria to unlink whatever row is linked. `r.variant(value).disconnect(criteria?)` on such a relation is now available and unlinks only a linked row of that variant. All of this applies to a relation whose foreign key is optional: on a required key, `disconnect` is refused with `ORM.OPERATION_UNSUPPORTED` (`reason: 'required-foreign-key'`) before its criteria or variant are looked at.
  - id: disconnect-empty-criteria-disconnects-nothing
    summary: |
      In `update()` data, `r.disconnect([])` with an explicit empty list of criteria now disconnects nothing. Before, it acted as `r.disconnect()`: on a relation the record holds the key for it unlinked the record, on a one-to-many or one-to-one relation it unlinked every related row, and `r.variant(value).disconnect([])` unlinked every linked row of the variant. Many-to-many `disconnect([])` is still refused.
---

# To-one `disconnect` applies its criteria

## `to-one-disconnect-criteria-applied`

On a relation the record holds the key for, such as `author` on a post, `r.disconnect(criteria)` used to set the record's foreign key to null whatever row it was linked to; the criteria had no effect. It now sets it to null only when the linked row matches one of the criteria. Otherwise the foreign key stays unchanged, with no error, and the other updates of the same `update()`, such as changes to the record's own fields, still apply. `r.disconnect()` without criteria is unchanged.

This applies to a relation whose foreign key is optional. On a relation whose foreign key is required, every `disconnect`, with or without criteria and on a variant too, is refused with `ORM.OPERATION_UNSUPPORTED` (`reason: 'required-foreign-key'`) before its criteria or variant are looked at; see `disconnect-on-required-relation-refused` in `nested-disconnect`.

Find each `disconnect([...])` in a relation callback for a many-to-one relation. Where the call is meant to unlink the record whatever it is linked to, drop the criteria:

```ts
// before
await db.Post.where({ id: 1 }).update({
  editor: (editor) => editor.disconnect([{ id: 7 }]),
});

// after, when the post should be unlinked from any editor
await db.Post.where({ id: 1 }).update({
  editor: (editor) => editor.disconnect(),
});
```

Where the call is meant to unlink only from that row, keep it. Code that read the record back and expected the key to be null after a call whose criteria did not match the linked row now reads the unchanged key.

On a relation whose target is a polymorphic model, `r.variant(value).disconnect(criteria?)` on such a relation used to be a type error and was refused at run time with `ORM.OPERATION_UNSUPPORTED`. It is now available on a relation whose foreign key is optional: it unlinks the record only when the linked row is of that variant and, when criteria are given, matches one of them. Where the foreign key is optional, code that caught that refusal can call it directly; where it is required, the call is still refused, now with `reason: 'required-foreign-key'`.

## `disconnect-empty-criteria-disconnects-nothing`

`r.disconnect([])` with an explicit empty list of criteria used to behave as `r.disconnect()` without criteria: it unlinked the record on a relation the record holds the key for, and every related row on a one-to-many or one-to-one relation; `r.variant(value).disconnect([])` unlinked every linked row of that variant. An empty list now matches no row, so the call disconnects nothing; other updates in the same `update()` still apply. Many-to-many `disconnect([])` is still refused with `ORM.ARGUMENT_INVALID`.

Find each `disconnect(...)` whose criteria list can be empty, such as one built from a filtered array. Where the call is meant to unlink everything when the list is empty, call `disconnect()` without criteria in that case.
