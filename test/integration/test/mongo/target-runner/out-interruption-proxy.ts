import { type AddressInfo, createServer, type Socket, connect as tcpConnect } from 'node:net';
import { MongoClient } from 'mongodb';

/** The MongoDB wire protocol prefixes each message with its length in bytes, header included. */
function takeMessages(buffered: Buffer): { readonly messages: Buffer[]; readonly rest: Buffer } {
  const messages: Buffer[] = [];
  let rest = buffered;
  while (rest.length >= 4 && rest.length >= rest.readInt32LE(0)) {
    const length = rest.readInt32LE(0);
    messages.push(rest.subarray(0, length));
    rest = rest.subarray(length);
  }
  return { messages, rest };
}

/**
 * A TCP proxy to a MongoDB server that drops the connection carrying the first request that holds
 * an `$out` stage: `beforeCommit` drops it without sending the request, so the copy never runs;
 * `afterCommit` sends it and drops the connection when the server answers, so the copy has run
 * but the client sees a closed connection; `whileRunning` sends it and drops the connection
 * 100 ms later, so a copy slower than that is still running on the server when the client stops.
 * `beforeSending` runs once that request is found and before it is sent, as when a test holds the
 * copy on the server.
 */
export async function outInterruptingClient(
  serverUri: string,
  mode: 'beforeCommit' | 'afterCommit' | 'whileRunning',
  beforeSending: () => Promise<void> = async () => {},
): Promise<{ readonly client: MongoClient; readonly close: () => Promise<void> }> {
  const { hostname, port } = new URL(serverUri.replace(/^mongodb:/, 'http:'));
  const sockets = new Set<Socket>();
  let fired = false;
  const server = createServer((downstream) => {
    const upstream = tcpConnect(Number(port), hostname);
    sockets.add(downstream).add(upstream);
    let armed = false;
    let ended = false;
    let buffered: Buffer = Buffer.alloc(0);
    let sending = Promise.resolve();
    const end = () => {
      ended = true;
      downstream.destroy();
      upstream.destroy();
    };
    const send = async (message: Buffer) => {
      if (ended) return;
      if (!fired && message.includes('$out')) {
        fired = true;
        if (mode === 'beforeCommit') return end();
        await beforeSending();
        if (mode === 'whileRunning') setTimeout(end, 100);
        else armed = true;
      }
      upstream.write(message);
    };
    downstream.on('data', (bytes) => {
      const chunk = typeof bytes === 'string' ? Buffer.from(bytes) : bytes;
      const { messages, rest } = takeMessages(Buffer.concat([buffered, chunk]));
      buffered = rest;
      for (const message of messages) sending = sending.then(() => send(message)).catch(end);
    });
    upstream.on('data', (bytes) => (armed ? end() : downstream.write(bytes)));
    for (const socket of [downstream, upstream]) {
      socket.on('error', end);
      socket.on('close', end);
    }
  });
  const close = async (client: MongoClient) => {
    await client.close(true);
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port: proxyPort } = server.address() as AddressInfo;
  const client = new MongoClient(`mongodb://127.0.0.1:${proxyPort}/?directConnection=true`, {
    retryReads: false,
    retryWrites: false,
  });
  try {
    await client.connect();
  } catch (error) {
    await close(client);
    throw error;
  }
  return { client, close: () => close(client) };
}
