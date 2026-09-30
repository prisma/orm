import { writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { PassThrough } from 'node:stream';
import { pathToFileURL } from 'node:url';
import { timeouts } from '@repo/test-utils';
import { FSWatcher } from 'chokidar';
import { afterEach, expect, it, vi } from 'vitest';
import {
  createConnection,
  InitializeRequest,
  PublishDiagnosticsNotification,
  type PublishDiagnosticsParams,
  ShutdownRequest,
  StreamMessageReader,
  StreamMessageWriter,
} from 'vscode-languageserver/node';
import { resolveSchemaInputs } from '../src/schema-inputs';
import { createServer } from '../src/server';

const observed = vi.hoisted(() => new Map<string, string | undefined>());

vi.mock('../src/config-resolution', async (original) => ({
  ...(await original<typeof import('../src/config-resolution')>()),
  resolveConfigInputs: async (
    configPath: string,
    readText: (uri: string) => string | undefined,
  ) => {
    const patterns = (await readFile(configPath, 'utf8')).trim().split('\n');
    const schemaInputConfig = {
      contract: {
        source: {
          format: 'psl',
          inputs: patterns.map((pattern) => join(dirname(configPath), pattern)),
        },
      },
    };
    return {
      schemaInputConfig,
      inputs: await resolveSchemaInputs(schemaInputConfig, (uri) => {
        const text = readText(uri);
        observed.set(uri, text);
        return text;
      }),
      controlStack: { scalarTypes: ['Int'], pslBlockDescriptors: {} },
    };
  },
}));

const clean = '// use prisma-8\nmodel User {\n id Int\n}\n';
const broken = `${clean}\nmodel User {\n id Int\n}\n`;
const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.reverse()) await cleanup();
  cleanups.length = 0;
  vi.restoreAllMocks();
  observed.clear();
});

async function fixture(
  patterns: readonly string[],
  files: Readonly<Record<string, string>>,
  beforeWatch?: (dir: string) => void,
  initialFile = 'bootstrap.prisma',
) {
  const dir = await mkdtemp(join(await realpath(tmpdir()), 'server-internal-watch-'));
  cleanups.push(() => rm(dir, { recursive: true, force: true }));
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), text);
  }
  const config = join(dir, 'prisma.config.ts');
  await writeFile(config, patterns.join('\n'));
  const bootstrap = join(dir, 'bootstrap.prisma');
  await writeFile(bootstrap, '// use prisma-8\nmodel Bootstrap {\n id Int\n}\n');
  const input = new PassThrough();
  const output = new PassThrough();
  const connection = createConnection(
    new StreamMessageReader(input),
    new StreamMessageWriter(output),
  );
  const client = createConnection(new StreamMessageReader(output), new StreamMessageWriter(input));
  const latest = new Map<string, PublishDiagnosticsParams>();
  client.onNotification(PublishDiagnosticsNotification.type, (report) => {
    latest.set(report.uri, report);
  });
  const watchers = new Set<FSWatcher>();
  const originalAdd = FSWatcher.prototype.add;
  let starting = true;
  const add = vi.spyOn(FSWatcher.prototype, 'add').mockImplementation(function (
    this: FSWatcher,
    ...args: Parameters<FSWatcher['add']>
  ) {
    watchers.add(this);
    if (starting) {
      starting = false;
      beforeWatch?.(dir);
    }
    return originalAdd.apply(this, args);
  });
  const emit = vi.spyOn(FSWatcher.prototype, 'emit');
  const registration = vi.spyOn(connection, 'sendRequest');
  const server = createServer(connection);
  client.listen();
  cleanups.push(async () => {
    await client.sendRequest(ShutdownRequest.type);
    for (const watcher of watchers) {
      expect(watcher.closed).toBe(true);
      expect(watcher.getWatched()).toEqual({});
    }
    await server.dispose();
    client.dispose();
    input.destroy();
    output.destroy();
  });
  await client.sendRequest(InitializeRequest.type, {
    processId: null,
    rootUri: null,
    capabilities: {},
  });
  await client.sendRequest('textDocument/foldingRange', {
    textDocument: { uri: pathToFileURL(join(dir, initialFile)).toString() },
  });
  await vi.waitFor(
    () => {
      expect(add).toHaveBeenCalled();
      for (const watcher of watchers) {
        expect(
          emit.mock.calls.some(
            ([event], index) => event === 'ready' && emit.mock.contexts[index] === watcher,
          ),
        ).toBe(true);
      }
    },
    { timeout: timeouts.databaseOperation },
  );
  expect(registration).not.toHaveBeenCalled();
  return {
    dir,
    config,
    async diagnostics(path: string, duplicate: boolean) {
      const uri = pathToFileURL(join(dir, path)).toString();
      await vi.waitFor(
        () => {
          const report = latest.get(uri);
          expect(report?.diagnostics).toEqual(
            duplicate
              ? expect.arrayContaining([
                  expect.objectContaining({ code: 'PSL_DUPLICATE_DECLARATION' }),
                ])
              : [],
          );
        },
        { timeout: timeouts.databaseOperation },
      );
    },
  };
}

