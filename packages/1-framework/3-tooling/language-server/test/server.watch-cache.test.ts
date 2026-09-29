import { statSync } from 'node:fs';
import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { PassThrough } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { timeouts } from '@repo/test-utils';
import { dirname, join } from 'pathe';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createConnection,
  DidChangeWatchedFilesNotification,
  type Disposable,
  DocumentDiagnosticRequest,
  FileChangeType,
  InitializeRequest,
  StreamMessageReader,
  StreamMessageWriter,
} from 'vscode-languageserver/node';
import { DocumentStore } from '../src/document-store';
import * as schemaInputs from '../src/schema-inputs';
import { resolveSchemaInputs } from '../src/schema-inputs';
import { createServer } from '../src/server';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, statSync: vi.fn(actual.statSync) };
});

vi.mock('@internal/config-loader', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@internal/config-loader')>();
  return {
    ...actual,
    findNearestConfigPathForFile: async (path: string) => join(dirname(path), 'prisma.config.ts'),
  };
});

const inputOverrides = vi.hoisted(() => new Map<string, readonly string[]>());

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
            inputs: inputOverrides.get(configPath) ?? [join(dirname(configPath), '*.prisma')],
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
const bravo = '// use prisma-8\nmodel Bravo {\n id Int\n}\n';

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'watch-cache-'));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'schema.prisma');
  await writeFile(path, alpha);
  return { path, uri: pathToFileURL(path).toString(), config: join(dir, 'prisma.config.ts'), dir };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function harness(watched = true) {
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
  const registrations: ReturnType<typeof deferred<Disposable>>[] = [];
  vi.spyOn(connection.client, 'register').mockImplementation((() => {
    const pending = deferred<Disposable>();
    registrations.push(pending);
    return pending.promise;
  }) as unknown as typeof connection.client.register);
  const coverage = vi.spyOn(DocumentStore.prototype, 'setWatchCoverage');
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
      textDocument: { diagnostic: { relatedDocumentSupport: true } },
      workspace: { didChangeWatchedFiles: { dynamicRegistration: watched } },
    },
  });
  return {
    registrations,
    register: vi.mocked(connection.client.register),
    coverage,
    read: (uri: string) =>
      client.sendRequest(DocumentDiagnosticRequest.type, { textDocument: { uri } }),
    changed: (path: string) =>
      client.sendNotification(DidChangeWatchedFilesNotification.type, {
        changes: [{ uri: pathToFileURL(path).toString(), type: FileChangeType.Changed }],
      }),
    async accept(index: number, config: string) {
      const dispose = vi.fn();
      registrations[index]?.resolve({ dispose });
      await vi.waitFor(() =>
        expect(coverage).toHaveBeenCalledWith(config, expect.arrayContaining([expect.any(String)])),
      );
      return dispose;
    },
  };
}

function fileStats(path: string) {
  return vi.mocked(statSync).mock.calls.filter(([candidate]) => candidate === path);
}

afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup();
  cleanups.length = 0;
  inputOverrides.clear();
  vi.restoreAllMocks();
  vi.mocked(statSync).mockClear();
});

