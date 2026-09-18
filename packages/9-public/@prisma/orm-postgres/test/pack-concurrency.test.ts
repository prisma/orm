import { type ChildProcess, execFileSync, spawn } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  watch,
  writeFileSync,
} from 'node:fs';
import { createServer, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { timeouts } from '@repo/test-utils/timeouts';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

type Phase = 'prepack' | 'prepare' | 'postpack' | 'orphan' | 'choosing' | 'chosen';
interface Barrier {
  readonly label: string;
  readonly phase: Phase;
  readonly socket: Socket;
  readonly owner: string | undefined;
}
interface Result {
  readonly code: number | null;
  readonly output: string;
}
interface Client {
  readonly child: ChildProcess;
  readonly result: Promise<Result>;
}

const fixtureDir = join(import.meta.dirname, 'fixtures');
const sourceFiles = {
  'SKILL.md': '---\nlibrary: SOURCE\n---\nComplete skill\n',
  'references/one.md': 'first reference\n',
  'references/two.md': 'second reference\n',
};

let scratch: string;
let port: number;
let clients: Client[];
let barriers: Barrier[];
let events: EventEmitter;
let closing: boolean;
let server: ReturnType<typeof createServer>;

beforeEach(async () => {
  scratch = mkdtempSync(join(tmpdir(), 'shell-pack-concurrency-'));
  clients = [];
  barriers = [];
  events = new EventEmitter();
  closing = false;
  server = createServer((socket) => {
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      if (!buffer.includes('\n')) return;
      const event = JSON.parse(buffer) as Omit<Barrier, 'socket'>;
      barriers.push({ ...event, socket });
      if (closing) socket.end('continue\n');
      events.emit('barrier');
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Missing barrier address');
  port = address.port;
});

afterEach(async () => {
  closing = true;
  for (const barrier of barriers) barrier.socket.end('continue\n');
  const stopChildren = () => {
    for (const dir of readdirSync(scratch)) {
      const lockDir = join(scratch, dir, 'node_modules', '.cache', 'shell-pack');
      if (!existsSync(lockDir)) continue;
      for (const entry of readdirSync(lockDir)) {
        try {
          process.kill(-Number(entry.split('-')[0]), 'SIGKILL');
        } catch (error) {
          if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error;
        }
      }
    }
    for (const client of clients) client.child.kill('SIGKILL');
  };
  const deadline = setTimeout(stopChildren, timeouts.databaseOperation);
  try {
    await Promise.all(clients.map((client) => client.result));
  } finally {
    clearTimeout(deadline);
    stopChildren();
    await Promise.allSettled(clients.map((client) => client.result));
    for (const barrier of barriers) barrier.socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(scratch, { recursive: true, force: true });
  }
});

function makePackage(name: string): string {
  const dir = join(scratch, name);
  mkdirSync(dir);
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({
      name,
      version: '1.0.0',
      files: ['skills'],
      scripts: Object.fromEntries(
        ['prepack', 'prepare', 'postpack'].map((phase) => [
          phase,
          `node ${JSON.stringify(join(fixtureDir, 'pack-lifecycle.ts'))} ${phase}`,
        ]),
      ),
    }),
  );
  writeFileSync(join(dir, 'pnpm-workspace.yaml'), '{}\n');
  for (const [file, content] of Object.entries(sourceFiles)) {
    const path = join(dir, 'skill-source', file);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, content);
  }
  mkdirSync(join(dir, 'skills'));
  writeFileSync(join(dir, 'skills', 'obsolete.md'), 'must not survive prepack');
  return dir;
}

function pack(dir: string, label: string, lockTimeoutMs?: number, ticketBarrier = false): Client {
  const out = join(scratch, label);
  mkdirSync(out);
  const args = [join(fixtureDir, 'pack-client.ts'), dir, out];
  if (lockTimeoutMs !== undefined) args.push(String(lockTimeoutMs));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PACK_BARRIER_PORT: String(port),
    PACK_LABEL: label,
  };
  if (ticketBarrier) {
    const preload = pathToFileURL(join(fixtureDir, 'pack-ticket-barrier.ts')).href;
    env['NODE_OPTIONS'] = `${process.env['NODE_OPTIONS'] ?? ''} --import=${preload}`;
  }
  const child = spawn(process.execPath, args, {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (data) => {
    output += data;
  });
  child.stderr.on('data', (data) => {
    output += data;
  });
  const result = new Promise<Result>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, output }));
  });
  const client = { child, result };
  clients.push(client);
  return client;
}

