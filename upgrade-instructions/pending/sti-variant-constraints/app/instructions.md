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
      A relation on a single-table variant now stores its foreign key on the base table, with a backing index unless the relation says `index: false`; both used to be dropped. Re-emit the contract, then plan and apply a migration.
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
PSL_UNSCOPED_INDEX_ON_STI_VARIANT: Model "Bug" shares the table of its base model "Task" (single-table inheritance), so "@unique" would also cover the rows of other variants. Without a condition, only a plain @@index, @unique or @@unique over exactly the fields of one of its own relations is accepted, and only when no other model maps those columns differently. Scope it to this variant instead: @@index([ticket], unique: true, where: sql`type = 'bug'`)
```

Without `where:`, only a plain `@@index`, `@unique` or `@@unique` over exactly the `fields:` of one of the variant's own relations is still accepted: the index is the one the relation's foreign key creates anyway, and the unique covers only the variant's rows and makes a one-to-one relation to the variant valid. A unique is accepted only when every other model that maps those columns declares the same relation and unique; when a one-to-one relation needs it, the message says to give the field its own column instead. Another variant may not give the same index a different `name` or `map`.

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

A relation with `fields:` on a variant now puts its foreign key on the base model's table. Before, it was dropped. The migration adds a backing index only when the relation derives one: a relation with `index: false` gets none, and one with `index: "<name>"` uses that index. A `@unique` or `@@unique` over exactly those fields is now stored too, as a unique constraint on the base table. Re-emit the contract with `prisma contract emit`, then plan and apply a migration to add them. The foreign key fails to build if a row already points at a missing row; fix those rows first.

When another model of the table maps the same column, it must declare the same relation: the same target, the same column pairs and the same referential actions. If it declares a different one, or maps the column as a plain field, the emit fails with `PSL_FOREIGN_KEY_CONFLICT_ON_STI_VARIANT`, because its rows would have to satisfy the foreign key too. When the other foreign key is the base model's, keep only one of the two relations. Otherwise give the variant's field its own column with `@map`, in this order, so that no value is lost:

1. Keep the old shared column. Add the variant's new column beside it, nullable and without a foreign key yet: map the field to the new column and leave the relation off for now.
2. Copy the values across for that variant's rows only, by discriminator value, as in `UPDATE actor SET human_contact_id = "contactId" WHERE kind = 'human'`.
3. Check that every copied value has its target row, as in `SELECT human_contact_id FROM actor WHERE human_contact_id IS NOT NULL AND human_contact_id NOT IN (SELECT id FROM contact)`, which must return no rows.
4. Put the relation back on the new column, plan and apply the migration that adds its foreign key, and drop the old column only when no model maps it any more.
