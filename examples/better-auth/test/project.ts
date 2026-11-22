import { execFile } from 'node:child_process';
import { cp, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const exampleDir = fileURLToPath(new URL('..', import.meta.url));

export const testSecret = 'a-test-secret-that-is-long-enough-for-better-auth';

export interface ProjectCopy {
  readonly dir: string;
  readonly databasePath: string;
  remove(): Promise<void>;
}

export interface CommandResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Copies the example to a folder under the operating system's temporary directory, with a database file there, so the commands leave the example as it is. The copy uses the example's installed packages.
 */
export async function copyProject(): Promise<ProjectCopy> {
  const dir = await mkdtemp(join(tmpdir(), 'better-auth-example-'));
  for (const entry of ['package.json', 'tsconfig.json', 'prisma.config.ts', 'prisma', 'src']) {
    await cp(join(exampleDir, entry), join(dir, entry), { recursive: true });
  }
  await symlink(join(exampleDir, 'node_modules'), join(dir, 'node_modules'), 'dir');
  return {
    dir,
    databasePath: join(dir, 'test.db'),
    remove: () => rm(dir, { recursive: true, force: true }),
  };
}

/** Runs one of the example's installed command-line tools in the copied project. */
export async function run(
  project: ProjectCopy,
  tool: 'prisma' | 'auth',
  args: readonly string[],
): Promise<CommandResult> {
  return execFileAsync(join(exampleDir, 'node_modules', '.bin', tool), [...args], {
    cwd: project.dir,
    env: {
      ...process.env,
      SQLITE_PATH: project.databasePath,
      BETTER_AUTH_SECRET: testSecret,
      BETTER_AUTH_URL: 'http://localhost:3000',
      BETTER_AUTH_TELEMETRY: '0',
      NO_COLOR: '1',
    },
  }).then(
    ({ stdout, stderr }) => ({ exitCode: 0, stdout, stderr }),
    (error: { code: number; stdout: string; stderr: string }) => ({
      exitCode: error.code,
      stdout: error.stdout,
      stderr: error.stderr,
    }),
  );
}
