import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'pathe';

class PackLockError extends Error {}

const [directory, tarball, timeoutArgument] = process.argv.slice(2);
if (!directory || !tarball) throw new PackLockError('Expected package directory and tarball path');
if (process.platform === 'win32')
  throw new PackLockError('Shell packing requires POSIX process groups');
const timeoutMs = Number(timeoutArgument);
if (!Number.isFinite(timeoutMs) || timeoutMs < 0)
  throw new PackLockError('Invalid pack lock timeout');

const packageDir = realpathSync(directory);
const lockDir = join(packageDir, 'node_modules', '.cache', 'shell-pack');
const id = `${process.pid}-${randomUUID()}`;
const ownDir = join(lockDir, id);
const deadline = performance.now() + timeoutMs;
const pause = new Int32Array(new SharedArrayBuffer(4));

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && 'code' in error && error.code === code;
}

function groupExists(pid: number): boolean {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    if (hasCode(error, 'ESRCH')) return false;
    throw error;
  }
}

function contenders(): { id: string; ticket: number }[] {
  const entries: { id: string; ticket: number }[] = [];
  for (const entry of readdirSync(lockDir)) {
    const pid = Number(entry.split('-')[0]);
    if (!Number.isSafeInteger(pid) || pid <= 0) {
      throw new PackLockError(`Invalid pack owner in ${lockDir}: ${entry}`);
    }
    if (!groupExists(pid)) {
      rmSync(join(lockDir, entry), { recursive: true, force: true });
      continue;
    }
    try {
      const ticket = Number(readFileSync(join(lockDir, entry, 'ticket'), 'utf8'));
      if (!Number.isSafeInteger(ticket) || ticket <= 0) {
        throw new PackLockError(`Invalid pack ticket in ${lockDir}: ${entry}`);
      }
      entries.push({ id: entry, ticket });
    } catch (error) {
      if (!hasCode(error, 'ENOENT')) throw error;
      // A published directory without a ticket is still choosing its place in the queue.
      entries.push({ id: entry, ticket: 0 });
    }
  }
  return entries;
}

mkdirSync(lockDir, { recursive: true });
mkdirSync(ownDir);
let packStarted = false;
try {
  const ticket = Math.max(0, ...contenders().map((entry) => entry.ticket)) + 1;
  writeFileSync(join(ownDir, 'ticket.tmp'), String(ticket));
  renameSync(join(ownDir, 'ticket.tmp'), join(ownDir, 'ticket'));
  while (true) {
    const blockers = contenders().filter(
      (entry) =>
        entry.id !== id &&
        (entry.ticket === 0 || entry.ticket < ticket || (entry.ticket === ticket && entry.id < id)),
    );
    if (blockers.length === 0) break;
    if (performance.now() >= deadline) {
      throw new PackLockError(
        `Timed out acquiring pack lock for ${directory} (${packageDir}); owners: ${blockers.map((entry) => entry.id).join(', ')}`,
      );
    }
    Atomics.wait(pause, 0, 0, Math.min(25, deadline - performance.now()));
  }
  packStarted = true;
  execFileSync('pnpm', ['pack', '--out', tarball], { cwd: packageDir, stdio: 'pipe' });
} finally {
  // Once launched, only a dead process group proves that pnpm and its lifecycle children are done.
  if (!packStarted) rmSync(ownDir, { recursive: true, force: true });
}
