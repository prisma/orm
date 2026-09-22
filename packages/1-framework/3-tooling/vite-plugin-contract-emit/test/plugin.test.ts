import { resolve } from 'node:path';
import { disposeEmitQueue, executeContractEmit } from '@internal/cli/control-api';
import type { PrismaNextConfig } from '@internal/config-loader';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { prismaVitePlugin } from '../src/plugin';

vi.mock('@internal/cli/control-api', () => ({
  executeContractEmit: vi.fn(),
  disposeEmitQueue: vi.fn(),
}));

const loadConfigForSectionsMock = vi.hoisted(() => vi.fn());

// The production code consumes `loadConfigForSections`, which wraps the config
// in a Result. Tests keep resolving plain configs (or rejecting); the wrapper
// adds the `ok(...)` so every existing fixture stays unchanged.
// `expandContractInputs` is passthrough here: fixtures already name each
// member file as a distinct absolute path, and this suite tests the
// plugin's file-set bookkeeping, not glob expansion (covered in
// `@internal/config-loader`'s own tests).
vi.mock('@internal/config-loader', async () => {
  const { ok } = await import('@internal/utils/result');
  return {
    loadConfigForSections: async (...args: unknown[]) =>
      ok(await loadConfigForSectionsMock(...args)),
    expandContractInputs: async (patterns: readonly string[] | undefined) => patterns ?? [],
  };
});

vi.mock('@internal/emitter', () => ({
  getEmittedArtifactPaths: (outputJsonPath: string) => ({
    jsonPath: outputJsonPath,
    dtsPath: outputJsonPath.replace(/\.json$/, '.d.ts'),
  }),
}));

vi.mock('pathe', async () => {
  const path = await vi.importActual<typeof import('node:path')>('node:path');
  return {
    extname: path.extname,
    resolve: path.resolve,
  };
});

const mockedExecuteContractEmit = vi.mocked(executeContractEmit);
const mockedDisposeEmitQueue = vi.mocked(disposeEmitQueue);
const mockedLoadConfig = loadConfigForSectionsMock;
const successfulEmitResult = {
  storageHash: 'abc123',
  profileHash: 'def456',
  files: { json: '/out/contract.json', dts: '/out/contract.d.ts' },
} satisfies Awaited<ReturnType<typeof executeContractEmit>>;

type LoadedConfig = PrismaNextConfig;
type SourceInputs = NonNullable<LoadedConfig['contract']>['source']['inputs'];

interface MockModuleNode {
  readonly id: string;
  readonly file: string;
  readonly importedModules: Set<MockModuleNode>;
}

const unusedContractLoad: NonNullable<LoadedConfig['contract']>['source']['load'] = async () => {
  throw new Error('unused in tests');
};

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks(turns = 16): Promise<void> {
  for (let index = 0; index < turns; index += 1) {
    await Promise.resolve();
  }
}

function toAbsolutePath(path: string): string {
  return resolve('/project', path);
}

function createLoadedConfig({
  inputs = undefined as SourceInputs,
  output = 'src/prisma/contract.json',
}: {
  inputs?: SourceInputs;
  output?: string;
} = {}): LoadedConfig {
  return {
    contract: {
      source: {
        ...(inputs === undefined
          ? {}
          : { inputs: inputs.map((input) => toAbsolutePath(input)) as SourceInputs }),
        load: unusedContractLoad,
      },
      output: toAbsolutePath(output),
    },
  } as LoadedConfig;
}

function applyModuleGraph(
  server: ReturnType<typeof createMockServer>,
  definitions: Record<string, { file?: string; imports?: readonly string[] }>,
) {
  const modules = new Map<string, MockModuleNode>();

  for (const [id, definition] of Object.entries(definitions)) {
    modules.set(id, {
      id,
      file: definition.file ?? id,
      importedModules: new Set(),
    });
  }

  for (const [id, definition] of Object.entries(definitions)) {
    const module = modules.get(id);
    if (!module) continue;
    for (const importedId of definition.imports ?? []) {
      const importedModule = modules.get(importedId);
      if (importedModule) {
        module.importedModules.add(importedModule);
      }
    }
  }

  server.moduleGraph.getModuleById.mockImplementation((id: string) => modules.get(id) ?? null);
}

