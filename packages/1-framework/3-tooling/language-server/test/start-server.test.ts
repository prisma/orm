import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { PassThrough } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { timeouts } from '@repo/test-utils';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';
import {
  createConnection,
  ExitNotification,
  InitializedNotification,
  InitializeRequest,
  type InitializeResult,
  ShutdownRequest,
  StreamMessageReader,
  StreamMessageWriter,
  TextDocumentSyncKind,
} from 'vscode-languageserver/node';
import { startServer } from '../src/start-server';

const rootUri = pathToFileURL(tmpdir()).toString();

/** A non-ASCII string whose UTF-8 encoding is longer than its length. */
const multiByteText = 'ünïcødé π 日本語 🎉';

function framed(message: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii'), body]);
}

interface Frame {
  readonly contentLength: number;
  readonly body: string;
}

function parseFrames(text: string): readonly Frame[] {
  const bytes = Buffer.from(text, 'utf8');
  const frames: Frame[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    const headerEnd = bytes.indexOf('\r\n\r\n', offset, 'ascii');
    if (headerEnd === -1) {
      break;
    }
    const declared = /content-length: *(\d+)/i.exec(
      bytes.toString('ascii', offset, headerEnd),
    )?.[1];
    if (declared === undefined) {
      throw new Error(`Frame without a Content-Length header: ${text.slice(offset)}`);
    }
    const contentLength = Number(declared);
    const bodyStart = headerEnd + 4;
    const bodyEnd = bodyStart + contentLength;
    if (bytes.length < bodyEnd) {
      break;
    }
    frames.push({ contentLength, body: bytes.toString('utf8', bodyStart, bodyEnd) });
    offset = bodyEnd;
  }
  return frames;
}

/** Collects what the server wrote to the host's stderr. */
function hostErrors(): { readonly write: (text: string) => void; readonly text: () => string } {
  let text = '';
  return {
    write: (chunk) => {
      text += chunk;
    },
    text: () => text,
  };
}

/** The `stdout` half of the pair, plus the ability to await frames on it. */
function serverOutput(): {
  readonly write: (text: string) => void;
  readonly text: () => string;
  readonly frames: () => readonly Frame[];
  readonly waitForFrames: (count: number) => Promise<readonly Frame[]>;
} {
  let text = '';
  const waiters: { count: number; resolve: () => void }[] = [];
  const frames = (): readonly Frame[] => parseFrames(text);
  return {
    text: () => text,
    write: (chunk) => {
      text += chunk;
      for (const waiter of [...waiters]) {
        if (frames().length >= waiter.count) {
          waiters.splice(waiters.indexOf(waiter), 1);
          waiter.resolve();
        }
      }
    },
    frames,
    waitForFrames: async (count) => {
      if (frames().length < count) {
        await new Promise<void>((resolve) => waiters.push({ count, resolve }));
      }
      return frames();
    },
  };
}

/** A client speaking real LSP over the injected pair. */
function connectedClient(stdin: PassThrough): {
  readonly client: ReturnType<typeof createConnection>;
  readonly stdout: { readonly write: (text: string) => void };
} {
  const serverToClient = new PassThrough();
  const client = createConnection(
    new StreamMessageReader(serverToClient),
    new StreamMessageWriter(stdin),
  );
  client.listen();
  return { client, stdout: { write: (text) => void serverToClient.write(text, 'utf8') } };
}

const initializeParams = {
  processId: null,
  rootUri,
  capabilities: {},
  workspaceFolders: [{ uri: rootUri, name: multiByteText }],
};

