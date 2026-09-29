import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { PassThrough } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { join } from 'pathe';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createConnection,
  DidChangeWatchedFilesNotification,
  DocumentDiagnosticRequest,
  FileChangeType,
  type FileEvent,
  InitializeRequest,
  StreamMessageReader,
  StreamMessageWriter,
} from 'vscode-languageserver/node';
import type { ConfigResolution } from '../src/config-resolution';
import { DocumentStore } from '../src/document-store';
import type { ProjectArtifacts, ProjectArtifactsOptions } from '../src/project-artifacts';
import * as schemaInputs from '../src/schema-inputs';
import { createServer } from '../src/server';

const mocks = vi.hoisted(() => ({
  discover: vi.fn<(path: string) => Promise<string | undefined>>(),
  load: vi.fn<() => Promise<ConfigResolution>>(),
  artifacts: [] as ProjectArtifacts[],
}));

vi.mock('@internal/config-loader', async (original) => ({
  ...(await original<typeof import('@internal/config-loader')>()),
  findNearestConfigPathForFile: mocks.discover,
}));
vi.mock('../src/config-resolution', async (original) => ({
  ...(await original<typeof import('../src/config-resolution')>()),
  resolveConfigInputs: mocks.load,
}));
vi.mock('../src/project-artifacts', async (original) => {
  const actual = await original<typeof import('../src/project-artifacts')>();
  return {
    ...actual,
    ProjectArtifacts: vi.fn(function MockProjectArtifacts(options: ProjectArtifactsOptions) {
      const artifacts = new actual.ProjectArtifacts(options);
      vi.spyOn(artifacts, 'documentChanged');
      vi.spyOn(artifacts, 'updateInputs');
      mocks.artifacts.push(artifacts);
      return artifacts;
    }),
  };
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const cleanups: (() => void | Promise<void>)[] = [];
const text = (name: string) => `// use prisma-8\nmodel ${name} {\n id Int\n}\n`;
const uri = (path: string) => pathToFileURL(path).toString();

async function setup(pull: boolean) {
  const dir = await mkdtemp(join(tmpdir(), 'membership-races-'));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  const first = join(dir, 'first.prisma');
  const second = join(dir, 'second.prisma');
  const config = join(dir, 'prisma.config.ts');
  await writeFile(first, text('First'));
  await writeFile(second, text('Second'));
  mocks.discover.mockResolvedValue(config);
  const resolveInputs = schemaInputs.resolveSchemaInputs;
  async function resolution(paths = [join(dir, '*.prisma')]): Promise<ConfigResolution> {
    const schemaInputConfig = { contract: { source: { format: 'psl', inputs: paths } } };
    return {
      schemaInputConfig,
      inputs: await resolveInputs(schemaInputConfig, () => text('Member')),
      controlStack: { scalarTypes: ['Int'], pslBlockDescriptors: {} },
    };
  }
  const initial = await resolution();
  mocks.load.mockResolvedValue(initial);
  const incoming = new PassThrough();
  const outgoing = new PassThrough();
  const connection = createConnection(
    new StreamMessageReader(incoming),
    new StreamMessageWriter(outgoing),
  );
  const client = createConnection(
    new StreamMessageReader(outgoing),
    new StreamMessageWriter(incoming),
  );
  const pending: {
    done: ReturnType<typeof deferred<void>>;
    started: ReturnType<typeof deferred<void>>;
  }[] = [];
  const registerChange = connection.onDidChangeWatchedFiles.bind(connection);
  vi.spyOn(connection, 'onDidChangeWatchedFiles').mockImplementation((handler) =>
    registerChange(async (params) => {
      const task = pending.shift();
      task?.started.resolve();
      try {
        await handler(params);
        task?.done.resolve();
      } catch (error) {
        task?.done.reject(error);
      }
    }),
  );
  vi.spyOn(connection.client, 'register').mockResolvedValue({
    dispose: vi.fn(),
    disposeSingle: vi.fn(),
  });
  const publish = vi.spyOn(connection, 'sendDiagnostics').mockResolvedValue(undefined);
  const diagnostics = connection.languages.diagnostics;
  vi.spyOn(connection.languages, 'diagnostics', 'get').mockReturnValue(diagnostics);
  const refresh = vi.spyOn(diagnostics, 'refresh').mockResolvedValue(undefined);
  const coverage = vi.spyOn(DocumentStore.prototype, 'setWatchCoverage');
  const invalidate = vi.spyOn(DocumentStore.prototype, 'invalidate');
  const server = createServer(connection);
  client.listen();
  cleanups.push(() => {
    server.dispose();
    client.dispose();
    incoming.destroy();
    outgoing.destroy();
  });
  await client.sendRequest(InitializeRequest.type, {
    processId: null,
    rootUri: null,
    capabilities: {
      ...(pull ? { textDocument: { diagnostic: { relatedDocumentSupport: true } } } : {}),
      workspace: {
        diagnostics: { refreshSupport: true },
        didChangeWatchedFiles: { dynamicRegistration: true },
      },
    },
  });
  const read = () =>
    client.sendRequest(DocumentDiagnosticRequest.type, { textDocument: { uri: uri(first) } });
  if (pull) await read();
  else {
    await client.sendRequest('textDocument/foldingRange', { textDocument: { uri: uri(first) } });
  }
  const artifacts = mocks.artifacts[0]!;
  artifacts.symbolTable();
  function change(...paths: string[]) {
    const done = deferred<void>();
    const started = deferred<void>();
    pending.push({ done, started });
    void client.sendNotification(DidChangeWatchedFilesNotification.type, {
      changes: paths.map((path): FileEvent => ({ uri: uri(path), type: FileChangeType.Changed })),
    });
    return Object.assign(done.promise, { started: started.promise });
  }
  function pauseExpansion() {
    const entered = deferred<void>();
    const result = deferred<schemaInputs.SchemaInputSet>();
    vi.spyOn(schemaInputs, 'resolveSchemaInputs').mockImplementationOnce(() => {
      entered.resolve();
      return result.promise;
    });
    return { entered: entered.promise, ...result };
  }
  function pauseLoad() {
    const entered = deferred<void>();
    const result = deferred<ConfigResolution>();
    mocks.load.mockImplementationOnce(() => {
      entered.resolve();
      return result.promise;
    });
    return { entered: entered.promise, ...result };
  }
  function effects() {
    return {
      publications: publish.mock.calls.length,
      refreshes: refresh.mock.calls.length,
      coverage: coverage.mock.calls.length,
      updates: vi.mocked(artifacts.updateInputs).mock.calls.length,
      invalidations: vi.mocked(artifacts.documentChanged).mock.calls.length,
    };
  }
  return {
    first,
    second,
    config,
    initial,
    resolution,
    change,
    pauseExpansion,
    pauseLoad,
    effects,
    artifacts,
    coverage,
    invalidate,
    read,
  };
}

afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup();
  cleanups.length = 0;
  mocks.artifacts.length = 0;
  mocks.load.mockReset();
  mocks.discover.mockReset();
  vi.restoreAllMocks();
});