function createMockServer() {
  return {
    httpServer: {
      on: vi.fn(),
    },
    watcher: {
      add: vi.fn(),
      unwatch: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
    },
    ws: {
      send: vi.fn(),
    },
    ssrLoadModule: vi.fn().mockResolvedValue({}),
    moduleGraph: {
      getModuleById: vi.fn().mockReturnValue(null),
      onFileChange: vi.fn(),
    },
  };
}

function getWatcherHandler(
  server: ReturnType<typeof createMockServer>,
  event: string,
): ((file: string) => void) | undefined {
  return server.watcher.on.mock.calls.find(([registeredEvent]) => registeredEvent === event)?.[1] as
    | ((file: string) => void)
    | undefined;
}

async function configurePlugin({
  options = { logLevel: 'silent', debounceMs: 100 },
  moduleGraph = { '/project/prisma.config.ts': {} },
}: {
  options?: Parameters<typeof prismaVitePlugin>[1];
  moduleGraph?: Record<string, { file?: string; imports?: readonly string[] }>;
} = {}): Promise<{
  readonly mockServer: ReturnType<typeof createMockServer>;
  readonly handleHotUpdate: (ctx: { file: string }) => void;
}> {
  const plugin = prismaVitePlugin('prisma.config.ts', options);
  const mockServer = createMockServer();

  applyModuleGraph(mockServer, moduleGraph);

  const configResolved = plugin.configResolved as unknown as (config: { root: string }) => void;
  configResolved({ root: '/project' });

  const configureServer = plugin.configureServer as unknown as (
    server: ReturnType<typeof createMockServer>,
  ) => Promise<void>;
  await configureServer(mockServer);

  return {
    mockServer,
    handleHotUpdate: plugin.handleHotUpdate as unknown as (ctx: { file: string }) => void,
  };
}