describe('startServer over injected streams', () => {
  it('answers initialize and exits 0 after shutdown', async () => {
    const stdin = new PassThrough();
    const { client, stdout } = connectedClient(stdin);
    const exitCode = startServer({ stdin, stdout, stderr: hostErrors() });

    const initialized = await client.sendRequest(InitializeRequest.type, initializeParams);
    client.sendNotification(InitializedNotification.type, {});
    await client.sendRequest(ShutdownRequest.type, undefined);
    client.sendNotification(ExitNotification.type);

    expect(initialized.capabilities).toMatchObject({
      textDocumentSync: { openClose: true, change: TextDocumentSyncKind.Incremental },
      documentFormattingProvider: true,
      foldingRangeProvider: true,
      completionProvider: { triggerCharacters: ['.', '@', '[', '(', '{', ':', ','] },
    });
    await expect(exitCode).resolves.toBe(0);
  });

  it('exits 1 when the client disconnects without shutting down', async () => {
    const stdin = new PassThrough();
    const { client, stdout } = connectedClient(stdin);
    const exitCode = startServer({ stdin, stdout, stderr: hostErrors() });

    await client.sendRequest(InitializeRequest.type, initializeParams);
    stdin.end();

    await expect(exitCode).resolves.toBe(1);
  });

  it('exits 0 when the client disconnects after asking to shut down', async () => {
    const stdin = new PassThrough();
    const { client, stdout } = connectedClient(stdin);
    const exitCode = startServer({ stdin, stdout, stderr: hostErrors() });

    await client.sendRequest(InitializeRequest.type, initializeParams);
    await client.sendRequest(ShutdownRequest.type, undefined);
    stdin.end();

    await expect(exitCode).resolves.toBe(0);
  });

  it('runs the whole conversation while the watched client process is alive', async () => {
    const stdin = new PassThrough();
    const { client, stdout } = connectedClient(stdin);
    const exitCode = startServer({
      stdin,
      stdout,
      stderr: hostErrors(),
      clientProcessId: process.pid,
    });

    await client.sendRequest(InitializeRequest.type, initializeParams);
    await client.sendRequest(ShutdownRequest.type, undefined);
    stdin.end();

    await expect(exitCode).resolves.toBe(0);
  });

  it('settles when the watched client process is already gone', async () => {
    const departed = spawnSync(process.execPath, ['-e', '']);
    expect(departed.pid).toBeGreaterThan(0);
    const stdin = new PassThrough();
    const { stdout } = connectedClient(stdin);
    const exitCode = startServer({
      stdin,
      stdout,
      stderr: hostErrors(),
      clientProcessId: departed.pid,
    });

    await expect(exitCode).resolves.toBe(1);
  });

  it('stops the server when the host had already aborted', async () => {
    const host = new AbortController();
    host.abort('SIGTERM');

    const exitCode = startServer({
      stdin: new PassThrough(),
      stdout: { write: () => undefined },
      stderr: hostErrors(),
      signal: host.signal,
    });

    await expect(exitCode).resolves.toBe(1);
  });

  it('stops the server when the host aborts the run', async () => {
    const stdin = new PassThrough();
    const { client, stdout } = connectedClient(stdin);
    const host = new AbortController();
    const exitCode = startServer({ stdin, stdout, stderr: hostErrors(), signal: host.signal });

    await client.sendRequest(InitializeRequest.type, initializeParams);
    host.abort('SIGTERM');

    await expect(exitCode).resolves.toBe(1);
  });

  it('settles an aborted run whose work never goes idle', {
    timeout: timeouts.databaseOperation,
  }, async () => {
    const stdin = new PassThrough();
    const { client, stdout } = connectedClient(stdin);
    const host = new AbortController();
    const exitCode = startServer({ stdin, stdout, stderr: hostErrors(), signal: host.signal });

    await client.sendRequest(InitializeRequest.type, initializeParams);
    // Cancelling a request already being handled: the connection answers the
    // cancellation itself without dispatching it, so the awaiting-dispatch
    // count is left standing for good.
    stdin.write(
      framed({
        jsonrpc: '2.0',
        id: 2,
        method: 'textDocument/foldingRange',
        params: { textDocument: { uri: pathToFileURL(join(tmpdir(), 'abort.psl')).toString() } },
      }),
    );
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    stdin.write(framed({ jsonrpc: '2.0', method: '$/cancelRequest', params: { id: 2 } }));
    // Fresh activity on every turn keeps the stalled-dispatch grace from ever
    // elapsing, so only the abort deadline can end the run.
    const holdOpen = setInterval(
      () => stdin.write(framed({ jsonrpc: '2.0', method: 'prisma/keepBusy' })),
      10,
    );
    host.abort('SIGTERM');
    try {
      await expect(exitCode).resolves.toBe(1);
    } finally {
      clearInterval(holdOpen);
    }
  });
});

describe('startServer byte framing', () => {
  it('reads a request whose frame is split mid-character across two chunks', async () => {
    const stdin = new PassThrough();
    const out = serverOutput();
    const exitCode = startServer({ stdin, stdout: out, stderr: hostErrors() });

    const request = framed({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: initializeParams,
    });
    const splitAt = request.indexOf(Buffer.from('ü', 'utf8')) + 1;
    expect(splitAt).toBeGreaterThan(0);
    stdin.write(request.subarray(0, splitAt));
    stdin.write(request.subarray(splitAt));

    const [response] = await out.waitForFrames(1);
    expect(response).toBeDefined();
    const parsed: { readonly id: number; readonly result: InitializeResult } = JSON.parse(
      response?.body ?? '',
    );
    expect(parsed.id).toBe(1);
    expect(parsed.result.capabilities.documentFormattingProvider).toBe(true);

    stdin.end();
    await expect(exitCode).resolves.toBe(1);
  });

  it('declares the byte length, not the character length, of a multi-byte response', async () => {
    const stdin = new PassThrough();
    const out = serverOutput();
    const exitCode = startServer({ stdin, stdout: out, stderr: hostErrors() });

    stdin.write(framed({ jsonrpc: '2.0', id: 1, method: 'initialize', params: initializeParams }));
    await out.waitForFrames(1);
    stdin.write(framed({ jsonrpc: '2.0', id: 2, method: `prisma/${multiByteText}` }));

    const frames = await out.waitForFrames(2);
    const response = frames[1];
    expect(response).toBeDefined();
    const parsed: { readonly error: { readonly message: string } } = JSON.parse(
      response?.body ?? '',
    );
    expect(parsed.error.message).toContain(multiByteText);
    expect(response?.contentLength).toBe(Buffer.byteLength(response?.body ?? '', 'utf8'));
    expect(response?.contentLength).toBeGreaterThan(response?.body.length ?? 0);

    stdin.end();
    await expect(exitCode).resolves.toBe(1);
  });

  it('reads a host that yields plain Uint8Array chunks rather than Buffers', async () => {
    const script = Buffer.concat([
      framed({ jsonrpc: '2.0', id: 1, method: 'initialize', params: initializeParams }),
      framed({ jsonrpc: '2.0', id: 2, method: 'shutdown' }),
      framed({ jsonrpc: '2.0', method: 'exit' }),
    ]);
    const bytes = new TextEncoder().encode(script.toString('utf8'));
    const out = serverOutput();

    const exitCode = await startServer({
      stdin: {
        async *[Symbol.asyncIterator]() {
          yield bytes;
        },
      },
      stdout: out,
      stderr: hostErrors(),
    });

    expect(out.frames()).toHaveLength(2);
    expect(exitCode).toBe(0);
  });
});

