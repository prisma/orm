---
changes:
  - id: re-emit-for-the-insert-conflict-target-capability
    summary: |
      The Postgres and SQLite adapters report a new capability key, `sql.insertOnConflictTarget`: an insert's conflict clause applies only to the unique columns it names. `upsert()` and `createAll`/`createAndCount` with `{ onConflict: 'skip', conflictOn }` now require it. A `contract.json` emitted before this release does not carry it. Against such a contract, `upsert()` is refused with `ORM.CAPABILITY_MISSING` when another unique key can collide; otherwise the ORM sends it without conflict columns, which the Postgres and SQLite adapters refuse with `RUNTIME.AST_INVALID`. The skip option with `conflictOn` is always refused. Run `prisma contract emit` to pick up the key.
    detection:
      glob: "**/contract.json"
      matches:
        - '(?<![\s\S])(?![\s\S]*"insertOnConflictTarget")[\s\S]*"insertOnConflictWithoutTarget"'
---

## `re-emit-for-the-insert-conflict-target-capability`

The Postgres and SQLite adapters now report `sql.insertOnConflictTarget`. It says that an insert's conflict clause applies only to the unique columns it names, which is what `ON CONFLICT (columns)` does on both databases. MySQL's `ON DUPLICATE KEY UPDATE` fires on any unique key instead, so the MySQL adapter does not report it.

Two ORM calls now require the key:

```ts
await db.orm.User.upsert({
  create: { email: 'alice@example.com', name: 'Alice' },
  update: { name: 'Alice (updated)' },
  conflictOn: { email: 'alice@example.com' },
});

await db.orm.User.createAll(rows, { onConflict: 'skip', conflictOn: ['email'] });
```

A `contract.json` emitted before this release does not carry the key. Against such a contract, the ORM treats the database as one whose conflict clause fires on any unique key, as MySQL's does. `upsert()` is refused with `ORM.CAPABILITY_MISSING` unless every other primary key and unique constraint of the table contains an auto-increment column the create values leave out; when it is allowed, the ORM sends it without conflict columns, and the Postgres and SQLite adapters refuse that with `RUNTIME.AST_INVALID`. `onConflict: 'skip'` with `conflictOn` is always refused.

Re-emit your contract to pick up the key:

```console
prisma contract emit
```

The key is additive: the storage hash does not change, and nothing else behaves differently.
