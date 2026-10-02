---
changes:
  - id: variant-takes-discriminator-value
    summary: |
      `.variant()` on a polymorphic SQL or Mongo ORM collection takes the discriminator value a variant declares instead of the variant's model name: `db.orm.public.Task.variant('bug')` for `@@base(Task, "bug")`, where it used to be `.variant('Bug')`. A value the model does not declare, or a call on a model with no discriminator, now throws `ORM.ARGUMENT_INVALID` instead of returning the collection unchanged.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      matches:
        - '\.variant\(\s*[''"`]'
---

## `variant-takes-discriminator-value`

For every `.variant(...)` call matched by `detection`, replace the variant's model name with the discriminator value that variant declares. Read the value from the contract: in PSL it is the second argument of the variant's `@@base(Base, "<value>")`; in the TypeScript builder it is the `value` under the base model's `discriminator.variants.<VariantName>`; in `contract.json` it is `domain.namespaces.<ns>.models.<Base>.variants.<VariantName>.value`.

```ts
// before
db.orm.public.Task.variant('Bug');
db.orm.events.variant('ViewProductEvent');

// after, for @@base(Task, "bug") and a ViewProductEvent variant declaring "view-product"
db.orm.public.Task.variant('bug');
db.orm.events.variant('view-product');
```

Custom collection methods that call `this.variant('<ModelName>')`, and helpers or closures that call `.variant()`, change the same way. Update code comments and READMEs that show `.variant('<ModelName>')` too.

The type checker catches most old call sites, because the parameter only accepts the base model's declared values. It does not catch a call whose model-name argument happens to equal a declared value, for example a variant model declared with `@@base(Base, "Admin")`. Such a call keeps compiling and now selects the variant declaring that value, so check every call site against the contract rather than relying on type errors.

A call that passes a value through `as never` or another cast also escapes the type checker. At runtime, a value the base model does not declare, or a `variant()` call on a model without a discriminator, throws `ORM.ARGUMENT_INVALID`. The error names the model and lists its declared values. Previously the call returned the collection unchanged, so the query read every variant. Code that relied on that fallback must stop calling `variant()` in that case.
