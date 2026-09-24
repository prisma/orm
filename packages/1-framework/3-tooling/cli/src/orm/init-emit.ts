import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'pathe';
import { redactSecrets } from '../commands/init/redact-secrets';

const STDERR_TAIL_LINES = 20;

/**
 * Test-only seam for the manifest resolution, mirroring probe-db's
 * `requireFromBaseDir`: vitest wraps `createRequire` so resolution never
 * fails under test even when the project has no `prisma` installed.
 * Production callers omit it.
 */
export interface EmitOverrides {
  readonly resolveFromBaseDir?: (baseDir: string, specifier: string) => string;
}

/**
 * Emits the contract for the project `init` has just scaffolded, by spawning
 * the project-local `prisma` binary the install step put into
 * `node_modules`. That binary and the installed `defineConfig` come from the
 * same registry release, so the config loader that evaluates
 * `prisma.config.ts` always matches the config format it was written
 * with — running the emit in-process would evaluate the project's config with
 * this (possibly newer) CLI's loader instead. Child output is captured, never
 * inherited, so `--json` envelopes on stdout stay parseable.
 */
export async function emitScaffoldedContract(
  ctx: { readonly cwd: string },
  overrides: EmitOverrides = {},
): Promise<void> {
  const binPath = resolveProjectBin(ctx.cwd, overrides);
  const result = await runCaptured(
    process.execPath,
    [binPath, 'contract', 'emit', '--json'],
    ctx.cwd,
  );
  if (result.exitCode !== 0) {
    const cause =
      result.exitCode === null
        ? `was killed by signal ${result.signal ?? 'unknown'}`
        : `exited with code ${result.exitCode}`;
    const detail =
      errorFromEnvelope(result.stdout) ?? tail(firstNonEmpty(result.stderr, result.stdout));
    throw new Error(`\`prisma contract emit\` ${cause}: ${redactSecrets(detail)}`);
  }
}

function firstNonEmpty(preferred: string, fallback: string): string {
  return preferred.trim().length > 0 ? preferred : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * The child ran with `--json`, so its settlement is a `result` event on
 * stdout whose envelope carries the structured error. That is the cause worth
 * quoting; stderr ends with whatever the child said last, which is often an
 * unrelated notice.
 */
function errorFromEnvelope(stdout: string): string | undefined {
  for (const line of stdout.split('\n').reverse()) {
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(event) || event['kind'] !== 'result' || !isRecord(event['envelope'])) {
      continue;
    }
    const error = event['envelope']['error'];
    if (!isRecord(error)) {
      continue;
    }
    const code = typeof error['code'] === 'string' ? error['code'] : undefined;
    const summary = typeof error['summary'] === 'string' ? error['summary'] : undefined;
    const why = typeof error['why'] === 'string' ? ` — ${error['why']}` : '';
    if (code === undefined && summary === undefined) {
      continue;
    }
    return `${[code, summary].filter((part) => part !== undefined).join(': ')}${why}`;
  }
  return undefined;
}

function resolveProjectBin(cwd: string, overrides: EmitOverrides): string {
  const resolveFromBaseDir =
    overrides.resolveFromBaseDir ??
    ((baseDir: string, specifier: string) =>
      createRequire(join(baseDir, 'package.json')).resolve(specifier));
  let manifestPath: string;
  try {
    manifestPath = resolveFromBaseDir(cwd, 'prisma/package.json');
  } catch (error) {
    throw new Error(
      `\`prisma\` is not installed in this project (resolved from ${cwd}; cause: ${causeMessage(error)})`,
    );
  }
  let manifest: unknown;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  } catch (error) {
    throw new Error(
      `the installed prisma manifest at ${manifestPath} is not valid JSON: ${causeMessage(error)}`,
    );
  }
  const bin =
    manifest !== null && typeof manifest === 'object' ? Reflect.get(manifest, 'bin') : undefined;
  const binEntry =
    typeof bin === 'string'
      ? bin
      : bin !== null && typeof bin === 'object'
        ? Reflect.get(bin, 'prisma')
        : undefined;
  if (typeof binEntry !== 'string') {
    throw new Error(
      `the installed prisma package at ${dirname(manifestPath)} declares no \`prisma\` bin`,
    );
  }
  return join(dirname(manifestPath), binEntry);
}

function runCaptured(
  file: string,
  args: readonly string[],
  cwd: string,
): Promise<{
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
}> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf-8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf-8');
    });
    child.on('error', (error) => {
      reject(new Error(`could not run the project-local prisma binary: ${error.message}`));
    });
    child.on('close', (code, signal) => {
      resolve({ exitCode: code, signal, stdout, stderr });
    });
  });
}

function tail(text: string): string {
  return text.trim().split('\n').slice(-STDERR_TAIL_LINES).join('\n');
}

function causeMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
