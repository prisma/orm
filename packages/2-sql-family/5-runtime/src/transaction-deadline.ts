import { runtimeError } from '@internal/framework-components/runtime';
import type { SqlTransaction } from '@internal/sql-relational-core/ast';

export function validateTransactionTimeout(timeout: number | null | undefined): number | undefined {
  if (timeout === undefined || timeout === null) return undefined;
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 2147483647) {
    throw runtimeError(
      'RUNTIME.INVALID_TRANSACTION_TIMEOUT',
      'Transaction timeout must be an integer between 1 and 2147483647 milliseconds',
      { timeout },
    );
  }
  return timeout;
}

export function containTransaction(
  transaction: SqlTransaction,
  stopChildren: () => void,
  closedError: Error,
  timeout: number,
): {
  readonly queryable: SqlTransaction;
  readonly signal: AbortSignal;
  admitCommit(): void;
  close(): void;
} {
  const controller = new AbortController();
  const deadline = performance.now() + timeout;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let invalidation: { reason: unknown } | undefined;
  let committing = false;
  const stopTimer = () => {
    clearTimeout(timer);
    timer = undefined;
  };
  const expire = () => {
    if (committing || invalidation !== undefined) return;
    const reason = runtimeError(
      'RUNTIME.TRANSACTION_TIMEOUT',
      'Transaction callback exceeded its timeout',
      { timeout },
    );
    invalidation = { reason };
    stopChildren();
    stopTimer();
    controller.abort(reason);
  };
  const assertActive = () => {
    if (performance.now() >= deadline) expire();
    if (invalidation !== undefined) throw invalidation.reason;
    if (committing) throw closedError;
  };
  const tick = () => {
    const remaining = deadline - performance.now();
    if (remaining > 0) timer = setTimeout(tick, Math.ceil(remaining));
    else expire();
  };
  timer = setTimeout(tick, timeout);
  const queryable: SqlTransaction = {
    async *query<Row>(request: Parameters<SqlTransaction['query']>[0]) {
      assertActive();
      const rows = transaction.query<Row>(request)[Symbol.asyncIterator]();
      try {
        while (true) {
          assertActive();
          const next = await rows.next();
          assertActive();
          if (next.done) return;
          yield next.value;
        }
      } finally {
        await rows.return?.();
      }
    },
    async execute(request) {
      assertActive();
      return transaction.execute(request);
    },
    commit: () => transaction.commit(),
    rollback: () => transaction.rollback(),
  };
  return {
    queryable,
    signal: controller.signal,
    admitCommit() {
      assertActive();
      committing = true;
      stopTimer();
    },
    close() {
      stopTimer();
      invalidation ??= { reason: closedError };
      stopChildren();
    },
  };
}
