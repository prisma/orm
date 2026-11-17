interface ErrorEventSource {
  on(event: 'error', listener: (err: Error) => void): unknown;
}

const suppressed = new WeakSet<ErrorEventSource>();

/**
 * Connection libraries emit 'error' on a pool or client when an idle
 * connection drops (database restart, pooler timeout, network blip). With no
 * listener Node treats that as an uncaught exception and kills the process.
 * Connect and query failures still reject their own promises, so nothing real
 * is masked. A pool discards the dead connection and hands the next query a
 * fresh one; a single client stays unusable and its later operations reject.
 * Idempotent per emitter: repeated calls attach one listener.
 */
export function suppressIdleConnectionErrors<T extends ErrorEventSource>(target: T): T {
  if (!suppressed.has(target)) {
    suppressed.add(target);
    target.on('error', () => {});
  }
  return target;
}