/** Every message of an exchange in one chunk, the way a host that cannot hold a
 *  conversation delivers it: end of input arrives while the first message is
 *  still being decoded. */
function scriptedExchange(...messages: readonly unknown[]): PassThrough {
  const stdin = new PassThrough();
  stdin.write(Buffer.concat(messages.map(framed)));
  stdin.end();
  return stdin;
}

describe('startServer draining', () => {
  it('answers a request whose handler awaits, though the input already ended', async () => {
    const out = serverOutput();
    // Folding ranges resolve the document's project first, which walks the
    // filesystem for a config — several turns of the event loop in which
    // nothing is decoded, dispatched or written.
    const stdin = scriptedExchange(
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: initializeParams },
      {
        jsonrpc: '2.0',
        id: 2,
        method: 'textDocument/foldingRange',
        params: { textDocument: { uri: pathToFileURL(join(tmpdir(), 'drain.psl')).toString() } },
      },
      { jsonrpc: '2.0', id: 3, method: 'shutdown' },
      { jsonrpc: '2.0', method: 'exit' },
    );

    const exitCode = await startServer({ stdin, stdout: out, stderr: hostErrors() });

    // Ids rather than order: the connection dispatches in parallel, so the
    // awaiting handler answers after the messages behind it.
    const answered: number[] = out.frames().map((frame) => JSON.parse(frame.body).id);
    expect([...answered].sort()).toEqual([1, 2, 3]);
    expect(exitCode).toBe(0);
  });

  it('settles when the client declares a Content-Length that is not a number', async () => {
    const stdin = new PassThrough();
    const out = serverOutput();
    const errors = hostErrors();
    const exitCode = startServer({ stdin, stdout: out, stderr: errors });

    stdin.write(Buffer.from('Content-Length: not-a-number\r\n\r\n{}', 'utf8'));

    await expect(exitCode).resolves.toBe(1);
    expect(out.frames()).toEqual([]);
    expect(errors.text()).toContain('Content-Length');
  });

  it('settles when a cancellation the connection answers itself is the last message', async () => {
    const out = serverOutput();
    const stdin = scriptedExchange(
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: initializeParams },
      { jsonrpc: '2.0', id: 2, method: 'shutdown' },
      { jsonrpc: '2.0', method: '$/cancelRequest', params: { id: 2 } },
    );

    await expect(startServer({ stdin, stdout: out, stderr: hostErrors() })).resolves.toBe(0);
  });
});

describe('startServer once the client is gone', () => {
  it('does not crash the process when a handler sends after the transport closed', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => void unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      const out = serverOutput();
      // This client declares no dynamic file-watcher registration, so the
      // `initialized` handler warns it over a connection the end of input has
      // already closed.
      const stdin = scriptedExchange(
        { jsonrpc: '2.0', id: 1, method: 'initialize', params: initializeParams },
        { jsonrpc: '2.0', method: 'initialized', params: {} },
      );

      await expect(startServer({ stdin, stdout: out, stderr: hostErrors() })).resolves.toBe(1);

      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(unhandled).toEqual([]);
      expect(out.frames()).toHaveLength(1);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});

describe('startServer console capture', () => {
  it('keeps a stray console write out of the frame stream', async () => {
    const stdin = new PassThrough();
    const out = serverOutput();
    const errors = hostErrors();
    const exitCode = startServer({ stdin, stdout: out, stderr: errors });

    console.log('a dependency talking to nobody');
    stdin.end();

    await expect(exitCode).resolves.toBe(1);
    expect(out.text()).toBe('');
    expect(errors.text()).toBe('a dependency talking to nobody\n');
  });

  it('restores the host console once the run settles', async () => {
    const stdin = new PassThrough();
    const before = console.log;

    const exitCode = startServer({
      stdin,
      stdout: serverOutput(),
      stderr: hostErrors(),
    });
    stdin.end();
    await exitCode;

    expect(console.log).toBe(before);
  });
});
