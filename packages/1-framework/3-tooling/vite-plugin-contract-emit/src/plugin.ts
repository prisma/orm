import type { ContractEmitResult } from '@internal/cli/control-api';
import { disposeEmitQueue, executeContractEmit } from '@internal/cli/control-api';
import { loadConfigForSections } from '@internal/config-loader';
import { getEmittedArtifactPaths } from '@internal/emitter';
import { extname, resolve } from 'pathe';
import type { Plugin, ViteDevServer } from 'vite';
import type { PrismaVitePluginOptions } from './types';

const PLUGIN_NAME = 'prisma-vite-plugin-contract-emit';
const DEFAULT_DEBOUNCE_MS = 150;
const DEFAULT_CONFIG_PATH = 'prisma.config.ts';
const MODULE_GRAPH_EXTENSIONS = new Set([
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
]);

/**
 * Creates a Vite plugin that automatically emits Prisma 8 contract artifacts.
 *
 * The plugin resolves watched files from contract source provider metadata,
 * re-emitting contract artifacts on changes with debounce while serializing
 * overlapping emits into a single follow-up run.
 *
 * @param configPath - Path to prisma.config.ts (relative or absolute). Defaults to 'prisma.config.ts'
 * @param options - Optional plugin configuration
 * @returns Vite plugin
 *
 * @example
 * ```ts
 * import { defineConfig } from 'vite';
 * import { prismaVitePlugin } from '@internal/vite-plugin-contract-emit';
 *
 * // Use default config path
 * export default defineConfig({
 *   plugins: [prismaVitePlugin()],
 * });
 *
 * // Or specify a custom path
 * export default defineConfig({
 *   plugins: [prismaVitePlugin('custom/prisma.config.ts')],
 * });
 * ```
 */
