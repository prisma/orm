import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { PassThrough } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'pathe';
import { afterEach, expect, it, vi } from 'vitest';
import {
  createConnection,
  InitializeRequest,
  RegistrationRequest,
  ShutdownRequest,
  StreamMessageReader,
  StreamMessageWriter,
  UnregistrationRequest,
} from 'vscode-languageserver/node';
import { DocumentStore } from '../src/document-store';
import { guardedConnection } from '../src/guarded-connection';
import { Project } from '../src/project';
import { resolveSchemaInputs } from '../src/schema-inputs';
import { createServer } from '../src/server';

const state = vi.hoisted(() => ({
  inputs: undefined as readonly string[] | undefined,
  watchers: [] as {
    onReady: () => void;
    onChange: (path: string) => void;
    onError: (error: unknown) => void;
    close: ReturnType<typeof vi.fn>;
  }[],
}));
vi.mock('../src/internal-watcher', () => ({
  InternalWatcher: class {
    readonly close = vi.fn(async () => {});
    constructor(
      _config: string,
      _inputs: readonly string[],
      callbacks: Omit<(typeof state.watchers)[number], 'close'>,
    ) {
      state.watchers.push({ ...callbacks, close: this.close });
    }
  },
}));
vi.mock('../src/config-resolution', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/config-resolution')>();
  return {
    ...actual,
    resolveConfigInputs: async (
      configPath: string,
      readText: (uri: string) => string | undefined,
    ) => {
      const schemaInputConfig = {
        contract: {
          source: {
            format: 'psl',
            inputs: state.inputs ?? [join(dirname(configPath), '*.prisma')],
          },
        },
      };
      return {
        schemaInputConfig,
        inputs: await resolveSchemaInputs(schemaInputConfig, readText),
        controlStack: { scalarTypes: ['Int'], pslBlockDescriptors: {} },
      };
    },
  };
});
const cleanups: (() => void | Promise<void>)[] = [];
const alpha = '// use prisma-8\nmodel Alpha {\n id Int\n}\n';
const duplicate = `${alpha}\nmodel Alpha {\n id Int\n}\n`;
async function fixture(watched = false, deadline = 10000, protocolRegistration = false) {
  const dir = await mkdtemp(join(tmpdir(), 'project-watching-'));
  const path = join(dir, 'schema.prisma');
  const config = join(dir, 'prisma.config.ts');
  const uri = pathToFileURL(path).toString();
  await writeFile(path, alpha);
  const input = new PassThrough();
  const output = new PassThrough();
  const connection = createConnection(
    new StreamMessageReader(input),
    new StreamMessageWriter(output),
  );
  const publish = vi.spyOn(connection, 'sendDiagnostics').mockResolvedValue(undefined);
  const warn = vi.spyOn(connection.console, 'warn').mockImplementation(() => {});
  const register =
    vi.fn<() => Promise<{ dispose: () => void; disposeSingle: () => boolean } | undefined>>();
  const request = vi.spyOn(connection, 'sendRequest');
  const documents = new DocumentStore();
  let sequence = 0;
  const refresh = vi.fn();
  const project = new Project(config, {
    documents,
    connection: guardedConnection(connection),
    pullDiagnostics: false,
    watchedFilesRegistration: watched,
    nextSequence: () => ++sequence,
    unmanage: vi.fn(),
    refreshDiagnostics: refresh,
    registrationTimeoutMs: deadline,
    ...(protocolRegistration ? {} : { registerWatcher: register }),
  });
  cleanups.push(async () => {
    await project.dispose();
    connection.dispose();
    input.destroy();
    output.destroy();
    await rm(dir, { recursive: true, force: true });
  });
  return {
    dir,
    path,
    config,
    uri,
    project,
    documents,
    register,
    request,
    publish,
    warn,
    refresh,
    connection,
    input,
    output,
  };
}
afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup();
  cleanups.length = 0;
  state.watchers.length = 0;
  state.inputs = undefined;
  vi.restoreAllMocks();
});

it.each(['success', 'rejection'] as const)(
  'distinguishes void registration success from rejection through the guarded connection: %s',
  async (outcome) => {
    const h = await fixture(true, 10000, true);
    if (outcome === 'success') h.request.mockResolvedValue(undefined);
    else h.request.mockRejectedValue(new Error('registration denied'));
    await h.project.reload();
    if (outcome === 'success') {
      await vi.waitFor(() => expect(h.refresh).toHaveBeenCalledOnce());
      expect(state.watchers).toHaveLength(0);
      expect(h.warn).not.toHaveBeenCalled();
    } else {
      await vi.waitFor(() => expect(state.watchers).toHaveLength(1));
      expect(h.warn).toHaveBeenCalledWith(expect.stringContaining('registration denied'));
      expect(await h.project.diagnosticReport(h.uri)).toMatchObject({ items: [] });
    }
  },
);

