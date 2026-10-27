import { createServer, type Socket } from 'node:net';

const SSL_REQUEST_CODE = 80_877_103;
const SSL_REFUSED = 'N';

export type StartupParameters = Readonly<Record<string, string>>;

/** A server that records the parameters of each PostgreSQL startup message it receives, then drops the connection. */
export interface StartupParameterRecorder {
  /** A URL that points a PostgreSQL client at the recorder. */
  readonly url: string;
  /** The parameters of the next startup message the recorder receives. */
  next(): Promise<StartupParameters>;
  close(): Promise<void>;
}

function parametersOf(message: Buffer): StartupParameters {
  const fields = message.subarray(8).toString('utf8').split('\0');
  const parameters: Record<string, string> = {};
  for (let index = 0; index + 1 < fields.length && fields[index] !== ''; index += 2) {
    parameters[fields[index] ?? ''] = fields[index + 1] ?? '';
  }
  return parameters;
}

export async function startStartupParameterRecorder(): Promise<StartupParameterRecorder> {
  const received: StartupParameters[] = [];
  const waiting: ((parameters: StartupParameters) => void)[] = [];
  const record = (parameters: StartupParameters) => {
    const waiter = waiting.shift();
    if (waiter === undefined) received.push(parameters);
    else waiter(parameters);
  };

  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    let buffered = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      buffered = Buffer.concat([buffered, chunk]);
      while (buffered.length >= 8 && buffered.length >= buffered.readInt32BE(0)) {
        const length = buffered.readInt32BE(0);
        const message = buffered.subarray(0, length);
        buffered = buffered.subarray(length);
        if (message.readInt32BE(4) === SSL_REQUEST_CODE) {
          socket.write(SSL_REFUSED);
          continue;
        }
        record(parametersOf(message));
        socket.destroy();
        return;
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;

  return {
    url: `postgres://recorder@127.0.0.1:${port}/recorder`,
    next: () => {
      const parameters = received.shift();
      if (parameters !== undefined) return Promise.resolve(parameters);
      return new Promise((resolve) => waiting.push(resolve));
    },
    close: () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}
