import * as childProcess from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runTelemetry } from '../src/spawn';
import { userConfigPath, writeUserConfig } from '../src/user-config';

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof childProcess>('node:child_process');
  return { ...actual, fork: vi.fn() };
});

const commandInput = {
  commandPath: ['prisma', 'init'],
  positionalArgs: [],
  options: [],
};

describe('test runs short-circuit the telemetry path', () => {
  let xdgRoot: string;
  let originalXdg: string | undefined;

  beforeEach(() => {
    xdgRoot = mkdtempSync(join(tmpdir(), 'cli-telemetry-probe-'));
    originalXdg = process.env['XDG_CONFIG_HOME'];
    process.env['XDG_CONFIG_HOME'] = xdgRoot;
    mkdirSync(dirname(userConfigPath()), { recursive: true });
    vi.mocked(childProcess.fork).mockReset();
  });

  afterEach(() => {
    if (originalXdg === undefined) {
      delete process.env['XDG_CONFIG_HOME'];
    } else {
      process.env['XDG_CONFIG_HOME'] = originalXdg;
    }
    rmSync(xdgRoot, { recursive: true, force: true });
  });

  it('the test harness sets PRISMA_DISABLE_TELEMETRY=1', () => {
    expect(process.env['PRISMA_DISABLE_TELEMETRY']).toBe('1');
  });

  it('runTelemetry returns gated-off under the harness env even with a stored opt-in', () => {
    writeUserConfig({ enableTelemetry: true });
    const result = runTelemetry({
      command: commandInput,
      version: '0.9.0',
      exitCode: undefined,
      projectRoot: process.cwd(),
      senderPath: '/never/used',
      isCI: false,
    });
    expect(result).toEqual({ spawned: false, reason: 'gated-off' });
  });

  it('child_process.fork is never called from runTelemetry under the harness env', () => {
    writeUserConfig({ enableTelemetry: true });
    runTelemetry({
      command: commandInput,
      version: '0.9.0',
      exitCode: undefined,
      projectRoot: process.cwd(),
      senderPath: '/never/used',
      isCI: false,
    });
    expect(childProcess.fork).not.toHaveBeenCalled();
  });
});
