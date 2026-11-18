---
changes:
  - id: sti-variant-unscoped-index-refused
    summary: |
      `prisma contract emit` now refuses most `@unique`, `@@unique` and `@@index` without `where:` on a single-table variant, and stores a variant `@@index` with `where:` that it used to drop. Rewrite each refused attribute as the partial index the message gives, then plan and apply a migration.
    detection:
      glob: "**/*.prisma"
      matches:
        - '(?<![\s\S])(?=[\s\S]*@@base\s*\()[\s\S]*(@unique|@@index\s*\()'
  - id: sti-variant-foreign-keys-stored
    summary: |
      A relation on a single-table variant now stores its foreign key and backing index on the base table, where they used to be dropped. Re-emit the contract, then plan and apply a migration.
    detection:
      glob: "**/*.prisma"
      matches:
        - '(?<![\s\S])(?=[\s\S]*@@base\s*\()[\s\S]*@relation\s*\([^)]*fields\s*:'
---

# Constraints declared on a single-table variant

This applies to SQL contracts only; a MongoDB contract is not affected, though the detection also matches MongoDB `.prisma` files. A single-table variant is a model with `@@base(Base, "value")` and no `@@map`. Its rows are stored in the base model's table, next to the rows of the base and of every other variant.

## A unique or an index without `where:` is refused

A unique constraint or a plain index on the shared table would also cover the other variants' rows. `prisma contract emit` used to drop these attributes from the contract. It now refuses each one at the attribute:

```text
PSL_UNSCOPED_INDEX_ON_STI_VARIANT: Model "Bug" shares the table of its base model "Task" (single-table inheritance), so "@unique" would also cover the rows of other variants. Without a condition, only a plain @@index, @unique or @@unique over exactly the fields of one of its own relations is accepted. Scope it to this variant instead: @@index([ticket], unique: true, where: sql`type = 'bug'`)
```

Without `where:`, only a plain `@@index`, `@unique` or `@@unique` over exactly the `fields:` of one of the variant's own relations is still accepted: the index is the one the relation's foreign key creates anyway, and the unique covers only the variant's rows and makes a one-to-one relation to the variant valid. Such an index or unique is refused when another variant gives the same one a different `name` or `map`.

In every file the detection matches, find each variant that declares `@unique`, `@@unique` or an `@@index` without `where:`. Replace it with the `@@index` the message writes out: the same fields, `unique: true` for a unique one, and a `where:` condition that compares the base's discriminator column with the variant's value.

```prisma
// Before
model Bug {
  ticket String @unique

  @@base(Task, "bug")
}

// After
model Bug {
  ticket String

  @@index([ticket], unique: true, where: sql`type = 'bug'`)
  @@base(Task, "bug")
}
```

These attributes were never in the contract before, so the new index is a change to storage: plan and apply a migration for it. A unique index fails to build if two rows of the variant already hold the same value; remove the duplicates first.

## An `@@index` with `where:` is now stored

A variant's `@@index` with `where:` used to be dropped from the contract too. It now becomes a partial index on the base model's table. Re-emit the contract with `prisma contract emit`, then plan and apply a migration to create the index.

## A relation's foreign key is now stored

A relation with `fields:` on a variant now puts its foreign key on the base model's table, with the index that backs it. Before, both were dropped. A `@unique` or `@@unique` over exactly those fields is now stored too, as a unique constraint on the base table. Re-emit the contract with `prisma contract emit`, then plan and apply a migration to add them. The foreign key fails to build if a row already points at a missing row; fix those rows first.

When two variants declare relations over the same column, both must name the same target and referential actions. If they differ, the emit fails with `PSL_FOREIGN_KEY_CONFLICT_ON_STI_VARIANT`, because every row would have to satisfy both foreign keys. Give each variant its own column with `@map`. When the other foreign key is declared by the base model, keep only one of the two relations.
