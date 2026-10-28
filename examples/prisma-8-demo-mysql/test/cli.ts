import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { cp, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const exampleDir = fileURLToPath(new URL('..', import.meta.url));
const prismaBin = join(exampleDir, 'node_modules', '.bin', 'prisma');

export interface CliRun {
  readonly exitCode: number;
  readonly result: Record<string, unknown>;
}

/** Runs the `prisma` CLI in `projectDir` against `databaseUrl`, and returns its JSON result. */
export async function prisma(
  projectDir: string,
  databaseUrl: string,
  args: string[],
): Promise<CliRun> {
  const { stdout, exitCode } = await execFileAsync(prismaBin, [...args, '--json'], {
    cwd: projectDir,
    env: { ...process.env, MYSQL_URL: databaseUrl },
  }).then(
    ({ stdout }) => ({ stdout, exitCode: 0 }),
    (error: { stdout: string; code: number }) => ({ stdout: error.stdout, exitCode: error.code }),
  );
  const lines = stdout.trim().split('\n');
  const last = JSON.parse(lines[lines.length - 1] ?? '{}');
  return { exitCode, result: last.envelope?.result ?? last.envelope };
}

export interface ProjectCopy {
  readonly dir: string;
  remove(): Promise<void>;
}

/** Copies the example's contract, config and migrations to a folder of its own, so commands that write files leave the example as it is. */
export async function copyProject(): Promise<ProjectCopy> {
  const dir = join(exampleDir, '.tmp-output', randomBytes(6).toString('hex'));
  await mkdir(dir, { recursive: true });
  for (const entry of ['prisma.config.ts', 'prisma', 'src', 'migrations']) {
    await cp(join(exampleDir, entry), join(dir, entry), { recursive: true });
  }
  return { dir, remove: () => rm(dir, { recursive: true, force: true }) };
}
