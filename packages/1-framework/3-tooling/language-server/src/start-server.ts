import { createConnection, ProposedFeatures } from 'vscode-languageserver/node';
import { createServer } from './server';
import type { LanguageServerStreams } from './stdio-transport';
import { runServerOverStreams } from './stream-server';

/**
 * Starts the language server on the transport `vscode-languageserver/node`
 * builds from the process arguments. That path ends the process itself when
 * the client disconnects, so there is no exit code to hand back and nothing to
 * await.
 */
export function startServer(): void;
/**
 * Starts the language server over the host's streams, and resolves with the
 * exit code the client's departure implies: 0 when it asked to shut down
 * first, 1 when it just went away.
 */
export function startServer(streams: LanguageServerStreams): Promise<number>;
export function startServer(streams?: LanguageServerStreams): Promise<number> | undefined {
  if (streams === undefined) {
    createServer(createConnection(ProposedFeatures.all));
    return undefined;
  }
  return runServerOverStreams(streams);
}
