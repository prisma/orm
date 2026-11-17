class AsyncMutex {
  #queue = Promise.resolve();

  async lock(): Promise<() => void> {
    const previous = this.#queue;
    let releaseLock: (() => void) | undefined;
    this.#queue = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    await previous;
    return () => {
      releaseLock?.();
      releaseLock = undefined;
    };
  }
}

/**
 * One statement at a time on each client, in the order sent, as the Postgres driver's per-client lock runs them, on the runtime and the control driver alike. The lock is held until the statement settles, or for a stream's whole life, so a statement sent while a stream is open waits for it.
 */
const clientQueryLocks = new WeakMap<object, AsyncMutex>();

export function acquireClientQueryLock(client: object): Promise<() => void> {
  let mutex = clientQueryLocks.get(client);
  if (mutex === undefined) {
    mutex = new AsyncMutex();
    clientQueryLocks.set(client, mutex);
  }
  return mutex.lock();
}
