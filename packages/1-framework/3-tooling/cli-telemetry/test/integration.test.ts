import { fork } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { timeouts } from '@repo/test-utils';
import { join } from 'pathe';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ParentToSenderPayload } from '../src/payload';
import { type BackendHarness, HARNESS_PATHS, startBackendHarness } from './backend-harness';

const SENDER_PATH = HARNESS_PATHS.SENDER_PATH;

let harness: BackendHarness;
let projectDir: string;

/**
 * Build a `prisma.config.mjs` source string with the minimum
 * descriptor shape that `validateConfig` (from
 * `@internal/config/config-validation`) accepts. The integration
 * test exercises the full c12 + validator pipeline in the detached
 * child, so the fixture has to be structurally valid.
 */
function validConfigSource(extensionPackIds: readonly string[]): string {
  const descriptor = (kind: string) =>
    `{ kind: '${kind}', id: 'postgres', familyId: 'sql', targetId: 'postgres', version: '0.0.1', create: () => ({}) }`;
  const packs = extensionPackIds
    .map(
      (id) =>
        `{ kind: 'extension', id: '${id}', familyId: 'sql', targetId: 'postgres', version: '0.0.1', create: () => ({}) }`,
    )
    .join(', ');
  return [
    'const orm = {',
    `  family: { kind: 'family', id: 'sql', familyId: 'sql', version: '0.0.1', emission: {}, create: () => ({}) },`,
    `  target: ${descriptor('target')},`,
    `  adapter: ${descriptor('adapter')},`,
    `  extensions: [${packs}],`,
    '};',
    'export default { $prismaConfig: 1, orm };\n',
  ].join('\n');
}

beforeAll(async () => {
  harness = await startBackendHarness();
  projectDir = mkdtempSync(join(tmpdir(), 'cli-telemetry-int-project-'));
  writeFileSync(
    join(projectDir, 'package.json'),
    JSON.stringify({ name: 'fixture', devDependencies: { typescript: '^5.9.3' } }),
  );
  // The detached child reads `prisma.config.*` via c12 and runs
  // it through `@internal/config`'s `validateConfig` to derive
  // `databaseTarget` + `extensions`. The integration suite exercises
  // the full pipeline; write a `.mjs` fixture that satisfies the
  // canonical validator so the happy-path assertions on those fields
  // stay end-to-end.
  writeFileSync(join(projectDir, 'prisma.config.mjs'), validConfigSource(['pgvector', 'paradedb']));
}, timeouts.spinUpPpgDev);

beforeEach(async () => {
  await harness.clearRows();
});

afterAll(async () => {
  await harness?.stop();
  if (projectDir !== undefined) {
    rmSync(projectDir, { recursive: true, force: true });
  }
  if (harness?.database !== undefined) {
    await harness.database.close();
  }
}, timeouts.spinUpPpgDev);

function buildPayload(overrides: Partial<ParentToSenderPayload> = {}): ParentToSenderPayload {
  return {
    installationId: '00000000-0000-4000-8000-000000000001',
    version: '0.9.0',
    command: 'migration new',
    flags: ['name', 'dry-run'],
    projectRoot: projectDir,
    endpoint: `${harness.endpointBase}/events`,
    ...overrides,
  };
}

function spawnSenderDirect(
  payload: ParentToSenderPayload,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  return new Promise((resolveSender, reject) => {
    const child = fork(SENDER_PATH, [], {
      stdio: ['pipe', 'ignore', 'ignore', 'ipc'],
      env,
    });
    child.on('error', reject);
    child.on('exit', () => resolveSender());
    child.send(payload);
  });
}

