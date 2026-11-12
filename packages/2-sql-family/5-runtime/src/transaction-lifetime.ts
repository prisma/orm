import type { SqlTransaction } from '@internal/sql-relational-core/ast';

export interface TransactionLifetimeControl {
  invalidate(reason: unknown): boolean;
}

export interface TransactionLifetime {
  started(control: TransactionLifetimeControl): void;
}

export function containTransaction(
  transaction: SqlTransaction,
  stop: () => void,
  closedError: Error,
) {
  let invalidation: { reason: unknown } | undefined;
  let committing = false;
  const assertActive = () => {
    if (invalidation !== undefined) throw invalidation.reason;
    if (committing) throw closedError;
  };
  const control: TransactionLifetimeControl = {
    invalidate(reason) {
      if (committing || invalidation !== undefined) return false;
      invalidation = { reason };
      stop();
      return true;
    },
  };
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
    control,
    admitCommit() {
      assertActive();
      committing = true;
    },
  };
}
