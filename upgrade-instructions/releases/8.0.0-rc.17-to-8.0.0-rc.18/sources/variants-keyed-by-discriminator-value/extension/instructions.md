---
changes:
  - id: read-variants-by-discriminator-value
    summary: |
      A polymorphic base model's `variants` in a contract is keyed by discriminator value, and each entry is a reference `{ namespace, model }` to the variant model. Code that reads it finds the variant model at `variants[<value>].model`, where it used to find the value at `variants[<Model>].value`. `ContractVariantEntry` is removed; the entry type is `CrossReference`. A variant may be in a different namespace from its base.
    detection:
      glob: "**/*.{ts,tsx,mts,cts,js,mjs,cjs}"
      matches:
        - '(?<![\w$])variants(?![\w$])'
        - '\bContractVariantEntry\b'
  - id: sql-orm-state-names-a-variant-by-value
    summary: |
      SQL ORM collection state names a variant by its discriminator value, not its model name. `CollectionState.variantName` is `variantValue`, `IncludeExpr.localVariantName` is `localVariantValue`, the type-state field `variantName` is `variantValue`, and `CollectionTables.variants` is keyed by discriminator value.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      matches:
        - '\bvariantName\b'
        - '\blocalVariantName\b'
        - '\bCollectionTables\b'
  - id: orm-variant-types-take-a-value
    summary: |
      The Mongo ORM variant type helpers take a discriminator value where they took a variant model name: `VariantModelRow`, `VariantCreateInput`, and the fourth type parameter of `MongoCollection`. `DiscriminatorValues` is the keys of `variants`. `VariantNames` and `VariantNameForValue` are removed.
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      matches:
        - '\bVariantNames\b'
        - '\bVariantNameForValue\b'
        - '\bVariantModelRow\b'
        - '\bVariantCreateInput\b'
        - '\bMongoCollection\s*<'
---

# A variant is named by its discriminator value

These changes concern code that reads `variants` from a contract, or that imports from `@prisma/orm-family-sql/orm-client` or `@prisma/orm-family-mongo/orm`. A contract an extension ships must be re-emitted: see the app instructions' `re-emit-contracts-with-polymorphic-models`.

## `read-variants-by-discriminator-value`

```ts
// before
for (const [variantName, { value }] of Object.entries(model.variants ?? {})) {
  const variant = models[variantName];
}

// after
for (const [value, variantRef] of Object.entries(model.variants ?? {})) {
  const variant = contract.domain.namespaces[variantRef.namespace]?.models[variantRef.model];
}
```

Look the variant model up in the namespace its reference names, not in the base's namespace. A discriminator value is unique in a hierarchy; a variant model name is not, because two namespaces may each have a variant model of the same name.

Replace the type `ContractVariantEntry` with `CrossReference`, exported from the same module.

## `sql-orm-state-names-a-variant-by-value`

Rename the properties, and where a value is written or compared, use the discriminator value the variant declares in place of its model name:

```ts
// before
const narrowed = { ...state, variantName: 'Feature' };
const include: IncludeExpr = { relationName: 'assignee', localVariantName: 'Feature', /* … */ };
const featureTable = state.tables.variants.get('Feature');

// after, for @@base(Task, "feature")
const narrowed = { ...state, variantValue: 'feature' };
const include: IncludeExpr = { relationName: 'assignee', localVariantValue: 'feature', /* … */ };
const featureTable = state.tables.variants.get('feature');
```

A type that reads the selected variant from a collection's type state reads `variantValue`, for example `CollectionTypeStateOf<C>['variantValue']`.

## `orm-variant-types-take-a-value`

These types are exported from `@prisma/orm-family-mongo/orm`. Pass the discriminator value where a variant model name was passed:

```ts
// before
type BugRow = VariantModelRow<Contract, 'Task', 'Bug'>;
type BugInput = VariantCreateInput<Contract, 'Task', 'Bug'>;
type Bugs = MongoCollection<Contract, 'Task', NoIncludes, 'Bug'>;

// after, for a Bug variant declaring "bug"
type BugRow = VariantModelRow<Contract, 'Task', 'bug'>;
type BugInput = VariantCreateInput<Contract, 'Task', 'bug'>;
type Bugs = MongoCollection<Contract, 'Task', NoIncludes, 'bug'>;
```

`VariantNameForValue<C, M, V>` mapped a value to a model name for these helpers; pass the value itself. Replace `VariantNames<C, M>` with `DiscriminatorValues<C, M>` where the code lists what `variant()` accepts.
