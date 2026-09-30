import { PassThrough } from 'node:stream';
import { afterEach, expect, it, vi } from 'vitest';
import {
  createConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from 'vscode-languageserver/node';
import { DocumentStore } from '../src/document-store';
import { Project } from '../src/project';

const load = vi.hoisted(() =>
  vi.fn(async () => ({
    inputs: { includes: () => false, uris: () => [] },
    schemaInputConfig: {},
    controlStack: { scalarTypes: [], pslBlockDescriptors: {} },
  })),
);
vi.mock('../src/config-resolution', async (original) => ({
  ...(await original<typeof import('../src/config-resolution')>()),
  resolveConfigInputs: load,
}));
vi.mock('../src/internal-watcher', () => ({
  InternalWatcher: class {
    async close() {}
  },
}));
vi.mock('node:url', async (original) => {
  const actual = await original<typeof import('node:url')>();
  return {
    ...actual,
    pathToFileURL: (path: string) =>
      actual.pathToFileURL(path, { windows: process.platform === 'win32' }),
  };
});
afterEach(() => {
  vi.restoreAllMocks();
  load.mockClear();
});

it.each([
  ['D:\\Project Files\\prisma.config.ts', 'file:///d:/project%20files/PRISMA.CONFIG.TS'],
  ['\\\\SERVER\\Share\\Project\\prisma.config.ts', 'file://server/share/PROJECT/PRISMA.CONFIG.TS'],
])('reloads a Windows config by canonical identity: %s', async (configPath, eventUri) => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
  const input = new PassThrough();
  const output = new PassThrough();
  const connection = createConnection(
    new StreamMessageReader(input),
    new StreamMessageWriter(output),
  );
  vi.spyOn(connection, 'sendDiagnostics').mockResolvedValue(undefined);
  let sequence = 0;
  const project = new Project(configPath, {
    documents: new DocumentStore(),
    connection,
    pullDiagnostics: false,
    watchedFilesRegistration: false,
    nextSequence: () => ++sequence,
    unmanage: vi.fn(),
    refreshDiagnostics: vi.fn(),
  });
  try {
    await project.reload();
    project.filesChanged([eventUri]);
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    expect(load).toHaveBeenLastCalledWith(configPath, expect.any(Function));
  } finally {
    await project.dispose();
    connection.dispose();
    input.destroy();
    output.destroy();
  }
});
