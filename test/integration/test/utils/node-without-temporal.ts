/**
 * Runs Node as a child process that has no `Temporal`, on any Node version, and that reports
 * whether a global `Temporal` exists before the program starts and when the process exits.
 */
import { type ChildProcessWithoutNullStreams, execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const BEFORE = '[temporal before=';
const AFTER = '[temporal after=';

const PRELOAD = `
delete globalThis.Temporal;
process.stderr.write('${BEFORE}' + typeof globalThis.Temporal + ']\\n');
process.on('exit', () => {
  process.stderr.write('${AFTER}' + typeof globalThis.Temporal + ']\\n');
});
`;

const PRELOAD_URL = `data:text/javascript,${encodeURIComponent(PRELOAD)}`;

export interface ChildRun {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  /** `typeof globalThis.Temporal` in the child before its program ran. */
  readonly temporalBefore: string | undefined;
  /** `typeof globalThis.Temporal` in the child when it exited. */
  readonly temporalAfter: string | undefined;
}

export const NO_GLOBAL_TEMPORAL = { temporalBefore: 'undefined', temporalAfter: 'undefined' };

function reported(stderr: string, marker: string): string | undefined {
  const start = stderr.lastIndexOf(marker);
  if (start < 0) return undefined;
  return stderr.slice(start + marker.length, stderr.indexOf(']', start));
}

function childEnv(extra: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const { NODE_OPTIONS: _nodeOptions, ...env } = process.env;
  return { ...env, NO_COLOR: '1', CI: 'true', ...extra };
}

function isFailedRun(error: unknown): error is { code: number; stdout: string; stderr: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof Reflect.get(error, 'code') === 'number' &&
    typeof Reflect.get(error, 'stdout') === 'string' &&
    typeof Reflect.get(error, 'stderr') === 'string'
  );
}

export async function runNodeWithoutTemporal(
  args: readonly string[],
  options: { readonly cwd: string; readonly env?: NodeJS.ProcessEnv },
): Promise<ChildRun> {
  const settled = await execFileAsync('node', ['--import', PRELOAD_URL, ...args], {
    cwd: options.cwd,
    env: childEnv(options.env ?? {}),
  }).then(
    ({ stdout, stderr }) => ({ exitCode: 0, stdout, stderr }),
    (error: unknown) => {
      if (!isFailedRun(error)) throw error;
      return { exitCode: error.code, stdout: error.stdout, stderr: error.stderr };
    },
  );
  return { ...settled, ...reportedTemporal(settled.stderr) };
}

/** The same child, left running, for a program the test talks to over its standard streams. */
export function spawnNodeWithoutTemporal(
  args: readonly string[],
  options: { readonly cwd: string; readonly env?: NodeJS.ProcessEnv },
): ChildProcessWithoutNullStreams {
  return spawn('node', ['--import', PRELOAD_URL, ...args], {
    cwd: options.cwd,
    env: childEnv(options.env ?? {}),
    stdio: 'pipe',
  });
}

/** What the child reported about its global `Temporal`, read from what it wrote to stderr. */
export function reportedTemporal(stderr: string): {
  readonly temporalBefore: string | undefined;
  readonly temporalAfter: string | undefined;
} {
  return { temporalBefore: reported(stderr, BEFORE), temporalAfter: reported(stderr, AFTER) };
}

export function childOutput(run: ChildRun): string {
  return `${run.stderr}\n${run.stdout}`;
}
