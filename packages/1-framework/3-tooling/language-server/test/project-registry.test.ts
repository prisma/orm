import { describe, expect, it, vi } from 'vitest';
import { type Connection, FileChangeType } from 'vscode-languageserver';
import type { ConfigResolution } from '../src/config-resolution';
import { DocumentStore } from '../src/document-store';
import { Project } from '../src/project';
import { ProjectRegistry } from '../src/project-registry';

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

  it('allocates watcher arrival order before asynchronous config discovery', async () => {
    const { registry } = setup();
    const project = await registry.nearestProject(uri);
    await project?.diagnosticReport(uri);
    let finishDiscovery!: (config: string) => void;
    const discovery = new Promise<string>((resolve) => {
      finishDiscovery = resolve;
    });
    mocks.discover.mockImplementationOnce(() => discovery);
    const refresh = vi.spyOn(Project.prototype, 'refreshMembership').mockResolvedValue(true);
    try {
      const first = registry.watchedFilesChanged([{ uri, type: FileChangeType.Changed }]);
      const secondUri = 'file:///project/second.prisma';
      await registry.watchedFilesChanged([{ uri: secondUri, type: FileChangeType.Changed }]);
      finishDiscovery(configPath);
      await first;
      expect(refresh.mock.calls).toEqual([
        [secondUri, 3],
        [uri, 2],
      ]);
    } finally {
      refresh.mockRestore();
    }
  });
});
