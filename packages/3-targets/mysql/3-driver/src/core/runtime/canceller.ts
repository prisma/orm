import { type Connection, createConnection } from 'mariadb';
import { mysqlConnectionOptions } from '../connection-options';
import { isFatal } from '../normalize-error';

/** How long the canceller waits to open its connection, and for MySQL to answer a `KILL QUERY`. */
const CANCEL_TIMEOUT_MILLIS = 2000;

function timeout(millis: number): { readonly expired: Promise<'expired'>; clear(): void } {
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<'expired'>((resolve) => {
    timer = setTimeout(() => resolve('expired'), millis);
  });
  return { expired, clear: () => clearTimeout(timer) };
}

/**
 * What became of a cancel: MySQL answered it (`'sent'`); it never reached MySQL, or MySQL answered with an error (`'unsent'`); or its `KILL QUERY` may still arrive, because it went out and got no answer in time or its connection was lost (`'unconfirmed'`). A connection whose cancel is unconfirmed must not run another statement: a late `KILL QUERY` would interrupt it.
 */
export type CancelOutcome = 'sent' | 'unsent' | 'unconfirmed';

/**
 * Cancels statements with `KILL QUERY`, which MySQL takes only from another connection. It keeps one connection of its own, outside the pool, so a cancel neither waits for a pooled connection nor normally opens one; it opens it on first need, and ends it once it has been idle for the pool's idle timeout, as the pool ends its own. Opening it and each `KILL QUERY` are bounded by two seconds. The connection is never destroyed: the package's `destroy()` sends a `KILL` of its own whose failure it does not handle (`mariadb` 3.5.4). A connection that stops answering is set aside and ended with `end()` once its statement settles.
 */
export class Canceller {
  readonly #url: string;
  readonly #idleTimeoutMillis: number;
  #connection: Promise<Connection | undefined> | undefined;
  #pending = 0;
  #closed = false;
  #idleTimer: NodeJS.Timeout | undefined;

  constructor(url: string, idleTimeoutMillis: number) {
    this.#url = url;
    this.#idleTimeoutMillis = idleTimeoutMillis;
  }

  /** Sends `KILL QUERY` for `threadId`. Never rejects. A kept connection that is no longer valid is replaced once. */
  async cancel(threadId: number | null, replaced = false): Promise<CancelOutcome> {
    if (this.#closed || threadId === null) return 'unsent';
    clearTimeout(this.#idleTimer);
    const opening = this.#connection ?? this.#open();
    this.#connection = opening;
    const connection = await opening;
    if (connection === undefined) {
      this.#setAside(opening);
      return 'unsent';
    }
    if (!connection.isValid()) {
      this.#setAside(opening);
      return replaced ? 'unsent' : this.cancel(threadId, true);
    }
    this.#pending += 1;
    const killing = connection.query(`KILL QUERY ${Number(threadId)}`).then(
      () => 'sent' as const,
      (error: unknown) => (isFatal(error) ? ('unconfirmed' as const) : ('unsent' as const)),
    );
    void killing.then(() => {
      this.#pending -= 1;
      this.#idleLater(opening, connection);
    });
    const limit = timeout(CANCEL_TIMEOUT_MILLIS);
    const result = await Promise.race([killing, limit.expired]);
    limit.clear();
    if (result === 'sent' || result === 'unsent') return result;
    this.#setAside(opening);
    void connection.end().catch(() => undefined);
    return 'unconfirmed';
  }

  /** Ends the connection: `end()` sends `QUIT` once any `KILL QUERY` on it settles. Waits for that only when none is pending, so a connection that stopped answering cannot hold `close()` up. */
  async close(): Promise<void> {
    this.#closed = true;
    clearTimeout(this.#idleTimer);
    const connection = await this.#connection;
    this.#connection = undefined;
    if (connection === undefined) return;
    const ending = connection.end().catch(() => undefined);
    if (this.#pending === 0) await ending;
  }

  #idleLater(opening: Promise<Connection | undefined>, connection: Connection): void {
    if (this.#pending > 0 || this.#connection !== opening) return;
    clearTimeout(this.#idleTimer);
    this.#idleTimer = setTimeout(() => {
      if (this.#pending > 0 || this.#connection !== opening) return;
      this.#connection = undefined;
      void connection.end().catch(() => undefined);
    }, this.#idleTimeoutMillis);
    this.#idleTimer.unref();
  }

  #setAside(opening: Promise<Connection | undefined>): void {
    if (this.#connection === opening) this.#connection = undefined;
  }

  async #open(): Promise<Connection | undefined> {
    try {
      const connection = await createConnection(
        mysqlConnectionOptions(this.#url, { connectTimeoutMs: CANCEL_TIMEOUT_MILLIS }),
      );
      connection.on('error', () => undefined);
      if (this.#closed) {
        await connection.end().catch(() => undefined);
        return undefined;
      }
      return connection;
    } catch {
      return undefined;
    }
  }
}