describe('schema watcher disk caching', { timeout: timeouts.databaseOperation }, () => {
  it('registers POSIX escapes unchanged without granting watcher cache trust', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
    const file = await fixture();
    const pattern = `${file.dir}/\\[draft\\].prisma`;
    inputOverrides.set(file.config, [file.path, pattern]);
    const h = await harness();
    await h.read(file.uri);
    expect(h.register).toHaveBeenCalledWith(DidChangeWatchedFilesNotification.type, {
      watchers: [{ globPattern: file.path }, { globPattern: pattern }],
    });
    h.registrations[0]?.resolve({ dispose: vi.fn() });
    await h.read(file.uri);
    vi.mocked(statSync).mockClear();
    await h.read(file.uri);
    expect(fileStats(file.path).length).toBeGreaterThan(0);
    expect(h.coverage.mock.calls.flatMap(([, uris]) => Array.from(uris))).toEqual([]);
  });

  it('trusts only registered projects and invalidates watched disk edits', async () => {
    const one = await fixture();
    const two = await fixture();
    const h = await harness();
    await h.read(one.uri);
    await h.read(two.uri);
    await h.accept(0, one.config);
    await h.read(one.uri);
    vi.mocked(statSync).mockClear();
    await h.read(one.uri);
    expect(fileStats(one.path)).toHaveLength(0);
    await h.read(two.uri);
    expect(fileStats(two.path).length).toBeGreaterThan(0);
    await writeFile(one.path, `${alpha}\nmodel Alpha {\n id Int\n}\n`);
    await h.changed(one.path);
    await vi.waitFor(async () => {
      const report = await h.read(one.uri);
      expect(report).toMatchObject({
        items: expect.arrayContaining([
          expect.objectContaining({ code: 'PSL_DUPLICATE_DECLARATION' }),
        ]),
      });
    });
  });

  it.each(['unavailable', 'pending', 'failed'] as const)(
    'revalidates when registration is %s',
    async (state) => {
      const file = await fixture();
      const h = await harness(state !== 'unavailable');
      await h.read(file.uri);
      if (state === 'failed') h.registrations[0]?.reject(new Error('registration failed'));
      vi.mocked(statSync).mockClear();
      await h.read(file.uri);
      expect(fileStats(file.path).length).toBeGreaterThan(0);
      await writeFile(file.path, `${alpha}\nmodel Alpha {\n id Int\n}\n`);
      expect(await h.read(file.uri)).toMatchObject({
        items: expect.arrayContaining([
          expect.objectContaining({ code: 'PSL_DUPLICATE_DECLARATION' }),
        ]),
      });
    },
  );

  it('keeps stat revalidation for registered extglobs before and after membership refresh', async () => {
    const file = await fixture();
    const post = join(file.dir, 'post.prisma');
    await writeFile(post, bravo);
    const inputs = [join(file.dir, '@(schema|post).prisma'), file.path];
    inputOverrides.set(file.config, inputs);
    const expanded = await resolveSchemaInputs(
      { contract: { source: { format: 'psl', inputs } } },
      () => alpha,
    );
    expect(Array.from(expanded.uris()).sort()).toEqual(
      [file.uri, pathToFileURL(post).toString()].sort(),
    );
    const h = await harness();
    await h.read(file.uri);
    expect(h.registrations).toHaveLength(1);
    h.registrations[0]?.resolve({ dispose: vi.fn() });
    await h.read(file.uri);
    vi.mocked(statSync).mockClear();
    await h.read(file.uri);
    expect(fileStats(file.path).length).toBeGreaterThan(0);
    await writeFile(file.path, `${alpha}\nmodel Alpha {\n id Int\n}\n`);
    expect(await h.read(file.uri)).toMatchObject({
      items: expect.arrayContaining([
        expect.objectContaining({ code: 'PSL_DUPLICATE_DECLARATION' }),
      ]),
    });
    const read = vi.spyOn(DocumentStore.prototype, 'text');
    await h.changed(post);
    await vi.waitFor(() => expect(read).toHaveBeenCalledWith(pathToFileURL(post).toString()));
    vi.mocked(statSync).mockClear();
    await h.read(file.uri);
    expect(fileStats(file.path).length).toBeGreaterThan(0);
    await writeFile(file.path, alpha);
    expect(await h.read(file.uri)).toMatchObject({ items: [] });
    expect(h.coverage.mock.calls.flatMap(([, uris]) => Array.from(uris))).toEqual([]);
  });

  it('evicts disk text read during pending registration before trusting it', async () => {
    const file = await fixture();
    const h = await harness();
    const pinned = new Date('2020-01-01T00:00:00Z');
    await utimes(file.path, pinned, pinned);
    await h.read(file.uri);
    await writeFile(file.path, bravo);
    await utimes(file.path, pinned, pinned);
    await h.accept(0, file.config);
    const read = vi.spyOn(DocumentStore.prototype, 'text');
    await h.read(file.uri);
    expect(read.mock.results.some((result) => result.value === bravo)).toBe(true);
  });

  it('rejects stale registration success while its replacement is pending or failed', async () => {
    const file = await fixture();
    const h = await harness();
    await h.read(file.uri);
    await h.changed(file.config);
    await vi.waitFor(() => expect(h.registrations).toHaveLength(2));
    const dispose = vi.fn();
    h.registrations[0]?.resolve({ dispose });
    await vi.waitFor(() => expect(dispose).toHaveBeenCalledOnce());
    vi.mocked(statSync).mockClear();
    await h.read(file.uri);
    expect(fileStats(file.path).length).toBeGreaterThan(0);
    h.registrations[1]?.reject(new Error('replacement failed'));
    vi.mocked(statSync).mockClear();
    await h.read(file.uri);
    expect(fileStats(file.path).length).toBeGreaterThan(0);
    expect(h.coverage.mock.calls.some(([, uris]) => Array.from(uris).length > 0)).toBe(false);
  });

  it('does not trust old membership refreshed across a config replacement', async () => {
    const file = await fixture();
    const h = await harness();
    await h.read(file.uri);
    await h.accept(0, file.config);
    const entered = deferred<void>();
    const release = deferred<void>();
    const resolveInputs = schemaInputs.resolveSchemaInputs;
    vi.spyOn(schemaInputs, 'resolveSchemaInputs').mockImplementationOnce(async (...args) => {
      const inputs = await resolveInputs(...args);
      entered.resolve();
      await release.promise;
      return inputs;
    });
    await h.changed(file.path);
    await entered.promise;
    const replacement = join(file.dir, 'replacement.prisma');
    await writeFile(replacement, bravo);
    inputOverrides.set(file.config, [replacement]);
    await h.changed(file.config);
    await vi.waitFor(() => expect(h.registrations).toHaveLength(2));
    h.coverage.mockClear();
    await h.accept(1, file.config);
    release.resolve();
    await h.read(file.uri);
    await h.changed(file.path);
    await h.read(file.uri);
    vi.mocked(statSync).mockClear();
    await h.read(file.uri);
    expect(fileStats(file.path).length).toBeGreaterThan(0);
    expect(h.coverage.mock.calls.flatMap(([, uris]) => Array.from(uris))).not.toContain(file.uri);
  });

  it('removes coverage when a config no longer declares inputs', async () => {
    const file = await fixture();
    const h = await harness();
    await h.read(file.uri);
    const dispose = await h.accept(0, file.config);
    h.coverage.mockClear();
    inputOverrides.set(file.config, []);
    await h.changed(file.config);
    await vi.waitFor(() => expect(dispose).toHaveBeenCalledOnce());
    expect(await h.read(file.uri)).toMatchObject({ items: [] });
    expect(h.registrations).toHaveLength(1);
    expect(h.coverage.mock.calls).toEqual([
      [file.config, []],
      [file.config, []],
    ]);
  });

  it('stops trusting replacement gaps and refreshes newly discovered coverage', async () => {
    const file = await fixture();
    const h = await harness();
    await h.read(file.uri);
    const dispose = await h.accept(0, file.config);
    await h.read(file.uri);
    await h.changed(file.config);
    await vi.waitFor(() => expect(h.registrations).toHaveLength(2));
    expect(dispose).toHaveBeenCalledOnce();
    vi.mocked(statSync).mockClear();
    await h.read(file.uri);
    expect(fileStats(file.path).length).toBeGreaterThan(0);
    const added = join(file.dir, 'added.prisma');
    await writeFile(added, bravo);
    const read = vi.spyOn(DocumentStore.prototype, 'text');
    await h.changed(added);
    await vi.waitFor(() => expect(read).toHaveBeenCalledWith(pathToFileURL(added).toString()));
    h.coverage.mockClear();
    await h.accept(1, file.config);
    await h.read(file.uri);
    vi.mocked(statSync).mockClear();
    await h.read(file.uri);
    expect(fileStats(added)).toHaveLength(0);
    expect(h.coverage).toHaveBeenCalledWith(
      file.config,
      expect.arrayContaining([pathToFileURL(added).toString()]),
    );
    const later = join(file.dir, 'later.prisma');
    await writeFile(later, '// use prisma-8\nmodel Later {\n id Int\n}\n');
    await h.changed(later);
    await vi.waitFor(() =>
      expect(h.coverage).toHaveBeenCalledWith(
        file.config,
        expect.arrayContaining([pathToFileURL(later).toString()]),
      ),
    );
    await h.read(file.uri);
    vi.mocked(statSync).mockClear();
    await h.read(file.uri);
    expect(fileStats(later)).toHaveLength(0);
  });
});
