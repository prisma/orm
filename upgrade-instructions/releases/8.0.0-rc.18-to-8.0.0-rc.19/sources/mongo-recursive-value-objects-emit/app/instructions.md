---
changes:
  - id: mongo-recursive-value-objects-emit
    summary: |
      A PSL MongoDB contract with a composite type that contains itself, such as a navigation item with a list of child items, now emits. Before, `prisma contract emit` failed with `Maximum call stack size exceeded`. The collection validator checks the type in full down to where it repeats, and accepts any object there.
---

# A MongoDB composite type that contains itself now emits

## `mongo-recursive-value-objects-emit`

No change to your code is needed. If you removed a self-referencing composite type to make `prisma contract emit` work, you can now write it:

```prisma
type NavItem {
  label    String
  children NavItem[]
}
```

The validator for the collection that holds it requires the fields of the first `NavItem` level and refuses any other field there. It accepts any object inside `children`, because a MongoDB `$jsonSchema` validator cannot describe a type at every depth of itself. Apply the contract as usual, with `prisma db update` or with `prisma migration plan` and `prisma db migrate`.
