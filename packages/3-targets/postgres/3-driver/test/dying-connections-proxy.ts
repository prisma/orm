import { once } from 'node:events';
import { createConnection, createServer, type Server, type Socket } from 'node:net';

/**
 * How a proxied connection dies. It dies only when its client next writes, so the pool keeps it
 * as idle until then, as it does a connection that died while the process was paused.
 *
 * - `reset`: the client's write is answered with a TCP reset.
 * - `fatal`: the client's write is answered with `FATAL 57P01`, then the connection closes.
 * - `silence`: the client's writes are swallowed and nothing ever answers, not even its FIN.
 */
export type Death = 'reset' | 'fatal' | 'silence';

export interface ProxiedConnection {
  /** The statements this connection forwarded to the database, from simple queries and Parse messages. */
  readonly statements: readonly string[];
  /** Whether the client wrote to this connection after it died. */
  readonly wroteAfterDeath: boolean;
  /** Cuts the connection to the database now; the client sees `death` when it next writes. */
  die(death: Death): void;
}

export interface DyingConnectionsProxy {
  readonly port: number;
  readonly connections: readonly ProxiedConnection[];
  /** The connection that forwarded `statement`. */
  connectionThatRan(statement: string): ProxiedConnection;
  /** Every statement forwarded to the database, connection by connection. */
  statements(): string[];
  /** Destroys every connection now. */
  cutNow(): void;
  /** Destroys every connection when any client next writes. */
  cutOnNextQuery(): void;
  /** Stops accepting connections, as a database that is gone, and leaves the open ones as they are. */
  refuseConnections(): void;
  close(): Promise<void>;
}

const READY_FOR_QUERY = 'Z'.charCodeAt(0);
const SIMPLE_QUERY = 'Q'.charCodeAt(0);
const PARSE = 'P'.charCodeAt(0);

function errorResponse(fields: Readonly<Record<string, string>>): Buffer {
  const body = Buffer.concat([
    ...Object.entries(fields).map(([type, value]) => Buffer.from(`${type}${value}\0`)),
    Buffer.from([0]),
  ]);
  const header = Buffer.alloc(5);
  header.write('E', 0);
  header.writeInt32BE(body.length + 4, 1);
  return Buffer.concat([header, body]);
}

const ADMINISTRATOR_SHUTDOWN = errorResponse({
  S: 'FATAL',
  V: 'FATAL',
  C: '57P01',
  M: 'terminating connection due to administrator command',
});

/** Splits a buffer into whole protocol messages, returning them and the incomplete rest. */
function splitMessages(buffer: Buffer): { messages: Buffer[]; rest: Buffer } {
  const messages: Buffer[] = [];
  let offset = 0;
  while (buffer.length - offset >= 5) {
    const length = buffer.readInt32BE(offset + 1);
    if (buffer.length - offset < length + 1) break;
    messages.push(buffer.subarray(offset, offset + length + 1));
    offset += length + 1;
  }
  return { messages, rest: buffer.subarray(offset) };
}

function statementOf(message: Buffer): string | undefined {
  if (message[0] === SIMPLE_QUERY) return message.subarray(5, message.indexOf(0, 5)).toString();
  if (message[0] === PARSE) {
    const textStart = message.indexOf(0, 5) + 1;
    return message.subarray(textStart, message.indexOf(0, textStart)).toString();
  }
  return undefined;
}

/** A TCP proxy in front of a database whose connections can die one at a time. */
export async function startDyingConnectionsProxy(target: {
  readonly host: string;
  readonly port: number;
}): Promise<DyingConnectionsProxy> {
  const sockets = new Set<Socket>();
  const connections: ProxiedConnection[] = [];
  let cutPending = false;
  const cutNow = () => {
    for (const socket of sockets) socket.destroy();
  };

  const server: Server = createServer({ allowHalfOpen: true }, (downstream) => {
    const upstream = createConnection(target);
    sockets.add(downstream);
    sockets.add(upstream);
    const statements: string[] = [];
    let death: Death | undefined;
    let wroteAfterDeath = false;
    let startedUp = false;
    let fromClient: Buffer = Buffer.alloc(0);
    let fromServer: Buffer = Buffer.alloc(0);

    const actOnDeath = () => {
      wroteAfterDeath = true;
      if (death === 'reset') downstream.resetAndDestroy();
      if (death === 'fatal') downstream.end(ADMINISTRATOR_SHUTDOWN);
    };

    downstream.on('data', (chunk: Buffer) => {
      if (death !== undefined) {
        actOnDeath();
        return;
      }
      if (startedUp && cutPending) {
        cutPending = false;
        cutNow();
        return;
      }
      if (startedUp) {
        const split = splitMessages(Buffer.concat([fromClient, chunk]));
        fromClient = split.rest;
        for (const message of split.messages) {
          const statement = statementOf(message);
          if (statement !== undefined) statements.push(statement);
        }
      }
      upstream.write(chunk);
    });
    upstream.on('data', (chunk: Buffer) => {
      if (!startedUp) {
        const split = splitMessages(Buffer.concat([fromServer, chunk]));
        fromServer = split.rest;
        if (split.messages.some((message) => message[0] === READY_FOR_QUERY)) startedUp = true;
      }
      downstream.write(chunk);
    });
    downstream.on('end', () => {
      if (death === undefined) upstream.end();
    });
    for (const socket of [downstream, upstream]) {
      socket.on('close', () => {
        sockets.delete(socket);
        if (socket === upstream && death !== undefined) return;
        downstream.destroy();
        upstream.destroy();
      });
      socket.on('error', () => undefined);
    }

    connections.push({
      get statements() {
        return statements;
      },
      get wroteAfterDeath() {
        return wroteAfterDeath;
      },
      die(how) {
        death = how;
        upstream.destroy();
      },
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('proxy has no port');

  let closed: Promise<void> | undefined;
  const stopListening = () => {
    closed ??= new Promise<void>((resolve) => server.close(() => resolve()));
    return closed;
  };

  return {
    port: address.port,
    connections,
    connectionThatRan(statement) {
      const connection = connections.find((candidate) => candidate.statements.includes(statement));
      if (connection === undefined) throw new Error(`no proxied connection ran ${statement}`);
      return connection;
    },
    statements: () => connections.flatMap((connection) => connection.statements),
    cutNow,
    cutOnNextQuery: () => {
      cutPending = true;
    },
    refuseConnections: () => {
      void stopListening();
    },
    close: async () => {
      cutNow();
      await stopListening();
    },
  };
}

/** A connection string like `connectionString`, through the proxy on `port`. */
export function throughProxy(connectionString: string, port: number): string {
  const url = new URL(connectionString);
  url.host = `127.0.0.1:${port}`;
  return url.toString();
}

const POSTGRES_DEFAULT_PORT = 5432;

/** The host and port `connectionString` names, with PostgreSQL's default port when it names none, as pg does. */
export function targetOf(connectionString: string): { host: string; port: number } {
  const url = new URL(connectionString);
  return { host: url.hostname, port: url.port === '' ? POSTGRES_DEFAULT_PORT : Number(url.port) };
}
