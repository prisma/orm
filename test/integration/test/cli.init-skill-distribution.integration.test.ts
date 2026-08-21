import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { delimiter as pathDelimiter } from 'node:path';
import { join, resolve } from 'pathe';
import { afterEach, describe, expect, it } from 'vitest';
import { createIntegrationTestDir } from './utils/cli-test-helpers';

const WORKSPACE_ROOT = resolve(import.meta.dirname, '../../..');
const CLI_BIN = resolve(WORKSPACE_ROOT, 'packages/1-framework/3-tooling/cli/dist/bin.mjs');

/**
 * What a consumer's project looks like after `init` where skills are
 * concerned: the skill tree ships inside the packages, so init's whole job is
 * to run the sync once and leave behind the wiring that keeps re-running it.
 * This exercises the real CLI bin as a subprocess against a fake package
 * manager, so the assertions are about the commands init actually spawns and
 * the files it actually writes.
 */
function runEngineInit(
  testDir: string,
  env: Readonly<Record<string, string | undefined>>,
  ...extraArgs: string[]
): { readonly exitCode: number; readonly stderr: string } {
  const result = spawnSync(
    process.execPath,
    [CLI_BIN, 'orm', 'init', '--target', 'postgres', '--authoring', 'psl', '--yes', ...extraArgs],
    { cwd: testDir, encoding: 'utf8', env: { ...process.env, ...env } },
  );
  return { exitCode: result.status ?? 1, stderr: result.stderr ?? '' };
}

function initProject(...extraArgs: string[]): {
  readonly testDir: string;
  readonly exitCode: number;
  readonly stderr: string;
  readonly commands: readonly string[];
} {
  const testDir = createIntegrationTestDir();
  writeFileSync(join(testDir, 'pnpm-lock.yaml'), '', 'utf8');
  const { fakeBinDir, logPath } = createFakeManagerHarness(testDir);
  const { exitCode, stderr } = runEngineInit(
    testDir,
    {
      PATH: `${fakeBinDir}${pathDelimiter}${process.env['PATH'] ?? ''}`,
      TEST_FAKE_DLX_LOG: logPath,
    },
    ...extraArgs,
  );
  return { testDir, exitCode, stderr, commands: readLoggedCommands(logPath) };
}

function manifestOf(testDir: string): { readonly scripts?: Record<string, string> } {
  return JSON.parse(readFileSync(join(testDir, 'package.json'), 'utf8'));
}

function gitignoreOf(testDir: string): string {
  return readFileSync(join(testDir, '.gitignore'), 'utf8');
}

const SYNC_COMMAND = 'dlx prisma@next skills sync';

const MANAGED_SKILL_PATHS = [
  '.claude/skills/prisma-8/',
  '.cursor/skills/prisma-8/',
  '.agents/skills/prisma-8/',
  '.windsurf/skills/prisma-8/',
];