describe('prismaVitePlugin', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockedExecuteContractEmit.mockReset();
    mockedExecuteContractEmit.mockResolvedValue(successfulEmitResult);
    mockedDisposeEmitQueue.mockReset();
    mockedLoadConfig.mockReset();
    mockedLoadConfig.mockResolvedValue(createLoadedConfig());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns a Vite plugin with the correct name', () => {
    const plugin = prismaVitePlugin('prisma.config.ts');

    expect(plugin.name).toBe('prisma-vite-plugin-contract-emit');
  });

  it('accepts optional configuration', () => {
    const plugin = prismaVitePlugin('prisma.config.ts', {
      debounceMs: 500,
      logLevel: 'silent',
    });

    expect(plugin.name).toBe('prisma-vite-plugin-contract-emit');
  });

  it('has configResolved hook', () => {
    const plugin = prismaVitePlugin('prisma.config.ts');

    expect(typeof plugin.configResolved).toBe('function');
  });

  it('has configureServer hook', () => {
    const plugin = prismaVitePlugin('prisma.config.ts');

    expect(typeof plugin.configureServer).toBe('function');
  });

  it('has handleHotUpdate hook', () => {
    const plugin = prismaVitePlugin('prisma.config.ts');

    expect(typeof plugin.handleHotUpdate).toBe('function');
  });

  describe('configResolved', () => {
    it('resolves config path relative to vite root', async () => {
      const plugin = prismaVitePlugin('prisma.config.ts', { logLevel: 'silent' });
      const mockServer = createMockServer();

      const configResolved = plugin.configResolved as unknown as (config: { root: string }) => void;
      configResolved({ root: '/project' });

      const configureServer = plugin.configureServer as unknown as (
        server: ReturnType<typeof createMockServer>,
      ) => Promise<void>;
      await configureServer(mockServer);

      expect(mockedExecuteContractEmit).toHaveBeenCalledWith(
        expect.objectContaining({
          configPath: '/project/prisma.config.ts',
        }),
      );
    });

    it('preserves absolute config path', async () => {
      const plugin = prismaVitePlugin('/absolute/prisma.config.ts', { logLevel: 'silent' });
      const mockServer = createMockServer();

      const configResolved = plugin.configResolved as unknown as (config: { root: string }) => void;
      configResolved({ root: '/project' });

      const configureServer = plugin.configureServer as unknown as (
        server: ReturnType<typeof createMockServer>,
      ) => Promise<void>;
      await configureServer(mockServer);

      expect(mockedExecuteContractEmit).toHaveBeenCalledWith(
        expect.objectContaining({
          configPath: '/absolute/prisma.config.ts',
        }),
      );
    });
  });

  describe('configureServer', () => {
    it('registers file watchers from the config module graph when provider omits inputs', async () => {
      mockedLoadConfig.mockResolvedValue(
        createLoadedConfig({
          inputs: undefined,
        }),
      );

      const plugin = prismaVitePlugin('prisma.config.ts', { logLevel: 'silent' });
      const mockServer = createMockServer();

      applyModuleGraph(mockServer, {
        '/project/prisma.config.ts': {
          imports: ['/project/config-shared.ts'],
        },
        '/project/config-shared.ts': {},
      });

      const configResolved = plugin.configResolved as unknown as (config: { root: string }) => void;
      configResolved({ root: '/project' });

      const configureServer = plugin.configureServer as unknown as (
        server: ReturnType<typeof createMockServer>,
      ) => Promise<void>;
      await configureServer(mockServer);

      expect(mockServer.ssrLoadModule).toHaveBeenCalledWith('/project/prisma.config.ts');
      expect(mockServer.watcher.add).toHaveBeenCalledWith('/project/prisma.config.ts');
      expect(mockServer.watcher.add).toHaveBeenCalledWith('/project/config-shared.ts');
    });

    it('merges declared inputs with config module dependencies', async () => {
      mockedLoadConfig.mockResolvedValue(
        createLoadedConfig({
          inputs: ['./prisma/schema.prisma'],
        }),
      );

      const plugin = prismaVitePlugin('prisma.config.ts', { logLevel: 'silent' });
      const mockServer = createMockServer();

      applyModuleGraph(mockServer, {
        '/project/prisma.config.ts': {
          imports: ['/project/config-shared.ts'],
        },
        '/project/config-shared.ts': {},
      });

      const configResolved = plugin.configResolved as unknown as (config: { root: string }) => void;
      configResolved({ root: '/project' });

      const configureServer = plugin.configureServer as unknown as (
        server: ReturnType<typeof createMockServer>,
      ) => Promise<void>;
      await configureServer(mockServer);

      expect(mockServer.ssrLoadModule).toHaveBeenCalledWith('/project/prisma.config.ts');
      expect(mockServer.watcher.add).toHaveBeenCalledWith('/project/prisma.config.ts');
      expect(mockServer.watcher.add).toHaveBeenCalledWith('/project/config-shared.ts');
      expect(mockServer.watcher.add).toHaveBeenCalledWith('/project/prisma/schema.prisma');
    });

    it('filters emitted artifacts from watched files', async () => {
      mockedLoadConfig.mockResolvedValue(
        createLoadedConfig({
          inputs: [
            './prisma/schema.prisma',
            './src/prisma/contract.json',
            './src/prisma/contract.d.ts',
          ],
        }),
      );

      const plugin = prismaVitePlugin('prisma.config.ts', { logLevel: 'silent' });
      const mockServer = createMockServer();

      applyModuleGraph(mockServer, {
        '/project/prisma.config.ts': {},
      });

      const configResolved = plugin.configResolved as unknown as (config: { root: string }) => void;
      configResolved({ root: '/project' });

      const configureServer = plugin.configureServer as unknown as (
        server: ReturnType<typeof createMockServer>,
      ) => Promise<void>;
      await configureServer(mockServer);

      expect(mockServer.watcher.add).toHaveBeenCalledWith('/project/prisma.config.ts');
      expect(mockServer.watcher.add).toHaveBeenCalledWith('/project/prisma/schema.prisma');
      expect(mockServer.watcher.add).not.toHaveBeenCalledWith('/project/src/prisma/contract.json');
      expect(mockServer.watcher.add).not.toHaveBeenCalledWith('/project/src/prisma/contract.d.ts');
    });

    it('treats js and ts input files as additional module graph roots', async () => {
      mockedLoadConfig.mockResolvedValue(
        createLoadedConfig({
          inputs: ['./prisma/contract.ts'],
        }),
      );

      const plugin = prismaVitePlugin('prisma.config.ts', { logLevel: 'silent' });
      const mockServer = createMockServer();

      applyModuleGraph(mockServer, {
        '/project/prisma.config.ts': {
          imports: ['/project/config-shared.ts'],
        },
        '/project/config-shared.ts': {},
        '/project/prisma/contract.ts': {
          imports: ['/project/prisma/models.ts'],
        },
        '/project/prisma/models.ts': {},
      });

      const configResolved = plugin.configResolved as unknown as (config: { root: string }) => void;
      configResolved({ root: '/project' });

      const configureServer = plugin.configureServer as unknown as (
        server: ReturnType<typeof createMockServer>,
      ) => Promise<void>;
      await configureServer(mockServer);

      expect(mockServer.ssrLoadModule).toHaveBeenCalledWith('/project/prisma.config.ts');
      expect(mockServer.ssrLoadModule).toHaveBeenCalledWith('/project/prisma/contract.ts');
      expect(mockServer.watcher.add).toHaveBeenCalledWith('/project/prisma.config.ts');
      expect(mockServer.watcher.add).toHaveBeenCalledWith('/project/config-shared.ts');
      expect(mockServer.watcher.add).toHaveBeenCalledWith('/project/prisma/contract.ts');
      expect(mockServer.watcher.add).toHaveBeenCalledWith('/project/prisma/models.ts');
    });

    it('triggers initial emit on server start', async () => {
      const plugin = prismaVitePlugin('prisma.config.ts', { logLevel: 'silent' });
      const mockServer = createMockServer();

      const configResolved = plugin.configResolved as unknown as (config: { root: string }) => void;
      configResolved({ root: '/project' });

      const configureServer = plugin.configureServer as unknown as (
        server: ReturnType<typeof createMockServer>,
      ) => Promise<void>;
      await configureServer(mockServer);

      expect(mockedExecuteContractEmit).toHaveBeenCalledWith(
        expect.objectContaining({
          configPath: expect.stringContaining('prisma.config.ts'),
        }),
      );
    });

    it('invalidates emitted artifacts after successful emit', async () => {
      const plugin = prismaVitePlugin('prisma.config.ts', { logLevel: 'silent' });
      const mockServer = createMockServer();

      const configResolved = plugin.configResolved as unknown as (config: { root: string }) => void;
      configResolved({ root: '/project' });

      const configureServer = plugin.configureServer as unknown as (
        server: ReturnType<typeof createMockServer>,
      ) => Promise<void>;
      await configureServer(mockServer);

      expect(mockServer.moduleGraph.onFileChange).toHaveBeenCalledWith('/out/contract.json');
      expect(mockServer.moduleGraph.onFileChange).toHaveBeenCalledWith('/out/contract.d.ts');
    });

    it('loads config for watch resolution and for the initial emit', async () => {
      const plugin = prismaVitePlugin('prisma.config.ts', { logLevel: 'silent' });
      const mockServer = createMockServer();

      const configResolved = plugin.configResolved as unknown as (config: { root: string }) => void;
      configResolved({ root: '/project' });

      const configureServer = plugin.configureServer as unknown as (
        server: ReturnType<typeof createMockServer>,
      ) => Promise<void>;
      await configureServer(mockServer);

      expect(mockedLoadConfig).toHaveBeenCalledTimes(2);
      expect(mockedExecuteContractEmit).toHaveBeenCalledTimes(1);
      expect(mockedLoadConfig.mock.invocationCallOrder[0]!).toBeLessThan(
        mockedExecuteContractEmit.mock.invocationCallOrder[0]!,
      );
    });

    it('registers cleanup hooks for server close', async () => {
      const plugin = prismaVitePlugin('prisma.config.ts', { logLevel: 'silent' });
      const mockServer = createMockServer();

      const configResolved = plugin.configResolved as unknown as (config: { root: string }) => void;
      configResolved({ root: '/project' });

      const configureServer = plugin.configureServer as unknown as (
        server: ReturnType<typeof createMockServer>,
      ) => Promise<void>;
      await configureServer(mockServer);

      expect(mockServer.httpServer.on).toHaveBeenCalledWith('close', expect.any(Function));
      expect(mockServer.watcher.on).toHaveBeenCalledWith('close', expect.any(Function));
      expect(mockServer.watcher.on).toHaveBeenCalledWith('change', expect.any(Function));
      expect(mockServer.watcher.on).toHaveBeenCalledWith('add', expect.any(Function));
      expect(mockServer.watcher.on).toHaveBeenCalledWith('unlink', expect.any(Function));
    });

    it('disposes the per-output emit queue on server close', async () => {
      mockedLoadConfig.mockResolvedValue(
        createLoadedConfig({ output: 'src/prisma/contract.json' }),
      );
      const { mockServer } = await configurePlugin();

      // The httpServer 'close' listener is the cleanup hook the plugin registers.
      const closeHandler = mockServer.httpServer.on.mock.calls.find(
        ([event]) => event === 'close',
      )?.[1] as (() => void) | undefined;
      expect(closeHandler).toEqual(expect.any(Function));

      closeHandler?.();

      expect(mockedDisposeEmitQueue).toHaveBeenCalledWith('/project/src/prisma/contract.json');
    });

    it('does not warn when provider omits inputs', async () => {
      mockedLoadConfig.mockResolvedValue(createLoadedConfig({ inputs: undefined }));

      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const plugin = prismaVitePlugin('prisma.config.ts', { logLevel: 'info' });
      const mockServer = createMockServer();

      const configResolved = plugin.configResolved as unknown as (config: { root: string }) => void;
      configResolved({ root: '/project' });

      const configureServer = plugin.configureServer as unknown as (
        server: ReturnType<typeof createMockServer>,
      ) => Promise<void>;
      await configureServer(mockServer);

      expect(mockServer.watcher.add).toHaveBeenCalledWith('/project/prisma.config.ts');
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    it('falls back to watching the config file and warns when loadConfig fails', async () => {
      // Only the watch-resolution load fails; the emit's own load still succeeds.
      mockedLoadConfig.mockRejectedValueOnce(new Error('config load failed'));

      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const plugin = prismaVitePlugin('prisma.config.ts', { logLevel: 'info' });
      const mockServer = createMockServer();

      const configResolved = plugin.configResolved as unknown as (config: { root: string }) => void;
      configResolved({ root: '/project' });

      const configureServer = plugin.configureServer as unknown as (
        server: ReturnType<typeof createMockServer>,
      ) => Promise<void>;
      await configureServer(mockServer);

      expect(mockServer.watcher.add).toHaveBeenCalledWith('/project/prisma.config.ts');
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Watching only /project/prisma.config.ts'),
      );
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Contract watch coverage is partial'),
      );
      expect(mockedExecuteContractEmit).toHaveBeenCalledWith(
        expect.objectContaining({
          configPath: '/project/prisma.config.ts',
        }),
      );
      expect(consoleErrorSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('Contract emit failed'),
      );
    });

    it('keeps existing watched dependencies while config loading falls back', async () => {
      // Fails the watch-resolution load only; the emit's own load still succeeds.
      let failNextLoad = false;
      mockedLoadConfig.mockImplementation(async () => {
        if (failNextLoad) {
          failNextLoad = false;
          throw new Error('config load failed');
        }
        return createLoadedConfig({ inputs: undefined });
      });

      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const plugin = prismaVitePlugin('prisma.config.ts', {
        logLevel: 'info',
        debounceMs: 100,
      });
      const mockServer = createMockServer();

      applyModuleGraph(mockServer, {
        '/project/prisma.config.ts': {
          imports: ['/project/config-shared.ts'],
        },
        '/project/config-shared.ts': {},
      });

      const configResolved = plugin.configResolved as unknown as (config: { root: string }) => void;
      configResolved({ root: '/project' });

      const configureServer = plugin.configureServer as unknown as (
        server: ReturnType<typeof createMockServer>,
      ) => Promise<void>;
      await configureServer(mockServer);

      mockedExecuteContractEmit.mockClear();
      mockServer.watcher.add.mockClear();
      mockServer.watcher.unwatch.mockClear();

      failNextLoad = true;

      const handleHotUpdate = plugin.handleHotUpdate as unknown as (ctx: { file: string }) => void;
      handleHotUpdate({ file: '/project/config-shared.ts' });
      await vi.advanceTimersByTimeAsync(100);

      expect(mockedExecuteContractEmit).toHaveBeenCalledTimes(1);
      expect(mockServer.watcher.unwatch).not.toHaveBeenCalledWith('/project/config-shared.ts');
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'Watching the previous dependency set plus /project/prisma.config.ts',
        ),
      );

      mockedExecuteContractEmit.mockClear();

      handleHotUpdate({ file: '/project/config-shared.ts' });
      await vi.advanceTimersByTimeAsync(100);

      expect(mockedExecuteContractEmit).toHaveBeenCalledTimes(1);
    });
  });

  describe('handleHotUpdate', () => {
    it('does not throw when called with untracked file', () => {
      const plugin = prismaVitePlugin('prisma.config.ts', { logLevel: 'silent' });

      const configResolved = plugin.configResolved as unknown as (config: { root: string }) => void;
      configResolved({ root: '/project' });

      const handleHotUpdate = plugin.handleHotUpdate as unknown as (ctx: { file: string }) => void;
      expect(() => handleHotUpdate({ file: '/unrelated/file.ts' })).not.toThrow();
    });

    it('triggers debounced emit for tracked file changes', async () => {
      mockedLoadConfig.mockResolvedValue(
        createLoadedConfig({
          inputs: undefined,
        }),
      );

      const plugin = prismaVitePlugin('prisma.config.ts', {
        logLevel: 'silent',
        debounceMs: 100,
      });
      const mockServer = createMockServer();

      applyModuleGraph(mockServer, {
        '/project/prisma.config.ts': {},
      });

      const configResolved = plugin.configResolved as unknown as (config: { root: string }) => void;
      configResolved({ root: '/project' });

      const configureServer = plugin.configureServer as unknown as (
        server: ReturnType<typeof createMockServer>,
      ) => Promise<void>;
      await configureServer(mockServer);

      mockedExecuteContractEmit.mockClear();

      const handleHotUpdate = plugin.handleHotUpdate as unknown as (ctx: { file: string }) => void;
      handleHotUpdate({ file: '/project/prisma.config.ts' });

      expect(mockedExecuteContractEmit).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(100);

      expect(mockedExecuteContractEmit).toHaveBeenCalledTimes(1);
    });

    it('ignores emitted artifact updates from raw watcher events', async () => {
      mockedLoadConfig.mockResolvedValue(
        createLoadedConfig({
          inputs: ['./prisma/schema.prisma'],
          output: 'output/contract.json',
        }),
      );

      const plugin = prismaVitePlugin('prisma.config.ts', {
        logLevel: 'silent',
        debounceMs: 100,
      });
      const mockServer = createMockServer();

      applyModuleGraph(mockServer, {
        '/project/prisma.config.ts': {},
      });

      const configResolved = plugin.configResolved as unknown as (config: { root: string }) => void;
      configResolved({ root: '/project' });

      const configureServer = plugin.configureServer as unknown as (
        server: ReturnType<typeof createMockServer>,
      ) => Promise<void>;
      await configureServer(mockServer);

      mockedExecuteContractEmit.mockClear();

      const changeHandler = getWatcherHandler(mockServer, 'change');
      expect(changeHandler).toEqual(expect.any(Function));

      changeHandler?.('/project/output/contract.json');
      changeHandler?.('/project/output/contract.d.ts');
      await vi.advanceTimersByTimeAsync(100);

      expect(mockedExecuteContractEmit).not.toHaveBeenCalled();
    });

    it('triggers debounced emit for tracked add and unlink watcher events', async () => {
      mockedLoadConfig.mockResolvedValue(
        createLoadedConfig({
          inputs: ['./prisma/schema.prisma'],
        }),
      );

      const plugin = prismaVitePlugin('prisma.config.ts', {
        logLevel: 'silent',
        debounceMs: 100,
      });
      const mockServer = createMockServer();

      applyModuleGraph(mockServer, {
        '/project/prisma.config.ts': {},
      });

      const configResolved = plugin.configResolved as unknown as (config: { root: string }) => void;
      configResolved({ root: '/project' });

      const configureServer = plugin.configureServer as unknown as (
        server: ReturnType<typeof createMockServer>,
      ) => Promise<void>;
      await configureServer(mockServer);

      const addHandler = getWatcherHandler(mockServer, 'add');
      const unlinkHandler = getWatcherHandler(mockServer, 'unlink');

      expect(addHandler).toEqual(expect.any(Function));
      expect(unlinkHandler).toEqual(expect.any(Function));

      mockedExecuteContractEmit.mockClear();

      addHandler?.('/project/prisma/schema.prisma');
      await vi.advanceTimersByTimeAsync(100);

      expect(mockedExecuteContractEmit).toHaveBeenCalledTimes(1);

      mockedExecuteContractEmit.mockClear();

      unlinkHandler?.('/project/prisma/schema.prisma');
      await vi.advanceTimersByTimeAsync(100);

      expect(mockedExecuteContractEmit).toHaveBeenCalledTimes(1);
    });

    it('updates watched files when config imports and resolved inputs change', async () => {
      let currentConfig = createLoadedConfig({
        inputs: ['./prisma/schema.prisma'],
      });
      mockedLoadConfig.mockImplementation(async () => currentConfig);

      const plugin = prismaVitePlugin('prisma.config.ts', {
        logLevel: 'silent',
        debounceMs: 100,
      });
      const mockServer = createMockServer();

      applyModuleGraph(mockServer, {
        '/project/prisma.config.ts': {
          imports: ['/project/config-shared-a.ts'],
        },
        '/project/config-shared-a.ts': {},
      });

      const configResolved = plugin.configResolved as unknown as (config: { root: string }) => void;
      configResolved({ root: '/project' });

      const configureServer = plugin.configureServer as unknown as (
        server: ReturnType<typeof createMockServer>,
      ) => Promise<void>;
      await configureServer(mockServer);

      mockedExecuteContractEmit.mockClear();
      mockServer.watcher.add.mockClear();
      mockServer.watcher.unwatch.mockClear();

      currentConfig = createLoadedConfig({
        inputs: ['./prisma/schema-alt.prisma'],
      });
      applyModuleGraph(mockServer, {
        '/project/prisma.config.ts': {
          imports: ['/project/config-shared-b.ts'],
        },
        '/project/config-shared-b.ts': {},
      });

      const handleHotUpdate = plugin.handleHotUpdate as unknown as (ctx: { file: string }) => void;
      handleHotUpdate({ file: '/project/prisma.config.ts' });
      await vi.advanceTimersByTimeAsync(100);

      expect(mockedExecuteContractEmit).toHaveBeenCalledTimes(1);
      expect(mockServer.watcher.add).toHaveBeenCalledWith('/project/config-shared-b.ts');
      expect(mockServer.watcher.add).toHaveBeenCalledWith('/project/prisma/schema-alt.prisma');
      expect(mockServer.watcher.unwatch).toHaveBeenCalledWith('/project/config-shared-a.ts');
      expect(mockServer.watcher.unwatch).toHaveBeenCalledWith('/project/prisma/schema.prisma');
    });

    it('debounces rapid successive changes', async () => {
      mockedLoadConfig.mockResolvedValue(
        createLoadedConfig({
          inputs: undefined,
        }),
      );

      const { handleHotUpdate } = await configurePlugin();
      mockedExecuteContractEmit.mockClear();

      handleHotUpdate({ file: '/project/prisma.config.ts' });
      await vi.advanceTimersByTimeAsync(50);
      handleHotUpdate({ file: '/project/prisma.config.ts' });
      await vi.advanceTimersByTimeAsync(50);
      handleHotUpdate({ file: '/project/prisma.config.ts' });
      await vi.advanceTimersByTimeAsync(100);

      expect(mockedExecuteContractEmit).toHaveBeenCalledTimes(1);
    });

    it('waits for an in-flight emit before starting the queued re-emit', async () => {
      const { handleHotUpdate } = await configurePlugin();
      mockedExecuteContractEmit.mockReset();

      const firstEmit = createDeferred<Awaited<ReturnType<typeof executeContractEmit>>>();
      let firstSignal: AbortSignal | undefined;
      mockedExecuteContractEmit.mockImplementationOnce(async ({ signal }) => {
        firstSignal = signal;
        return firstEmit.promise;
      });
      mockedExecuteContractEmit.mockRejectedValueOnce(new Error('latest source invalid'));

      handleHotUpdate({ file: '/project/prisma.config.ts' });
      await vi.advanceTimersByTimeAsync(100);

      expect(mockedExecuteContractEmit).toHaveBeenCalledTimes(1);

      handleHotUpdate({ file: '/project/prisma.config.ts' });
      await vi.advanceTimersByTimeAsync(100);

      expect(mockedExecuteContractEmit).toHaveBeenCalledTimes(1);
      expect(firstSignal?.aborted).toBe(false);

      firstEmit.resolve(successfulEmitResult);
      await firstEmit.promise;
      await flushMicrotasks();

      expect(mockedExecuteContractEmit).toHaveBeenCalledTimes(2);
      expect(firstSignal?.aborted).toBe(false);
    });

    it('coalesces multiple queued changes while an emit is in flight', async () => {
      const { handleHotUpdate } = await configurePlugin();
      mockedExecuteContractEmit.mockReset();

      const firstEmit = createDeferred<Awaited<ReturnType<typeof executeContractEmit>>>();
      mockedExecuteContractEmit.mockImplementationOnce(async () => firstEmit.promise);
      mockedExecuteContractEmit.mockResolvedValueOnce(successfulEmitResult);

      handleHotUpdate({ file: '/project/prisma.config.ts' });
      await vi.advanceTimersByTimeAsync(100);

      expect(mockedExecuteContractEmit).toHaveBeenCalledTimes(1);

      handleHotUpdate({ file: '/project/prisma.config.ts' });
      await vi.advanceTimersByTimeAsync(100);
      handleHotUpdate({ file: '/project/prisma.config.ts' });
      await vi.advanceTimersByTimeAsync(100);

      expect(mockedExecuteContractEmit).toHaveBeenCalledTimes(1);

      firstEmit.resolve(successfulEmitResult);
      await firstEmit.promise;
      await flushMicrotasks();

      expect(mockedExecuteContractEmit).toHaveBeenCalledTimes(2);
    });

    it('defers full reload while a newer queued emit is still pending', async () => {
      const { handleHotUpdate, mockServer } = await configurePlugin();
      mockedExecuteContractEmit.mockReset();
      mockServer.ws.send.mockClear();

      const firstEmit = createDeferred<Awaited<ReturnType<typeof executeContractEmit>>>();
      mockedExecuteContractEmit.mockImplementationOnce(async () => firstEmit.promise);
      mockedExecuteContractEmit.mockRejectedValueOnce(new Error('latest source invalid'));

      handleHotUpdate({ file: '/project/prisma.config.ts' });
      await vi.advanceTimersByTimeAsync(100);
      handleHotUpdate({ file: '/project/prisma.config.ts' });
      await vi.advanceTimersByTimeAsync(100);

      firstEmit.resolve(successfulEmitResult);
      await firstEmit.promise;
      await flushMicrotasks();

      expect(mockedExecuteContractEmit).toHaveBeenCalledTimes(2);
      expect(mockServer.ws.send).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
          err: expect.objectContaining({
            message: expect.stringContaining('latest source invalid'),
          }),
        }),
      );
      expect(mockServer.ws.send).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: 'full-reload' }),
      );
    });
  });

  describe('error handling', () => {
    it('logs error when emit fails', async () => {
      mockedExecuteContractEmit.mockRejectedValue(new Error('Emit failed'));

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const plugin = prismaVitePlugin('prisma.config.ts', { logLevel: 'info' });
      const mockServer = createMockServer();

      const configResolved = plugin.configResolved as unknown as (config: { root: string }) => void;
      configResolved({ root: '/project' });

      const configureServer = plugin.configureServer as unknown as (
        server: ReturnType<typeof createMockServer>,
      ) => Promise<void>;
      await configureServer(mockServer);

      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Contract emit failed'));

      consoleErrorSpy.mockRestore();
    });

    it('sends error to Vite overlay on failure', async () => {
      mockedExecuteContractEmit.mockRejectedValue(new Error('Something broke'));

      vi.spyOn(console, 'error').mockImplementation(() => {});

      const plugin = prismaVitePlugin('prisma.config.ts', { logLevel: 'silent' });
      const mockServer = createMockServer();

      const configResolved = plugin.configResolved as unknown as (config: { root: string }) => void;
      configResolved({ root: '/project' });

      const configureServer = plugin.configureServer as unknown as (
        server: ReturnType<typeof createMockServer>,
      ) => Promise<void>;
      await configureServer(mockServer);

      expect(mockServer.ws.send).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'error',
          err: expect.objectContaining({
            message: expect.stringContaining('Something broke'),
          }),
        }),
      );
    });

    it('silently ignores cancellation errors', async () => {
      mockedExecuteContractEmit.mockRejectedValue(
        new DOMException('The operation was aborted', 'AbortError'),
      );

      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const plugin = prismaVitePlugin('prisma.config.ts', { logLevel: 'info' });
      const mockServer = createMockServer();

      const configResolved = plugin.configResolved as unknown as (config: { root: string }) => void;
      configResolved({ root: '/project' });

      const configureServer = plugin.configureServer as unknown as (
        server: ReturnType<typeof createMockServer>,
      ) => Promise<void>;
      await configureServer(mockServer);

      expect(consoleErrorSpy).not.toHaveBeenCalledWith(
        expect.stringContaining('Contract emit failed'),
      );

      consoleErrorSpy.mockRestore();
    });
  });
});
