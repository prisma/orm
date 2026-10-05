import { spawn } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'pathe';
import { expect } from 'vitest';

export const EXAMPLE_ROOT = join(__dirname, '..');
const BIN = join(EXAMPLE_ROOT, 'node_modules/.bin');

export interface RunResult {
  readonly status: number | null;
  readonly output: string;
}

// The dev database runs inside this process, so the commands must be spawned
// asynchronously: a blocking spawn would starve it and every command would
// report the database as unreachable.
export function runAllowingFailure(
  cwd: string,
  databaseUrl: string,
  bin: string,
  args: readonly string[],
): Promise<RunResult> {
  const command = [bin, ...args].join(' ');
  return new Promise((resolve, reject) => {
    const child = spawn(join(BIN, bin), args, {
      cwd,
      env: { ...process.env, DATABASE_URL: databaseUrl },
    });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.on('error', (error) => {
      reject(new Error(`${command} did not start: ${error.message}`));
    });
    child.on('close', (status) => {
      resolve({ status, output });
    });
  });
}

export async function run(
  cwd: string,
  databaseUrl: string,
  bin: string,
  args: readonly string[],
): Promise<string> {
  const { status, output } = await runAllowingFailure(cwd, databaseUrl, bin, args);
  if (status !== 0) {
    throw new Error(`${[bin, ...args].join(' ')} exited with ${status}\n${output}`);
  }
  return output;
}

/** The envelope of the `result` event in the line-delimited JSON a Prisma 8 command prints. */
export function resultEnvelope(output: string): {
  readonly ok: boolean;
  readonly result: Record<string, unknown>;
  readonly diagnostics: readonly { readonly code: string }[];
} {
  const terminal = output
    .split('\n')
    .filter((line) => line.startsWith('{'))
    .map((line) => JSON.parse(line))
    .find((event) => event.kind === 'result');
  expect(terminal, output).toBeDefined();
  return terminal.envelope;
}

export async function verifyHasNoFindings(cwd: string, databaseUrl: string): Promise<void> {
  const output = await run(cwd, databaseUrl, 'prisma', ['db', 'verify', '--json']);
  const envelope = resultEnvelope(output);
  expect(envelope).toMatchObject({ ok: true, diagnostics: [] });
  expect(envelope.result['schema']).toMatchObject({ warnings: [] });
}

/** A scratch copy of this example, inside it so node_modules resolve. */
export function copyExample(): string {
  const dir = mkdtempSync(join(EXAMPLE_ROOT, '.story-'));
  for (const entry of [
    'prisma',
    'scripts',
    'src',
    'test/handover',
    'prisma.config.ts',
    'prisma7.config.ts',
  ]) {
    cpSync(join(EXAMPLE_ROOT, entry), join(dir, entry), { recursive: true });
  }
  return dir;
}

export function readContract(dir: string): string {
  return readFileSync(join(dir, 'generated/prisma8/contract.json'), 'utf-8');
}
