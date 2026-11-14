import { runtimeError } from '@internal/framework-components/runtime';

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