interface SilentSenderResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Spawn the sender with stdout + stderr piped into in-memory buffers so a
 * test can assert on what the child wrote. The original failure-mode tests
 * used `stdio: ['pipe', 'ignore', 'ignore', 'ipc']` which discarded the
 * child's stderr entirely; this helper captures it so the test can pin the
 * silence invariant (no telemetry-originating output appears on stdout or
 * stderr in normal mode; output appears only under `PRISMA_DEBUG=1`).
 *
 * Resolves on `exit` + both stdio streams reporting `end`. `close` is the
 * usual way to wait for both, but the sender's IPC-disconnect-driven idle
 * exit leaves the parent's ChildProcess in a state where `close` never
 * fires (the IPC channel reference appears to linger on the parent side
 * even after the child has exited and the stdio pipes have emitted `end`).
 * Composing the three signals directly avoids that hang.
 */
function spawnSenderCapturingStdio(options: {
  readonly payload?: ParentToSenderPayload;
  readonly env: NodeJS.ProcessEnv;
  readonly onSpawn?: (child: import('node:child_process').ChildProcess) => void;
}): Promise<SilentSenderResult> {
  return new Promise((resolveSender, reject) => {
    const child = fork(SENDER_PATH, [], {
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      env: options.env,
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutEnded = child.stdout === null;
    let stderrEnded = child.stderr === null;
    let exited = false;
    let exitCode: number | null = null;
    let settled = false;

    const maybeResolve = (): void => {
      if (settled || !exited || !stdoutEnded || !stderrEnded) return;
      settled = true;
      resolveSender({
        exitCode,
        stdout: Buffer.concat(stdoutChunks).toString('utf-8'),
        stderr: Buffer.concat(stderrChunks).toString('utf-8'),
      });
    };

    child.stdout?.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(chunk));
    child.stdout?.on('end', () => {
      stdoutEnded = true;
      maybeResolve();
    });
    child.stderr?.on('end', () => {
      stderrEnded = true;
      maybeResolve();
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      exited = true;
      exitCode = code;
      maybeResolve();
    });

    if (options.payload !== undefined) {
      child.send(options.payload);
    }
    options.onSpawn?.(child);
  });
}

/**
 * Returns a copy of the current process env with `PRISMA_DEBUG` deleted
 * (so the failure-mode tests assert silence under the default-off debug
 * setting irrespective of whatever the developer's shell exports), then
 * layers `extra` on top — callers explicitly opt in to debug by passing
 * `{ PRISMA_DEBUG: '1' }`.
 */
function envWithoutDebug(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env['PRISMA_DEBUG'];
  return { ...env, ...extra };
}

describe('cli-telemetry end-to-end via telemetry backend', () => {
  it('forks the sender, the child POSTs the event, and the backend stores the wire shape', async () => {
    const result = await spawnSenderCapturingStdio({
      payload: buildPayload(),
      env: envWithoutDebug(),
    });
    const [row] = await harness.awaitRows(1);

    expect(row?.installationId).toBe('00000000-0000-4000-8000-000000000001');
    expect(row?.version).toBe('0.9.0');
    expect(row?.command).toBe('migration new');
    expect(row?.flags).toEqual(['name', 'dry-run']);
    expect(row?.databaseTarget).toBe('postgres');
    expect(row?.extensions).toEqual(['pgvector', 'paradedb']);
    expect(typeof row?.runtimeName).toBe('string');
    expect(typeof row?.runtimeVersion).toBe('string');
    expect(typeof row?.os).toBe('string');
    expect(typeof row?.arch).toBe('string');
    expect(row?.tsVersion).toBe('5.9.3');

    // Happy-path silence: the child never writes to stdout or stderr when
    // PRISMA_DEBUG is unset, even when the POST succeeds.
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
  });

  it('transmits only flag names, never values or positionals', async () => {
    const sensitiveFlags = ['connection-string', 'name', 'config'];
    await spawnSenderDirect(buildPayload({ flags: sensitiveFlags }));
    const [row] = await harness.awaitRows(1);

    expect(row?.flags).toEqual(sensitiveFlags);
    const serialised = JSON.stringify(row);
    expect(serialised).not.toMatch(/postgres:\/\/u:p@h\/d/);
    expect(serialised).not.toMatch(/customer-acme-payments/);
    expect(serialised).not.toMatch(/\/Users\/alice\/secrets/);
  });

  it('round-trips a string[] of declared extension-pack ids verbatim from prisma.config', async () => {
    // Override the suite's shared fixture for this test so the child's
    // c12 load resolves a different extension-pack set. Restored in
    // the `finally` so the rest of the suite keeps seeing the default.
    const configPath = join(projectDir, 'prisma.config.mjs');
    const previous = readFileSync(configPath, 'utf-8');
    writeFileSync(configPath, validConfigSource(['pgvector', 'paradedb', 'myorg-custom-ext']));
    try {
      await spawnSenderDirect(buildPayload());
      const [row] = await harness.awaitRows(1);
      expect(row?.extensions).toEqual(['pgvector', 'paradedb', 'myorg-custom-ext']);
    } finally {
      writeFileSync(configPath, previous);
    }
  });

  // The agent-field tests hand the child an explicit minimal env instead of
  // a scrubbed copy of `process.env`, so the suite stays hermetic no matter
  // which agent markers the developer's (or CI's) own session exports.
  it('populates the agent field from the child env', async () => {
    await spawnSenderDirect(buildPayload(), { CLAUDECODE: '1' });
    const [row] = await harness.awaitRows(1);
    expect(row?.agent).toBe('claude');
  });

  it('populates the agent field for Gemini CLI sessions', async () => {
    await spawnSenderDirect(buildPayload(), { GEMINI_CLI: '1' });
    const [row] = await harness.awaitRows(1);
    expect(row?.agent).toBe('gemini');
  });

  it('passes null agent when no marker env var is set', async () => {
    await spawnSenderDirect(buildPayload(), {});
    const [row] = await harness.awaitRows(1);
    expect(row?.agent).toBeNull();
  });

  it('produces a backend-accepted row containing the required field set', async () => {
    await spawnSenderDirect(buildPayload());
    const [row] = await harness.awaitRows(1);
    const required = [
      row?.installationId,
      row?.version,
      row?.command,
      row?.runtimeName,
      row?.runtimeVersion,
      row?.os,
      row?.arch,
    ];
    for (const field of required) {
      expect(typeof field).toBe('string');
      expect(field?.length).toBeGreaterThan(0);
    }
  });
});

describe('cli-telemetry end-to-end — failure modes are silent', () => {
  it('the sender swallows a network failure (parent never knows) and stays silent', async () => {
    const payload = buildPayload({ endpoint: 'http://127.0.0.1:1/events' });
    const result = await spawnSenderCapturingStdio({
      payload,
      env: envWithoutDebug(),
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
  });

  it(
    'the sender exits 0 when no payload is received within the idle timeout, and stays silent',
    async () => {
      const result = await spawnSenderCapturingStdio({
        env: envWithoutDebug(),
        onSpawn: (child) => {
          setTimeout(() => child.disconnect(), 50);
        },
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe('');
      expect(result.stderr).toBe('');
    },
    // The sender's idle-exit timeout is ~3s (REQUEST_TIMEOUT_MS × 2).
    // `databaseOperation` (5s base, scaled by `TEST_TIMEOUT_MULTIPLIER`)
    // is the closest semantic helper exposed by `@repo/test-utils`
    // for an end-to-end operation that should finish within a few
    // seconds; on CI with `TEST_TIMEOUT_MULTIPLIER=2` it becomes 10s,
    // matching the previous hardcoded value.
    timeouts.databaseOperation,
  );

  it('emits diagnostics to stderr under PRISMA_DEBUG=1', async () => {
    const payload = buildPayload({ endpoint: 'http://127.0.0.1:1/events' });
    const result = await spawnSenderCapturingStdio({
      payload,
      env: envWithoutDebug({ PRISMA_DEBUG: '1' }),
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('');
    // Debug-mode invariants: every diagnostic line carries the
    // `[cli-telemetry]` prefix and the network failure surfaces as a
    // `send failed` line so a future refactor that quietly removes the
    // diagnostic path fails this test.
    expect(result.stderr).toContain('[cli-telemetry]');
    expect(result.stderr).toContain('send failed');
  });
});
