---
changes:
  - id: re-emit-contracts-with-polymorphic-models
    summary: |
      A polymorphic base model's `variants` is stored in a new form in `contract.json` and `contract.d.ts`: keyed by discriminator value, each entry naming the variant model and its namespace. A contract in the previous form is rejected with `CONTRACT.VALIDATION_FAILED`. Re-emit the contract, and rewrite `variants` in the contract snapshots under `migrations/snapshots/`.
    detection:
      glob: "**/contract*.json"
      matches:
        - '"variants"\s*:\s*\{\s*"[^"]+"\s*:\s*\{\s*"value"\s*:'
  - id: read-variants-by-discriminator-value
    summary: |
      Code that reads a base model's `variants` from a contract finds the variant model at `variants[<value>].model`, where it used to find the value at `variants[<Model>].value`.
    detection:
      glob: "**/*.{ts,tsx,mts,cts,js,mjs,cjs}"
      matches:
        - '(?<![\w$])variants(?![\w$])'
---

# A base model lists its variants by discriminator value

## `re-emit-contracts-with-polymorphic-models`

For `@@base(Task, "bug")` and `@@base(Task, "feature")` the base model's entry changes like this:

```diff
 "Task": {
   "discriminator": { "field": "type" },
   "variants": {
-    "Bug": { "value": "bug" },
-    "Feature": { "value": "feature" }
+    "bug": { "model": "Bug", "namespace": "public" },
+    "feature": { "model": "Feature", "namespace": "public" }
   }
 }
```

The schema source does not change, and neither does a variant model's `base`. The storage hash does not change, so no migration is needed and the database marker stays valid.

1. Run `prisma contract emit` and commit the regenerated `contract.json` and `contract.d.ts`.
2. Rewrite each contract snapshot under `migrations/snapshots/<hash>/` whose `contract.json` matches `detection`. No command regenerates a snapshot, and a snapshot in the previous form stops `prisma migration plan` when it is the plan's origin. The directory names stay as they are.

In a snapshot's `contract.json`, for every model that has `variants`:

- replace each entry `"<Model>": { "value": "<value>" }` with `"<value>": { "model": "<Model>", "namespace": "<namespace>" }`, where `<namespace>` is the key under `domain.namespaces` that holds the base model;
- order the entries by key;
- keep the file on one line with no added whitespace.

In the snapshot's `contract.d.ts`, make the same change to the type of `variants`:

```diff
 readonly variants: {
-  readonly Bug: { readonly value: 'bug' };
-  readonly Feature: { readonly value: 'feature' };
+  readonly bug: { readonly namespace: 'public' & NamespaceId; readonly model: 'Bug' };
+  readonly feature: { readonly namespace: 'public' & NamespaceId; readonly model: 'Feature' };
 };
```

Quote a key that is not an identifier, such as `'view-product'`. Change nothing else in either file.

A MongoDB contract has one namespace, `__unbound__`; use it as `<namespace>`.

## `read-variants-by-discriminator-value`

This affects only code that reads `variants` from a contract object or from `contract.json`. The `variants` option of the MongoDB TypeScript contract builder's `discriminator` is unchanged: it still lists `<Model>: { value }`.

```ts
// before
const value = models.Task.variants.Bug.value;
const variantNames = Object.keys(models.Task.variants);

// after
const model = models.Task.variants.bug.model;
const values = Object.keys(models.Task.variants);
const variantNames = Object.values(models.Task.variants).map((variant) => variant.model);
```

To find the value of a known variant model, search the entries for the one whose `model` and `namespace` are that model's.
