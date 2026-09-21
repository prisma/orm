import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { timeouts } from '@repo/test-utils';
import { join } from 'pathe';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { type BackendHarness, HARNESS_PATHS, sleep, startBackendHarness } from './backend-harness';

/**
 * End-to-end CLI-process coverage for telemetry. Spawns the compiled
 * engine bin (`node dist/bin.mjs ...`) against an isolated
 * `XDG_CONFIG_HOME` per test, points the in-binary endpoint at the test
 * backend, and asserts the rows the detached sender ends up writing.
 *
 * The engine bin reports through the run's `onSettled` hook
 * (`src/orm/telemetry/reporting.ts`), so what these cases pin is the
 * settlement-time contract:
 *
 *   - `--help` never settles a mounted command, so it emits nothing,
 *   - a run that settles — completed or errored — emits exactly one row,
 *   - the row carries the settled exit code,
 *   - installation ids persist across invocations of one XDG home.
 *
 * The commander-era "a crash after the preAction hook still produces a
 * row" scenario is gone by design: with `onSettled` a run killed before
 * settlement emits nothing. Its inverse lives here instead — an
 * erroring-but-settling run produces a row carrying the exit code.
 *
 * Each test stands up its own tempdir for `XDG_CONFIG_HOME` and a
 * separate tempdir for the project's cwd. CI detection is suppressed by
 * explicitly setting `CI=false` in the child env, and the opt-out
 * signals are stripped so the gating layer behaves as on a real user
 * machine. Row assertions use `awaitRowsForInstallation(...)` so a slow
 * detached sender from a prior case cannot contaminate the next one.
 */

const CLI_BIN_PATH = HARNESS_PATHS.CLI_BIN_PATH;

let harness: BackendHarness;
const tempDirs: string[] = [];

beforeAll(async () => {
  harness = await startBackendHarness();
}, timeouts.spinUpPpgDev);

let xdgDir: string;
let projectDir: string;

beforeEach(async () => {
  await harness.clearRows();
  xdgDir = mkdtempSync(join(tmpdir(), 'cli-e2e-xdg-'));
  projectDir = mkdtempSync(join(tmpdir(), 'cli-e2e-proj-'));
  tempDirs.push(xdgDir, projectDir);
  writeFileSync(join(projectDir, 'package.json'), JSON.stringify({ name: 'cli-e2e-fixture' }));
});

// Tempdir cleanup is deferred to `afterAll`: the detached telemetry
// sender may still be in flight when a test completes, and pulling its
// `XDG_CONFIG_HOME` out from under it mid-write produces ENOENT spam.
afterAll(async () => {
  await harness?.stop();
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  if (harness?.database !== undefined) {
    await harness.database.close();
  }
}, timeouts.spinUpPpgDev);

interface CliResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Spawn the engine bin as `node dist/bin.mjs ...`. The detached
 * telemetry sender the settlement hook forks is not observable through
 * these handles (it is `unref()`d and inherits no stdio), so callers
 * verify its work via `harness.awaitRowsForInstallation(...)`.
 */
function spawnCli(
  args: readonly string[],
  options: { readonly env: NodeJS.ProcessEnv; readonly cwd: string },
): Promise<CliResult> {
  return new Promise((resolveCli, reject) => {
    const child = spawn('node', [CLI_BIN_PATH, ...args], {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout?.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(chunk));
    child.on('error', reject);
    child.on('exit', (code) =>
      resolveCli({
        exitCode: code,
        stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
        stderr: Buffer.concat(stderrChunks).toString('utf-8'),
      }),
    );
  });
}

/**
 * Build the child env for a CLI spawn: strips every opt-out signal so
 * the production gating logic is exercised, pins `CI=false` so
 * `ci-info` reports a non-CI environment regardless of where the test
 * runs, and points the endpoint at the test backend.
 */
function buildEnv(xdg: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env['PRISMA_DISABLE_TELEMETRY'];
  delete env['DO_NOT_TRACK'];
  delete env['PRISMA_DEBUG'];
  return {
    ...env,
    CI: 'false',
    XDG_CONFIG_HOME: xdg,
    PRISMA_TELEMETRY_ENDPOINT: harness.endpointBase,
  };
}

/**
 * Seed `$XDG_CONFIG_HOME/prisma-8/config.json` with a pre-generated
 * consent + installation id, so the assertion can pin the exact id.
 */
function seedConsent(xdg: string, installationId: string): void {
  const dir = join(xdg, 'prisma-8');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'config.json'),
    `${JSON.stringify({ enableTelemetry: true, installationId }, null, 2)}\n`,
  );
}

const V4_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// A cheap run that errors but settles: `migration list` in a project
// directory with no config file settles errored (CONFIG.FILE_NOT_FOUND)
// at exit 2, which is exactly what the settlement hook reports.
const SETTLING_COMMAND = ['migration', 'list'] as const;

describe('cli-telemetry e2e — engine bin against the real backend', () => {
  it('prisma-8 --help on a fresh XDG_CONFIG_HOME writes no config.json and emits no event', async () => {
    const result = await spawnCli(['--help'], { env: buildEnv(xdgDir), cwd: projectDir });

    expect(result.exitCode).toBe(0);
    expect(existsSync(join(xdgDir, 'prisma-8', 'config.json'))).toBe(false);

    // `onSettled` never fires for --help (no mounted command settles), so
    // no fork should ever happen. Wait a beat anyway so a regression that
    // reported help runs would show up as a row arriving.
    await sleep(1000);
    expect(await harness.readRows()).toHaveLength(0);
  });

  it('a settling run with seeded consent emits one backend row carrying the stored installationId', async () => {
    const installationId = randomUUID();
    seedConsent(xdgDir, installationId);

    await spawnCli([...SETTLING_COMMAND], { env: buildEnv(xdgDir), cwd: projectDir });
    const rows = await harness.awaitRowsForInstallation(installationId, 1);

    expect(rows[0]?.installationId).toBe(installationId);
    expect(rows[0]?.installationId).toMatch(V4_UUID);
    expect(rows[0]?.command).toBe('migration list');
  });

  it('a second invocation reusing the same XDG_CONFIG_HOME produces a second row sharing the installationId', async () => {
    const installationId = randomUUID();
    seedConsent(xdgDir, installationId);

    await spawnCli([...SETTLING_COMMAND], { env: buildEnv(xdgDir), cwd: projectDir });
    await spawnCli([...SETTLING_COMMAND], { env: buildEnv(xdgDir), cwd: projectDir });
    const rows = await harness.awaitRowsForInstallation(installationId, 2);

    expect(rows).toHaveLength(2);
    expect(rows[0]?.installationId).toBe(installationId);
    expect(rows[1]?.installationId).toBe(installationId);
  });

  it('an erroring-but-settling run produces a row carrying the exit code', async () => {
    const installationId = randomUUID();
    seedConsent(xdgDir, installationId);

    const result = await spawnCli([...SETTLING_COMMAND], {
      env: buildEnv(xdgDir),
      cwd: projectDir,
    });

    // The run errors (no config file) but settles, so `onSettled` fires
    // with the exit code already determined — that code rides the event.
    expect(result.exitCode).toBe(2);
    const rows = await harness.awaitRowsForInstallation(installationId, 1);
    expect(rows[0]?.installationId).toBe(installationId);
    expect(rows[0]?.exitCode).toBe(2);
  });
});
