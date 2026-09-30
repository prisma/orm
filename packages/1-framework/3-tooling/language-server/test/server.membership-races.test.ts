import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { PassThrough } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { join } from 'pathe';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createConnection,
  StreamMessageReader,
  StreamMessageWriter,
} from 'vscode-languageserver/node';
import type { ConfigResolution } from '../src/config-resolution';
import { DocumentStore } from '../src/document-store';
import { Project } from '../src/project';
import * as schemaInputs from '../src/schema-inputs';

const load = vi.hoisted(() => vi.fn<() => Promise<ConfigResolution>>());
vi.mock('../src/config-resolution', async (original) => ({
  ...(await original<typeof import('../src/config-resolution')>()),
  resolveConfigInputs: load,
}));
vi.mock('../src/internal-watcher', () => ({
  InternalWatcher: class {
    async close() {}
  },
}));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const cleanups: (() => Promise<void>)[] = [];
const text = (name: string) => `// use prisma-8\nmodel ${name} {\n id Int\n}\n`;
const uri = (path: string) => pathToFileURL(path).toString();
async function setup(pull: boolean) {
  const dir = await mkdtemp(join(tmpdir(), 'membership-races-'));
  const first = join(dir, 'first.prisma');
  const second = join(dir, 'second.prisma');
  const config = join(dir, 'prisma.config.ts');
  await writeFile(first, text('First'));
  await writeFile(second, text('Second'));
  const documents = new DocumentStore();
  const resolveInputs = schemaInputs.resolveSchemaInputs;
  async function resolution(paths = [join(dir, '*.prisma')]): Promise<ConfigResolution> {
    const schemaInputConfig = { contract: { source: { format: 'psl', inputs: paths } } };
    return {
      schemaInputConfig,
      inputs: await resolveInputs(schemaInputConfig, (candidate) => documents.text(candidate)),
      controlStack: { scalarTypes: ['Int'], pslBlockDescriptors: {} },
    };
  }
  const initial = await resolution();
  load.mockResolvedValue(initial);
  const input = new PassThrough();
  const output = new PassThrough();
  const connection = createConnection(
    new StreamMessageReader(input),
    new StreamMessageWriter(output),
  );
  const publish = vi.spyOn(connection, 'sendDiagnostics').mockResolvedValue(undefined);
  const refresh = vi.fn();
  let sequence = 0;
  const nextSequence = () => ++sequence;
  const project = new Project(config, {
    documents,
    connection,
    pullDiagnostics: pull,
    watchedFilesRegistration: false,
    nextSequence,
    unmanage: vi.fn(),
    refreshDiagnostics: refresh,
  });
  cleanups.push(async () => {
    await project.dispose();
    connection.dispose();
    input.destroy();
    output.destroy();
    await rm(dir, { recursive: true, force: true });
  });
  await project.reload();
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
    load.mockImplementationOnce(() => {
      entered.resolve();
      return result.promise;
    });
    return { entered: entered.promise, ...result };
  }
  return {
    first,
    second,
    config,
    initial,
    resolution,
    project,
    documents,
    publish,
    refresh,
    nextSequence,
    pauseExpansion,
    pauseLoad,
  };
}
afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup();
  cleanups.length = 0;
  load.mockReset();
  vi.restoreAllMocks();
});

describe.each([false, true])('membership refresh ordering (pull=%s)', (pull) => {
  it.each(['pending', 'successful', 'failed'] as const)(
    'discards a refresh across a %s reload',
    async (state) => {
      const h = await setup(pull);
      const expansion = h.pauseExpansion();
      const member = h.project.refreshMembership(uri(h.first), h.nextSequence());
      await expansion.entered;
      const loading = h.pauseLoad();
      const reload = h.project.reload();
      await loading.entered;
      const replacement = await h.resolution([h.second]);
      if (state === 'successful') loading.resolve(replacement);
      if (state === 'failed') loading.reject(new Error('broken config'));
      if (state !== 'pending') await reload;
      const before = h.publish.mock.calls.length;
      expansion.resolve(h.initial.inputs);
      expect(await member).toBe(false);
      expect(h.publish.mock.calls).toHaveLength(before);
      if (state === 'pending') {
        loading.resolve(replacement);
        await reload;
      }
      if (state !== 'failed') expect(h.project.artifacts?.document(uri(h.first))).toBeUndefined();
    },
  );
  it('rejects an earlier refresh that resolves after a newer one', async () => {
    const h = await setup(pull);
    const expansion = h.pauseExpansion();
    const older = h.project.refreshMembership(uri(h.first), h.nextSequence());
    await expansion.entered;
    const next = await h.resolution([h.first]);
    vi.spyOn(schemaInputs, 'resolveSchemaInputs').mockResolvedValueOnce(next.inputs);
    expect(await h.project.refreshMembership(uri(h.second), h.nextSequence())).toBe(true);
    expansion.resolve(h.initial.inputs);
    expect(await older).toBe(false);
    expect(h.project.artifacts?.document(uri(h.second))).toBeUndefined();
  });
  it('performs a later pass for changes arriving during expansion', async () => {
    const h = await setup(pull);
    const expansion = h.pauseExpansion();
    h.project.filesChanged([uri(h.first)]);
    await expansion.entered;
    await writeFile(h.second, text('Updated'));
    h.project.filesChanged([uri(h.second)]);
    expansion.resolve(h.initial.inputs);
    await vi.waitFor(() => expect(h.refresh).toHaveBeenCalledTimes(2));
    expect(h.project.artifacts?.document(uri(h.second))?.text).toBe(text('Updated'));
  });
  it('retains changes arriving during a reload for a subsequent pass', async () => {
    const h = await setup(pull);
    const loading = h.pauseLoad();
    h.project.filesChanged([uri(h.config)]);
    await loading.entered;
    await writeFile(h.second, text('Updated'));
    h.project.filesChanged([uri(h.second)]);
    loading.resolve(h.initial);
    await vi.waitFor(() => expect(h.refresh).toHaveBeenCalledTimes(2));
    expect(h.project.artifacts?.document(uri(h.second))?.text).toBe(text('Updated'));
  });
  it('rejects a resolution after disposal', async () => {
    const h = await setup(pull);
    const expansion = h.pauseExpansion();
    const pending = h.project.refreshMembership(uri(h.first), h.nextSequence());
    await expansion.entered;
    await h.project.dispose();
    h.publish.mockClear();
    expansion.resolve(h.initial.inputs);
    expect(await pending).toBe(false);
    expect(h.publish).not.toHaveBeenCalled();
  });
});