it.each(['success', 'rejection'] as const)(
  'selects watching from an actual client registration response: %s',
  async (outcome) => {
    const h = await fixture();
    await writeFile(h.config, '');
    const client = createConnection(
      new StreamMessageReader(h.output),
      new StreamMessageWriter(h.input),
    );
    const registration = vi.fn(() => {
      if (outcome === 'rejection') throw new Error('client refused watching');
      return undefined;
    });
    client.onRequest(RegistrationRequest.type, registration);
    client.onRequest(UnregistrationRequest.type, () => undefined);
    const server = createServer(h.connection);
    client.listen();
    cleanups.push(async () => {
      await client.sendRequest(ShutdownRequest.type);
      for (const request of h.request.mock.results) {
        if (request.type === 'return') await request.value.catch(() => undefined);
      }
      await server.dispose();
      client.dispose();
    });
    await client.sendRequest(InitializeRequest.type, {
      processId: null,
      rootUri: null,
      capabilities: { workspace: { didChangeWatchedFiles: { dynamicRegistration: true } } },
    });
    await client.sendRequest('textDocument/foldingRange', { textDocument: { uri: h.uri } });
    await vi.waitFor(() => expect(registration).toHaveBeenCalledOnce());
    if (outcome === 'rejection') {
      await vi.waitFor(() => expect(state.watchers).toHaveLength(1));
      expect(h.warn).toHaveBeenCalledWith(expect.stringContaining('client refused watching'));
    } else {
      await vi.waitFor(() =>
        expect(h.publish).toHaveBeenCalledWith({ uri: h.uri, diagnostics: [] }),
      );
      expect(state.watchers).toHaveLength(0);
      expect(h.warn).not.toHaveBeenCalled();
    }
  },
);

it('uses compatible successful client registration without an internal duplicate', async () => {
  const h = await fixture(true);
  const dispose = vi.fn();
  h.register.mockResolvedValue({ dispose, disposeSingle: () => true });
  await h.project.reload();
  await vi.waitFor(() => expect(h.register).toHaveBeenCalledOnce());
  expect(state.watchers).toHaveLength(0);
  await h.project.dispose();
  expect(dispose).toHaveBeenCalledOnce();
});
it.each(['absent', 'failed', 'empty', 'incompatible'] as const)(
  'starts internal watching for %s client coverage',
  async (mode) => {
    const h = await fixture(mode !== 'absent');
    if (mode === 'failed') h.register.mockRejectedValue(new Error('failed registration'));
    if (mode === 'empty') h.register.mockResolvedValue(undefined);
    if (mode === 'incompatible') state.inputs = [join(h.dir, '@(schema|other).prisma')];
    await h.project.reload();
    await vi.waitFor(() => expect(state.watchers).toHaveLength(1));
    expect(await h.project.diagnosticReport(h.uri)).toMatchObject({ items: [] });
  },
);
it('bounds registration, disposes late success, and keeps cached reads while pending', async () => {
  const h = await fixture(true, 10);
  let resolve!: (value: { dispose: () => void; disposeSingle: () => boolean }) => void;
  h.register.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  await h.project.reload();
  await writeFile(h.path, duplicate);
  expect(h.documents.text(h.uri)).toBe(alpha);
  await vi.waitFor(() => expect(state.watchers).toHaveLength(1));
  const dispose = vi.fn();
  resolve({ dispose, disposeSingle: () => true });
  await vi.waitFor(() => expect(dispose).toHaveBeenCalledOnce());
  expect(h.documents.text(h.uri)).toBe(alpha);
});
it('reconciles readiness and coalesces external changes without editor messages', async () => {
  const h = await fixture();
  await h.project.reload();
  await writeFile(h.path, duplicate);
  expect(h.documents.text(h.uri)).toBe(alpha);
  state.watchers[0]!.onReady();
  await vi.waitFor(() =>
    expect(h.publish).toHaveBeenLastCalledWith(
      expect.objectContaining({
        uri: h.uri,
        diagnostics: expect.arrayContaining([
          expect.objectContaining({ code: 'PSL_DUPLICATE_DECLARATION' }),
        ]),
      }),
    ),
  );
  h.publish.mockClear();
  await writeFile(h.path, alpha);
  state.watchers[0]!.onChange(h.path);
  state.watchers[0]!.onChange(h.path);
  await vi.waitFor(() => expect(h.publish).toHaveBeenCalledOnce());
  expect(h.publish).toHaveBeenLastCalledWith({ uri: h.uri, diagnostics: [] });
});
it('reads the final write after the backend change-coalescing window', async () => {
  const h = await fixture();
  await h.project.reload();
  h.publish.mockClear();
  vi.useFakeTimers();
  try {
    await writeFile(h.path, duplicate);
    state.watchers[0]!.onChange(join(h.dir, 'other.prisma'));
    await vi.advanceTimersByTimeAsync(25);
    state.watchers[0]!.onChange(h.path);
    await vi.advanceTimersByTimeAsync(25);
    expect(h.documents.text(h.uri)).toBe(alpha);
    await writeFile(h.path, alpha);
    await vi.advanceTimersByTimeAsync(25);
  } finally {
    vi.useRealTimers();
  }
  await vi.waitFor(() => expect(h.refresh).toHaveBeenCalledOnce());
  expect(h.publish).toHaveBeenLastCalledWith({ uri: h.uri, diagnostics: [] });
});

