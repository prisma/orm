/**
 * Equivalent to `once` from `node:events` for DOM {@link EventTarget}.
 *
 * It is useful, e.g., to wait for an `abort` event on {@link AbortSignal}.
 * While in Node.js `AbortSignal` does implement `EventEmitter` interface
 * and is compatible with the `once` utility in `node:events`, it is not
 * necessarily the case in other JS runtimes.
 */
export async function once(target: EventTarget, event: string): Promise<Event> {
  return new Promise((resolve) => {
    target.addEventListener(event, resolve, { once: true })
  })
}