async function queuedPack(dir: string, label: string): Promise<{ client: Client; entry: string }> {
  const lockDir = join(dir, 'node_modules', '.cache', 'shell-pack');
  const original = new Set(readdirSync(lockDir));
  const watcher = watch(lockDir);
  const change = once(watcher, 'change', {
    signal: AbortSignal.timeout(timeouts.coldTransformImport),
  });
  try {
    const client = pack(dir, label);
    await change;
    const entry = readdirSync(lockDir).find((name) => !original.has(name));
    expect(entry).toBeDefined();
    return { client, entry: entry! };
  } finally {
    watcher.close();
  }
}

async function entered(label: string, phase: Phase): Promise<Barrier> {
  while (true) {
    const event = barriers.find((barrier) => barrier.label === label && barrier.phase === phase);
    if (event) return event;
    await once(events, 'barrier');
  }
}

async function release(label: string, phase: Phase, command = 'continue'): Promise<void> {
  (await entered(label, phase)).socket.end(`${command}\n`);
}

async function finish(client: Client, label: string): Promise<Result> {
  for (const phase of ['prepack', 'prepare', 'postpack'] as const) await release(label, phase);
  return client.result;
}

async function expectExcluded(dir: string, label: string, lockTimeoutMs = 0): Promise<void> {
  await expectBlocked(pack(dir, label, lockTimeoutMs), label, dir);
}

async function expectBlocked(contender: Client, label: string, dir: string): Promise<void> {
  const outcome = await Promise.race([
    contender.result,
    entered(label, 'prepack').then(
      () => 'entered prepack while another pack still owns the package',
    ),
  ]);
  expect(outcome).toEqual({
    code: 1,
    output: expect.stringContaining('Timed out acquiring pack lock'),
  });
  expect(outcome).toEqual({ code: 1, output: expect.stringContaining(dir) });
}

