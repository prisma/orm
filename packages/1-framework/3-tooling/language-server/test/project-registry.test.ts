import { describe, expect, it, vi } from 'vitest';
import { type Connection, FileChangeType } from 'vscode-languageserver';
import type { ConfigResolution } from '../src/config-resolution';
import { DocumentStore } from '../src/document-store';
import { Project } from '../src/project';
import { ProjectRegistry } from '../src/project-registry';

vi.mock('../src/internal-watcher', () => ({
  InternalWatcher: class {
    async close() {}
  },
}));

const mocks = vi.hoisted(() => ({
  discover: vi.fn<(path: string) => Promise<string | undefined>>(),
  load: vi.fn<() => Promise<ConfigResolution>>(),
}));
vi.mock('@internal/config-loader', async (original) => ({
  ...(await original<typeof import('@internal/config-loader')>()),
  findNearestConfigPathForFile: mocks.discover,
}));
vi.mock('../src/config-resolution', async (original) => ({
  ...(await original<typeof import('../src/config-resolution')>()),
  resolveConfigInputs: mocks.load,
}));

vi.mock('node:url', async (original) => {
  const actual = await original<typeof import('node:url')>();
  return {
    ...actual,
    fileURLToPath: (url: string | URL, options?: { windows?: boolean }) =>
      actual.fileURLToPath(url, options ?? { windows: process.platform === 'win32' }),
    pathToFileURL: (path: string, options?: { windows?: boolean }) =>
      actual.pathToFileURL(path, options ?? { windows: process.platform === 'win32' }),
  };
});

const configPath = '/project/prisma.config.ts';
const uri = 'file:///project/schema.prisma';

function setup() {
  mocks.discover.mockReset().mockResolvedValue(configPath);
  mocks.load.mockReset().mockResolvedValue({
    inputs: { includes: () => false, uris: () => [] },
    schemaInputConfig: {},
    controlStack: { scalarTypes: [], pslBlockDescriptors: {} },
  });
  const documents = new DocumentStore();
  const connection = {
    sendDiagnostics: vi.fn().mockResolvedValue(undefined),
    console: { error: vi.fn() },
  } as unknown as Connection;
  const registry = new ProjectRegistry(documents, connection);
  documents.open({ uri, languageId: 'prisma', version: 1, text: '// use prisma-8\n' });
  return { registry, documents };
}

describe('ProjectRegistry', () => {
  it('normalizes document associations and retains the same project after the last close', async () => {
    const { registry, documents } = setup();
    const project = await registry.nearestProject(uri);
    expect(project).toBeInstanceOf(Project);
    expect(registry.associatedProject('file:///project/%73chema.prisma')).toBe(project);
    documents.close(uri);
    registry.documentClosed(uri);
    expect(registry.associatedProject(uri)).toBeUndefined();
    expect(await registry.nearestProject(uri)).toBe(project);
    expect(mocks.discover).toHaveBeenCalledTimes(2);
  });

  it('removes a non-member association without replacing its nearest project', async () => {
    const { registry } = setup();
    const project = await registry.nearestProject(uri);
    expect(await project?.foldingRanges(uri)).toEqual([]);
    expect(registry.associatedProject(uri)).toBeUndefined();
    expect(await registry.nearestProject(uri)).toBe(project);
    expect(mocks.load).toHaveBeenCalledOnce();
  });

  it('clears open associations on a failed first load and retries on the same project', async () => {
    const { registry } = setup();
    const project = await registry.nearestProject(uri);
    mocks.load.mockRejectedValueOnce(new Error('broken config'));
    await project?.diagnosticReport(uri);
    expect(registry.associatedProject(uri)).toBeUndefined();
    expect(await registry.nearestProject(uri)).toBe(project);
    await project?.diagnosticReport(uri);
    expect(mocks.load).toHaveBeenCalledTimes(2);
    expect(project?.artifacts).toBeDefined();
  });

  it('does not create a project after disposal while discovery is pending', async () => {
    const { registry } = setup();
    let resolve!: (config: string) => void;
    mocks.discover.mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const pending = registry.nearestProject(uri);
    await registry.dispose();
    resolve(configPath);
    expect(await pending).toBeUndefined();
    expect(registry.associatedProject(uri)).toBeUndefined();
  });

  it.each([
    [
      'D:/Project Files/prisma.config.ts',
      'file:///d:/PROJECT%20FILES/prisma.config.ts',
      'file:///d:/other/prisma.config.ts',
    ],
    [
      '//SERVER/Share/Project/prisma.config.ts',
      'file://server/share/PROJECT/prisma.config.ts',
      'file://server/share/other/prisma.config.ts',
    ],
  ])(
    'routes Windows config identity to its owner only: %s',
    async (ownerPath, eventUri, unrelatedUri) => {
      const { registry } = setup();
      const platform = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
      mocks.discover.mockResolvedValue(ownerPath);
      const route = vi.spyOn(Project.prototype, 'filesChanged');
      try {
        const project = await registry.nearestProject(
          eventUri.replace('prisma.config.ts', 'schema.prisma'),
        );
        expect(project).toBeInstanceOf(Project);
        await project?.reload();
        registry.watchedFilesChanged([
          { uri: eventUri, type: FileChangeType.Changed },
          { uri: unrelatedUri, type: FileChangeType.Changed },
        ]);
        expect(route).toHaveBeenCalledExactlyOnceWith([eventUri]);
        await vi.waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(2));
        expect(mocks.load).toHaveBeenLastCalledWith(ownerPath, expect.any(Function));
      } finally {
        await registry.dispose();
        route.mockRestore();
        platform.mockRestore();
      }
    },
  );

  it('routes client notifications to existing owners without asynchronous rediscovery', async () => {
    const { registry } = setup();
    await registry.nearestProject(uri);
    const route = vi.spyOn(Project.prototype, 'filesChanged').mockImplementation(() => {});
    try {
      const secondUri = 'file:///external/second.prisma';
      registry.watchedFilesChanged([{ uri, type: FileChangeType.Changed }]);
      registry.watchedFilesChanged([{ uri: secondUri, type: FileChangeType.Deleted }]);
      expect(route.mock.calls).toEqual([[[uri]], [[secondUri]]]);
      expect(mocks.discover).toHaveBeenCalledOnce();
    } finally {
      route.mockRestore();
      await registry.dispose();
    }
  });
});
