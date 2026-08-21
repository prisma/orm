/**
 * Pins the init emit invariant end to end: the shipped bin's `init` command
 * emits the scaffolded contract by spawning the *project-local* `prisma`
 * bin as a child process in the scaffold directory — never by loading the
 * project's config in-process with the running CLI's own loader. A revert to
 * in-process emit makes the fake project-local bin unnecessary, so its
 * sentinel file never appears and this suite fails.
 *
 * The project's `node_modules/prisma` is a fake package whose
 * `prisma` bin records its argv and cwd; the package-manager install step
 * is satisfied by a PATH shim `npm` that exits 0, so `init` reaches the emit
 * step without the network.
 */

import { execFile } from 'node:child_process';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { timeouts } from '@repo/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_BIN = resolve(__dirname, '../../../../packages/1-framework/3-tooling/cli/dist/bin.mjs');

let projectDir: string;
let shimDir: string;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'pn-init-emit-e2e-'));
  writeFileSync(
    join(projectDir, 'package.json'),
    JSON.stringify({ name: 'init-emit-e2e-app', version: '0.0.0', private: true, type: 'module' }),
  );
  // A lockfile makes package-manager detection choose npm, which the PATH
  // shim below intercepts — the install step "succeeds" without the network.
  writeFileSync(
    join(projectDir, 'package-lock.json'),
    JSON.stringify({ name: 'init-emit-e2e-app', lockfileVersion: 3 }),
  );
  shimDir = join(projectDir, '.pm-shims');
  mkdirSync(shimDir, { recursive: true });
  const npmShim = join(shimDir, 'npm');
  writeFileSync(npmShim, '#!/bin/sh\nexit 0\n');
  chmodSync(npmShim, 0o755);
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

function installFakePrismaCli(binSource: string): void {
  const packageDir = join(projectDir, 'node_modules', 'prisma');
  mkdirSync(join(packageDir, 'bin'), { recursive: true });
  writeFileSync(
    join(packageDir, 'package.json'),
    JSON.stringify({
      name: 'prisma',
      version: '0.0.0-test',
      type: 'module',
      bin: { prisma: './bin/prisma.mjs' },
    }),
  );
  writeFileSync(join(packageDir, 'bin/prisma.mjs'), binSource);
}

interface InitRun {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function runInit(): Promise<InitRun> {
  const env = {
    ...process.env,
    PATH: `${shimDir}${delimiter}${process.env['PATH'] ?? ''}`,
    DO_NOT_TRACK: '1',
  };
  const argv = [
    CLI_BIN,
    'orm',
    'init',
    '--target',
    'postgres',
    '--authoring',
    'psl',
    '--schema-path',
    'prisma/contract.prisma',
    '--yes',
    '--skip-skills',
    '--json',
  ];
  try {
    const { stdout, stderr } = await execFileAsync('node', argv, { cwd: projectDir, env });
    return { exitCode: 0, stdout, stderr };
  } catch (error) {
    const failed = error as { code?: number; stdout?: string; stderr?: string };
    if (typeof failed.code !== 'number') {
      throw error;
    }
    return { exitCode: failed.code, stdout: failed.stdout ?? '', stderr: failed.stderr ?? '' };
  }
}

/** The terminal frame of the bin's json stream — one NDJSON object per line. */
function settledFrame(stdout: string): unknown {
  const lines = stdout.split('\n').filter((line) => line.trim() !== '');
  const last = lines.at(-1);
  expect(last, `no json frames on stdout:\n${stdout}`).toBeDefined();
  return JSON.parse(last ?? '');
}

describe('init emit through the project-local prisma bin (process e2e)', () => {
  it(
    'runs node_modules/prisma with `contract emit` as a child process in the scaffold directory',
    async () => {
      installFakePrismaCli(
        [
          "import { writeFileSync } from 'node:fs';",
          "writeFileSync('emit-invocation.json', JSON.stringify({ argv: process.argv.slice(2), script: process.argv[1], cwd: process.cwd(), pid: process.pid }));",
          '',
        ].join('\n'),
      );

      const run = await runInit();

      expect(run.exitCode, `stdout:\n${run.stdout}\nstderr:\n${run.stderr}`).toBe(0);
      const invocation = JSON.parse(
        readFileSync(join(projectDir, 'emit-invocation.json'), 'utf-8'),
      ) as { argv: string[]; script: string; cwd: string };
      expect(invocation.argv).toEqual(['contract', 'emit']);
      expect(realpathSync(invocation.cwd)).toBe(realpathSync(projectDir));
      expect(realpathSync(invocation.script)).toBe(
        realpathSync(join(projectDir, 'node_modules', 'prisma', 'bin', 'prisma.mjs')),
      );
      expect(JSON.stringify(settledFrame(run.stdout))).toContain('"contractEmitted":true');
    },
    timeouts.spinUpDbServer,
  );

  it(
    'surfaces the failing child bin stderr tail in the CLI.INIT_EMIT_FAILED diagnostic',
    async () => {
      installFakePrismaCli(
        [
          "process.stderr.write('emit-e2e-marker: scaffolded emit exploded\\n');",
          'process.exit(3);',
          '',
        ].join('\n'),
      );

      const run = await runInit();

      expect(run.exitCode, `stdout:\n${run.stdout}\nstderr:\n${run.stderr}`).toBe(5);
      const frame = JSON.stringify(settledFrame(run.stdout));
      expect(frame).toContain('CLI.INIT_EMIT_FAILED');
      expect(frame).toContain('emit-e2e-marker: scaffolded emit exploded');
      expect(frame).toContain('exited with code 3');
    },
    timeouts.spinUpDbServer,
  );
});
