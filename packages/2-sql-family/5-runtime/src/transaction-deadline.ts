import { runtimeError } from '@internal/framework-components/runtime';
import type { SqlTransactionOptions } from '@internal/sql-relational-core/ast';
import type { TransactionLifetimeControl } from './transaction-lifetime';

export interface CallbackTransactionOptions extends SqlTransactionOptions {
  readonly timeout?: number | null | undefined;
}

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

export function createTransactionDeadline(timeout: number, invalidate: () => void) {
  let control: TransactionLifetimeControl | undefined;
  let invalidateContext: (() => void) | undefined = invalidate;
  let deadline: number | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let expired: ReturnType<typeof runtimeError> | undefined;
  let rejectExpiration = (_reason: unknown) => {};
  const expiration = new Promise<never>((_, reject) => {
    rejectExpiration = reject;
  });
  void expiration.catch(() => undefined);

  const stop = () => {
    stopped = true;
    clearTimeout(timer);
    timer = undefined;
    control = undefined;
    invalidateContext = undefined;
  };
  const expire = () => {
    if (stopped) return;
    const error = runtimeError(
      'RUNTIME.TRANSACTION_TIMEOUT',
      'Transaction callback exceeded its timeout',
      { timeout },
    );
    control?.invalidate(error);
    invalidateContext?.();
    expired = error;
    stop();
    rejectExpiration(error);
  };
  const check = () => {
    if (deadline === undefined) {
      throw runtimeError(
        'RUNTIME.TRANSACTION_LIFETIME_UNAVAILABLE',
        'Transaction connection did not notify successful BEGIN',
      );
    }
    if (performance.now() >= deadline) expire();
    if (expired !== undefined) throw expired;
  };
  const tick = () => {
    if (stopped || deadline === undefined) return;
    const remaining = deadline - performance.now();
    if (remaining > 0) timer = setTimeout(tick, Math.ceil(remaining));
    else expire();
  };

  return {
    started(value: TransactionLifetimeControl): void {
      control = value;
      deadline = performance.now() + timeout;
      timer = setTimeout(tick, timeout);
    },
    async run<T>(callback: () => PromiseLike<T>): Promise<T> {
      check();
      try {
        const result = Promise.resolve(callback()).catch((error: unknown) => {
          check();
          stop();
          throw error;
        });
        return await Promise.race([result, expiration]);
      } catch (error) {
        check();
        stop();
        throw error;
      }
    },
    admitCommit(): void {
      check();
      stop();
    },
    stop,
  };
}
