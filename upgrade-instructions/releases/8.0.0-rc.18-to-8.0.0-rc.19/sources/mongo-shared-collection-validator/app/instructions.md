---
changes:
  - id: mongo-shared-collection-validator
    summary: |
      A MongoDB collection that stores several models that are not variants of one base, such as two PSL models with the same `@@map`, now gets a validator that accepts a document of any of them. Before, the validator described only the last model and refused the other models' documents. Re-emit the contract and apply the new validator with `prisma db update`, or with `prisma migration plan` and `prisma db migrate`.
---

# A collection that stores several models accepts each model's documents

## `mongo-shared-collection-validator`

If two or more models map to one collection without being variants of one base model, the collection's validator is now one `anyOf` with a branch per model. Before, it described only one of the models, so inserting or updating a document of another model failed with `Document failed validation`.

Run `prisma contract emit`. The collection's `validator` in `contract.json` and `storage.storageHash` change. Then apply the validator with `prisma db update`, or with `prisma migration plan` followed by `prisma db migrate`.

No discriminator tells these models' documents apart, so `prisma migration plan` and `prisma db update` refuse to rename or remove a field of one of them when another model in the collection stores the same field: the change would reach that model's documents too. Renaming the field to the same new name in every model that stores it, in one plan, is planned as one rename. Move the models to separate collections, or carry out the change in a `dataTransform` operation of a `migration.ts`, with a filter that selects only the documents to change.

Every collection validator now requires `_id`, in each branch. A model that declares a field stored as `_id` gets that field's BSON type, so a PSL model may now declare `id String @id @map("_id")` or any other single type. A model that declares none gets an `objectId` `_id`, because MongoDB adds one to every document inserted without it, so a MongoDB model in PSL may leave out its `@id` field. A field stored as `_id` cannot hold an array, a regular expression, undefined or null, so it cannot be a list, optional, `Json` or `Bson`. A PSL contract that built before still builds.
