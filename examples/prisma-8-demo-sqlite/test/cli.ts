import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { cp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const exampleDir = fileURLToPath(new URL('..', import.meta.url));
const prismaBin = join(exampleDir, 'node_modules', '.bin', 'prisma');

export interface ProjectCopy {
  readonly dir: string;
  readonly databasePath: string;
  remove(): Promise<void>;
}

/** Copies the example's contract and config to a folder of its own, with a database file there, so commands leave the example as it is. */
export async function copyProject(): Promise<ProjectCopy> {
  const dir = join(exampleDir, '.tmp-output', randomBytes(6).toString('hex'));
  await mkdir(dir, { recursive: true });
  for (const entry of ['prisma.config.ts', 'prisma', 'src']) {
    await cp(join(exampleDir, entry), join(dir, entry), { recursive: true });
  }
  return {
    dir,
    databasePath: join(dir, 'test.db'),
    remove: () => rm(dir, { recursive: true, force: true }),
  };
}

/** Runs the `prisma` CLI in the copied project against its database file, and returns its exit code. */
export async function prisma(project: ProjectCopy, args: readonly string[]): Promise<number> {
  return execFileAsync(prismaBin, [...args], {
    cwd: project.dir,
    env: { ...process.env, SQLITE_PATH: project.databasePath },
  }).then(
    () => 0,
    (error: { code: number }) => error.code,
  );
}
