import { PassThrough, type Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import {
  type Connection,
  createConnection,
  DidChangeWatchedFilesNotification,
  type Message,
  type MessageWriter,
  ProposedFeatures,
  type WatchDog,
} from 'vscode-languageserver';
import {
  createProtocolConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from 'vscode-languageserver/node';
import { guardedConnection } from '../src/guarded-connection';

const watchDog: WatchDog = {
  shutdownReceived: false,
  initialize: () => undefined,
  exit: () => undefined,
};

function serverConnection(input: Readable, writer: MessageWriter): Connection {
  return createConnection(
    (logger) => createProtocolConnection(new StreamMessageReader(input), writer, logger),
    watchDog,
    ProposedFeatures.all,
  );
}

function discardingWriter(): MessageWriter {
  const output = new PassThrough();
  output.resume();
  return new StreamMessageWriter(output);
}

/** Rejects the first write only: a writer that always rejects sends
 *  `vscode-languageserver`'s own log of the failure into an endless retry. */
function writerRejectingOnce(): MessageWriter {
  const writer = discardingWriter();
  let rejected = false;
  return {
    onError: writer.onError,
    onClose: writer.onClose,
    write: (message: Message) => {
      if (rejected) {
        return writer.write(message);
      }
      rejected = true;
      return Promise.reject(new Error('pipe closed'));
    },
    end: () => writer.end(),
    dispose: () => writer.dispose(),
  };
}

async function closedConnection(): Promise<Connection> {
  const input = new PassThrough();
  const connection = serverConnection(input, discardingWriter());
  connection.listen();
  input.end();
  await new Promise((resolve) => setImmediate(resolve));
  return connection;
}

describe('guardedConnection', () => {
  describe('once the client is gone', () => {
    it('hands an awaiting sender a promise, not a bare undefined', async () => {
      const connection = guardedConnection(await closedConnection());

      await expect(
        connection.sendDiagnostics({ uri: 'file:///x.psl', diagnostics: [] }),
      ).resolves.toBeUndefined();
    });

    it('drops sends made through a nested feature', async () => {
      const connection = guardedConnection(await closedConnection());

      expect(() => connection.console.warn('nobody is listening')).not.toThrow();
      expect(() => void connection.languages.diagnostics.refresh()).not.toThrow();
    });

    it('reports the same guarded feature on every read', async () => {
      const connection = guardedConnection(await closedConnection());

      expect(connection.console).toBe(connection.console);
    });
  });

  it('resolves a send the transport rejected', async () => {
    const connection = guardedConnection(
      serverConnection(new PassThrough(), writerRejectingOnce()),
    );

    await expect(
      connection.sendDiagnostics({ uri: 'file:///x.psl', diagnostics: [] }),
    ).resolves.toBeUndefined();
  });

  // A second copy of `vscode-jsonrpc` in the tree throws its own
  // `ConnectionError` class, so the error carries the shape but not the
  // identity of the one this module imports.
  class ForeignConnectionError extends Error {
    readonly code = 2;
  }

  it('drops a send the connection refused from another copy of the transport', () => {
    const console = {
      error: () => {
        throw new ForeignConnectionError('Connection is disposed.');
      },
    };
    const guarded = guardedConnection({ console } as unknown as Connection);

    expect(() => guarded.console.error('late log')).not.toThrow();
  });

  it('lets an error that is not the connection leaving through', () => {
    const connection = guardedConnection(serverConnection(new PassThrough(), discardingWriter()));

    expect(() =>
      connection.client.register(DidChangeWatchedFilesNotification.type, { watchers: [] }),
    ).toThrow('Call listen() first.');
  });
});