describe('init skill distribution (offline integration, real CLI)', () => {
  const testDirs = new Set<string>();

  afterEach(() => {
    for (const dir of testDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    testDirs.clear();
  });

  it('syncs the skills out of the installed packages, once', { timeout: 60_000 }, async () => {
    const { testDir, exitCode, stderr, commands } = initProject();
    testDirs.add(testDir);

    expect(exitCode, stderr).toBe(0);
    const syncCommands = commands.filter((command) => command.includes('skills sync'));
    expect(syncCommands).toEqual([SYNC_COMMAND]);
  });

  it('fetches no skills from GitHub any more', { timeout: 60_000 }, async () => {
    const { testDir, commands } = initProject();
    testDirs.add(testDir);

    expect(commands.filter((command) => command.includes('skills add'))).toEqual([]);
    expect(commands.filter((command) => command.includes('prisma/prisma'))).toEqual([]);
  });

  it('names one binary everywhere: the one it installed', { timeout: 60_000 }, async () => {
    const { testDir, commands } = initProject();
    testDirs.add(testDir);

    // The postinstall and the emit script both name `prisma`, so the package
    // that carries that bin is the one that has to be installed. Naming
    // @prisma/cli here (bin `prisma-cli`) would leave both scripts calling a
    // binary the project does not have, and `|| exit 0` would hide it.
    expect(commands).toContain('add -D prisma@next @types/node');
    expect(commands).toContain(SYNC_COMMAND);
    expect(manifestOf(testDir).scripts).toMatchObject({
      postinstall: 'prisma skills sync || exit 0',
      'contract:emit': 'prisma contract emit',
    });
  });

  it('leaves the wiring that keeps the skills current', { timeout: 60_000 }, async () => {
    const { testDir } = initProject();
    testDirs.add(testDir);

    expect(manifestOf(testDir).scripts).toMatchObject({
      postinstall: 'prisma skills sync || exit 0',
    });
    for (const path of MANAGED_SKILL_PATHS) {
      expect(gitignoreOf(testDir)).toContain(path);
    }
  });

  it('removes skill directories the router replaced', { timeout: 60_000 }, async () => {
    const testDir = createIntegrationTestDir();
    testDirs.add(testDir);
    writeFileSync(join(testDir, 'pnpm-lock.yaml'), '', 'utf8');
    const retired = join(testDir, '.agents', 'skills', 'prisma-next-upgrade');
    mkdirSync(retired, { recursive: true });
    writeFileSync(join(retired, 'SKILL.md'), '---\nname: prisma-next-upgrade\n---\n', 'utf8');

    const { fakeBinDir, logPath } = createFakeManagerHarness(testDir);
    const { exitCode, stderr } = runEngineInit(testDir, {
      PATH: `${fakeBinDir}${pathDelimiter}${process.env['PATH'] ?? ''}`,
      TEST_FAKE_DLX_LOG: logPath,
    });

    expect(exitCode, stderr).toBe(0);
    expect(existsSync(retired)).toBe(false);
  });

  it('under --skip-skills, syncs nothing and writes no wiring', { timeout: 60_000 }, async () => {
    const { testDir, exitCode, stderr, commands } = initProject('--skip-skills');
    testDirs.add(testDir);

    expect(exitCode, stderr).toBe(0);
    expect(commands.filter((command) => command.includes('skills'))).toEqual([]);
    expect(manifestOf(testDir).scripts?.['postinstall']).toBeUndefined();
    expect(gitignoreOf(testDir)).not.toContain('skills/prisma-8/');
  });
});

/**
 * Stand-in for the project's package manager. A real `pnpm dlx
 * @prisma/cli@next skills sync` would fetch from the npm registry, which an
 * offline test cannot do, so `pnpm` on `PATH` is replaced by a Node script
 * that logs every invocation, reports success, and leaves behind the part of
 * the "installed" project init reads next.
 */
function createFakeManagerHarness(testDir: string): {
  readonly fakeBinDir: string;
  readonly logPath: string;
} {
  const fakeBinDir = join(testDir, '.fake-bin');
  const logPath = join(testDir, '.fake-dlx.log');
  mkdirSync(fakeBinDir, { recursive: true });
  writeFileSync(
    join(fakeBinDir, 'pnpm'),
    `#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const cwd = process.cwd();
const logPath = process.env.TEST_FAKE_DLX_LOG;

if (args[0] === 'add' || args[0] === 'install') {
  materializePrismaCliStub(cwd);
}

/**
 * The shim reports a successful install without fetching anything, so the
 * project it leaves behind has to contain what \`init\` reads next: init emits
 * by spawning the project-local \`prisma\` binary it resolves through
 * \`prisma/package.json\`. Without this stub the emit step fails, init
 * settles at exit 5, and the skill sync this file is about never runs.
 *
 * The binary only has to exit 0 — no assertion here reads the emitted
 * contract, and the emit path itself is covered by the CLI's own unit tests
 * and by test/e2e/framework/test/init-emit-subprocess.test.ts.
 */
function materializePrismaCliStub(projectDir) {
  const packageDir = path.join(projectDir, 'node_modules', 'prisma');
  fs.mkdirSync(packageDir, { recursive: true });
  fs.writeFileSync(
    path.join(packageDir, 'package.json'),
    JSON.stringify({ name: 'prisma', version: '0.0.0-test', bin: { prisma: 'bin.mjs' } }),
    'utf8',
  );
  fs.writeFileSync(path.join(packageDir, 'bin.mjs'), 'process.exit(0);\\n', 'utf8');
}

if (logPath) {
  fs.appendFileSync(logPath, JSON.stringify({ cwd, args, status: 0 }) + '\\n', 'utf8');
}
process.exit(0);
`,
    'utf8',
  );
  // Make the shim executable (POSIX) and provide a Windows shim for parity.
  // chmod is a no-op on Windows.
  const { chmodSync } = require('node:fs');
  chmodSync(join(fakeBinDir, 'pnpm'), 0o755);
  writeFileSync(
    join(fakeBinDir, 'pnpm.cmd'),
    '@echo off\r\nnode "%~dp0pnpm" %*\r\nexit /b %ERRORLEVEL%\r\n',
    'utf8',
  );
  return { fakeBinDir, logPath };
}

function readLoggedCommands(logPath: string): readonly string[] {
  if (!existsSync(logPath)) return [];
  return readFileSync(logPath, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as { readonly args: readonly string[] })
    .map((entry) => entry.args.join(' '));
}
