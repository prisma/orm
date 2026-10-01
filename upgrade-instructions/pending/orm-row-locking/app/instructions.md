---
changes:
  - id: orm-collections-lock-rows
    summary: "ORM collections gain forUpdate(), forNoKeyUpdate(), forShare() and forKeyShare(), gated on the same capability keys as the SQL builder's row-locking methods; a contract emitted before this release does not carry them and the methods are unavailable against it, so re-emit the contract before using them."
    detection:
      glob: "**/contract.json"
      contains:
        - '"distinctOn"'
---

## `orm-collections-lock-rows`

The ORM client's collections gain four methods that lock the rows a read selects: `forUpdate()`, `forNoKeyUpdate()`, `forShare()` and `forKeyShare()`. Each takes an optional `{ nowait, skipLocked }`, which exclude each other. There is no `of` option, because the ORM always locks only the model's own table. A lock lasts until the transaction ends, so use it inside `db.transaction(...)`:

```ts
await db.transaction(async (tx) => {
  const job = await tx.orm.public.Job.where({ state: 'queued' })
    .orderBy((j) => j.createdAt.asc())
    .forUpdate({ skipLocked: true })
    .first();
});
```

A lock cannot be combined with `include`, `groupBy`, `aggregate`, `distinct`, `distinctOn` or a mutation terminal, and a lock method cannot be called inside an `include()` refinement callback. Each of these throws `ORM.LOCK_INCOMPATIBLE`.

Each method is gated on `sql.forUpdate`, `postgres.forNoKeyUpdate`, `sql.forShare` or `postgres.forKeyShare`, and the options on `sql.lockNowait` and `sql.lockSkipLocked`. A `contract.json` emitted before this release carries none of them, so the methods do not exist on its collections. Re-emit your contract to pick up the keys:

```console
prisma contract emit
```
