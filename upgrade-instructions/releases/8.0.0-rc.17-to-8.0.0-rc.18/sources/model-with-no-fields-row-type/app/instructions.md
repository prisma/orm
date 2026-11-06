---
changes:
  - id: model-with-no-fields-has-no-keys
    summary: |
      A model with no fields now has no keys at the type level: reading a property of its row, such as `row.legacy_key`, fails to compile. In an emitted `contract.d.ts`, the fields and output types of such a model change from `Record<string, never>` to `{}`. In the SQL ORM client, writing a key in the create or update input of such a model, such as `create({ legacy_key: 'x' })`, also fails to compile now; before, both the read and the write compiled, for an emitted contract and for a contract built with `defineContract`. In the Mongo ORM, writes behave as before: an emitted contract already rejected such a key, and the update methods now take the type `UpdateInput` (see the next entry).
  - id: generic-update-data-uses-update-input-type
    summary: |
      Code that is generic over the model name and passes a value typed `Partial<DefaultModelRow<Contract, M>>` to `updateAll`, `updateAndCount` or the `update` of `upsert` no longer compiles. Type the value as `ScalarUpdateInput<Contract, M>` from the SQL ORM client (`orm-client` entry point of the SQL facade, such as `@prisma/orm-postgres/orm-client`), or `UpdateInput<Contract, M>` from the Mongo ORM, instead.
    detection:
      glob: "**/*.{ts,mts,cts,tsx}"
      matches:
        - 'Partial<\s*DefaultModelRow<'
---

# A model with no fields has no keys

Re-emit the contract. If code reads a property of a row of a model with no fields, it now fails to compile, because the model has no field of that name. With the SQL ORM client, passing a key in the create or update input of such a model fails to compile too. Remove the read or the key, or add a field to the model that maps the column.

# Generic update data uses the update input type

The update methods of the SQL and Mongo ORM clients now take the update input type of the model, which rejects every key for a model with no fields. While the model name is a type parameter, TypeScript cannot tell that `Partial<DefaultModelRow<Contract, M>>` is that type. Use the update input type instead.

SQL ORM client:

```diff
- import type { DefaultModelRow } from '@prisma/orm-postgres/orm-client';
- function touchAll<M extends 'User' | 'Post'>(rows: Collection<Contract, M>, data: Partial<DefaultModelRow<Contract, M>>) {
+ import type { ScalarUpdateInput } from '@prisma/orm-postgres/orm-client';
+ function touchAll<M extends 'User' | 'Post'>(rows: Collection<Contract, M>, data: ScalarUpdateInput<Contract, M>) {
    return rows.where({}).updateAndCount(data);
  }
```

Mongo ORM: replace `Partial<DefaultModelRow<Contract, M>>` with `UpdateInput<Contract, M>`, imported from `@prisma/orm-mongo/orm`, the same entry point as `DefaultModelRow`.

Where the model name is a concrete name, such as `Partial<DefaultModelRow<Contract, 'User'>>`, nothing changes.
