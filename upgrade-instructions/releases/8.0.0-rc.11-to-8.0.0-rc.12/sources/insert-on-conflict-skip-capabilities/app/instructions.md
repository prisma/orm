---
changes:
  - id: re-emit-for-the-insert-conflict-skip-capabilities
    summary: "The Postgres and SQLite adapters report two new capability keys, sql.insertOnConflictSkip and sql.insertOnConflictWithoutTarget, which gate the new createAll/createAndCount option { onConflict: 'skip' }; a contract emitted before this release does not carry them and the option is refused against it, so re-emit the contract before using it."
    detection:
      glob: "**/contract.json"
      contains:
        - '"defaultInInsert"'
---

## `re-emit-for-the-insert-conflict-skip-capabilities`

`createAll` and `createAndCount` on the SQL ORM client take a new option in second position that asks the database to skip rows colliding with a unique constraint:

```ts
const inserted = await db.orm.User.createAll(rows, { onConflict: 'skip' });
const added = await db.orm.User.createAndCount(rows, {
  onConflict: 'skip',
  conflictOn: ['email'],
});
```

The option is gated on two capability keys that the Postgres and SQLite adapters now report: `sql.insertOnConflictSkip`, and `sql.insertOnConflictWithoutTarget` for the untargeted form. A `contract.json` emitted before this release carries neither, so the ORM refuses the option with `ORM.CAPABILITY_MISSING` before running any statement.

Re-emit your contract to pick up the keys:

```console
prisma contract emit
```

Nothing else changes. The keys are additive, the storage hash does not move, and every existing call — including `createAll(rows, configure)` with the annotation callback in second position — behaves exactly as before. You only need to re-emit if you want to use the new option.