describe.each([false, true])('membership refresh races (pull=%s)', (pull) => {
  it.each(['pending', 'successful', 'failed'] as const)(
    'discards a refresh across a %s reload',
    async (state) => {
      const h = await setup(pull);
      const expansion = h.pauseExpansion();
      const member = h.change(h.first);
      await expansion.entered;
      const load = h.pauseLoad();
      const reload = h.change(h.config);
      await load.entered;
      const replacement = await h.resolution([h.second]);
      if (state === 'successful') load.resolve(replacement);
      if (state === 'failed') load.reject(new Error('broken config'));
      if (state !== 'pending') await reload;
      const before = h.effects();
      expansion.resolve(h.initial.inputs);
      await member;
      const after = h.effects();
      if (state === 'pending') {
        load.resolve(replacement);
        await reload;
      }
      expect(after).toEqual(before);
      if (state !== 'failed') {
        expect(mocks.artifacts.at(-1)?.document(uri(h.first))).toBeUndefined();
        expect(h.coverage).toHaveBeenLastCalledWith(h.config, [uri(h.second)]);
      }
    },
  );

  it('keeps latest membership and both file invalidations when refreshes finish in reverse order', async () => {
    const h = await setup(pull);
    const expansion = h.pauseExpansion();
    await writeFile(h.first, text('UpdatedFirst'));
    const older = h.change(h.first);
    await expansion.entered;
    await writeFile(h.second, text('UpdatedSecond'));
    const next = await h.resolution([h.first]);
    vi.spyOn(schemaInputs, 'resolveSchemaInputs').mockResolvedValueOnce(next.inputs);
    await h.change(h.second);
    const before = h.effects();
    const invalidated = vi
      .mocked(h.artifacts.documentChanged)
      .mock.calls.map(([changed]) => changed);
    expansion.resolve(h.initial.inputs);
    await older;
    expect(h.effects()).toEqual(before);
    expect(invalidated).toEqual([uri(h.first), uri(h.second)]);
    expect(h.invalidate).toHaveBeenCalledWith(uri(h.first));
    expect(h.invalidate).toHaveBeenCalledWith(uri(h.second));
    expect(h.artifacts.document(uri(h.first))?.text).toBe(text('UpdatedFirst'));
    expect(h.artifacts.document(uri(h.second))).toBeUndefined();
    expect(h.coverage).toHaveBeenLastCalledWith(h.config, [uri(h.first)]);
  });

  it('does not let an older event awaiting a load supersede a newer event', async () => {
    const h = await setup(pull);
    const load = h.pauseLoad();
    const reload = h.change(h.config);
    await load.entered;
    const discovered = deferred<void>();
    mocks.discover.mockImplementationOnce(async () => {
      discovered.resolve();
      return h.config;
    });
    const older = h.change(h.first);
    await discovered.promise;
    const laterDiscovered = deferred<void>();
    mocks.discover.mockImplementationOnce(async () => {
      laterDiscovered.resolve();
      return h.config;
    });
    const newer = h.change(h.second);
    await laterDiscovered.promise;
    const expand = vi
      .spyOn(schemaInputs, 'resolveSchemaInputs')
      .mockResolvedValue(h.initial.inputs);
    load.resolve(h.initial);
    await Promise.all([reload, older, newer]);
    expect(expand).toHaveBeenCalledOnce();
  });

  it('allocates member generations before awaiting a config reload in the same notification', async () => {
    const h = await setup(pull);
    const load = h.pauseLoad();
    const older = h.change(h.config, h.first);
    await load.entered;
    const discovered = deferred<void>();
    mocks.discover.mockImplementationOnce(async () => {
      discovered.resolve();
      return h.config;
    });
    const newer = h.change(h.second);
    await discovered.promise;
    const expand = vi
      .spyOn(schemaInputs, 'resolveSchemaInputs')
      .mockResolvedValue(h.initial.inputs);
    load.resolve(h.initial);
    await Promise.all([older, newer]);
    expect(expand).toHaveBeenCalledOnce();
  });

  it.each(['successful', 'failed'] as const)(
    'refreshes the current project when the load it awaited is %s',
    async (state) => {
      const h = await setup(pull);
      const load = h.pauseLoad();
      const reload = h.change(h.config);
      await load.entered;
      const discovered = deferred<void>();
      mocks.discover.mockImplementationOnce(async () => {
        discovered.resolve();
        return h.config;
      });
      const member = h.change(h.first);
      await discovered.promise;
      const next = await h.resolution([h.second]);
      vi.spyOn(schemaInputs, 'resolveSchemaInputs').mockResolvedValueOnce(next.inputs);
      if (state === 'successful') load.resolve(h.initial);
      else load.reject(new Error('broken config'));
      await Promise.all([reload, member]);
      expect(mocks.artifacts.at(-1)?.updateInputs).toHaveBeenCalledExactlyOnceWith(next.inputs);
      expect(h.coverage).toHaveBeenLastCalledWith(h.config, [uri(h.second)]);
      if (pull) expect(h.effects().refreshes).toBe(2);
      else expect(h.effects().publications).toBeGreaterThan(1);
    },
  );

  it('does not allocate a newer generation after delayed config discovery', async () => {
    const h = await setup(pull);
    const discovered = deferred<string | undefined>();
    mocks.discover.mockReturnValueOnce(discovered.promise);
    const older = h.change(h.first);
    await older.started;
    const next = await h.resolution([h.second]);
    const expand = vi.spyOn(schemaInputs, 'resolveSchemaInputs').mockResolvedValue(next.inputs);
    await h.change(h.second);
    const before = h.effects();
    discovered.resolve(h.config);
    await older;
    expect(expand).toHaveBeenCalledOnce();
    expect(h.effects()).toEqual(before);
    expect(h.coverage).toHaveBeenLastCalledWith(h.config, [uri(h.second)]);
  });

  it('does not use a superseded load result while a successor reload is pending', async () => {
    const h = await setup(pull);
    const firstLoad = h.pauseLoad();
    const firstReload = h.change(h.config);
    await firstLoad.entered;
    const discovered = deferred<void>();
    mocks.discover.mockImplementationOnce(async () => {
      discovered.resolve();
      return h.config;
    });
    const member = h.change(h.first);
    await discovered.promise;
    const secondLoad = h.pauseLoad();
    const secondReload = h.change(h.config);
    await secondReload.started;
    const expand = vi
      .spyOn(schemaInputs, 'resolveSchemaInputs')
      .mockResolvedValue(h.initial.inputs);
    firstLoad.resolve(h.initial);
    await secondLoad.entered;
    await Promise.all([firstReload, member]);
    secondLoad.resolve(await h.resolution([h.second]));
    await secondReload;
    expect(expand).not.toHaveBeenCalled();
    expect(h.coverage).toHaveBeenLastCalledWith(h.config, [uri(h.second)]);
  });
});
