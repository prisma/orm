import type { RunTelemetryInputs, TelemetryRunOutcome } from '@internal/cli-telemetry';
import type { RunSummary } from '@prisma/cli-engine';
import { describe, expect, it } from 'vitest';
import { resolveTelemetryHooks } from '../../src/orm/telemetry/reporting';

const summary: RunSummary = {
  commandId: 'migration.list',
  exitCode: 2,
  durationMs: 12,
  snapshot: {
    commandPath: ['migration', 'list'],
    positionalCount: 0,
    flags: [{ name: 'json', source: 'cli' }],
  },
};

function collectingProc() {
  const writes: string[] = [];
  return {
    env: {},
    cwd: () => '/project',
    stderr: {
      write: (chunk: string) => {
        writes.push(chunk);
        return true;
      },
    },
    writes,
  };
}

describe('resolveTelemetryHooks', () => {
  it('returns no hook in CI', () => {
    expect(resolveTelemetryHooks(collectingProc(), { inCI: true })).toBeUndefined();
  });

  it('reports the settled exit code through the sender inputs', () => {
    const fired: RunTelemetryInputs[] = [];
    const fire = (inputs: RunTelemetryInputs): TelemetryRunOutcome => {
      fired.push(inputs);
      return { spawned: true };
    };
    const hooks = resolveTelemetryHooks(collectingProc(), {
      inCI: false,
      fire,
      senderPath: '/unused/sender.mjs',
    });
    expect(hooks).toBeDefined();
    hooks?.onSettled?.(summary);
    expect(fired).toHaveLength(1);
    expect(fired[0]).toMatchObject({
      exitCode: 2,
      command: {
        commandPath: ['prisma', 'migration', 'list'],
        positionalArgs: [],
        options: [{ attributeName: 'json', longName: '--json', source: 'cli' }],
      },
    });
  });
});
