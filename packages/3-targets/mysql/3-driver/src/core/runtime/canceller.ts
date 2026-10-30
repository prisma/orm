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
 * Cancels statements with `KILL QUERY`, which MySQL takes only from another connection. It keeps one connection of its own, outside the pool, so a cancel neither waits for a pooled connection nor normally opens one; it opens it on first need. Opening it and each `KILL QUERY` are bounded by two seconds; past that, or on any failure, the cancel reports that it sent none and the caller reads the rest of the result instead. The connection is never destroyed: the package's `destroy()` sends a `KILL` of its own whose failure it does not handle (`mariadb` 3.5.4). A connection that stops answering is set aside and ended with `end()` once its statement settles.
 */
export class Canceller {
  readonly #url: string;
  #connection: Promise<Connection | undefined> | undefined;
  #pending = 0;
  #closed = false;

  constructor(url: string) {
    this.#url = url;
  }

  /** Sends `KILL QUERY` for `threadId`, and resolves whether MySQL accepted it. Never rejects. */
  async cancel(threadId: number | null): Promise<boolean> {
    if (this.#closed || threadId === null) return false;
    const opening = this.#connection ?? this.#open();
    this.#connection = opening;
    const connection = await opening;
    if (connection === undefined) {
      this.#setAside(opening);
      return false;
    }
    if (!connection.isValid()) {
      this.#setAside(opening);
      return this.cancel(threadId);
    }
    this.#pending += 1;
    const killing = connection.query(`KILL QUERY ${Number(threadId)}`).then(
      () => 'sent' as const,
      (error: unknown) => (isFatal(error) ? ('lost' as const) : ('refused' as const)),
    );
    void killing.then(() => {
      this.#pending -= 1;
    });
    const limit = timeout(CANCEL_TIMEOUT_MILLIS);
    const result = await Promise.race([killing, limit.expired]);
    limit.clear();
    if (result === 'expired' || result === 'lost') {
      this.#setAside(opening);
      void connection.end().catch(() => undefined);
    }
    return result === 'sent';
  }

  /** Ends the connection: `end()` sends `QUIT` once any `KILL QUERY` on it settles. Waits for that only when none is pending, so a connection that stopped answering cannot hold `close()` up. */
  async close(): Promise<void> {
    this.#closed = true;
    const connection = await this.#connection;
    this.#connection = undefined;
    if (connection === undefined) return;
    const ending = connection.end().catch(() => undefined);
    if (this.#pending === 0) await ending;
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