it('publishes and clears diagnostics for a never-opened member without further editor messages', {
  timeout: timeouts.databaseOperation,
}, async () => {
  const h = await fixture(['schemas/*.prisma'], { 'schemas/user.prisma': clean });
  await h.diagnostics('schemas/user.prisma', false);
  await writeFile(join(h.dir, 'schemas/user.prisma'), broken);
  await h.diagnostics('schemas/user.prisma', true);
  await writeFile(join(h.dir, 'schemas/user.prisma'), clean);
  await h.diagnostics('schemas/user.prisma', false);
});

it.each([false, true])(
  'discovers empty-glob members and clears file and directory deletions (existing root: %s)',
  {
    timeout: timeouts.databaseOperation,
  },
  async (existingRoot) => {
    const h = await fixture(['schemas/**/*.prisma'], existingRoot ? { 'schemas/.keep': '' } : {});
    const nested = join(h.dir, 'schemas/future/nested');
    await mkdir(nested, { recursive: true });
    const member = 'schemas/future/nested/user.prisma';
    await writeFile(join(h.dir, member), broken);
    await h.diagnostics(member, true);
    await rm(join(h.dir, member));
    await h.diagnostics(member, false);
    await writeFile(join(h.dir, member), broken);
    await h.diagnostics(member, true);
    await rm(join(h.dir, 'schemas/future'), { recursive: true });
    await h.diagnostics(member, false);
  },
);

it('replaces config membership after atomic save without subsequent editor operations', {
  timeout: timeouts.databaseOperation,
}, async () => {
  const h = await fixture(['old/**/*.prisma'], {
    'old/user.prisma': broken,
    'next/user.prisma': broken,
  });
  await h.diagnostics('old/user.prisma', true);
  const temporary = join(h.dir, 'replacement.tmp');
  await writeFile(temporary, 'next/**/*.prisma');
  await rename(temporary, h.config);
  await h.diagnostics('next/user.prisma', true);
  await h.diagnostics('old/user.prisma', false);
  await writeFile(join(h.dir, 'next/user.prisma'), clean);
  await h.diagnostics('next/user.prisma', false);
});

it('reconciles disk text changed after loading but before native watcher startup', {
  timeout: timeouts.databaseOperation,
}, async () => {
  let cachedBeforeWatch = false;
  const h = await fixture(
    ['schemas/*.prisma'],
    { 'schemas/user.prisma': clean },
    (dir) => {
      cachedBeforeWatch =
        observed.get(pathToFileURL(join(dir, 'schemas/user.prisma')).toString()) === clean;
      writeFileSync(join(dir, 'schemas/user.prisma'), broken);
    },
    'schemas/user.prisma',
  );
  expect(cachedBeforeWatch).toBe(true);
  await h.diagnostics('schemas/user.prisma', true);
});
