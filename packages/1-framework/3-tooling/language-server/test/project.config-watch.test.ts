import { mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { PassThrough } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { timeouts } from '@repo/test-utils';
import { FSWatcher } from 'chokidar';
import { expect, it, vi } from 'vitest';
import {
  createConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from 'vscode-languageserver/node';
import { DocumentStore } from '../src/document-store';
import { guardedConnection } from '../src/guarded-connection';
import { Project } from '../src/project';
import { resolveSchemaInputs } from '../src/schema-inputs';

const loads = vi.hoisted(() => ({
  revisions: [] as string[],
  pause: async (_revision: string) => {},
}));
vi.mock('../src/config-resolution', async (original) => ({
  ...(await original<typeof import('../src/config-resolution')>()),
  resolveConfigInputs: async (
    configPath: string,
    readText: (uri: string) => string | undefined,
  ) => {
    const revision = await readFile(configPath, 'utf8');
    loads.revisions.push(revision);
    await loads.pause(revision);
    const schemaInputConfig = {
      contract: {
        source: { format: 'psl', inputs: [join(dirname(configPath), `${revision}.prisma`)] },
      },
    };
    return {
      schemaInputConfig,
      inputs: await resolveSchemaInputs(schemaInputConfig, readText),
      controlStack: { scalarTypes: ['Int'], pslBlockDescriptors: {} },
    };
  },
}));
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { resolve, promise };
}
it('observes atomic config replacements throughout consecutive asynchronous reloads', {
  timeout: timeouts.databaseOperation,
}, async () => {
  const dir = await mkdtemp(join(await realpath(tmpdir()), 'config-watch-reload-'));
  const config = join(dir, 'prisma.config.ts');
  await writeFile(config, 'first');
  const text = '// use prisma-8\nmodel User {\n id Int\n}\n';
  for (const revision of ['first', 'second', 'third', 'fourth'])
    await writeFile(join(dir, `${revision}.prisma`), text);
  const second = deferred();
  const third = deferred();
  loads.revisions.length = 0;
  loads.pause = async (revision) => {
    if (revision === 'second') await second.promise;
    if (revision === 'third') await third.promise;
  };
  const input = new PassThrough();
  const output = new PassThrough();
  const connection = createConnection(
    new StreamMessageReader(input),
    new StreamMessageWriter(output),
  );
  vi.spyOn(connection, 'sendDiagnostics').mockResolvedValue(undefined);
  const refresh = vi.fn();
  const emit = vi.spyOn(FSWatcher.prototype, 'emit');
  let sequence = 0;
  const project = new Project(config, {
    documents: new DocumentStore(),
    connection: guardedConnection(connection),
    pullDiagnostics: false,
    watchedFilesRegistration: false,
    nextSequence: () => ++sequence,
    unmanage: vi.fn(),
    refreshDiagnostics: refresh,
  });
  async function replace(revision: string) {
    emit.mockClear();
    const temporary = join(dir, 'config.tmp');
    await writeFile(temporary, revision);
    await rename(temporary, config);
    await vi.waitFor(
      () =>
        expect(
          emit.mock.calls.some(([event, path]) => event === 'change' && path === config),
          revision,
        ).toBe(true),
      { timeout: timeouts.vitestPackageDefault },
    );
  }
  try {
    await project.reload();
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce(), {
      timeout: timeouts.vitestPackageDefault,
    });
    await replace('second');
    await vi.waitFor(() => expect(loads.revisions).toEqual(['first', 'second']));
    const editorRequest = project.foldingRanges(
      pathToFileURL(join(dir, 'second.prisma')).toString(),
    );
    await replace('third');
    second.resolve();
    expect((await editorRequest).length).toBeGreaterThan(0);
    await vi.waitFor(() => expect(loads.revisions).toEqual(['first', 'second', 'third']));
    await replace('fourth');
    third.resolve();
    const fourthUri = pathToFileURL(join(dir, 'fourth.prisma')).toString();
    await vi.waitFor(() => expect(project.artifacts?.document(fourthUri)?.text).toBe(text), {
      timeout: timeouts.vitestPackageDefault,
    });
    expect(loads.revisions).toEqual(['first', 'second', 'third', 'fourth']);
  } finally {
    second.resolve();
    third.resolve();
    await project.dispose();
    connection.dispose();
    input.destroy();
    output.destroy();
    await rm(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  }
});
