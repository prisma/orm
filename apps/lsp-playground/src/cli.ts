import { access, copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import * as nodeHttp from 'node:http';
import { createRequire } from 'node:module';
import { basename, dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as vite from 'vite';
import { attachBridge } from './bridge';
import { generateDefaultPostgresConfig, PLAYGROUND_DIR } from './default-config';
import { findNearestConfig } from './find-config';

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const PORT = 5295;
const LSP_PATH = '/psl';
const RUNTIME_CONFIG_PATH = '/__psl_playground_runtime.json';
const REQUEST_URL_BASE = 'http://localhost/';

interface RuntimeConfig {
  readonly wsPath: string;
  readonly documentUri: string;
  readonly rootUri: string;
  readonly schemaPath: string;
  readonly schemaText: string;
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

/**
 * Stages a writable schema file under `.playground/` and returns its path.
 *
 * `.playground/` is where the server can resolve both the generated config's
 * `@prisma/orm-postgres` import and (via walk-up) the config for the opened
 * document. When `sourceFile` points at an existing file, its contents are
 * copied so the playground edits a sandbox copy rather than the user's file;
 * otherwise a scratch file with the Prisma Next directive is created. The
 * staged file reuses the source's basename (or `scratch.psl`) so the editor tab
 * reads naturally.
 */
async function stageSchema(sourceFile?: string): Promise<string> {
  await mkdir(PLAYGROUND_DIR, { recursive: true });
  const name = sourceFile !== undefined ? basename(sourceFile) : 'scratch.psl';
  const target = resolve(PLAYGROUND_DIR, name);
  if (sourceFile !== undefined && (await fileExists(sourceFile))) {
    await copyFile(sourceFile, target);
  } else if (!(await fileExists(target))) {
    await writeFile(target, '// use prisma-8\n\n', 'utf8');
  }
  return target;
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
    console.error('Usage: psl-playground [<schema.psl>]');
    process.exit(1);
  }
  const positionals = args.filter((a) => !a.startsWith('-'));
  if (positionals.length > 1) {
    console.error(`Expected at most one schema path, got ${positionals.length}.`);
    console.error('Usage: psl-playground [<schema.psl>]');
    process.exit(1);
  }
  const schemaArg = positionals[0];

  // Resolve the schema the editor opens and the config the server will find for
  // it. The language server discovers a document's config by walking up from
  // the document's own path, so the schema must sit at or under a directory
  // that contains a resolvable `prisma.config.ts`. (There is deliberately
  // no `--config` flag: the server has no way to be pointed at an arbitrary
  // config path, so accepting one would be misleading.)
  //
  // The PSL file is optional. An existing file already inside a project opens
  // in place under its discovered config; otherwise (no file, missing path, or
  // an existing file with no project config) the schema is staged into
  // `.playground/` (whose `@prisma/orm-postgres` import resolves) beside a generated
  // default-postgres config — the "without a config, assume default postgres"
  // path.
  let schemaPath: string;
  let configPath: string;

  const sourceFile =
    schemaArg === undefined
      ? undefined
      : isAbsolute(schemaArg)
        ? schemaArg
        : resolve(process.cwd(), schemaArg);

  if (sourceFile !== undefined && (await fileExists(sourceFile))) {
    if (!(await stat(sourceFile)).isFile()) {
      console.error(`Schema path must be a file: ${sourceFile}`);
      process.exit(1);
    }
    const discovered = await findNearestConfig(sourceFile);
    if (discovered !== undefined) {
      // The file belongs to a real project; open it in place under its own config.
      schemaPath = sourceFile;
      configPath = discovered;
      console.log(`Using schema in place: ${schemaPath}`);
      console.log(`Using config (discovered): ${configPath}`);
    } else {
      // Existing file, no project config: stage a copy and assume default postgres.
      schemaPath = await stageSchema(sourceFile);
      configPath = await generateDefaultPostgresConfig(schemaPath);
      console.log(
        `No project config found; staged copy under default-postgres config: ${schemaPath}`,
      );
    }
  } else {
    // No file, or a path that does not exist yet: scratch under default postgres.
    schemaPath = await stageSchema(sourceFile);
    configPath = await generateDefaultPostgresConfig(schemaPath);
    const why = sourceFile === undefined ? 'No schema given' : 'Schema not found';
    console.log(`${why}; opening scratch schema: ${schemaPath}`);
  }

  const cliEntry = resolveCliEntry();
  if (!(await fileExists(cliEntry))) {
    console.error(`Built CLI not found at ${cliEntry}.\n` + 'Build it first:  pnpm -w build');
    process.exit(1);
  }

  const schemaText = await readFile(schemaPath, 'utf8');
  const documentUri = pathToFileURL(schemaPath).toString();
  const rootUri = pathToFileURL(dirname(configPath)).toString();

  const runtimeConfig: RuntimeConfig = {
    wsPath: LSP_PATH,
    documentUri,
    rootUri,
    schemaPath,
    schemaText,
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
