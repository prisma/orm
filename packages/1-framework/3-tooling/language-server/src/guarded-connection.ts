import { type Connection, ConnectionError, ConnectionErrors } from 'vscode-languageserver';

/**
 * Wraps a connection so that an outbound call the client is no longer there to
 * receive does nothing, instead of throwing at whoever made it.
 *
 * `vscode-jsonrpc` marks the connection closed the moment the input stream
 * ends, and every send after that throws synchronously. A throw that escapes a
 * notification handler ends the process: jsonrpc reports it through its logger,
 * which is the connection's own remote console, so the report is another send —
 * it throws again inside a `.catch()`, and the unhandled rejection is fatal.
 *
 * The wrapper carries the check so no individual send site has to: reads walk
 * the connection's features (`console`, `languages`, …) and hand back guarded
 * functions, so a send added later is guarded by construction. Only the
 * connection's departure is swallowed — any other synchronous failure is a bug
 * in the caller and still reaches it.
 */
export function guardedConnection(connection: Connection): Connection {
  return guardCalls(connection);
}

function guardCalls<Target extends object>(target: Target): Target {
  const guarded = new Map<PropertyKey, unknown>();
  return new Proxy(target, {
    get: (source, property) => {
      const cached = guarded.get(property);
      if (cached !== undefined) {
        return cached;
      }
      const value: unknown = Reflect.get(source, property);
      if (typeof value === 'function') {
        const call = (...args: readonly unknown[]): unknown =>
          whileConnected(() => Reflect.apply(value, source, args));
        guarded.set(property, call);
        return call;
      }
      if (typeof value === 'object' && value !== null) {
        const feature = guardCalls(value);
        guarded.set(property, feature);
        return feature;
      }
      return value;
    },
  });
}

/**
 * Whether an error says the connection is gone.
 *
 * The identity check is the fast path. It misses when the error comes from a
 * second copy of `vscode-jsonrpc` in the dependency tree, whose
 * `ConnectionError` is a different class carrying the same shape, so the code
 * is what decides: `Closed`, `Disposed` and `AlreadyListening` are the whole
 * range, and no other error jsonrpc throws carries a numeric `code` in it.
 */
function isConnectionGone(error: unknown): error is ConnectionError {
  if (error instanceof ConnectionError) {
    return true;
  }
  if (!(error instanceof Error) || !('code' in error)) {
    return false;
  }
  const { code } = error;
  return (
    code === ConnectionErrors.Closed ||
    code === ConnectionErrors.Disposed ||
    code === ConnectionErrors.AlreadyListening
  );
}

function whileConnected(send: () => unknown): unknown {
  let sent: unknown;
  try {
    sent = send();
  } catch (error) {
    if (isConnectionGone(error)) {
      // Sends return promises, so a caller that awaits or chains a swallowed
      // one must get a promise back, not a bare `undefined`.
      return Promise.resolve(undefined);
    }
    throw error;
  }
  // A write that failed after the send was accepted has nobody left to report
  // it to either, and an unhandled rejection here would end the process.
  return isThenable(sent) ? sent.then(undefined, () => undefined) : sent;
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'then' in value &&
    typeof Reflect.get(value, 'then') === 'function'
  );
}
