---
changes:
  - id: unique-criterion-rejects-null
    summary: "UniqueConstraintCriterion in @internal/sql-orm-client no longer accepts null for a nullable unique column, so upsert's conflictOn and the criteria of a relation connect or disconnect stop compiling when a value is null or may be null. Pass a non-null value, or handle the null case before the call."
    detection:
      glob: "**/*.{ts,tsx,mts,cts}"
      matches:
        - '\bconflictOn\b|\.(?:connect|disconnect)\s*\(|\bUniqueConstraintCriterion\b'
---

## `unique-criterion-rejects-null`

`UniqueConstraintCriterion<TContract, ModelName>` from `@internal/sql-orm-client` is the object that names one row by its primary key or by one of its unique constraints. Each of its values is now the field's type without `null`. A `null` value cannot identify one row: a unique constraint allows any number of rows whose column is `NULL`.

The type is the argument of three calls, and each of them now refuses `null` and a value whose type includes `null`:

- `conflictOn` in `collection.upsert({ create, update, conflictOn })`
- `mutator.connect(criterion)` and `mutator.connect([criterion, ...])` in a relation callback of `create` or `update`
- `mutator.disconnect([criterion, ...])` in a relation callback of `update`

Only a model with a nullable unique column is affected. Given `Account.handle`, a nullable column with a unique constraint, these no longer compile:

```ts
await db.orm.Account.upsert({ create, update, conflictOn: { handle: null } });
await db.orm.Account.upsert({ create, update, conflictOn: { handle: maybeHandle } }); // maybeHandle: string | null

await db.orm.Owner.where({ id }).update({
  accounts: (accounts) => accounts.connect({ handle: maybeHandle }),
});
```

The compiler reports `Type 'null' is not assignable to type 'string'` on the field.

What to write instead:

- Where the value is known to be present, narrow it before the call, so that its type has no `null`:

  ```ts
  if (maybeHandle === null) {
    throw new Error('an account needs a handle to be connected');
  }
  await db.orm.Owner.where({ id }).update({
    accounts: (accounts) => accounts.connect({ handle: maybeHandle }),
  });
  ```

- Where the value can be absent, decide what that case means and write it as its own branch. For `upsert`, no existing row can be selected by a `null` value, so create the row with `create(...)` in that branch, or use a constraint whose columns all have values, such as the primary key: `conflictOn: { id }`. For `connect` and `disconnect`, leave the criterion out of the list in that branch, or name the row by another key.

- To read or write the rows whose column is `NULL`, use `where({ handle: null })`. It can match more than one row.

- Where your own code declares a variable, a parameter or a return value as `UniqueConstraintCriterion<...>`, the same rule applies to the values assigned to it.
