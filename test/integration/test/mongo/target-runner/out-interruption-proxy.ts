import { type AddressInfo, createServer, type Socket, connect as tcpConnect } from 'node:net';
import { MongoClient } from 'mongodb';

/**
 * A TCP proxy to a MongoDB server that drops the connection carrying the first request that holds
 * an `$out` stage: `beforeCommit` drops it without sending the request, so the copy never runs;
 * `afterCommit` sends it and drops the connection when the server answers, so the copy has run
 * but the client sees a closed connection.
 */
export async function outInterruptingClient(
  serverUri: string,
  mode: 'beforeCommit' | 'afterCommit',
): Promise<{ readonly client: MongoClient; readonly close: () => Promise<void> }> {
  const { hostname, port } = new URL(serverUri.replace(/^mongodb:/, 'http:'));
  const sockets = new Set<Socket>();
  let fired = false;
  const server = createServer((downstream) => {
    const upstream = tcpConnect(Number(port), hostname);
    sockets.add(downstream).add(upstream);
    let armed = false;
    const end = () => {
      downstream.destroy();
      upstream.destroy();
    };
    downstream.on('data', (bytes) => {
      if (!fired && bytes.includes('$out')) {
        fired = true;
        if (mode === 'beforeCommit') return end();
        armed = true;
      }
      upstream.write(bytes);
    });
    upstream.on('data', (bytes) => (armed ? end() : downstream.write(bytes)));
    for (const socket of [downstream, upstream]) {
      socket.on('error', end);
      socket.on('close', end);
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port: proxyPort } = server.address() as AddressInfo;
  const client = new MongoClient(`mongodb://127.0.0.1:${proxyPort}/?directConnection=true`, {
    retryReads: false,
    retryWrites: false,
  });
  await client.connect();
  return {
    client,
    close: async () => {
      await client.close(true);
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
