---
changes:
  - id: client-connect-safe-to-call-again
    summary: |
      `connect()` without options on a `postgres()`, `sqlite()`, `mysql()` or `mongo()` client no longer rejects when the client is connecting or connected. It waits for the connection and resolves with the runtime. `connect(options)` on such a client still rejects with `DRIVER.ALREADY_CONNECTED`, but its message is now `<Target> client is already bound` (for example `Postgres client is already bound`), it has a `why`, and its `fix` changed. Update code or tests that branch on `DRIVER.ALREADY_CONNECTED` after a `connect()` without options, or that match the old message `<Target> client already connected` or the old `fix` "Call connect() at most once per client.". Code that avoided a second `connect()` for fear of this error may call it freely. A `connect()` that is waiting when `close()` is called now rejects with `DRIVER.NOT_CONNECTED`.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs}"
      matches:
        - 'DRIVER\.ALREADY_CONNECTED'
        - '(?:Postgres|SQLite|MySQL|Mongo) client already connected'
        - 'Call connect\(\) at most once per client'
---

# `connect()` on a client is safe to call again

```ts
// Before
await db.orm.public.User.first();
await db.connect(); // rejected with DRIVER.ALREADY_CONNECTED

// After
await db.orm.public.User.first();
await db.connect(); // resolves with the same runtime
await db.connect({ url: other }); // rejects: "Postgres client is already bound"
```

Replace an assertion on the old message with the new one:

```ts
// Before
await expect(db.connect({ url })).rejects.toThrow('Postgres client already connected');

// After
await expect(db.connect({ url })).rejects.toThrow('Postgres client is already bound');
```
