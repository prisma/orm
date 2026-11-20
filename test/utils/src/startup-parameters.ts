import { connect, createServer, type Socket } from 'node:net';

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

/** The settings the Prisma Postgres pooler accepts as `-c` startup options. It refuses a connection whose startup options name any other. */
export const PRISMA_POSTGRES_POOLER_STARTUP_SETTINGS: readonly string[] = [
  'DateStyle',
  'TimeZone',
  'extra_float_digits',
];

const POOLER_REFUSAL =
  'Failed to connect to upstream database. Please contact Prisma support if the problem persists.';

/** A server that stands in for the Prisma Postgres pooler: it refuses a startup whose options set anything outside {@link PRISMA_POSTGRES_POOLER_STARTUP_SETTINGS}, and passes every other connection through to the upstream database. */
export interface PrismaPostgresPoolerStandIn {
  /** The upstream URL, pointed at the stand-in. */
  readonly url: string;
  close(): Promise<void>;
}

/** Splits startup options into words as PostgreSQL does: whitespace separates words, and a backslash makes the next character part of the word. */
function startupOptionWords(options: string): string[] {
  const words: string[] = [];
  let word: string | undefined;
  let escaped = false;
  for (const character of options) {
    if (escaped) {
      word = (word ?? '') + character;
      escaped = false;
    } else if (character === '\\') {
      word ??= '';
      escaped = true;
    } else if (/\s/.test(character)) {
      if (word !== undefined) words.push(word);
      word = undefined;
    } else {
      word = (word ?? '') + character;
    }
  }
  if (word !== undefined) words.push(word);
  return words;
}

function settingNamesOf(options: string): string[] {
  const names: string[] = [];
  const words = startupOptionWords(options);
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index] ?? '';
    const assignment = word === '-c' ? words[++index] : word.replace(/^(-c|--)/, '');
    names.push((assignment ?? '').split('=')[0] ?? '');
  }
  return names;
}

/** Whether the Prisma Postgres pooler refuses a connection with these startup options: whether they set anything outside {@link PRISMA_POSTGRES_POOLER_STARTUP_SETTINGS}. */
export function prismaPostgresPoolerRefusesOptions(options: string): boolean {
  const allowed = new Set(
    PRISMA_POSTGRES_POOLER_STARTUP_SETTINGS.map((name) => name.toLowerCase()),
  );
  return settingNamesOf(options).some((name) => !allowed.has(name.toLowerCase()));
}

function fatalErrorResponse(message: string): Buffer {
  const fields = Buffer.from(`SFATAL\0VFATAL\0C08004\0M${message}\0\0`, 'utf8');
  const header = Buffer.alloc(5);
  header.write('E', 0);
  header.writeInt32BE(fields.length + 4, 1);
  return Buffer.concat([header, fields]);
}

export async function startPrismaPostgresPoolerStandIn(
  upstreamUrl: string,
): Promise<PrismaPostgresPoolerStandIn> {
  const upstream = new URL(upstreamUrl);
  const sockets = new Set<Socket>();
  const track = (socket: Socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
  };

  const server = createServer((client) => {
    track(client);
    let buffered = Buffer.alloc(0);
    const onData = (chunk: Buffer) => {
      buffered = Buffer.concat([buffered, chunk]);
      while (buffered.length >= 8 && buffered.length >= buffered.readInt32BE(0)) {
        const length = buffered.readInt32BE(0);
        const message = buffered.subarray(0, length);
        if (message.readInt32BE(4) === SSL_REQUEST_CODE) {
          buffered = buffered.subarray(length);
          client.write(SSL_REFUSED);
          continue;
        }
        client.off('data', onData);
        if (prismaPostgresPoolerRefusesOptions(parametersOf(message)['options'] ?? '')) {
          client.end(fatalErrorResponse(POOLER_REFUSAL));
          return;
        }
        const database = connect(Number(upstream.port), upstream.hostname);
        track(database);
        database.on('close', () => client.destroy());
        client.on('close', () => database.destroy());
        database.write(buffered);
        client.pipe(database);
        database.pipe(client);
        return;
      }
    };
    client.on('data', onData);
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const standIn = new URL(upstreamUrl);
  standIn.hostname = '127.0.0.1';
  standIn.port = String(typeof address === 'object' && address !== null ? address.port : 0);

  return {
    url: standIn.toString(),
    close: () =>
      new Promise((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
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
