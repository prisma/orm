import type { IncomingMessage, Server } from 'node:http';
import type { Socket } from 'node:net';
import type { IWebSocket } from 'vscode-ws-jsonrpc';
import { WebSocketMessageReader, WebSocketMessageWriter } from 'vscode-ws-jsonrpc';
import { createConnection, createServerProcess, forward } from 'vscode-ws-jsonrpc/server';
import { WebSocketServer } from 'ws';

export interface BridgeOptions {
  /** Absolute path to the built CLI entry (`dist/bin.mjs`) to spawn. */
  readonly cliEntry: string;
  /** WebSocket path the client connects to (e.g. `/psl`). */
  readonly path: string;
}

/**
 * Attaches an LSP WebSocket bridge to an existing HTTP server.
 *
 * The bridge does NOT own a port: it registers an `upgrade` listener on the
 * shared server (the same one Vite serves the editor from) and only claims
 * WebSocket upgrades on {@link BridgeOptions.path}, leaving Vite's own HMR
 * WebSocket and all HTTP requests untouched. On each accepted connection it
 * spawns `node <cliEntry> lsp --stdio` and forwards LSP
 * JSON-RPC traffic between the browser editor and that stdio process.
 *
 * Adapted from the canonical `vscode-ws-jsonrpc` example
 * (TypeFox/monaco-languageclient, MIT): `createServerProcess` spawns the stdio
 * LSP and `forward` pipes the socket <-> process connections. The server does
 * not depend on the client's `processId`, so the example's `initialize`
 * `processId` rewrite is intentionally omitted.
 *
 * Returns a disposer that detaches the bridge.
 */
export function attachBridge(server: Server, options: BridgeOptions): () => void {
  const wss = new WebSocketServer({ noServer: true });

  const onUpgrade = (request: IncomingMessage, socket: Socket, head: Buffer): void => {
    const baseUrl = `http://${request.headers.host ?? 'localhost'}/`;
    const pathname = request.url !== undefined ? new URL(request.url, baseUrl).pathname : undefined;
    // Only claim our own path; ignore everything else (e.g. Vite's HMR socket)
    // so other upgrade listeners on the shared server still get a chance.
    if (pathname !== options.path) {
      return;
    }
    wss.handleUpgrade(request, socket, head, (webSocket) => {
      const ws: IWebSocket = {
        send: (content) =>
          webSocket.send(content, (error) => {
            // A transient send error (peer gone, socket closing) must not crash
            // the playground process; close the socket and let the LSP
            // connection tear down through the normal close path.
            if (error !== null && error !== undefined) {
              webSocket.close();
            }
          }),
        onMessage: (cb) => webSocket.on('message', (data) => cb(data)),
        onError: (cb) => webSocket.on('error', cb),
        onClose: (cb) => webSocket.on('close', cb),
        dispose: () => webSocket.close(),
      };
      if (webSocket.readyState === webSocket.OPEN) {
        launch(ws, options);
      } else {
        webSocket.on('open', () => launch(ws, options));
      }
    });
  };

  server.on('upgrade', onUpgrade);
  return () => {
    server.off('upgrade', onUpgrade);
    wss.close();
  };
}

function launch(socket: IWebSocket, options: BridgeOptions): void {
  const reader = new WebSocketMessageReader(socket);
  const writer = new WebSocketMessageWriter(socket);
  const socketConnection = createConnection(reader, writer, () => socket.dispose());
  const serverConnection = createServerProcess('PSL', 'node', [options.cliEntry, 'lsp', '--stdio']);
  if (serverConnection === undefined) {
    // The LSP subprocess could not be spawned. Don't leave the client hanging
    // on a backend-less socket: report it and close the connection.
    console.error(
      `Failed to spawn the language server (node ${options.cliEntry} lsp --stdio). Has the workspace been built?`,
    );
    socket.dispose();
    return;
  }
  forward(socketConnection, serverConnection);
}
