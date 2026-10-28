---
changes:
  - id: client-members-reject-instead-of-throwing
    summary: |
      A client member that returns a promise or a result no longer throws at the call when the client or the transaction is in a failed state. On `postgres()`, `sqlite()`, a `supabase()` role-bound client and a transaction, `query`, `execute`, `prepare`, `transaction`, ORM calls and a prepared statement's `query(target, params)` and `execute(target, params)` now report a closed client, a failed connection or an ended transaction through what they return: the promise rejects, and a result rejects when it is awaited or read. Error codes and messages do not change. Code that wraps such a call in `try`/`catch` without awaiting it no longer catches the error; add `await`, or handle it with `.catch(...)`. `db.runtime()` still throws at the call, and so does a mistake in the call itself, such as an ORM query the database's capabilities do not allow. The detection matches a file that imports an `@prisma/orm-*` package and has a `try` block, one line or many, nested or not, that calls one of these members or an ORM terminal (`all`, `first`, `create`, `update`, `delete`, `upsert`, …) without `await` directly before it, on a receiver shaped like a client: a name ending in `db`, `tx`, a name ending in `client`, `admin`, a prepared statement, or a chain through `.orm`; chains may span lines and take callbacks; leave a call whose result is awaited or returned to an awaiting caller as it is.
    detection:
      glob: "**/*.{ts,mts,cts,tsx,js,mjs,cjs}"
      matches:
        - '(?<![\s\S])(?=[\s\S]*[\x27\x22]@prisma/orm-)[\s\S]*\btry\s*\{(?:(?!\}\s*(?:catch|finally)\b)[\s\S])*?(?<![\w$.])(?<!\bawait\s+)(?:this\s*\.\s*)?(?:[\w$]*(?:db|Db|DB)|tx|trx|[\w$]*[Cc]lient|admin|[\w$]*[Pp]repared[\w$]*|[\w$]+\s*\.\s*orm)(?:\s*\.\s*[\w$]+(?:\s*\((?:[^()]|\([^()]*\))*\))?)*?\s*\.\s*(?:query|execute|prepare|transaction|all|first|firstOrThrow|create|createAll|createAndCount|update|updateAll|updateAndCount|delete|deleteAll|deleteAndCount|upsert|aggregate)\s*\('
  - id: lazy-activity-source-rejects
    summary: |
      `lazyActivitySource(source)` and `delegatingActivitySource(target)` now reject from `startActivity` and `planContentHash` when `source()` or `target()` throws, instead of throwing at the call. A transaction context from `withTransaction` and its activity handles report `RUNTIME.TRANSACTION_CLOSED` from `query` and from the prepared-statement bridges through the result they return. No code change is needed unless your code caught these errors with a synchronous `try`/`catch`.
---

# A client reports failures through what its members return

```ts
await db.close();

// Before: throws at the call, so .catch never runs
db.query(plan).toArray().catch(handle);

// After: the result rejects, so handle runs
db.query(plan).toArray().catch(handle);

// A synchronous try/catch around an unawaited call stops catching
try {
  db.transaction(work);
} catch (error) {
  handle(error);
}

// Await it instead
try {
  await db.transaction(work);
} catch (error) {
  handle(error);
}
```
