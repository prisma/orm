import { startPrismaDevServer } from '@prisma/dev';
import { timeouts } from '../timeouts';

export interface PostgresServer {
  readonly url: string;
  /** Resolves when the server has closed or after `timeouts.devServerClose`, whichever is first. */
  close(): Promise<void>;
}

/**
 * Starts one `@prisma/dev` server. It accepts one connection at a time, so a test closes every client before it opens the next.
 */
export async function startPostgresServer(): Promise<PostgresServer> {
  // Stops each dev server starting the Prisma Streams worker thread, which crashes Node 24.
  process.env['DS_TOUCH_WORKERS'] = '0';
  const server = await startPrismaDevServer({
    databaseConnectTimeoutMillis: 1000,
    databaseIdleTimeoutMillis: 30_000,
  });
  const url = new URL(server.database.connectionString);
  url.searchParams.delete('sslmode');
  url.searchParams.delete('connection_limit');
  return {
    url: url.toString(),
    async close() {
      const closing = server.close().catch(() => undefined);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const waited = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeouts.devServerClose);
        timer.unref();
      });
      await Promise.race([closing, waited]);
      clearTimeout(timer);
    },
  };
}