function expectArchive(label: string, name: string): void {
  const tarball = join(scratch, label, `${name}.tgz`);
  const files = execFileSync('tar', ['-tzf', tarball], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter((file) => !file.endsWith('/'))
    .sort();
  expect(files).toEqual(
    [
      'package/package.json',
      ...Object.keys(sourceFiles).map((file) => `package/skills/${file}`),
    ].sort(),
  );
  for (const [file, content] of Object.entries(sourceFiles)) {
    expect(
      execFileSync('tar', ['-xOzf', tarball, `package/skills/${file}`], { encoding: 'utf8' }),
    ).toBe(content.replace('SOURCE', name));
  }
}

describe(
  'cross-process shell packing',
  () => {
    it('excludes aliases of the same package through archive completion and packs complete contents', async () => {
      const dir = makePackage('same-package');
      const alias = join(scratch, 'alias');
      symlinkSync(dir, alias);
      const first = pack(dir, 'first');
      await entered('first', 'prepack');
      await expectExcluded(alias, 'during-prepack');
      await release('first', 'prepack');
      await entered('first', 'prepare');
      await expectExcluded(dir, 'before-archive');
      const { client: second } = await queuedPack(alias, 'second');
      await release('first', 'prepare');
      await entered('first', 'postpack');
      expectArchive('first', 'same-package');
      await expectExcluded(dir, 'after-archive', timeouts.default);
      await release('first', 'postpack');
      expect(await first.result).toMatchObject({ code: 0 });
      expect(await finish(second, 'second')).toMatchObject({ code: 0 });
      expectArchive('second', 'same-package');
    });

    it('breaks equal-ticket ties without admitting two simultaneous choosers', async () => {
      const dir = makePackage('equal-tickets');
      const first = pack(dir, 'a', 0, true);
      await entered('a', 'choosing');
      const second = pack(dir, 'b', 0, true);
      await entered('b', 'choosing');
      await release('a', 'choosing');
      await release('b', 'choosing');
      const a = await entered('a', 'chosen');
      const b = await entered('b', 'chosen');
      expect(a.owner).toBeDefined();
      expect(b.owner).toBeDefined();
      const lockDir = join(dir, 'node_modules', '.cache', 'shell-pack');
      expect(
        [a, b].map(({ owner }) => readFileSync(join(lockDir, owner!, 'ticket'), 'utf8')),
      ).toEqual(['1', '1']);
      const [leader, follower] =
        a.owner! < b.owner!
          ? [
              { client: first, label: 'a' },
              { client: second, label: 'b' },
            ]
          : [
              { client: second, label: 'b' },
              { client: first, label: 'a' },
            ];
      await release(leader!.label, 'chosen');
      await entered(leader!.label, 'prepack');
      await release(follower!.label, 'chosen');
      await expectBlocked(follower!.client, follower!.label, dir);
      expect(await finish(leader!.client, leader!.label)).toMatchObject({ code: 0 });
      expectArchive(leader!.label, 'equal-tickets');
    });

    it('lets different packages enter before either owner is released', async () => {
      const first = pack(makePackage('package-a'), 'a');
      await entered('a', 'prepack');
      const second = pack(makePackage('package-b'), 'b');
      await entered('b', 'prepack');
      expect(await finish(first, 'a')).toMatchObject({ code: 0 });
      expect(await finish(second, 'b')).toMatchObject({ code: 0 });
      expectArchive('a', 'package-a');
      expectArchive('b', 'package-b');
    });

    it('releases ownership when pnpm fails so a waiting pack can finish', async () => {
      const dir = makePackage('failed-package');
      const first = pack(dir, 'failed');
      await entered('failed', 'prepack');
      const { client: second } = await queuedPack(dir, 'retry');
      await release('failed', 'prepack', 'fail');
      expect(await first.result).toMatchObject({ code: 1 });
      expect(await finish(second, 'retry')).toMatchObject({ code: 0 });
      expectArchive('retry', 'failed-package');
    });

    it('retains ownership after the caller dies until its pack process finishes', async () => {
      const dir = makePackage('abandoned-caller');
      const first = pack(dir, 'abandoned');
      await entered('abandoned', 'prepack');
      first.child.kill('SIGKILL');
      await expectExcluded(dir, 'still-owned');
      await finish(first, 'abandoned');
      expect(await finish(pack(dir, 'recovered'), 'recovered')).toMatchObject({ code: 0 });
      expectArchive('recovered', 'abandoned-caller');
    });

    it('retains abandoned ownership while a failed lifecycle still has a live child', async () => {
      const dir = makePackage('orphaned-lifecycle');
      const first = pack(dir, 'failed');
      await release('failed', 'prepack', 'orphan');
      await entered('failed', 'orphan');
      expect(await first.result).toMatchObject({ code: 1 });
      await expectExcluded(dir, 'still-owned');
      await release('failed', 'orphan');
      expect(await finish(pack(dir, 'recovered'), 'recovered')).toMatchObject({ code: 0 });
      expectArchive('recovered', 'orphaned-lifecycle');
    });

    it('retains abandoned ownership when its supervisor dies before pnpm finishes', async () => {
      const dir = makePackage('orphaned-pack');
      const first = pack(dir, 'killed');
      await release('killed', 'prepack');
      await release('killed', 'prepare');
      await entered('killed', 'postpack');
      const [owner] = readdirSync(join(dir, 'node_modules', '.cache', 'shell-pack'));
      expect(owner).toBeDefined();
      process.kill(Number(owner!.split('-')[0]), 'SIGKILL');
      expect(await first.result).toMatchObject({ code: 1 });
      await expectExcluded(dir, 'still-owned');
      await release('killed', 'postpack');
      expect(await finish(pack(dir, 'recovered'), 'recovered')).toMatchObject({ code: 0 });
      expectArchive('recovered', 'orphaned-pack');
    });

    it('ignores an abandoned contender without deleting a live owner', async () => {
      const dir = makePackage('abandoned-contender');
      const first = pack(dir, 'owner');
      await entered('owner', 'prepack');
      const lockDir = join(dir, 'node_modules', '.cache', 'shell-pack');
      const { client: contender, entry } = await queuedPack(dir, 'contender');
      const pid = Number(entry.split('-')[0]);
      process.kill(-pid, 'SIGKILL');
      expect(await contender.result).toMatchObject({ code: 1 });
      await expectExcluded(dir, 'owner-survives');
      expect(await finish(first, 'owner')).toMatchObject({ code: 0 });
      expect(await finish(pack(dir, 'recovered'), 'recovered')).toMatchObject({ code: 0 });
      expectArchive('recovered', 'abandoned-contender');
      const remaining = readdirSync(lockDir);
      expect(remaining).not.toContain(entry);
      expect(remaining).toHaveLength(1);
      expect(() => process.kill(-Number(remaining[0]!.split('-')[0]), 0)).toThrow(
        expect.objectContaining({ code: 'ESRCH' }),
      );
    });
  },
  timeouts.coldTransformImport,
);