export function prismaVitePlugin(
  configPath: string = DEFAULT_CONFIG_PATH,
  options?: PrismaVitePluginOptions,
): Plugin {
  const debounceMs = options?.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const logLevel = options?.logLevel ?? 'info';

  let absoluteConfigPath: string;
  const watchedFiles = new Set<string>();
  // Vite watches the project root, so writes to emitted artifacts can still surface as change
  // events even when those files are excluded from watchedFiles.
  const ignoredOutputFiles = new Set<string>();
  // Output JSON paths whose serialization queue this plugin instance owns. Disposed on cleanup
  // so long-lived dev sessions don't accumulate per-process queue state across config edits.
  const ownedOutputJsonPaths = new Set<string>();
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let lifecycleAbortController = new AbortController();
  let server: ViteDevServer | null = null;
  let isEmitInFlight = false;
  let hasQueuedEmit = false;
  let queuedEmitNeedsWatchedFileRefresh = false;
  let didWarnConfigWatchFallback = false;

  function log(message: string, level: 'info' | 'debug' = 'info') {
    if (logLevel === 'silent') return;
    if (level === 'debug' && logLevel !== 'debug') return;
    console.log(`[${PLUGIN_NAME}] ${message}`);
  }

  function logError(message: string, error?: unknown) {
    if (logLevel === 'silent') return;
    const errorMessage = error instanceof Error ? error.message : error ? String(error) : '';
    console.error(`[${PLUGIN_NAME}] ${message}${errorMessage ? ` ${errorMessage}` : ''}`);
    if (error instanceof Error && error.stack && logLevel === 'debug') {
      console.error(error.stack);
    }
  }

  function logWarning(message: string) {
    if (logLevel === 'silent') return;
    console.warn(`[${PLUGIN_NAME}] ${message}`);
  }

  function handleTrackedFileChange(file: string) {
    const normalized = resolve(file);
    if (ignoredOutputFiles.has(normalized)) {
      log(`Ignoring emitted artifact update: ${normalized}`, 'debug');
      return;
    }

    if (watchedFiles.has(normalized)) {
      log(`Detected change: ${normalized}`, 'debug');
      scheduleEmit();
    }
  }

  async function emitContract({
    refreshWatchedFiles = true,
  }: {
    refreshWatchedFiles?: boolean;
  } = {}): Promise<ContractEmitResult | null> {
    const signal = lifecycleAbortController.signal;

    try {
      if (server && refreshWatchedFiles) {
        await updateWatchedFiles(server);
      }

      const configResult = await loadConfigForSections(absoluteConfigPath, [
        'contract',
        'family',
        'target',
        'adapter',
        'extensions',
      ]);
      if (!configResult.ok) {
        throw configResult.failure;
      }

      const result = await executeContractEmit({
        config: configResult.value,
        cwd: process.cwd(),
        configPath: absoluteConfigPath,
        signal,
      });

      log(`Emitted contract (storageHash: ${result.storageHash.slice(0, 8)}...)`);
      log(`  → ${result.files.json}`, 'debug');
      log(`  → ${result.files.dts}`, 'debug');

      if (server) {
        server.moduleGraph.onFileChange(result.files.json);
        server.moduleGraph.onFileChange(result.files.dts);
      }

      if (server && !hasQueuedEmit) {
        server.ws.send({ type: 'full-reload' });
      } else if (hasQueuedEmit) {
        log('Skipped full reload because a newer emit is queued', 'debug');
      }

      return result;
    } catch (error) {
      // Ignore cancellation - check signal first, then error name
      if (signal.aborted || (error instanceof Error && error.name === 'AbortError')) {
        log('Emit cancelled', 'debug');
        return null;
      }

      logError('Contract emit failed:', error);

      // Send error to Vite overlay
      if (server) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorStack = error instanceof Error ? error.stack : undefined;
        server.ws.send({
          type: 'error',
          err: {
            message: `[prisma] ${errorMessage}`,
            stack: errorStack ?? '',
            plugin: PLUGIN_NAME,
          },
        });
      }

      return null;
    }
  }

  async function drainQueuedEmits(): Promise<void> {
    if (isEmitInFlight || lifecycleAbortController.signal.aborted) {
      return;
    }

    isEmitInFlight = true;

    try {
      while (hasQueuedEmit && !lifecycleAbortController.signal.aborted) {
        const refreshWatchedFiles = queuedEmitNeedsWatchedFileRefresh;
        hasQueuedEmit = false;
        queuedEmitNeedsWatchedFileRefresh = false;

        await emitContract({ refreshWatchedFiles });
      }
    } finally {
      isEmitInFlight = false;
    }
  }

  function requestEmit({
    refreshWatchedFiles = true,
  }: {
    refreshWatchedFiles?: boolean;
  } = {}): Promise<void> {
    if (lifecycleAbortController.signal.aborted) {
      return Promise.resolve();
    }

    hasQueuedEmit = true;
    queuedEmitNeedsWatchedFileRefresh ||= refreshWatchedFiles;

    if (isEmitInFlight) {
      log('Queued follow-up emit while another emit is running', 'debug');
      return Promise.resolve();
    }

    return drainQueuedEmits();
  }

  function scheduleEmit() {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void requestEmit();
    }, debounceMs);
  }

  function resolveContractOutputFiles(contractOutput: string | undefined): Set<string> {
    if (contractOutput === undefined) {
      return new Set();
    }
    const { jsonPath, dtsPath } = getEmittedArtifactPaths(contractOutput);
    ownedOutputJsonPaths.add(jsonPath);
    return new Set<string>([jsonPath, dtsPath]);
  }

  function isModuleGraphRoot(filePath: string): boolean {
    return MODULE_GRAPH_EXTENSIONS.has(extname(filePath));
  }

  async function collectModuleGraphFiles(
    viteServer: ViteDevServer,
    roots: readonly string[],
  ): Promise<Set<string>> {
    const files = new Set<string>();
    const uniqueRoots = [...new Set(roots)];

    for (const root of uniqueRoots) {
      try {
        await viteServer.ssrLoadModule(root);
      } catch (error) {
        if (root === absoluteConfigPath) {
          logError('Failed to load config module graph root:', error);
        } else {
          log(`Skipped module-graph root after load failure: ${root}`, 'debug');
        }
      }
    }

    try {
      const visited = new Set<string>();
      const queue = [...uniqueRoots];

      while (queue.length > 0) {
        const current = queue.shift();
        if (current === undefined || visited.has(current)) continue;
        visited.add(current);

        const mod = viteServer.moduleGraph.getModuleById(current);
        if (!mod) continue;

        // Add file to watched set if it's a file path
        if (mod.file) {
          files.add(mod.file);
        }

        // Add imported modules to queue
        for (const imported of mod.importedModules) {
          if (imported.id && !visited.has(imported.id)) {
            queue.push(imported.id);
          }
        }
      }
    } catch (error) {
      logError('Failed to collect watched files:', error);
    }

    return files;
  }

  async function resolveWatchedFiles(viteServer: ViteDevServer): Promise<Set<string>> {
    const previousWatchedFiles = new Set(watchedFiles);
    const previousIgnoredOutputFiles = new Set(ignoredOutputFiles);
    ignoredOutputFiles.clear();

    try {
      const configResult = await loadConfigForSections(absoluteConfigPath, ['contract']);
      if (!configResult.ok) {
        throw configResult.failure;
      }
      const config = configResult.value;
      didWarnConfigWatchFallback = false;
      const contract = config.contract;

      if (!contract) {
        return new Set([absoluteConfigPath]);
      }

      const files = new Set<string>([absoluteConfigPath]);
      const inputs = contract.source.inputs ?? [];
      for (const outputFile of resolveContractOutputFiles(contract.output)) {
        ignoredOutputFiles.add(outputFile);
      }

      const moduleGraphRoots = [absoluteConfigPath];
      for (const input of inputs) {
        if (!ignoredOutputFiles.has(input)) {
          files.add(input);
        }
        if (isModuleGraphRoot(input)) {
          moduleGraphRoots.push(input);
        }
      }

      for (const file of await collectModuleGraphFiles(viteServer, moduleGraphRoots)) {
        if (!ignoredOutputFiles.has(file)) {
          files.add(file);
        }
      }

      return files;
    } catch (error) {
      if (previousIgnoredOutputFiles.size > 0) {
        for (const outputFile of previousIgnoredOutputFiles) {
          ignoredOutputFiles.add(outputFile);
        }
      }
      if (!didWarnConfigWatchFallback) {
        didWarnConfigWatchFallback = true;
        const reason = error instanceof Error ? ` ${error.message}` : '';
        const watchScope =
          previousWatchedFiles.size > 0
            ? `Watching the previous dependency set plus ${absoluteConfigPath}`
            : `Watching only ${absoluteConfigPath}`;
        logWarning(
          `${watchScope} because Prisma 8 config inputs could not be resolved.${reason} Contract watch coverage is partial.`,
        );
      }
      if (previousWatchedFiles.size > 0) {
        previousWatchedFiles.add(absoluteConfigPath);
        return previousWatchedFiles;
      }
      return new Set([absoluteConfigPath]);
    }
  }

  async function updateWatchedFiles(viteServer: ViteDevServer): Promise<void> {
    const newWatchedFiles = await resolveWatchedFiles(viteServer);

    // Find files to add and remove
    const toAdd: string[] = [];
    const toRemove: string[] = [];

    for (const file of newWatchedFiles) {
      if (!watchedFiles.has(file)) {
        toAdd.push(file);
      }
    }

    for (const file of watchedFiles) {
      if (!newWatchedFiles.has(file)) {
        toRemove.push(file);
      }
    }

    // Update the watcher
    for (const file of toAdd) {
      viteServer.watcher.add(file);
    }
    for (const file of toRemove) {
      viteServer.watcher.unwatch(file);
    }

    // Replace the watched files set
    watchedFiles.clear();
    for (const file of newWatchedFiles) {
      watchedFiles.add(file);
    }

    if (toAdd.length > 0 || toRemove.length > 0) {
      log(`Updated watched files: +${toAdd.length} -${toRemove.length}`, 'debug');
    }
  }

  return {
    name: PLUGIN_NAME,

    configResolved(config) {
      // Resolve config path to absolute path based on Vite root
      absoluteConfigPath = resolve(config.root, configPath);
      log(`Config path: ${absoluteConfigPath}`, 'debug');
    },

    async configureServer(viteServer) {
      server = viteServer;
      lifecycleAbortController = new AbortController();
      isEmitInFlight = false;
      hasQueuedEmit = false;
      queuedEmitNeedsWatchedFileRefresh = false;
      const onTrackedWatcherEvent = (file: string) => {
        handleTrackedFileChange(file);
      };

      // Register close hook to clean up timers and abort in-flight work.
      const cleanup = () => {
        if (debounceTimer) {
          clearTimeout(debounceTimer);
          debounceTimer = null;
        }
        hasQueuedEmit = false;
        queuedEmitNeedsWatchedFileRefresh = false;
        lifecycleAbortController.abort();
        viteServer.watcher.off?.('change', onTrackedWatcherEvent);
        viteServer.watcher.off?.('add', onTrackedWatcherEvent);
        viteServer.watcher.off?.('unlink', onTrackedWatcherEvent);
        ignoredOutputFiles.clear();
        for (const outputJsonPath of ownedOutputJsonPaths) {
          disposeEmitQueue(outputJsonPath);
        }
        ownedOutputJsonPaths.clear();
        didWarnConfigWatchFallback = false;
        server = null;
        watchedFiles.clear();
        log('Server closed, cleaned up resources', 'debug');
      };

      // Register cleanup on server close via httpServer or watcher
      viteServer.httpServer?.on('close', cleanup);
      viteServer.watcher?.on?.('close', cleanup);
      viteServer.watcher.on('change', onTrackedWatcherEvent);
      viteServer.watcher.on('add', onTrackedWatcherEvent);
      viteServer.watcher.on('unlink', onTrackedWatcherEvent);

      const initialWatchedFiles = await resolveWatchedFiles(viteServer);

      // Collect files to watch from provider metadata
      for (const file of initialWatchedFiles) {
        watchedFiles.add(file);
      }

      // Add all dependency files to Vite's watcher
      for (const file of watchedFiles) {
        viteServer.watcher.add(file);
      }

      // Error if no files are being watched - this indicates a configuration problem
      if (watchedFiles.size === 0) {
        const errorMessage =
          `No files are being watched. The config file "${absoluteConfigPath}" could not be loaded ` +
          'or has no dependencies. HMR for contract changes will not work.';
        logError(errorMessage);
        viteServer.ws.send({
          type: 'error',
          err: {
            message: `[prisma] ${errorMessage}`,
            stack: '',
            plugin: PLUGIN_NAME,
          },
        });
      } else {
        log(`Watching ${watchedFiles.size} files`, 'debug');
        if (logLevel === 'debug') {
          for (const file of watchedFiles) {
            log(`  ${file}`, 'debug');
          }
        }
      }

      // Initial emit on server start
      await requestEmit({ refreshWatchedFiles: false });
    },

    handleHotUpdate(ctx) {
      handleTrackedFileChange(ctx.file);
    },
  };
}
