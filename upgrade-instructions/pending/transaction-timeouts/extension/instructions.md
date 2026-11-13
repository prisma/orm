---
changes:
  - id: runtime-transaction-signal
    summary: Forward runtime transaction options and provide the required transaction AbortSignal.
---

## Runtime transaction wrappers and implementations

- Change runtime connection/activity wrapper parameters from driver `SqlTransactionOptions` to `RuntimeTransactionOptions`, imported from your SQL runtime entry (`@prisma/orm-family-sql/runtime` for published extensions). Forward the complete options to the underlying runtime transaction or `beginTransactionOn`, and preserve the returned transaction's `signal` when wrapping it. Drivers still receive isolation-only `SqlTransactionOptions`.
- Every handwritten `RuntimeTransaction` implementation or test double must expose a stable readonly `signal: AbortSignal`, even when untimed: `withTransaction` reads it unconditionally. For an untimed double, allocate one `AbortController` per transaction and expose its signal (for an object literal, `signal: new AbortController().signal` allocates it once).
- Never replace a real timed transaction's signal with an inert signal: doing so prevents callback timeout observation. Delegate the original signal; if implementing timed runtime transactions yourself, own the deadline and invalidation, abort with the structured timeout reason after invalidating access, and stop the timer at commit admission or rollback. There is no separate lifetime argument or `started(control)` callback.