it('logs errors without stat fallback or suspension and reload recovers missed changes', async () => {
  const h = await fixture();
  await h.project.reload();
  state.watchers[0]!.onError(new Error('ENOSPC'));
  expect(h.warn).toHaveBeenCalledWith(expect.stringContaining('restart'));
  expect(state.watchers[0]!.close).not.toHaveBeenCalled();
  await writeFile(h.path, duplicate);
  expect(await h.project.diagnosticReport(h.uri)).toMatchObject({ items: [] });
  await h.project.reload();
  expect(await h.project.diagnosticReport(h.uri)).toMatchObject({
    items: expect.arrayContaining([expect.objectContaining({ code: 'PSL_DUPLICATE_DECLARATION' })]),
  });
});
it('preserves overlays and rejects callbacks from superseded generations', async () => {
  const h = await fixture();
  await h.project.reload();
  const old = state.watchers[0]!;
  h.documents.open({ uri: h.uri, text: alpha, version: 1, languageId: 'prisma' });
  await writeFile(h.path, duplicate);
  await h.project.reload();
  h.publish.mockClear();
  expect(old.close).not.toHaveBeenCalled();
  old.onReady();
  state.watchers[1]!.onReady();
  old.onChange(h.config);
  await vi.waitFor(() => expect(h.publish).toHaveBeenCalledOnce());
  expect(h.documents.text(h.uri)).toBe(alpha);
  expect(state.watchers).toHaveLength(2);
  expect(old.close).toHaveBeenCalledOnce();
});
it('keeps owner-directed watching after the last document closes, including external inputs', async () => {
  const h = await fixture();
  const external = await fixture();
  state.inputs = [external.path];
  await h.project.reload();
  h.documents.open({ uri: external.uri, text: alpha, version: 1, languageId: 'prisma' });
  h.documents.close(external.uri);
  h.project.documentClosed(external.uri);
  expect(state.watchers[0]!.close).not.toHaveBeenCalled();
  await writeFile(external.path, duplicate);
  state.watchers[0]!.onChange(external.path);
  await vi.waitFor(() =>
    expect(h.publish).toHaveBeenLastCalledWith({
      uri: external.uri,
      diagnostics: expect.arrayContaining([
        expect.objectContaining({ code: 'PSL_DUPLICATE_DECLARATION' }),
      ]),
    }),
  );
});
it('disposes superseded client registration without replacing the current backend', async () => {
  const h = await fixture(true);
  let resolve!: (value: { dispose: () => void; disposeSingle: () => boolean }) => void;
  h.register.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  await h.project.reload();
  h.register.mockRejectedValueOnce(new Error('replacement failed'));
  await h.project.reload();
  await vi.waitFor(() => expect(state.watchers).toHaveLength(1));
  const dispose = vi.fn();
  resolve({ dispose, disposeSingle: () => true });
  await vi.waitFor(() => expect(dispose).toHaveBeenCalledOnce());
  expect(state.watchers).toHaveLength(1);
  expect(state.watchers[0]!.close).not.toHaveBeenCalled();
});
it('awaits asynchronous close and rejects events after disposal', async () => {
  const h = await fixture();
  await h.project.reload();
  let release!: () => void;
  state.watchers[0]!.close.mockImplementation(
    () =>
      new Promise<void>((done) => {
        release = done;
      }),
  );
  let closed = false;
  const pending = h.project.dispose().then(() => {
    closed = true;
  });
  await Promise.resolve();
  expect(closed).toBe(false);
  h.publish.mockClear();
  state.watchers[0]!.onReady();
  release();
  await pending;
  expect(h.publish).not.toHaveBeenCalled();
});
