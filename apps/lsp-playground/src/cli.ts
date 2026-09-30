import { access } from 'node:fs/promises';
import * as nodeHttp from 'node:http';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as vite from 'vite';
import { attachBridge } from './bridge';
import { ensureScratchProject, SCRATCH_DIR } from './default-config';

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = 5295;
const LSP_PATH = '/psl';
const RUNTIME_CONFIG_PATH = '/__psl_playground_runtime.json';
const REQUEST_URL_BASE = 'http://localhost/';

interface RuntimeMember {
  readonly uri: string;
  readonly text: string;
}

interface RuntimeConfig {
  readonly wsPath: string;
  readonly rootUri: string;
  readonly scratchRootUri: string;
  readonly members: readonly RuntimeMember[];
}

function requestPathname(requestUrl: string | undefined): string | undefined {
  if (requestUrl === undefined) {
    return undefined;
  }
  try {
    return new URL(requestUrl, REQUEST_URL_BASE).pathname;
  } catch {
    return undefined;
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function resolveCliEntry(): string {
  // Nothing published carries a bin anymore (the unified `prisma` CLI is the
  // only user-facing binary), so the playground spawns the workspace-local
  // engine entry directly. The path is repo-relative rather than resolved
  // through the `@internal/cli` package name so this app's manifest stays
  // shaped like a consumer's (ADR 242, lint:consumer-internal-imports).
  return resolve(PACKAGE_ROOT, '../../packages/1-framework/3-tooling/cli/dist/bin.mjs');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const flags = args.filter((a) => a.startsWith('-'));
  if (flags.length > 0) {
    console.error(`Unknown option(s): ${flags.join(', ')}`);
    console.error('Usage: psl-playground');
    process.exit(1);
  }
  const positionals = args.filter((a) => !a.startsWith('-'));
  if (positionals.length > 0) {
    console.error(`psl-playground no longer accepts a schema path (got "${positionals[0]}").`);
    console.error(`Edit the scratch project directly instead: ${SCRATCH_DIR}`);
    console.error('Usage: psl-playground');
    process.exit(1);
  }

  // The playground always opens the gitignored multi-file scratch project
  // under `.playground/scratch/`, seeding it with a demo schema on first
  // creation and reusing it (untouched) on every later run. There is
  // deliberately no `--config` flag and no schema-path argument: the
  // language server discovers a document's config by walking up from the
  // document's own path, so it cannot be pointed at an arbitrary config, and
  // the scratch project is the one place that walk-up is guaranteed to land.
  const { configPath, members: scratchMembers } = await ensureScratchProject();
  if (scratchMembers.length === 0) {
    console.error(`Scratch directory has no .prisma files: ${SCRATCH_DIR}`);
    console.error(`Delete it to re-seed the default multi-file project: rm -rf "${SCRATCH_DIR}"`);
    process.exit(1);
  }
  console.log(`Opening scratch project: ${SCRATCH_DIR}`);

  const cliEntry = resolveCliEntry();
  if (!(await fileExists(cliEntry))) {
    console.error(`Built CLI not found at ${cliEntry}.\n` + 'Build it first:  pnpm -w build');
    process.exit(1);
  }

  const rootUri = pathToFileURL(dirname(configPath)).toString();
  const scratchRootUri = pathToFileURL(SCRATCH_DIR).toString();
  const members: RuntimeMember[] = scratchMembers.map(({ path, text }) => ({
    uri: pathToFileURL(path).toString(),
    text,
  }));

  const runtimeConfig: RuntimeConfig = {
    wsPath: LSP_PATH,
    rootUri,
    scratchRootUri,
    members,
  };

  // One HTTP server hosts both the editor (Vite, in middleware mode) and the
  // LSP WebSocket bridge (on LSP_PATH). Vite's HMR WebSocket is bound to the
  // same server via `hmr.server`, so a single port serves everything.
  const httpServer = nodeHttp.createServer();

  const viteServer = await vite.createServer({
    root: PACKAGE_ROOT,
    server: {
      middlewareMode: true,
      hmr: { server: httpServer },
    },
    appType: 'spa',
    // monaco-languageclient requires specific optimization settings
    // Based on TypeFox's official vite.config.ts
    optimizeDeps: {
      include: [
        '@codingame/monaco-vscode-files-service-override',
        'vscode-jsonrpc',
        'vscode-languageclient/browser',
        'vscode-languageserver-protocol/browser',
        'vscode-ws-jsonrpc',
      ],
      exclude: ['@codingame/monaco-vscode-theme-defaults-default-extension'],
    },
    resolve: {
      alias: (() => {
        // Resolve the absolute paths for proper aliasing
        const require = createRequire(import.meta.url);
        // Extension API provides vscode.* namespace (CancellationError, Uri, etc.)
        const extensionApiPath = require.resolve('@codingame/monaco-vscode-extension-api');
        return [
          // vscode/localExtensionHost is imported by monaco-languageclient but no longer exists
          // in @codingame/monaco-vscode-api@25. Stub it with an empty module.
          {
            find: 'vscode/localExtensionHost',
            replacement: resolve(PACKAGE_ROOT, 'src/stubs/localExtensionHost.ts'),
          },
          // Alias vscode to monaco-vscode-extension-api for proper extension API support
          { find: 'vscode', replacement: extensionApiPath },
        ];
      })(),
    },
  });
  httpServer.on(
    'request',
    (request: nodeHttp.IncomingMessage, response: nodeHttp.ServerResponse) => {
      const requestPath = requestPathname(request.url);
      if (requestPath === undefined) {
        response.statusCode = 400;
        response.end('Bad Request');
        return;
      }
      if (requestPath === RUNTIME_CONFIG_PATH) {
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          response.statusCode = 405;
          response.setHeader('allow', 'GET, HEAD');
          response.end('Method Not Allowed');
          return;
        }
        response.statusCode = 200;
        response.setHeader('content-type', 'application/json; charset=utf-8');
        response.setHeader('cache-control', 'no-store');
        response.end(request.method === 'HEAD' ? undefined : JSON.stringify(runtimeConfig));
        return;
      }

      viteServer.middlewares(request, response, (error?: unknown) => {
        if (response.writableEnded) {
          return;
        }
        if (error !== undefined) {
          console.error(error);
          response.statusCode = 500;
          response.end('Internal Server Error');
          return;
        }
        response.statusCode = 404;
        response.end('Not Found');
      });
    },
  );

  const stopBridge = attachBridge(httpServer, { cliEntry, path: LSP_PATH });

  httpServer.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') {
      console.error(
        `Port ${PORT} is already in use — another psl-playground may be running. Stop it and retry.`,
      );
    } else {
      console.error(`Server error: ${error.message}`);
    }
    process.exit(1);
  });

  httpServer.listen(PORT, () => {
    const url = `http://localhost:${PORT}/`;
    console.log(`Playground: ${url}`);
    // nosemgrep: javascript.lang.security.detect-insecure-websocket.detect-insecure-websocket -- localhost dev playground bridge URL log
    console.log(`LSP bridge: ws://localhost:${PORT}${LSP_PATH}`);
    console.log('Open the URL above in your browser. Ctrl+C to stop.');
  });

  const shutdown = async (): Promise<void> => {
    stopBridge();
    await viteServer.close();
    httpServer.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

void main();
