import { pathToFileURL } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type { Connection } from 'vscode-languageserver';
import type { ConfigResolution } from '../src/config-resolution';
import { DocumentStore } from '../src/document-store';
import { Project } from '../src/project';
import { resolveSchemaInputs } from '../src/schema-inputs';

const load = vi.hoisted(() => vi.fn<() => Promise<ConfigResolution>>());
vi.mock('../src/config-resolution', async (original) => ({
  ...(await original<typeof import('../src/config-resolution')>()),
  resolveConfigInputs: load,
}));

function pendingResolution() {
  let resolve!: (value: ConfigResolution) => void;
  const promise = new Promise<ConfigResolution>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function setup(pullDiagnostics = false) {
  const resolution: ConfigResolution = {
    inputs: await resolveSchemaInputs({}, () => undefined),
    schemaInputConfig: {},
    controlStack: { scalarTypes: ['Int'], pslBlockDescriptors: {} },
  };
  load.mockReset().mockResolvedValue(resolution);
  const sendDiagnostics = vi.fn();
  const unmanage = vi.fn();
  let sequence = 0;
  const documents = new DocumentStore();
  const project = new Project('/project/prisma.config.ts', {
    documents,
    connection: { sendDiagnostics, console: { error: vi.fn() } } as unknown as Connection,
    pullDiagnostics,
    watchedFilesRegistration: false,
    nextSequence: () => ++sequence,
    unmanage,
  });
  return { project, documents, resolution, sendDiagnostics, unmanage };
}

describe('Project lifecycle', () => {
  it('finishes an earlier read with its own resolution while the next load is pending', async () => {
    const { project, documents, resolution } = await setup();
    const uri = 'file:///project/schema.prisma';
    documents.open({
      uri,
      languageId: 'prisma',
      version: 1,
      text: '// use prisma-8\nmodel User {\n id Int\n}\n',
    });
    const initial = pendingResolution();
    const next = pendingResolution();
    load.mockImplementationOnce(() => initial.promise).mockImplementationOnce(() => next.promise);
    const read = project.foldingRanges(uri);
    const reload = project.reload();
    initial.resolve({
      ...resolution,
      inputs: { includes: (candidate) => candidate === uri, uris: () => [uri] },
    });
    expect((await read).length).toBeGreaterThan(0);
    next.resolve(resolution);
    await reload;
    expect(await project.foldingRanges(uri)).toEqual([]);
  });

  it('keeps its identity and last-good analysis across a failed reload and recovery', async () => {
    const { project, resolution, sendDiagnostics, unmanage } = await setup();
    await project.diagnosticReport('file:///project/schema.prisma');
    const artifacts = project.artifacts;
    load.mockRejectedValueOnce(new Error('broken config'));
    await project.reload();
    expect(project.artifacts).toBe(artifacts);
    expect(unmanage).not.toHaveBeenCalled();
    expect(sendDiagnostics).toHaveBeenLastCalledWith(
      expect.objectContaining({
        diagnostics: [expect.objectContaining({ message: 'broken config' })],
      }),
    );
    load.mockResolvedValueOnce({
      ...resolution,
      controlStack: { scalarTypes: ['String'], pslBlockDescriptors: {} },
    });
    await project.reload();
    expect(project.artifacts).not.toBe(artifacts);
    expect(sendDiagnostics).toHaveBeenLastCalledWith({
      uri: pathToFileURL(project.configPath).toString(),
      diagnostics: [],
    });
  });

  it('retries a failed first load on the same project', async () => {
    const { project, unmanage } = await setup();
    load.mockRejectedValueOnce(new Error('first load failed'));
    expect(await project.diagnosticReport('file:///project/schema.prisma')).toEqual({
      kind: 'full',
      items: [],
    });
    expect(project.artifacts).toBeUndefined();
    expect(unmanage).toHaveBeenCalledOnce();
    await project.diagnosticReport('file:///project/schema.prisma');
    expect(project.artifacts).toBeDefined();
    expect(load).toHaveBeenCalledTimes(2);
  });
});
