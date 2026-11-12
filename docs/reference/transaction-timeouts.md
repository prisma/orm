# Callback transaction timeouts

PostgreSQL pooled and serverless, MySQL, SQLite, and Supabase role-bound clients accept `timeout` in factory `transactionOptions` and in `transaction(callback, options?)`. Timeout and [isolation](transaction-isolation.md) resolve independently.

```ts
const db = postgres({
  contract,
  url,
  transactionOptions: { isolationLevel: IsolationLevel.RepeatableRead, timeout: 5000 },
});

await db.transaction(async (tx) => {
  await tx.execute(tx.raw.sql`UPDATE posts SET views = 0`.affectedCount().build());
}, { timeout: null });
```

This call inherits RepeatableRead and disables the default timeout. Supabase uses the same options on its factory and on `asAnon()`, `asUser(...)`, or `asServiceRole()` application clients. The `.supabase` secondary root has no callback transaction API.

## Values and inheritance

- Durations are integer milliseconds from **1 through 2147483647**, inclusive. Zero, negative or fractional numbers, NaN, infinities, larger numbers, and non-numeric values are invalid.
- Global omission, `undefined`, or `null` means no application deadline. There is no finite default.
- Local omission or `undefined` inherits the global timeout. Local `null` disables it for that callback.
- An isolation override does not reset timeout; a timeout override does not reset isolation. `isolationLevel: null` remains invalid.
- Invalid per-call options reject the returned promise before acquisition or callback execution. Global validation follows the factory's existing synchronous/asynchronous convention.

Defaults apply only to explicit callback transactions. Manual runtime and implicit ORM transactions do not inherit them. MySQL's implicit ORM transactions continue to request ReadCommitted. ORM operations inside an explicit transaction participate in its lifetime without creating a second deadline or changing isolation.

## Timing and cleanup

The clock starts immediately after successful database BEGIN, not during acquisition or BEGIN. It includes subsequent setup, callback execution, asynchronous waits, and statements. Supabase binds role and claims before BEGIN; its deadline is forwarded to the actual BEGIN boundary, not restarted after role-wrapper setup.

A successful callback can enter commit only before the monotonic deadline. The clock stops at commit admission: a slow COMMIT is awaited normally, without a timeout rollback claim.

Expiry invalidates the transaction and refuses future transaction work and escaped lazy results. The promise rejects after safe rollback or destruction, without waiting for a hung callback to finish. Ordinary expiry reports `RUNTIME.TRANSACTION_TIMEOUT` with milliseconds in `details.timeout`. Rollback failure retains `RUNTIME.TRANSACTION_ROLLBACK_FAILED`, its actual `details.rollbackError`, and the selected timeout as wrapper cause. Supabase resets role/session state only on the safe release path; uncertain cleanup destroys instead of returning the session to the pool.

Timeout is not JavaScript termination or a hard upper bound on rejection time. Callback code can continue external side effects. A blocked event loop, including synchronous SQLite work, delays observation. Running statements, startup cleanup, or transport draining can delay rejection. No `maxWait`, commit deadline, automatic retry, or implicit transaction timeout is introduced.
