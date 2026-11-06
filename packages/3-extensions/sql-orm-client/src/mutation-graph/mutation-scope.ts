import type { RuntimeScope } from '@internal/sql-relational-core/types';
import { settlementOf } from '@internal/sql-runtime/internal/prepared-query';
import type { RuntimeQueryable, RuntimeTransaction } from '../types';

export async function withMutationScope<T>(
  runtime: RuntimeQueryable,
  run: (scope: RuntimeScope) => Promise<T>,
): Promise<T> {
  // A top-level transaction wins when the runtime exposes one directly.
  if (typeof runtime.transaction === 'function') {
    return runInTransaction(await runtime.transaction(), run);
  }

  // Otherwise open a connection and run the whole mutation graph inside its
  // transaction. The top-level `Runtime` exposes `transaction()` only on a
  // connection (`connection().transaction()`), so without this a multi-statement
  // graph that fails after the first write would leave a partial write behind.
  if (typeof runtime.connection === 'function') {
    const connection = await runtime.connection();
    try {
      if (typeof connection.transaction === 'function') {
        return await runInTransaction(await connection.transaction(), run);
      }
      return await run(connection);
    } finally {
      await connection.release?.();
    }
  }

  // Bare runtimes (e.g. unit-test stubs) expose neither: run directly.
  return run(runtime);
}

async function runInTransaction<T>(
  transaction: RuntimeTransaction,
  run: (scope: RuntimeScope) => Promise<T>,
): Promise<T> {
  try {
    const result = await run(transaction);
    if (typeof transaction.commit === 'function') {
      await transaction.commit();
    }
    return result;
  } catch (error) {
    if (typeof transaction.rollback === 'function') {
      try {
        await transaction.rollback();
      } catch (rollbackError) {
        // A hook that threw after the ROLLBACK landed must not replace the error that caused it.
        const settlement = settlementOf(transaction);
        if (settlement?.rolledBack !== true) throw rollbackError;
        settlement.logDroppedError(rollbackError);
      }
    }
    throw error;
  }
}
